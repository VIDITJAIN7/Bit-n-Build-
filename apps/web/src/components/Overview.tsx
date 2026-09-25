import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Cpu,
  MapPin,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Thermometer,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import type { State, Page, Command } from "../types";
import { money, time } from "../api";

export function Overview({
  state,
  go,
  command,
  busy,
}: {
  state: State;
  go: (page: Page) => void;
  command: Command;
  busy: boolean;
}) {
  const autonomous = state.actions.filter(
    (a) => a.execution_mode === "autonomous",
  ).length;
  const pending = state.actions.filter((a) => a.status === "pending");
  const fan = state.actions.find((a) => a.id === "fans-x14");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span /> OPERATIONS OVERVIEW
          </p>
          <h1>
            A clearer view.
            <br className="mobile-break" /> A lighter workload.
          </h1>
          <p className="subtitle">
            Your site keeps moving. You focus on the decisions that matter.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => command("/scenario/run")}
          disabled={busy}
        >
          <Zap size={16} />
          {state.scenario_ran ? "Run site agent" : "Start demo scenario"}
        </button>
      </div>
      <div className="metrics">
        <article className="metric">
          <div className="metric-label">
            Handled autonomously{" "}
            <span className="metric-icon green">
              <Cpu size={17} />
            </span>
          </div>
          <strong>{autonomous.toString().padStart(2, "0")}</strong>
          <p>
            <span className="green-text">
              <Check size={13} />
              Within policy
            </span>{" "}
            No sign-off needed
          </p>
          <div className="mini-lines green-lines">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </article>
        <article className="metric">
          <div className="metric-label">
            Needs your attention{" "}
            <span className="metric-icon orange">
              <SlidersHorizontal size={17} />
            </span>
          </div>
          <strong>{pending.length.toString().padStart(2, "0")}</strong>
          <p>
            <span className="amber-text">
              {pending.filter((a) => a.policy.level === "high").length} high
              risk
            </span>{" "}
            Routed for review
          </p>
          <div className="metric-underline" />
        </article>
        <article className="metric">
          <div className="metric-label">
            Agent budget today{" "}
            <span className="metric-icon blue">
              <ArrowUpRight size={17} />
            </span>
          </div>
          <strong>
            {money(state.wallet.agent_spent_cents)}
            <small> / $1,000</small>
          </strong>
          <p>
            {money(
              state.policy.agent_daily_cents - state.wallet.agent_spent_cents,
            )}{" "}
            remaining <span className="muted">· UTC day</span>
          </p>
          <div className="budget-track">
            <span
              style={{
                width: `${Math.min(100, (state.wallet.agent_spent_cents / state.policy.agent_daily_cents) * 100)}%`,
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
          <strong>{money(state.wallet.balance_cents)}</strong>
          <p>
            <span className="currency-dot" />
            USDC equivalent <span className="muted">· Simulated</span>
          </p>
          <div className="wallet-decor">LIMITED AUTHORITY</div>
        </article>
      </div>
      <div className="overview-columns">
        <div className="overview-main">
          <section className="panel attention-panel">
            <div className="panel-heading">
              <div className="section-title">
                <span className="attention-dot" />
                <h2>On your radar</h2>
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
                      {action.policy.level === "high" ? (
                        <Zap size={19} />
                      ) : (
                        <Package size={19} />
                      )}
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
                        {action.supplier} ·{" "}
                        {action.requires_field
                          ? "Field evidence + supervisor approval"
                          : "Above autonomous spending limit"}
                      </span>
                    </span>
                    <strong>{money(action.amount_cents)}</strong>
                    <ChevronRight size={17} />
                  </button>
                ))
            ) : (
              <div className="empty compact">
                <ShieldCheck />
                <strong>
                  {state.scenario_ran
                    ? "You’re all caught up."
                    : "Ready when you are."}
                </strong>
                <p>
                  {state.scenario_ran
                    ? "Every proposed action has a recorded outcome."
                    : "Start the scenario to see the agent plan site maintenance."}
                </p>
              </div>
            )}
            <div className="panel-caption">
              <ShieldCheck size={14} /> Every action is checked against
              deterministic policy before execution.
            </div>
          </section>
          <section className="panel planner-panel">
            <div className="panel-heading">
              <div>
                <h2>From signal to action</h2>
                <p>How the local planner connects the dots</p>
              </div>
              <span className="badge green-badge">
                <Cpu size={12} /> LOCAL PLANNER
              </span>
            </div>
            <div className="reasoning-chain">
              <div>
                <span className="chain-icon">
                  <Thermometer size={19} />
                </span>
                <small>01 · SIGNAL</small>
                <strong>Fan vibration</strong>
                <p>Elevated · 78°C</p>
              </div>
              <ArrowRight size={16} />
              <div>
                <span className="chain-icon">
                  <Package size={19} />
                </span>
                <small>02 · STOCK</small>
                <strong>0 cooling fans</strong>
                <p>2 needed on site</p>
              </div>
              <ArrowRight size={16} />
              <div>
                <span className="chain-icon">
                  <Clock3 size={19} />
                </span>
                <small>03 · TIMING</small>
                <strong>3 days to visit</strong>
                <p>Choose 2-day delivery</p>
              </div>
            </div>
            <div className="planner-conclusion">
              <span className="conclusion-icon">
                <ArrowDownLeft size={19} />
              </span>
              <div>
                <strong>
                  {fan
                    ? "Order 2 × X14 fans from Desert Supply"
                    : "The next best action is ready to calculate"}
                </strong>
                <p>
                  {fan
                    ? "$136 total. The cheaper supplier arrives after maintenance."
                    : "The planner compares stock, supplier lead time, and the maintenance window."}
                </p>
              </div>
              {fan && (
                <span className="badge green-badge">
                  <Check size={12} />
                  EXECUTED
                </span>
              )}
            </div>
            <details className="source-details">
              <summary>
                Inspect supplier evidence <ChevronRight size={14} />
              </summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Unit price</th>
                      <th>Lead time</th>
                      <th>Eligible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.suppliers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{money(s.price_cents)}</td>
                        <td>{s.delivery_days} days</td>
                        <td>
                          {!s.approved
                            ? "Not approved"
                            : s.delivery_days > 3
                              ? "Arrives too late"
                              : "Within schedule"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>Accountability, without the noise</p>
              </div>
              <button className="link-button" onClick={() => go("audit")}>
                All activity <ArrowRight size={14} />
              </button>
            </div>
            <div className="activity-preview">
              {state.audit.length ? (
                state.audit
                  .slice(-3)
                  .reverse()
                  .map((event) => (
                    <div className="activity-line" key={event.id}>
                      <span className="timeline-point" />
                      <div>
                        <strong>{event.message}</strong>
                        <small>{event.actor.replaceAll("-", " ")}</small>
                      </div>
                      <time>{time(event.at)}</time>
                    </div>
                  ))
              ) : (
                <p className="empty-inline">
                  The audit trail starts when the scenario runs.
                </p>
              )}
            </div>
          </section>
        </div>
        <aside className="overview-aside">
          <section className="panel site-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow small">SITE 07</span>
                <h2>Desert Ridge</h2>
              </div>
              <span className="round-icon">
                <Sun size={20} />
              </span>
            </div>
            <div
              className="solar-visual"
              aria-label="Illustration of the solar site"
            >
              <svg
                viewBox="0 0 320 175"
                role="img"
                aria-label="Solar array site illustration"
              >
                <defs>
                  <pattern
                    id="land"
                    width="32"
                    height="24"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M0 12 Q16 0 32 12"
                      fill="none"
                      stroke="#cbd7c5"
                      strokeWidth=".6"
                    />
                  </pattern>
                  <pattern
                    id="cells"
                    width="18"
                    height="14"
                    patternUnits="userSpaceOnUse"
                  >
                    <rect width="18" height="14" fill="#36574c" />
                    <path
                      d="M0 0H18V14"
                      fill="none"
                      stroke="#91aa98"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width="320" height="175" fill="#e6ebde" />
                <rect width="320" height="175" fill="url(#land)" />
                <path d="M0 158 320 81" stroke="#f4f5ef" strokeWidth="16" />
                <g transform="translate(48,40) skewY(-13)">
                  {[0, 1, 2].map((row) => (
                    <g
                      key={row}
                      transform={`translate(${row * 12},${row * 35})`}
                    >
                      {[0, 1, 2].map((col) => (
                        <g key={col} transform={`translate(${col * 62},0)`}>
                          <path
                            d="M0 0h51v26H0Z"
                            fill="url(#cells)"
                            stroke="#213e33"
                            strokeWidth="2"
                          />
                          <path
                            d="M4 26v6m43-6v6"
                            stroke="#829780"
                            strokeWidth="2"
                          />
                        </g>
                      ))}
                    </g>
                  ))}
                </g>
                <circle
                  cx="254"
                  cy="46"
                  r="14"
                  fill="#f3e7c1"
                  stroke="#b89752"
                />
                <path
                  d="m249 46 4 4 7-8"
                  stroke="#746339"
                  strokeWidth="2"
                  fill="none"
                />
                <circle cx="231" cy="142" r="4" fill="#ce8844" />
                <circle
                  cx="231"
                  cy="142"
                  r="9"
                  fill="none"
                  stroke="#ce8844"
                  opacity=".4"
                />
              </svg>
              <span className="map-coordinate">
                <MapPin size={11} />
                24.1° N · 53.7° E
              </span>
            </div>
            <div className="site-health">
              <span className="badge warning">
                <span className="status-dot" />
                Verification needed
              </span>
              <span>INV / 04</span>
            </div>
            <div className="site-readings">
              <div>
                <Thermometer size={15} />
                <span>Inverter temperature</span>
                <strong>{state.site.temperature}°C</strong>
              </div>
              <div>
                <Wrench size={15} />
                <span>Maintenance visit</span>
                <strong>In {state.site.maintenance_days} days</strong>
              </div>
              <div>
                <MapPin size={15} />
                <span>Location</span>
                <strong>Al Dhafra</strong>
              </div>
            </div>
            <button className="field-entry" onClick={() => go("field")}>
              <span className="item-icon">
                <MapPin size={20} />
              </span>
              <span>
                <strong>Take it to the field</strong>
                <small>Clear decisions. Even offline.</small>
              </span>
              <ArrowUpRight size={20} />
            </button>
          </section>
          <section className="panel policy-card">
            <div className="panel-heading">
              <h2>Guardrails, always on</h2>
              <ShieldCheck size={18} />
            </div>
            <div className="policy-item">
              <span>Agent transaction limit</span>
              <strong>$250</strong>
            </div>
            <div className="policy-item">
              <span>Agent daily ceiling</span>
              <strong>$1,000</strong>
            </div>
            <div className="policy-item">
              <span>New payment destination</span>
              <strong>Review</strong>
            </div>
            <div className="policy-item">
              <span>Supervisor ceiling</span>
              <strong>$5,000</strong>
            </div>
            <p>
              <span className="status-dot" />
              The planner proposes. Policy permits.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
