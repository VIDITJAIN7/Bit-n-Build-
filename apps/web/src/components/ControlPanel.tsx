import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cpu,
  Layers,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { Command, Page, State, Trigger } from "../types";
import { ago, money } from "../api";
import {
  ACTIONS,
  SOURCES,
  actionSummary,
  draftOf,
  fieldFor,
  formatValue,
  industryIcon,
  opLabel,
  recordIndex,
  type RecordRow,
} from "../rules";
import type { BuilderTarget } from "../App";

export function ControlPanel({
  state,
  siteFilter,
  setSiteFilter,
  go,
  openBuilder,
  command,
  busy,
  now,
}: {
  state: State;
  siteFilter: string;
  setSiteFilter: (site: string) => void;
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
  const openTasks = state.field_tasks.filter(
    (t) => t.status === "open" && inSite(t.site_id),
  );
  const records = recordIndex(state);
  const triggers = state.triggers.filter(
    (t) =>
      siteFilter === "all" || t.site_id === "all" || t.site_id === siteFilter,
  );
  const { agent, stats, wallet, policy } = state;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span /> CONTROL PANEL
          </p>
          <h1>
            Routine work runs itself.
            <br className="mobile-break" /> You see what needs you.
          </h1>
          <p className="subtitle">
            <strong>{stats.auto_handled} routine actions handled</strong> by the
            background agent ·{" "}
            <strong>{pending.length} need your attention</strong>
          </p>
        </div>
        <button className="button primary" onClick={() => openBuilder()}>
          <Plus size={16} />
          New trigger
        </button>
      </div>
      <section
        className={`agent-bar panel ${agent.enabled ? "" : "is-paused"}`}
      >
        <span className="agent-icon">
          <Bot size={22} />
        </span>
        <div className="agent-copy">
          <strong>
            {agent.enabled
              ? "Operations agent is working in the background"
              : "Operations agent is paused"}
          </strong>
          <small>
            Cycle #{agent.cycles} · last run {ago(agent.last_cycle_at, now)}
            {agent.interval_seconds
              ? ` · every ${agent.interval_seconds}s`
              : ""}{" "}
            ·{" "}
            {
              state.triggers.filter((t) => t.enabled && t.mode === "auto")
                .length
            }{" "}
            automatic triggers over{" "}
            {state.assets.length + state.inventory.length} records ·{" "}
            {stats.alerts} alerts raised
          </small>
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
        <label className="toggle">
          <input
            type="checkbox"
            role="switch"
            checked={agent.live_feed}
            disabled={busy}
            onChange={(e) => command("/agent", { live_feed: e.target.checked })}
          />
          <span>Simulated sensor feed</span>
        </label>
        <button
          className="button secondary"
          disabled={busy || !agent.enabled}
          onClick={() => command("/agent/cycle")}
        >
          <RefreshCw size={15} />
          Run cycle now
        </button>
      </section>
      <div className="metrics">
        <article className="metric">
          <div className="metric-label">
            Handled autonomously{" "}
            <span className="metric-icon green">
              <Cpu size={17} />
            </span>
          </div>
          <strong>{String(stats.auto_handled).padStart(2, "0")}</strong>
          <p>
            <span className="green-text">Within policy</span> No sign-off needed
          </p>
        </article>
        <article className="metric">
          <div className="metric-label">
            Needs your attention{" "}
            <span className="metric-icon orange">
              <SlidersHorizontal size={17} />
            </span>
          </div>
          <strong>{String(pending.length).padStart(2, "0")}</strong>
          <p>
            <span className="amber-text">
              {pending.filter((a) => a.policy.level === "high").length} high
              risk
            </span>{" "}
            {openTasks.length} field checks open
          </p>
        </article>
        <article className="metric">
          <div className="metric-label">
            Agent budget today{" "}
            <span className="metric-icon blue">
              <ArrowUpRight size={17} />
            </span>
          </div>
          <strong>
            {money(wallet.agent_spent_cents)}
            <small> / {money(policy.agent_daily_cents)}</small>
          </strong>
          <p>
            {money(
              Math.max(0, policy.agent_daily_cents - wallet.agent_spent_cents),
            )}{" "}
            remaining <span className="muted">· UTC day</span>
          </p>
          <div className="budget-track">
            <span
              style={{
                width: `${Math.min(100, (wallet.agent_spent_cents / policy.agent_daily_cents) * 100)}%`,
              }}
            />
          </div>
        </article>
        <article className="metric">
          <div className="metric-label">
            Operating wallet{" "}
            <span className="metric-icon neutral">
              <Wallet size={17} />
            </span>
          </div>
          <strong>{money(wallet.balance_cents)}</strong>
          <p>
            <span className="currency-dot" />
            USDC equivalent <span className="muted">· Simulated</span>
          </p>
        </article>
      </div>
      <section className="site-strip" aria-label="Sites">
        <button
          className={`site-chip ${siteFilter === "all" ? "active" : ""}`}
          onClick={() => setSiteFilter("all")}
        >
          <span className="site-chip-icon">
            <Layers size={17} />
          </span>
          <span>
            <strong>All sites</strong>
            <small>{state.sites.length} sites · one policy</small>
          </span>
        </button>
        {state.sites.map((site) => {
          const Icon = industryIcon(site.industry);
          const open = state.actions.filter(
            (a) => a.status === "pending" && a.site_id === site.id,
          ).length;
          return (
            <button
              key={site.id}
              className={`site-chip ${siteFilter === site.id ? "active" : ""}`}
              onClick={() => setSiteFilter(site.id)}
            >
              <span className="site-chip-icon">
                <Icon size={17} />
              </span>
              <span>
                <strong>{site.name}</strong>
                <small>
                  {site.industry} · {site.location}
                </small>
              </span>
              {open > 0 && <span className="nav-count">{open}</span>}
            </button>
          );
        })}
      </section>
      <div className="section-row">
        <h2>
          Triggers <span className="count">{triggers.length}</span>
        </h2>
        <p className="muted small-text">
          Each trigger watches your data. Adjust a threshold here; build new
          ones in Triggers.
        </p>
      </div>
      <div className="trigger-grid">
        {triggers.map((trigger) => (
          <TriggerTile
            key={trigger.id}
            trigger={trigger}
            state={state}
            records={records}
            siteFilter={siteFilter}
            command={command}
            busy={busy}
            now={now}
            onEdit={() => openBuilder({ triggerId: trigger.id })}
          />
        ))}
        <button className="trigger-tile tile-new" onClick={() => openBuilder()}>
          <Plus size={24} />
          <strong>Create a trigger</strong>
          <small>Pick a template or start from your own data</small>
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
              Review queue <ArrowRight size={14} />
            </button>
          </div>
          {pending.length ? (
            [...pending]
              .sort((a, b) => b.amount_cents - a.amount_cents)
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
              <p>The agent is handling everything within policy.</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Agent activity</h2>
              <p>What happened in the background</p>
            </div>
            <button className="link-button" onClick={() => go("audit")}>
              All activity <ArrowRight size={14} />
            </button>
          </div>
          <div className="activity-preview">
            {state.audit.length ? (
              state.audit
                .slice(-6)
                .reverse()
                .map((event) => (
                  <div className="activity-line" key={event.id}>
                    <span className="timeline-point" />
                    <div>
                      <strong>{event.message}</strong>
                      <small>
                        {event.actor.replaceAll("-", " ")} · {event.event}
                      </small>
                    </div>
                    <time>{ago(event.at, now)}</time>
                  </div>
                ))
            ) : (
              <p className="empty-inline">
                The agent’s first cycle will appear here within seconds.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function TriggerTile({
  trigger,
  state,
  records,
  siteFilter,
  command,
  busy,
  now,
  onEdit,
}: {
  trigger: Trigger;
  state: State;
  records: Map<string, RecordRow>;
  siteFilter: string;
  command: Command;
  busy: boolean;
  now: number;
  onEdit: () => void;
}) {
  const matches = trigger.runtime.matches
    .map((id) => records.get(id))
    .filter(
      (row): row is RecordRow =>
        !!row && (siteFilter === "all" || row.site_id === siteFilter),
    );
  const control = trigger.conditions.findIndex(
    (c) => fieldFor(state, trigger.source, c.field)?.type === "number",
  );
  const controlValue =
    control >= 0 ? String(trigger.conditions[control].value) : "";
  const [threshold, setThreshold] = useState(controlValue);
  useEffect(() => setThreshold(controlValue), [controlValue]);
  const manual = trigger.mode === "manual";
  const status = !trigger.enabled
    ? { label: "Paused", tone: "paused" }
    : manual
      ? { label: "Runbook", tone: "manual" }
      : matches.length
        ? { label: `Matching · ${matches.length}`, tone: "firing" }
        : { label: "Armed", tone: "armed" };
  const Icon = ACTIONS[trigger.action.type].icon;
  const site = state.sites.find((s) => s.id === trigger.site_id);
  const stats = trigger.runtime.stats;
  function saveThreshold() {
    const value = Number(threshold);
    if (control < 0 || threshold.trim() === "" || Number.isNaN(value)) {
      setThreshold(controlValue);
      return;
    }
    if (value === trigger.conditions[control].value) return;
    const draft = draftOf(trigger);
    draft.conditions[control] = { ...draft.conditions[control], value };
    void command(`/triggers/${trigger.id}`, draft, "PUT");
  }
  return (
    <article className={`trigger-tile tone-${status.tone}`}>
      <div className="tile-head">
        <span className={`tile-status tone-${status.tone}`}>
          <span className="status-dot" />
          {status.label}
        </span>
        <label
          className="toggle compact"
          title={trigger.enabled ? "Pause" : "Enable"}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label={`${trigger.enabled ? "Pause" : "Enable"} ${trigger.name}`}
            checked={trigger.enabled}
            disabled={busy}
            onChange={(e) =>
              command(`/triggers/${trigger.id}/enabled`, {
                enabled: e.target.checked,
              })
            }
          />
        </label>
      </div>
      <h3>{trigger.name}</h3>
      <p className="tile-scope">
        {SOURCES[trigger.source].label} · {site ? site.name : "All sites"} ·{" "}
        {manual ? "Manual runbook" : "Automatic"}
      </p>
      <div className="expr" aria-label="Condition">
        <span className="expr-when">{manual ? "FOR" : "WHEN"}</span>
        {trigger.conditions.length ? (
          trigger.conditions.map((condition, index) => {
            const field = fieldFor(state, trigger.source, condition.field);
            return (
              <span className="expr-clause" key={`${condition.field}-${index}`}>
                {index > 0 && (
                  <span className="expr-join">
                    {trigger.match === "all" ? "and" : "or"}
                  </span>
                )}
                <span className="expr-field">
                  {field?.label ?? condition.field}
                </span>
                <span className="expr-op">{opLabel(condition.op)}</span>
                {index === control ? (
                  <span className="expr-value editable-value">
                    <input
                      type="number"
                      value={threshold}
                      aria-label={`${field?.label ?? condition.field} threshold`}
                      disabled={busy}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setThreshold(e.target.value)}
                      onBlur={saveThreshold}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setThreshold(controlValue);
                      }}
                    />
                    {field?.unit && field.unit !== "units" ? field.unit : ""}
                  </span>
                ) : (
                  <span className="expr-value">
                    {formatValue(field, condition.value)}
                  </span>
                )}
              </span>
            );
          })
        ) : (
          <span className="expr-field">
            every {SOURCES[trigger.source].noun} in scope
          </span>
        )}
      </div>
      <p className="tile-then">
        <Icon size={15} />
        <span>{actionSummary(state, trigger)}</span>
      </p>
      <div className="tile-matches">
        {matches.length ? (
          matches.slice(0, 3).map((row) => {
            const key = trigger.conditions[control >= 0 ? control : 0]?.field;
            const field = key
              ? fieldFor(state, trigger.source, key)
              : undefined;
            return (
              <span key={row.id} className="match-chip">
                <strong>{row.code}</strong>
                {key && row.values[key] !== undefined
                  ? formatValue(field, row.values[key])
                  : row.name}
              </span>
            );
          })
        ) : (
          <span className="muted">No records match right now</span>
        )}
        {matches.length > 3 && (
          <span className="muted">+{matches.length - 3} more</span>
        )}
      </div>
      <div className="tile-foot">
        <span className="tile-stats">
          Fired {stats.fired} · {stats.auto} handled · {stats.review} to review
          {stats.blocked ? ` · ${stats.blocked} blocked` : ""}
          <br />
          Last fired {ago(trigger.runtime.last_fired_at, now)}
        </span>
        <span className="tile-actions">
          <button
            className={`button ${manual ? "primary" : "secondary"}`}
            disabled={busy || !trigger.enabled}
            onClick={() => command(`/triggers/${trigger.id}/run`)}
          >
            <Play size={14} />
            {manual ? "Run" : "Run now"}
          </button>
          <button
            className="icon-button"
            onClick={onEdit}
            aria-label={`Edit ${trigger.name}`}
            title="Edit trigger"
          >
            <Pencil size={15} />
          </button>
        </span>
      </div>
    </article>
  );
}
