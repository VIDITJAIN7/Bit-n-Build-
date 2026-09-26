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
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const actor = role === "owner" ? state.wallet.owner : "backup";
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
          <h1>Review</h1>
        </div>
        <label className="role-select">
          <UserRound size={16} />
          <span>
            Approver
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="owner">
                Primary approver
              </option>
              <option
                value="backup"
                disabled={!state.supervision.backup_active}
              >
                Backup approver
              </option>
            </select>
          </span>
        </label>
      </div>
      {state.supervision.backup_active && (
        <div className="availability-banner">
          <UserRound size={20} />
          <div>
            <strong>
              Escalation window missed — backup approver available
            </strong>
            <p>
              The backup approver can handle pending decisions now. Guardian recovery is a
              separate, longer process.
            </p>
          </div>
        </div>
      )}
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
      </div>
      {!displayed.length && (
        <div className="panel empty">
          <ShieldCheck size={36} />
          <h2>No pending items.</h2>
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
                      From task “{action.trigger_name}” ·{" "}
                      {action.subject.code}
                    </p>
                  </div>
                  <strong>
                    {money(action.amount_cents)}
                    <small>Amount</small>
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
                          ? "Evidence received. Approval is still required."
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
                        Open worker tasks <ArrowRight size={15} />
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
                  <label className="acknowledge">
                    <input
                      type="checkbox"
                      checked={!!acknowledged[action.id]}
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
                        !acknowledged[action.id]
                      }
                      onConfirm={() =>
                        void command(`/actions/${action.id}/decision`, {
                          actor,
                          decision: "approve",
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
      <p className="footnote">
        <ShieldCheck size={14} />
        Risk scores explain the routing. Server-side policy, evidence, and
        workspace policy, evidence, and access rules determine whether an action can proceed.
      </p>
    </>
  );
}
