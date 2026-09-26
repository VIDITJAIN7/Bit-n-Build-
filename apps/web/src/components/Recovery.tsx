import {
  Check,
  ChevronRight,
  Clock3,
  KeyRound,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { State, Command } from "../types";
import { money } from "../api";

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
              : "Primary supervisor is available"}{" "}
            · {state.supervision.silence_hours}h since primary action
          </strong>
          <p>
            After 4 hours, pending decisions can route to the backup approver. After 7 days,
            guardian recovery becomes eligible. Agent activity never refreshes
            this clock. Each recorded approval is tied to a distinct authorizer.
          </p>
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
            Spending limits stay in place during access recovery.
          </p>
        </div>
        <div className="current-owner">
          <span>ACCOUNT OWNER</span>
          <strong>
            <UserRound size={16} />
            {state.wallet.owner === "supervisor"
              ? "Primary supervisor"
              : "Replacement supervisor"}
          </strong>
          <small>
            {state.wallet.owner === "supervisor"
              ? "Primary supervisor"
              : "Replacement supervisor"}
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
                  ? "Two distinct designated guardians must approve the new supervisor."
                  : recovery.stage === "complete"
                    ? "The new supervisor now has access. Funds remain in the account."
                    : ready
                      ? "Finalize to transfer access to the replacement supervisor."
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
            {recovery.stage === "idle" && (
              <button
                className="button primary"
                disabled={busy || !state.supervision.recovery_eligible}
                onClick={() => operate("start")}
              >
                Start recovery <ChevronRight size={17} />
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
            <span className="eyebrow small">ALSO IN THIS REPOSITORY</span>
            <p>Guardian approval and a waiting period protect access changes.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
