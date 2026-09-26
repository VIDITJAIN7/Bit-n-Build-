import {
  Blocks,
  Check,
  ChevronRight,
  Clock3,
  FastForward,
  KeyRound,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { State, Command } from "../types";
import { ago, money } from "../api";

const ROLE_NAMES: Record<string, string> = {
  supervisor: "Primary supervisor",
  "replacement-supervisor": "Replacement supervisor",
  backup: "Backup approver",
  agent: "Agent key",
  "guardian-1": "Guardian 1",
  "guardian-2": "Guardian 2",
  "guardian-3": "Guardian 3",
};
const roleName = (role: string | null | undefined) =>
  role ? (ROLE_NAMES[role] ?? role) : "Unknown";
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

export function Recovery({
  state,
  command,
  busy,
}: {
  state: State;
  command: Command;
  busy: boolean;
}) {
  const recovery = state.recovery;
  const ready =
    recovery.stage === "timelock" &&
    !!recovery.unlock_at &&
    Date.parse(recovery.now) >= Date.parse(recovery.unlock_at);
  const step = { idle: 0, voting: 1, timelock: 2, complete: 3 }[recovery.stage];
  const chain = state.chain;
  const onChain = chain.mode === "local-chain";
  function operate(operation: string, actor?: string) {
    return command("/recovery", { operation, actor });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Access</h1>
        </div>
      </div>
      <section className="availability-banner">
        <Clock3 size={25} />
        <div>
          <strong>
            {state.supervision.backup_active
              ? "Backup approval is active"
              : `${roleName(state.wallet.owner)} is available`}{" "}
            · {state.supervision.silence_hours}h since the owner’s last action
          </strong>
          <p>
            After 4 hours, pending decisions can route to the backup approver,
            who can approve up to {money(state.policy.backup_absence_cents)} in
            total while the primary supervisor is away (
            {money(state.supervision.backup_remaining_cents)} left). After 7
            days, guardian recovery becomes eligible. Agent activity never
            refreshes this clock.
          </p>
        </div>
        <div className="clock-controls" aria-label="Simulation clock">
          <span>Simulate time away</span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => command("/demo/clock", { hours: 4 })}
          >
            <FastForward size={14} /> 4 hours
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => command("/demo/clock", { hours: 168 })}
          >
            <FastForward size={14} /> 7 days
          </button>
        </div>
      </section>
      <div className="wallet-summary">
        <span className="wallet-summary-icon">
          <KeyRound size={29} />
        </span>
        <div>
          <span className="eyebrow small">PAYMENT ACCOUNT</span>
          <h2>
            {money(state.wallet.balance_cents)} <small>Available balance</small>
          </h2>
          <p>
            {onChain
              ? chain.connected
                ? `OperatingWallet contract on the ${chain.network} (chain ${chain.chain_id}). Limits are enforced by the contract as well as the workspace.`
                : `Local chain unavailable: ${chain.error ?? "not connected"}.`
              : "Simulated payment account. Run npm run dev:chain to execute payments on a local EVM."}
          </p>
        </div>
        <div className="current-owner">
          <span>ACCOUNT OWNER</span>
          <strong>
            <UserRound size={16} />
            {roleName(state.wallet.owner)}
          </strong>
          <small>
            {onChain && chain.connected
              ? `On chain: ${roleName(chain.owner_role)}`
              : "Workspace record"}
          </small>
        </div>
      </div>
      <div className="recovery-grid">
        <section className="panel recovery-panel">
          <div className="panel-heading">
            <div>
              <h2>Recovery control</h2>
              <p>2 of 3 guardians · 48-hour cancellation window</p>
            </div>
            <span
              className={`badge ${recovery.stage === "idle" || recovery.stage === "complete" ? "green-badge" : "warning"}`}
            >
              {recovery.stage === "idle"
                ? "NORMAL OPERATION"
                : recovery.stage === "complete"
                  ? "ACCESS RESTORED"
                  : recovery.stage === "voting"
                    ? "GUARDIAN VOTING"
                    : ready
                      ? "READY TO FINALIZE"
                      : "TIMELOCK ACTIVE"}
            </span>
          </div>
          <div className="recovery-status-area">
            <span className="recovery-symbol">
              {recovery.stage === "idle" || recovery.stage === "complete" ? (
                <ShieldCheck size={33} />
              ) : recovery.stage === "voting" ? (
                <Users size={33} />
              ) : (
                <Clock3 size={33} />
              )}
            </span>
            <h2>
              {recovery.stage === "idle"
                ? "No recovery in progress."
                : recovery.stage === "voting"
                  ? "Waiting for trusted guardians."
                  : recovery.stage === "complete"
                    ? "Operations can continue."
                    : ready
                      ? "The cancellation window has elapsed."
                      : "Time to challenge the request."}
            </h2>
            <p>
              {recovery.stage === "idle"
                ? state.supervision.recovery_eligible
                  ? "Seven days without primary-supervisor activity have made recovery eligible."
                  : "Backup approval opens after 4 hours. Guardian recovery opens after 7 days without primary-supervisor activity."
                : recovery.stage === "voting"
                  ? `Two distinct designated guardians must approve the nominee: ${roleName(recovery.candidate)}.`
                  : recovery.stage === "complete"
                    ? `${roleName(state.wallet.owner)} now has access. Funds remain in the account.`
                    : ready
                      ? `Finalize to transfer access to ${roleName(recovery.candidate).toLowerCase()}.`
                      : "The current owner can cancel during the waiting period."}
            </p>
            {recovery.stage === "timelock" && (
              <div className="timelock-box">
                <strong>
                  {ready ? "48h elapsed" : "48h cancellation window"}
                </strong>
                <div className="timelock-track">
                  <span style={{ width: ready ? "100%" : "3%" }} />
                </div>
                {!ready && (
                  <button
                    className="link-button"
                    disabled={busy}
                    onClick={() => operate("advance")}
                  >
                    <FastForward size={14} /> Simulate the 48 hours passing
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="guardian-list">
            {recovery.guardians.map((id, index) => (
              <div className="guardian-row" key={id}>
                <span className={`avatar avatar-${index}`}>
                  {index + 1}
                </span>
                <div><strong>Guardian {index + 1}</strong></div>
                <button
                  className={`button ${recovery.approvals.includes(id) ? "approved-button" : "secondary"}`}
                  disabled={
                    busy ||
                    recovery.stage !== "voting" ||
                    recovery.approvals.includes(id)
                  }
                  onClick={() => operate("approve", id)}
                >
                  {recovery.approvals.includes(id) ? (
                    <>
                      <Check size={14} />
                      Approved
                    </>
                  ) : (
                    "Approve"
                  )}
                </button>
              </div>
            ))}
          </div>
          <div className="recovery-actions">
            {(recovery.stage === "idle" || recovery.stage === "complete") && (
              <button
                className="button primary"
                disabled={busy || !state.supervision.recovery_eligible}
                onClick={() => operate("start")}
              >
                {recovery.stage === "complete"
                  ? "Start another recovery"
                  : "Start recovery"}{" "}
                <ChevronRight size={17} />
              </button>
            )}
            {(recovery.stage === "voting" || recovery.stage === "timelock") && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => operate("cancel", state.wallet.owner)}
              >
                Cancel as current owner
              </button>
            )}
            {recovery.stage === "timelock" && (
              <button
                className="button primary"
                disabled={busy || !ready}
                onClick={() => operate("finalize")}
              >
                {ready
                  ? "Transfer access"
                  : "48-hour waiting period"}
                <ChevronRight size={17} />
              </button>
            )}
          </div>
          <div className="panel-caption">
            <ShieldCheck size={14} />
            Recovery requires guardian approval and a waiting period.
          </div>
        </section>
        <aside className="panel recovery-path">
          <div className="panel-heading">
            <div>
              <h2>A deliberate path forward</h2>
              <p>Every transition has a condition.</p>
            </div>
          </div>
          <ol>
            {[
              {
                title: "Recovery requested",
                text: "Eligible after 7 days without a primary-owner action.",
              },
              {
                title: "Guardian quorum",
                text: "Two of three trusted guardians approve.",
              },
              {
                title: "Timelock elapses",
                text: "48 hours for the original owner to intervene.",
              },
              {
                title: "Access transferred",
                text: "A new supervisor can authorize operations.",
              },
            ].map((item, index) => (
              <li className={index <= step ? "reached" : ""} key={item.title}>
                <span>
                  {index < step ? <Check size={16} /> : `0${index + 1}`}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="recovery-contract-note">
            <span className="eyebrow small">
              {onChain ? "ENFORCED ON CHAIN" : "ALSO IN THIS REPOSITORY"}
            </span>
            <p>
              The OperatingWallet contract applies the same quorum, timelock,
              and backup limit, and refuses guardians or the backup as
              nominees.
            </p>
          </div>
        </aside>
      </div>
      {onChain && (
        <section className="panel chain-panel">
          <div className="panel-heading">
            <div className="section-title">
              <Blocks size={18} />
              <h2>Local chain transactions</h2>
              {chain.connected && <span className="count">block {chain.block}</span>}
            </div>
            {chain.wallet && (
              <code title={chain.wallet}>contract {short(chain.wallet)}</code>
            )}
          </div>
          {chain.transactions?.length ? (
            <div className="chain-list">
              {[...chain.transactions].reverse().map((tx) => (
                <div className="chain-row" key={tx.hash}>
                  <code title={tx.hash}>{short(tx.hash)}</code>
                  <span>
                    <strong>{tx.summary}</strong>
                    <small>
                      {roleName(tx.from_role)} · block {tx.block} · gas{" "}
                      {tx.gas_used.toLocaleString()} · {ago(tx.at)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-inline">No transactions yet.</p>
          )}
        </section>
      )}
    </>
  );
}
