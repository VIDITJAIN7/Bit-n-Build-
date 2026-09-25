import {
  Check,
  ChevronRight,
  Clock3,
  KeyRound,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import type { State, Command } from "../types";
import { money } from "../api";

const names = ["Omar Hassan", "Leena Thomas", "Alex Rivera"];
const roles = ["Operations director", "Finance lead", "Field lead"];
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
          <p className="eyebrow">
            <span />
            AVAILABILITY IS NEVER GUARANTEED
          </p>
          <h1>Authority can recover.</h1>
          <p className="subtitle">
            A lost key should not mean a permanently frozen operation.
          </p>
        </div>
        <span className="badge subtle">
          <Wallet size={14} />
          LOCAL WALLET SIMULATOR
        </span>
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
            After 4 hours, pending decisions can route to Omar. After 7 days,
            guardian recovery becomes eligible. Agent activity never refreshes
            this clock. Local role actions simulate signatures.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => command("/demo/clock", { hours: 4 })}
        >
          Advance 4h
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => command("/demo/clock", { hours: 168 })}
        >
          Advance 7 days
        </button>
      </section>
      <div className="wallet-summary">
        <span className="wallet-summary-icon">
          <KeyRound size={29} />
        </span>
        <div>
          <span className="eyebrow small">SITE OPERATING WALLET</span>
          <h2>
            {money(state.wallet.balance_cents)} <small>USDC equivalent</small>
          </h2>
          <p>
            Limited funds. Limited authority. Recovery changes the supervisor.
          </p>
        </div>
        <div className="current-owner">
          <span>CURRENT AUTHORITY</span>
          <strong>
            <UserRound size={16} />
            {state.wallet.owner === "supervisor"
              ? "Maya Kapoor"
              : "Leena Thomas"}
          </strong>
          <small>
            {state.wallet.owner === "supervisor"
              ? "Original supervisor"
              : "Recovered supervisor"}
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
                  ? "AUTHORITY RECOVERED"
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
                  ? "Seven days without primary-supervisor actions have made recovery eligible."
                  : "Backup approvals open after 4 hours. Guardian recovery opens after 7 days of primary-owner silence."
                : recovery.stage === "voting"
                  ? "Two distinct designated guardians must approve Leena as the new supervisor."
                  : recovery.stage === "complete"
                    ? "Leena now holds supervisor authority. Funds remained in the operating wallet."
                    : ready
                      ? "Finalize explicitly to transfer authority to Leena."
                      : "The current owner can cancel. The simulation clock can advance without waiting two real days."}
            </p>
            {recovery.stage === "timelock" && (
              <div className="timelock-box">
                <strong>
                  {ready ? "48h elapsed" : "48h cancellation window"}
                </strong>
                <div className="timelock-track">
                  <span style={{ width: ready ? "100%" : "3%" }} />
                </div>
                <small>
                  Simulation time: {new Date(recovery.now).toLocaleString()}
                </small>
              </div>
            )}
          </div>
          <div className="guardian-list">
            {recovery.guardians.map((id, index) => (
              <div className="guardian-row" key={id}>
                <span className={`avatar avatar-${index}`}>
                  {names[index]
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
                <div>
                  <strong>{names[index]}</strong>
                  <small>{roles[index]}</small>
                </div>
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
                    "Simulate approval"
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
                Start eligible recovery <ChevronRight size={17} />
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
                disabled={busy}
                onClick={() => operate(ready ? "finalize" : "advance")}
              >
                {ready
                  ? "Finalize authority transfer"
                  : "Advance 48h · demo only"}
                <ChevronRight size={17} />
              </button>
            )}
          </div>
          <div className="panel-caption">
            <ShieldCheck size={14} />
            Missed check-ins never automatically transfer authority or funds.
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
                title: "Authority transferred",
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
            <p>
              A Solidity wallet with guardian quorum, timelock, spending limits,
              and local EVM tests. This screen currently uses the Python
              simulator.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
