// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Hackathon reference wallet. Not audited for deployment with real funds.
/// @dev Only token transfers are exposed: the agent cannot call arbitrary contracts,
///      raise limits, grant allowances, or update primary-owner availability.
contract OperatingWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant AGENT_TX_LIMIT = 250 * 1e6;
    uint256 public constant AGENT_DAILY_LIMIT = 1_000 * 1e6;
    uint256 public constant SUPERVISOR_TX_LIMIT = 5_000 * 1e6;
    uint256 public constant BACKUP_DELAY = 4 hours;
    uint256 public constant RECOVERY_SILENCE = 7 days;
    uint256 public constant RECOVERY_DELAY = 48 hours;
    uint256 public constant GUARDIAN_QUORUM = 2;

    IERC20 public immutable token;
    address public owner;
    address public immutable agent;
    address public immutable backup;
    uint256 public lastOwnerAction;
    bool public agentEnabled = true;
    mapping(address => bool) public approvedRecipients;
    mapping(uint256 => uint256) public agentSpendByDay;
    mapping(address => bool) public isGuardian;
    mapping(bytes32 => bool) public usedActionIds;

    address public recoveryCandidate;
    uint256 public recoveryNonce;
    uint256 public recoveryVotes;
    uint256 public recoveryUnlockAt;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event Executed(bytes32 indexed actionId, address indexed signer, address recipient, uint256 amount, bool autonomous);
    event OwnerAction(address indexed owner, bytes32 indexed decisionId, bool approved);
    event RecipientPolicy(address indexed recipient, bool allowed);
    event RecoveryStarted(uint256 indexed nonce, address indexed candidate);
    event RecoveryApproved(uint256 indexed nonce, address indexed guardian, uint256 votes);
    event RecoveryCancelled(uint256 indexed nonce);
    event AuthorityTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() { require(msg.sender == owner, "owner only"); _; }
    modifier onlyGuardian() { require(isGuardian[msg.sender], "guardian only"); _; }

    constructor(address token_, address owner_, address agent_, address backup_, address[3] memory guardians_) {
        require(token_ != address(0) && owner_ != address(0) && agent_ != address(0) && backup_ != address(0), "zero address");
        require(owner_ != agent_ && backup_ != agent_ && owner_ != backup_, "distinct operating roles");
        require(IERC20Metadata(token_).decimals() == 6, "six decimal token required");
        token = IERC20(token_); owner = owner_; agent = agent_; backup = backup_;
        lastOwnerAction = block.timestamp;
        for (uint256 i; i < 3; i++) {
            address guardian = guardians_[i];
            require(guardian != address(0) && !isGuardian[guardian] && guardian != agent_, "invalid guardian");
            isGuardian[guardian] = true;
        }
    }

    function backupActive() public view returns (bool) {
        return block.timestamp >= lastOwnerAction + BACKUP_DELAY;
    }

    function setRecipient(address recipient, bool allowed) external onlyOwner {
        require(recipient != address(0) && recipient != address(this), "invalid recipient");
        approvedRecipients[recipient] = allowed;
        lastOwnerAction = block.timestamp;
        emit RecipientPolicy(recipient, allowed);
    }

    function setAgentEnabled(bool enabled) external onlyOwner {
        agentEnabled = enabled;
        lastOwnerAction = block.timestamp;
    }

    /// @notice A primary-owner signature on a real decision refreshes availability.
    ///         Agents, guardians, and the backup cannot call this function.
    function recordDecision(bytes32 decisionId, bool approved) external onlyOwner {
        lastOwnerAction = block.timestamp;
        emit OwnerAction(msg.sender, decisionId, approved);
    }

    function executeAgent(bytes32 actionId, address recipient, uint256 amount) external nonReentrant {
        require(msg.sender == agent && agentEnabled, "agent unavailable");
        require(approvedRecipients[recipient], "recipient not allowed");
        require(amount > 0 && amount <= AGENT_TX_LIMIT, "agent transaction limit");
        uint256 day = block.timestamp / 1 days;
        require(agentSpendByDay[day] + amount <= AGENT_DAILY_LIMIT, "agent daily limit");
        agentSpendByDay[day] += amount;
        _pay(actionId, recipient, amount, true);
        // Intentionally does NOT update lastOwnerAction.
    }

    function executeSupervisor(bytes32 actionId, address recipient, uint256 amount) external nonReentrant {
        require(msg.sender == owner || (msg.sender == backup && backupActive()), "supervisor unavailable");
        require(amount > 0 && amount <= SUPERVISOR_TX_LIMIT, "supervisor transaction limit");
        if (msg.sender == owner) lastOwnerAction = block.timestamp;
        _pay(actionId, recipient, amount, false);
    }

    function _pay(bytes32 actionId, address recipient, uint256 amount, bool autonomous) internal {
        require(!usedActionIds[actionId], "action already executed");
        require(recipient != address(0) && recipient != address(this), "invalid recipient");
        usedActionIds[actionId] = true;
        token.safeTransfer(recipient, amount);
        emit Executed(actionId, msg.sender, recipient, amount, autonomous);
    }

    function initiateRecovery(address candidate) external onlyGuardian {
        require(block.timestamp >= lastOwnerAction + RECOVERY_SILENCE, "owner recently active");
        require(recoveryCandidate == address(0), "recovery already active");
        require(candidate != address(0) && candidate != owner && candidate != agent && candidate != address(this), "invalid candidate");
        recoveryNonce++;
        recoveryCandidate = candidate;
        recoveryVotes = 0;
        recoveryUnlockAt = 0;
        emit RecoveryStarted(recoveryNonce, candidate);
    }

    function approveRecovery() external onlyGuardian {
        require(recoveryCandidate != address(0), "no active recovery");
        require(!hasVoted[recoveryNonce][msg.sender], "guardian already voted");
        hasVoted[recoveryNonce][msg.sender] = true;
        recoveryVotes++;
        if (recoveryVotes == GUARDIAN_QUORUM) recoveryUnlockAt = block.timestamp + RECOVERY_DELAY;
        emit RecoveryApproved(recoveryNonce, msg.sender, recoveryVotes);
    }

    function cancelRecovery() external onlyOwner {
        require(recoveryCandidate != address(0), "no active recovery");
        emit RecoveryCancelled(recoveryNonce);
        _clearRecovery();
        lastOwnerAction = block.timestamp;
    }

    function finalizeRecovery() external {
        require(recoveryCandidate != address(0) && recoveryVotes >= GUARDIAN_QUORUM, "guardian quorum missing");
        require(recoveryUnlockAt != 0 && block.timestamp >= recoveryUnlockAt, "timelock active");
        address previous = owner;
        owner = recoveryCandidate;
        _clearRecovery();
        lastOwnerAction = block.timestamp;
        emit AuthorityTransferred(previous, owner);
    }

    function _clearRecovery() internal {
        recoveryCandidate = address(0);
        recoveryVotes = 0;
        recoveryUnlockAt = 0;
    }
}
