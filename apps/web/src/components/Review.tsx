import { useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Info,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { mediaUrl, money } from "../api";
import type { State, Command, Page } from "../types";
import { HoldButton } from "./HoldButton";

export function Review({
  state,
  siteFilter,
  command,
  busy,
  go,
}: {
  state: State;
  siteFilter: string;
  command: Command;
  busy: boolean;
  go: (page: Page) => void;
}) {
  const [role, setRole] = useState("owner");
  const [filter, setFilter] = useState("all");
  const [readback, setReadback] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const actor = role === "owner" ? state.wallet.owner : "backup";
  const stats = state.drills.stats[actor] || {
    caught: 0,
    missed: 0,
    enhanced: false,
  };
  const siteName = (id: string) =>
    state.sites.find((site) => site.id === id)?.name ?? "Unknown site";
  const pending = state.actions.filter(
    (a) =>
      a.status === "pending" &&
      (siteFilter === "all" || a.site_id === siteFilter),
  );
  const displayed = pending.filter(
    (a) => filter === "all" || a.policy.level === "high",
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span />
            MEANINGFUL HUMAN CONTROL
          </p>
          <h1>The decisions that need you.</h1>
          <p className="subtitle">
            Review the evidence. Authorize an exact action, once.
          </p>
        </div>
        <label className="role-select">
          <UserRound size={16} />
          <span>
            Demo authorizer
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="owner">
                {state.wallet.owner === "supervisor"
                  ? "Maya · Supervisor"
                  : "Leena · New supervisor"}
              </option>
              <option
                value="backup"
                disabled={!state.supervision.backup_active}
              >
                Omar · Backup approver
              </option>
            </select>
          </span>
        </label>
      </div>
      <section className="drill-banner">
        <ShieldCheck size={23} />
        <div>
          <strong>Announced attention drills</strong>
          <p>
            When enabled, each new planned action has a 3% chance of adding a
            deliberately incorrect payment request. Exercises never execute and
            are revealed immediately after your decision. The demo button
            inserts one on demand.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            command("/drills", {
              operation: state.drills.enabled ? "disable" : "enable",
            })
          }
        >
          {state.drills.enabled
            ? "Disable program"
            : "Enable announced program"}
        </button>
        {state.drills.enabled && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => command("/drills", { operation: "inject" })}
          >
            Add demo drill
          </button>
        )}
      </section>
      {state.supervision.backup_active && (
        <div className="availability-banner">
          <UserRound size={20} />
          <div>
            <strong>
              Escalation window missed — backup approver available
            </strong>
            <p>
              Omar can handle pending decisions now. Guardian recovery is a
              separate, longer process.
            </p>
          </div>
        </div>
      )}
      <div className="drill-stats">
        <span>
          This reviewer:{" "}
          <strong>
            {stats.caught} caught / {stats.caught + stats.missed} completed
            drills
          </strong>
        </span>
        <span>
          {stats.enhanced
            ? "Enhanced review active: destination readback required"
            : "Standard review friction"}
        </span>
        <span>Drill outcomes are not a validated attention score.</span>
      </div>
      <div className="review-toolbar">
        <div className="tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            All pending <span>{pending.length}</span>
          </button>
          <button
            className={filter === "high" ? "selected" : ""}
            onClick={() => setFilter("high")}
          >
            High risk{" "}
            <span>
              {pending.filter((a) => a.policy.level === "high").length}
            </span>
          </button>
        </div>
        <span className="muted small-text">
          Role selection simulates separate people locally
        </span>
      </div>
      {!displayed.length && (
        <div className="panel empty">
          <ShieldCheck size={36} />
          <h2>No decisions waiting.</h2>
          <p>
            The background agent routes only exceptions here. Everything it
            handled within policy is in the activity log.
          </p>
          <button className="button secondary" onClick={() => go("control")}>
            Back to control panel
          </button>
        </div>
      )}
      <div className="review-cards">
        {displayed
          .sort((a, b) => b.amount_cents - a.amount_cents)
          .map((action) => {
            const needsEvidence =
              action.requires_field_check && action.field_confirmed !== true;
            const task = [...state.field_tasks]
              .reverse()
              .find((t) => t.action_id === action.id);
            const question =
              task?.question || action.field_question || "Confirm on site";
            const alreadySigned = action.approvals.includes(actor);
            const wrongFirst =
              role === "backup" && !state.supervision.backup_active;
            return (
              <article className="panel review-card" key={action.id}>
                <div className="review-header">
                  <span
                    className={`badge ${action.policy.level === "high" ? "warning" : "subtle"}`}
                  >
                    {action.policy.level} · score {action.policy.score}/100
                  </span>
                  <span className="mono muted">{action.id.toUpperCase()}</span>
                </div>
                <div className="review-title">
                  <div>
                    <h2>{action.title}</h2>
                    <p>
                      {action.supplier ?? action.subject.label} ·{" "}
                      {siteName(action.site_id)}
                    </p>
                    <p className="provenance">
                      Raised by trigger “{action.trigger_name}” ·{" "}
                      {action.subject.code}
                    </p>
                  </div>
                  <strong>
                    {money(action.amount_cents)}
                    <small>USDC equivalent</small>
                  </strong>
                </div>
                <div className="review-columns">
                  <div className="reason-box">
                    <h3>
                      <Info size={16} />
                      Why you’re seeing this
                    </h3>
                    <ul>
                      {action.policy.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="agent-explanation">
                    <span className="eyebrow small">PLANNER CONTEXT</span>
                    <p>{action.explanation}</p>
                    <div>
                      <span>Payment destination</span>
                      <code>{action.recipient}</code>
                    </div>
                  </div>
                </div>
                {action.requires_field_check && (
                  <div
                    className={`evidence-box ${action.field_confirmed === true ? "verified" : ""}`}
                  >
                    <ClipboardCheck size={21} />
                    <div>
                      <strong>
                        {action.field_confirmed === true
                          ? "Confirmed on site"
                          : action.field_confirmed === false
                            ? "Technician could not confirm"
                            : task?.status === "open"
                              ? "Waiting for field evidence"
                              : "A physical check comes first"}
                      </strong>
                      <small>
                        {action.field_confirmed === true
                          ? "Evidence received by the local server. Human authorization is still required."
                          : action.field_confirmed === false
                            ? "Approval stays blocked. Request another check if conditions change."
                            : `The technician will be asked: “${question}”`}
                      </small>
                    </div>
                    {task?.status === "open" ? (
                      <button
                        className="link-button"
                        onClick={() => go("field")}
                      >
                        Open field console <ArrowRight size={15} />
                      </button>
                    ) : action.field_confirmed !== true ? (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          command(`/actions/${action.id}/verification`)
                        }
                      >
                        {action.field_confirmed === false
                          ? "Request another check"
                          : "Request verification"}{" "}
                        <ArrowRight size={15} />
                      </button>
                    ) : null}
                  </div>
                )}
                {state.reports
                  .filter((report) => report.action_id === action.id)
                  .slice(-1)
                  .map((report) => (
                    <details
                      className="source-details evidence-details"
                      key={report.id}
                    >
                      <summary>
                        Inspect technician evidence ·{" "}
                        {new Date(report.created_at).toLocaleString()}
                      </summary>
                      <div className="technician-evidence">
                        <strong>
                          {report.asset_code} ·{" "}
                          {report.answer
                            ? "Yes, confirmed"
                            : "No, not observed"}
                        </strong>
                        <p>{question}</p>
                        <p>{report.note || "No additional text note."}</p>
                        <p>
                          Equipment matched · Work area checked · Protective
                          equipment checked
                        </p>
                        {report.attachments.map((attachment) => (
                          <div key={attachment.kind}>
                            <small>
                              {attachment.name}
                              {attachment.demo_fixture
                                ? " · DEMO FIXTURE, NOT A REAL SITE PHOTO"
                                : ""}
                            </small>
                            {attachment.kind === "photo" ? (
                              <img
                                src={mediaUrl(report.id, "photo")}
                                alt="Technician equipment evidence"
                                loading="lazy"
                              />
                            ) : (
                              <audio
                                src={mediaUrl(report.id, "audio")}
                                controls
                                preload="none"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                <div className="approval-progress">
                  <span>
                    <UserRound size={15} />
                    {action.approvals.length} of{" "}
                    {action.policy.required_approvals} approvals
                  </span>
                  {action.approvals.map((approval) => (
                    <span className="signed" key={approval}>
                      <Check size={12} />
                      {approval.replaceAll("-", " ")}
                    </span>
                  ))}
                </div>
                <div className="review-footer">
                  {stats.enhanced && (
                    <label className="readback-label">
                      Enhanced review: type the exact payment destination
                      <input
                        value={readback[action.id] || ""}
                        onChange={(e) =>
                          setReadback({
                            ...readback,
                            [action.id]: e.target.value,
                          })
                        }
                        placeholder="Read it from the evidence above"
                        autoComplete="off"
                      />
                    </label>
                  )}
                  <label className="acknowledge">
                    <input
                      type="checkbox"
                      checked={
                        !!acknowledged[action.id] ||
                        (stats.enhanced &&
                          readback[action.id] !== action.recipient)
                      }
                      onChange={(e) =>
                        setAcknowledged({
                          ...acknowledged,
                          [action.id]: e.target.checked,
                        })
                      }
                      disabled={!!needsEvidence || busy || alreadySigned}
                    />
                    <span>
                      I reviewed the amount, destination, and evidence.
                    </span>
                  </label>
                  <div className="review-buttons">
                    <button
                      className="button danger-quiet"
                      disabled={busy}
                      onClick={() =>
                        command(`/actions/${action.id}/decision`, {
                          actor,
                          decision: "reject",
                        })
                      }
                    >
                      <X size={15} />
                      Reject
                    </button>
                    <HoldButton
                      disabled={
                        busy ||
                        !!needsEvidence ||
                        alreadySigned ||
                        wrongFirst ||
                        !acknowledged[action.id] ||
                        (stats.enhanced &&
                          readback[action.id] !== action.recipient)
                      }
                      onConfirm={() =>
                        void command(`/actions/${action.id}/decision`, {
                          actor,
                          decision: "approve",
                          readback: readback[action.id] || "",
                        })
                      }
                    >
                      {alreadySigned
                        ? "Your approval is recorded"
                        : wrongFirst
                          ? "Backup is not active"
                          : action.approvals.length + 1 ===
                              action.policy.required_approvals
                            ? "Hold to authorize execution"
                            : "Hold to authorize"}
                    </HoldButton>
                  </div>
                </div>
              </article>
            );
          })}
      </div>
      {state.actions
        .filter((a) => a.status === "drill_resolved")
        .slice(-1)
        .map((a) => (
          <div className="drill-reveal" key={a.id}>
            <strong>
              Training reveal ·{" "}
              {a.drill_result === "caught"
                ? "Mismatch caught"
                : "Mismatch missed"}
            </strong>
            <p>
              The destination {a.recipient} was a lookalike of{" "}
              {a.canary_expected}. This request could never execute. Two
              successfully rejected drills restore standard friction after a
              miss.
            </p>
          </div>
        ))}
      <p className="footnote">
        <ShieldCheck size={14} />
        Risk scores explain the routing. Server-side policy, evidence, and
        authority determine whether an action can execute.
      </p>
    </>
  );
}
