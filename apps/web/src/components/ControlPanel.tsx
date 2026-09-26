import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cpu,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Command, Page, State } from "../types";
import { ago, money } from "../api";
import type { BuilderTarget } from "../App";

export function ControlPanel({
  state,
  siteFilter,
  go,
  openBuilder,
  command,
  busy,
  now,
}: {
  state: State;
  siteFilter: string;
  go: (page: Page) => void;
  openBuilder: (target?: BuilderTarget) => void;
  command: Command;
  busy: boolean;
  now: number;
}) {
  const inSite = (siteId: string) =>
    siteFilter === "all" || siteId === siteFilter;
  const pending = state.actions.filter(
    (a) => a.status === "pending" && inSite(a.site_id),
  );
  const { agent, stats, wallet, policy } = state;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
        </div>
        <button className="button primary" onClick={() => openBuilder()}>
          <Plus size={16} />
          New task
        </button>
      </div>
      <div className="overview-columns control-columns">
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div className="section-title">
              <span className="attention-dot" />
              <h2>Needs your attention</h2>
              <span className="count">{pending.length}</span>
            </div>
            <button className="link-button" onClick={() => go("review")}>
              Review <ArrowRight size={14} />
            </button>
          </div>
          {pending.length ? (
            [...pending]
              .sort((a, b) => b.amount_cents - a.amount_cents)
              .slice(0, 4)
              .map((action) => (
                <button
                  className="attention-row"
                  key={action.id}
                  onClick={() => go("review")}
                >
                  <span
                    className={`item-icon ${action.policy.level === "high" ? "orange" : "neutral"}`}
                  >
                    <ShieldCheck size={19} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">
                      {action.title}
                      <span
                        className={`badge ${action.policy.level === "high" ? "warning" : "subtle"}`}
                      >
                        {action.policy.level}
                      </span>
                    </span>
                    <span className="row-detail">
                      {state.sites.find((s) => s.id === action.site_id)?.name} ·{" "}
                      {action.policy.reasons[0]}
                    </span>
                  </span>
                  <strong>{money(action.amount_cents)}</strong>
                </button>
              ))
          ) : (
            <div className="empty compact">
              <ShieldCheck />
              <strong>You’re all caught up.</strong>
            </div>
          )}
        </section>
      </div>
      <section className={`agent-bar panel ${agent.enabled ? "" : "is-paused"}`}>
        <span className="agent-icon"><Bot size={20} /></span>
        <div className="agent-copy">
          <strong>{agent.enabled ? "Agent active" : "Agent paused"}</strong>
          <small>{ago(agent.last_cycle_at, now)}</small>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            role="switch"
            checked={agent.enabled}
            disabled={busy}
            onChange={(e) => command("/agent", { enabled: e.target.checked })}
          />
          <span>Agent</span>
        </label>
      </section>
      <div className="metrics overview-metrics">
        <article className="metric">
          <div className="metric-label">Handled <span className="metric-icon green"><Cpu size={17} /></span></div>
          <strong>{String(stats.auto_handled).padStart(2, "0")}</strong>
        </article>
        <article className="metric">
          <div className="metric-label">Daily spend <span className="metric-icon blue"><ArrowUpRight size={17} /></span></div>
          <strong>{money(wallet.agent_spent_cents)}<small> / {money(policy.agent_daily_cents)}</small></strong>
          <div className="budget-track"><span style={{ width: `${Math.min(100, (wallet.agent_spent_cents / policy.agent_daily_cents) * 100)}%` }} /></div>
        </article>
        <article className="metric">
          <div className="metric-label">Balance <span className="metric-icon neutral"><Wallet size={17} /></span></div>
          <strong>{money(wallet.balance_cents)}</strong>
        </article>
      </div>
    </>
  );
}
