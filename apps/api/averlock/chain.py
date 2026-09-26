"""Local EVM devnet wallet: the Solidity OperatingWallet running on a Hardhat node.

Payments, primary-owner decisions, and guardian recovery become real transactions on a local
chain, sent from the node's unlocked development accounts. The contract enforces the agent's
limits a second time, so a payment the Python gate should never have allowed is still refused
on chain. Development accounts are unlocked by the node: this is a demo network, not
production key management.
"""

import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

from .policy import money
from .seed import now_iso, sim_now

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "contracts" / "artifacts"
UNITS_PER_CENT = 10_000  # the token has six decimals
ROLES = (
    "supervisor",
    "agent",
    "backup",
    "guardian-1",
    "guardian-2",
    "guardian-3",
    "replacement-supervisor",
)
TRANSACTION_LOG = 40
ERROR_SELECTOR = "08c379a0"


class ChainError(ValueError):
    pass


def address_for(name):
    """Deterministic devnet address for a named payment destination such as vendor-a."""
    return "0x" + hashlib.sha256(f"workkite:{name}".encode()).hexdigest()[:40]


def action_key(action_id):
    return action_id.encode()[:32].ljust(32, b"\0")


def _word(value):
    if isinstance(value, bool):
        return f"{int(value):064x}"
    if isinstance(value, int):
        return f"{value:064x}"
    if isinstance(value, bytes):
        return value.hex().ljust(64, "0")
    if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
        return value[2:].lower().rjust(64, "0")
    raise TypeError(f"Cannot ABI-encode {value!r}")


def encode(selector, *args):
    return "0x" + selector + "".join(_word(arg) for arg in args)


def revert_reason(error):
    """Extract a Solidity require() message from a JSON-RPC error."""
    data = error.get("data") if isinstance(error, dict) else None
    if isinstance(data, dict):
        data = data.get("data")
    if isinstance(data, str) and data.startswith("0x" + ERROR_SELECTOR):
        raw = bytes.fromhex(data[10:])
        length = int.from_bytes(raw[32:64], "big")
        return raw[64 : 64 + length].decode(errors="replace")
    message = error.get("message", "") if isinstance(error, dict) else str(error)
    for marker in ("reverted with reason string '", "execution reverted: "):
        if marker in message:
            return message.split(marker, 1)[1].rstrip("'\"")
    return message or "Transaction rejected by the local chain"


class RPC:
    def __init__(self, url, timeout=10):
        self.url, self.timeout, self.sequence = url, timeout, 0

    def __call__(self, method, *params):
        self.sequence += 1
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": self.sequence, "method": method, "params": list(params)}
        ).encode()
        request = urllib.request.Request(self.url, payload, {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                reply = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                reply = json.load(error)
            except ValueError:
                raise ChainError(f"Local chain returned HTTP {error.code}") from error
        except (urllib.error.URLError, OSError) as error:
            raise ChainError(f"Local chain unreachable at {self.url}") from error
        if reply.get("error"):
            raise ChainError(revert_reason(reply["error"]))
        return reply["result"]


class ChainWallet:
    mode = "local-chain"
    network = "Hardhat local devnet"

    def __init__(self, rpc_url, artifacts=ARTIFACTS):
        self.url = rpc_url
        self.rpc = RPC(rpc_url)
        # Status is read on every poll: fail fast if the node went away.
        self.probe = RPC(rpc_url, timeout=2)
        try:
            self.artifacts = {
                name: json.loads((Path(artifacts) / f"{name}.json").read_text())
                for name in ("OperatingWallet", "MockUSDC")
            }
        except FileNotFoundError as error:
            raise RuntimeError(
                "Contract artifacts are missing. Run npm run compile --workspace "
                "@workkite/contracts (npm run dev:chain does this for you)."
            ) from error

    # Low-level helpers -------------------------------------------------------------

    def _selector(self, contract, signature):
        return self.artifacts[contract]["evm"]["methodIdentifiers"][signature]

    def _call(self, to, contract, signature, *args, rpc=None):
        data = encode(self._selector(contract, signature), *args)
        return (rpc or self.rpc)("eth_call", {"to": to, "data": data}, "latest")

    def _send(self, state, role, to, data, summary):
        sender = state["chain"]["accounts"][role]
        transaction = {"from": sender, "to": to, "data": data}
        # Preflight with eth_call so a revert reports the contract's reason without mining.
        self.rpc("eth_call", transaction, "latest")
        tx_hash = self.rpc("eth_sendTransaction", transaction)
        receipt = self.rpc("eth_getTransactionReceipt", tx_hash)
        if not receipt or receipt.get("status") != "0x1":
            raise ChainError(f"Transaction {tx_hash} failed on the local chain")
        return self._log(state, tx_hash, receipt, role, summary)

    def _log(self, state, tx_hash, receipt, role, summary):
        entry = {
            "hash": tx_hash,
            "block": int(receipt["blockNumber"], 16),
            "gas_used": int(receipt["gasUsed"], 16),
            "from_role": role,
            "summary": summary,
            "at": now_iso(),
        }
        chain = state["chain"]
        chain["transactions"] = (chain.get("transactions", []) + [entry])[-TRANSACTION_LOG:]
        return entry

    def _deploy(self, state, sender, contract, arguments=""):
        data = "0x" + self.artifacts[contract]["evm"]["bytecode"]["object"] + arguments
        tx_hash = self.rpc("eth_sendTransaction", {"from": sender, "data": data})
        receipt = self.rpc("eth_getTransactionReceipt", tx_hash)
        if not receipt or receipt.get("status") != "0x1":
            raise ChainError(f"Deploying {contract} failed")
        return receipt["contractAddress"], tx_hash, receipt

    def _deployed(self, state):
        wallet = (state.get("chain") or {}).get("wallet")
        return bool(wallet) and self.rpc("eth_getCode", wallet, "latest") not in ("0x", "0x0")

    # Wallet protocol -----------------------------------------------------------------

    def prepare(self, state, fresh=False):
        state["wallet"]["mode"] = self.mode
        if not fresh and self._deployed(state):
            return
        accounts = self.rpc("eth_accounts")
        if len(accounts) < len(ROLES):
            raise ChainError("The local chain needs at least seven unlocked development accounts")
        roles = dict(zip(ROLES, accounts))
        owner = roles[state["wallet"]["owner"]]
        state["chain"] = {
            "network": self.network,
            "rpc": self.url,
            "chain_id": int(self.rpc("eth_chainId"), 16),
            "accounts": roles,
            "transactions": [],
            "deployed_at": now_iso(),
        }
        token, tx_hash, receipt = self._deploy(state, owner, "MockUSDC")
        self._log(state, tx_hash, receipt, state["wallet"]["owner"], "Deployed demo USDC token")
        guardians = [roles["guardian-1"], roles["guardian-2"], roles["guardian-3"]]
        signers = (token, owner, roles["agent"], roles["backup"], *guardians)
        arguments = "".join(_word(address) for address in signers)
        wallet, tx_hash, receipt = self._deploy(state, owner, "OperatingWallet", arguments)
        self._log(state, tx_hash, receipt, state["wallet"]["owner"], "Deployed OperatingWallet")
        state["chain"].update(token=token, wallet=wallet)
        owner_role = state["wallet"]["owner"]
        amount = state["wallet"]["balance_cents"] * UNITS_PER_CENT
        mint = encode(self._selector("MockUSDC", "mint(address,uint256)"), wallet, amount)
        funded = f"Funded wallet with {money(amount // UNITS_PER_CENT)}"
        self._send(state, owner_role, token, mint, funded)
        allow = self._selector("OperatingWallet", "setRecipient(address,bool)")
        for name in state["policy"]["known_recipients"]:
            data = encode(allow, address_for(name), True)
            self._send(state, owner_role, wallet, data, f"Allowed agent payments to {name}")
        state["chain"]["recipients"] = {
            name: address_for(name) for name in state["policy"]["known_recipients"]
        }
        # Deploying is the owner's own act, so the contract and the workspace start their
        # availability clocks together; demo fast-forwards then move both.
        state["supervision"]["last_owner_action"] = sim_now(state).isoformat()
        state["supervision"]["backup_spent_cents"] = 0

    def execute(self, state, action, autonomous, actor=None):
        if action.get("is_canary"):
            raise ValueError("Training canaries can never execute")
        if action.get("receipt"):
            return action["receipt"]
        if not self._deployed(state):
            self.prepare(state)
        chain = state["chain"]
        key = action_key(action["id"])
        recipient = address_for(action.get("recipient") or "internal")
        amount = action["amount_cents"] * UNITS_PER_CENT
        role = "agent" if autonomous else actor
        signature = (
            "executeAgent(bytes32,address,uint256)"
            if autonomous
            else "executeSupervisor(bytes32,address,uint256)"
        )
        used = self._call(chain["wallet"], "OperatingWallet", "usedActionIds(bytes32)", key)
        if int(used, 16):
            entry = self._reconcile(state, key, role, action)
        else:
            data = encode(self._selector("OperatingWallet", signature), key, recipient, amount)
            summary = (
                f"{action['title']} · {money(action['amount_cents'])} to {action.get('recipient')}"
            )
            entry = self._send(state, role, chain["wallet"], data, summary)
        receipt = {
            "id": entry["hash"],
            "mode": self.mode,
            "tx": entry["hash"],
            "block": entry["block"],
            "signer": role,
            "amount_cents": action["amount_cents"],
            "at": now_iso(),
            "recipient": action.get("recipient", "internal"),
            "recipient_address": recipient,
            "action_id": action["id"],
        }
        state["wallet"]["receipts"].append(receipt)
        state["wallet"]["balance_cents"] = self._balance_cents(state)
        if autonomous:
            state["wallet"]["agent_spent_cents"] += action["amount_cents"]
        return receipt

    def _reconcile(self, state, key, role, action):
        # Already paid on chain (a previous attempt committed there but not locally):
        # recover the original transaction instead of paying twice.
        logs = self.rpc(
            "eth_getLogs",
            {
                "address": state["chain"]["wallet"],
                "topics": [None, "0x" + key.hex()],
                "fromBlock": "0x0",
                "toBlock": "latest",
            },
        )
        if not logs:
            raise ChainError("The chain reports this action as executed but has no payment log")
        receipt = self.rpc("eth_getTransactionReceipt", logs[0]["transactionHash"])
        return self._log(
            state, logs[0]["transactionHash"], receipt, role, f"Reconciled {action['title']}"
        )

    def _balance_cents(self, state, rpc=None):
        chain = state["chain"]
        raw = self._call(chain["token"], "MockUSDC", "balanceOf(address)", chain["wallet"], rpc=rpc)
        return int(raw, 16) // UNITS_PER_CENT

    def record_decision(self, state, actor, decision_id, approved):
        if actor != state["wallet"]["owner"]:
            return None
        if not self._deployed(state):
            self.prepare(state)
        data = encode(
            self._selector("OperatingWallet", "recordDecision(bytes32,bool)"),
            action_key(decision_id),
            bool(approved),
        )
        verb = "approved" if approved else "rejected"
        summary = f"Owner {verb} {decision_id}"
        return self._send(state, actor, state["chain"]["wallet"], data, summary)

    def recover(self, state, operation, actor):
        recovery = state["recovery"]
        if operation == "advance":
            self.advance_time(state, recovery["delay_seconds"])
            return
        if not self._deployed(state):
            self.prepare(state)
        args = ()
        if operation == "start":
            sender, signature = "guardian-1", "initiateRecovery(address)"
            args = (state["chain"]["accounts"][recovery["candidate"]],)
            summary = f"Recovery started for {recovery['candidate']}"
        elif operation == "approve":
            sender, signature, summary = actor, "approveRecovery()", f"{actor} approved recovery"
        elif operation == "cancel":
            sender, signature, summary = actor, "cancelRecovery()", "Owner cancelled recovery"
        else:
            # Anyone may finalize once the quorum and the timelock are satisfied.
            sender, signature, summary = "guardian-1", "finalizeRecovery()", "Authority transferred"
        data = encode(self._selector("OperatingWallet", signature), *args)
        self._send(state, sender, state["chain"]["wallet"], data, summary)

    def advance_time(self, state, seconds):
        self.rpc("evm_increaseTime", int(seconds))
        self.rpc("evm_mine")

    def status(self, state):
        chain = state.get("chain") or {}
        base = {
            "mode": self.mode,
            "network": self.network,
            "rpc": self.url,
            "chain_id": chain.get("chain_id"),
            "wallet": chain.get("wallet"),
            "token": chain.get("token"),
            "accounts": chain.get("accounts", {}),
            "transactions": chain.get("transactions", [])[-12:],
        }
        if not chain.get("wallet"):
            return {**base, "connected": False, "error": "Not deployed yet"}
        try:
            wallet, probe = chain["wallet"], self.probe
            owner = "0x" + self._call(wallet, "OperatingWallet", "owner()", rpc=probe)[-40:]
            roles = {address.lower(): role for role, address in chain["accounts"].items()}
            spent = self._call(wallet, "OperatingWallet", "backupSpentThisAbsence()", rpc=probe)
            return {
                **base,
                "connected": True,
                "block": int(probe("eth_blockNumber"), 16),
                "balance_cents": self._balance_cents(state, rpc=probe),
                "owner": owner,
                "owner_role": roles.get(owner.lower()),
                "backup_active": bool(
                    int(self._call(wallet, "OperatingWallet", "backupActive()", rpc=probe), 16)
                ),
                "backup_spent_cents": int(spent, 16) // UNITS_PER_CENT,
                "recovery_votes": int(
                    self._call(wallet, "OperatingWallet", "recoveryVotes()", rpc=probe), 16
                ),
            }
        except ChainError as error:
            return {**base, "connected": False, "error": str(error)}
