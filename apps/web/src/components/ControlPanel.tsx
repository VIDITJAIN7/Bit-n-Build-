import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cpu,
  FastForward,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Siren,
  UserRound,
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
  opLabel,
  recordIndex,
  type RecordRow,
} from "../rules";
import type { BuilderTarget } from "../App";
import { IncidentAlerts } from "./Incidents";

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
  const records = useMemo(() => recordIndex(state), [state]);
  const triggers = state.triggers.filter(
    (t) => t.site_id === "all" || inSite(t.site_id),
  );
  const { agent, stats, wallet, policy, chain } = state;
  // Everything a person had to decide, against everything the agent settled alone.
  const needed = stats.human_executed + stats.rejected + pending.length;
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
      <IncidentAlerts
        state={state}
        siteFilter={siteFilter}
        command={command}
        busy={busy}
        now={now}
      />
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
          <small>
            {ago(agent.last_cycle_at, now)} ·{" "}
            {triggers.filter((t) => t.enabled && t.mode === "auto").length}{" "}
            automatic rules · {state.ml.model}{" "}
            {state.ml.learning
              ? "learning"
              : `trained on ${state.ml.trained_on} purchases`}
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
      </section>
      <div className="metrics overview-metrics">
        <article className="metric">
          <div className="metric-label">Handled automatically <span className="metric-icon green"><Cpu size={17} /></span></div>
          <strong>{String(stats.auto_handled).padStart(2, "0")}</strong>
          <p>{stats.alerts} alerts raised · {stats.field_dispatched} worker tasks</p>
        </article>
        <article className="metric">
          <div className="metric-label">Needed a person <span className="metric-icon neutral"><UserRound size={17} /></span></div>
          <strong>{String(needed).padStart(2, "0")}</strong>
          <p>
            {pending.length} waiting now
            {stats.ml_flagged ? ` · ${stats.ml_flagged} flagged by the model` : ""}
          </p>
        </article>
        <article className="metric">
          <div className="metric-label">Daily spend <span className="metric-icon blue"><ArrowUpRight size={17} /></span></div>
          <strong>{money(wallet.agent_spent_cents)}<small> / {money(policy.agent_daily_cents)}</small></strong>
          <div className="budget-track"><span style={{ width: `${Math.min(100, (wallet.agent_spent_cents / policy.agent_daily_cents) * 100)}%` }} /></div>
        </article>
        <article className="metric">
          <div className="metric-label">Balance <span className="metric-icon neutral"><Wallet size={17} /></span></div>
          <strong>{money(wallet.balance_cents)}</strong>
          <p>
            {chain.connected
              ? `On the local chain · block ${chain.block}`
              : "Simulated payment account"}
          </p>
        </article>
      </div>
      <div className="section-row">
        <h2>
          Task rules <span className="count">{triggers.length}</span>
        </h2>
        <p className="muted small-text">
          Automatic rules run in the background. Run on-demand rules here, pause
          any rule, or adjust a threshold in place.
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
          <strong>Create a task rule</strong>
          <small>Start from any field in your workspace data</small>
        </button>
      </div>
      <SimulationPanel state={state} command={command} busy={busy} />
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
      ? { label: "On demand", tone: "manual" }
      : matches.length
        ? { label: `Matching · ${matches.length}`, tone: "firing" }
        : { label: "Watching", tone: "armed" };
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
        <label className="toggle" title={trigger.enabled ? "Pause" : "Resume"}>
          <input
            type="checkbox"
            role="switch"
            aria-label={`${trigger.enabled ? "Pause" : "Resume"} ${trigger.name}`}
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
        {manual ? "On demand" : "Automatic"}
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
            title="Edit task rule"
          >
            <Pencil size={15} />
          </button>
        </span>
      </div>
    </article>
  );
}

/** Local demo levers. Nothing here exists in a connected production workspace. */
function SimulationPanel({
  state,
  command,
  busy,
}: {
  state: State;
  command: Command;
  busy: boolean;
}) {
  const { agent } = state;
  return (
    <details className="panel sim-panel">
      <summary>
        <FastForward size={16} />
        <span>
          <strong>Simulation controls</strong>
          <small>
            Local demo levers: sensor feed, time-lapse, practice approvals, and
            reset
            {agent.simulated_hours
              ? ` · ${Math.round(agent.simulated_hours / 24)} simulated days so far`
              : ""}
          </small>
        </span>
      </summary>
      <div className="sim-grid">
        <div className="sim-group">
          <strong>Agent</strong>
          <button
            className="button secondary"
            disabled={busy || !agent.enabled}
            onClick={() => command("/agent/cycle")}
          >
            <RefreshCw size={15} />
            Run a cycle now
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              role="switch"
              checked={agent.live_feed}
              disabled={busy}
              onChange={(e) =>
                command("/agent", { live_feed: e.target.checked })
              }
            />
            <span>Simulated sensor feed</span>
          </label>
        </div>
        <div className="sim-group">
          <strong>Time-lapse</strong>
          <p>
            Fast-forward normal operations with the supervisor present. Every
            proposal crosses the same policy gate and anomaly model.
          </p>
          <div className="sim-buttons">
            {(
              [
                [24, "1 day"],
                [168, "7 days"],
                [720, "30 days"],
              ] as const
            ).map(([hours, label]) => (
              <button
                key={hours}
                className="button secondary"
                disabled={busy}
                onClick={() => command("/demo/time-lapse", { hours })}
              >
                <FastForward size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="sim-group">
          <strong>Practice approval</strong>
          <p>
            Insert one non-executable item with a lookalike payment destination
            into the review queue.
            {state.drills.enabled
              ? ""
              : " Turn on attention checks in Review first."}
          </p>
          <button
            className="button secondary"
            disabled={busy || !state.drills.enabled}
            onClick={() => command("/drills", { operation: "inject" })}
          >
            <Siren size={15} />
            Insert practice item
          </button>
        </div>
        <div className="sim-group">
          <strong>Workspace</strong>
          <label className="toggle">
            <input
              type="checkbox"
              role="switch"
              checked={state.weather.high_heat}
              disabled={busy}
              onChange={(e) =>
                command("/weather/scenario", { hot: e.target.checked })
              }
            />
            <span>Heat wave on site</span>
          </label>
          <button
            className="button danger-quiet"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Reset the local workspace? Rules, data, actions, and activity return to the seeded demo.",
                )
              )
                void command("/demo/reset");
            }}
          >
            <RotateCcw size={15} />
            Reset workspace
          </button>
        </div>
      </div>
    </details>
  );
}
