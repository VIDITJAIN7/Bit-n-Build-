import type { Action, Asset, FieldReport, State } from "./types";

export const previewMode = import.meta.env.VITE_PREVIEW_MODE === "true";

const STORAGE_KEY = "workkite-ui-preview-state-v1";
const now = () => new Date().toISOString();

function initialState(): State {
  const siteId = "site-field";
  const assets: Asset[] = [
    { id: "asset-inv-01", site_id: siteId, code: "INV-01", name: "Inverter 01", type: "Inverter", metrics: { temperature_c: 38, fault_confirmed: false } },
    { id: "asset-inv-02", site_id: siteId, code: "INV-02", name: "Inverter 02", type: "Inverter", metrics: { temperature_c: 37 } },
    { id: "asset-inv-03", site_id: siteId, code: "INV-03", name: "Inverter 03", type: "Inverter", metrics: { temperature_c: 39 } },
  ];
  const task = (id: string, asset: (typeof assets)[number], question: string, actionId: string, gatesDecision = false) => ({
    id,
    action_id: actionId,
    trigger_id: null,
    site_id: siteId,
    subject_id: asset.id,
    subject_code: asset.code,
    subject_label: asset.name,
    question,
    instructions: "Check the equipment and record what you observe.",
    assignee: "Worker 1",
    priority: "normal" as const,
    report_fields: [],
    gates_decision: gatesDecision,
    status: "open" as const,
    created_at: now(),
    answer: null,
    answered_at: null,
    report_id: null,
  });
  const action = (id: string, title: string, kind: Action["kind"], taskId: string, status: Action["status"]): Action => ({
    id,
    title,
    kind,
    amount_cents: 0,
    site_id: siteId,
    subject: { source: "assets", id: "", code: "", label: "" },
    trigger_id: null,
    trigger_name: "",
    explanation: "",
    status,
    policy: { auto_allowed: true, level: "low", score: 0, reasons: [], hard_blocks: [], required_approvals: 1 },
    approvals: [],
    requires_field_check: true,
    field_question: "",
    field_task_id: taskId,
    field_confirmed: null,
    verification_requested: false,
    created_at: now(),
    scheduled_for: null,
    receipt: null,
  });
  const tasks = [
    task("task-fault-check", assets[0], "Check for inverter faults", "action-fault-check"),
    task("task-routine-check", assets[1], "Routine inverter check", "action-routine-check"),
    task("task-replacement-check", assets[2], "Check replacement requirement", "action-replacement-check", true),
  ];
  const actions = [
    action("action-fault-check", "Follow up on Inverter 01", "work_order", tasks[0].id, "scheduled"),
    action("action-routine-check", "Routine inverter maintenance", "work_order", tasks[1].id, "scheduled"),
    action("action-replacement-check", "Review replacement for Inverter 03", "purchase", tasks[2].id, "scheduled"),
  ];
  actions.forEach((item, index) => {
    item.subject = { source: "assets", id: assets[index].id, code: assets[index].code, label: assets[index].name };
  });
  return {
    workspace: { name: "Workkite" },
    integrations: {
      telemetry: { provider: "", endpoint_url: "", enabled: false },
      inventory: { provider: "", endpoint_url: "", enabled: false },
      workforce: { provider: "", endpoint_url: "", enabled: false },
      wallet: { provider: "", rpc_url: "", chain_id: "", contract_address: "", wallet_connect_project_id: "", enabled: false },
    },
    sites: [{ id: siteId, name: "Solar Field", industry: "Solar farm", location: "", technician: "Worker 1", next_visit_days: 1 }],
    assets,
    inventory: [],
    suppliers: [],
    triggers: [],
    schema: { assets: [], inventory: [] },
    actions,
    field_tasks: tasks,
    reports: [],
    audit: [],
    stats: { auto_handled: 0, human_executed: 0, rejected: 0, blocked: 0, alerts: 0, field_dispatched: 3 },
    agent: { enabled: true, live_feed: false, cycles: 0, last_cycle_at: now(), last_cycle_changes: 0, interval_seconds: 30, planner: "rules" },
    wallet: { balance_cents: 0, agent_spent_cents: 0, mode: "unconfigured", owner: "", receipts: [] },
    policy: { agent_per_action_cents: 0, agent_daily_cents: 0, supervisor_limit_cents: 0, known_recipients: [], typical_purchase_cents: 0 },
    supervision: { backup_active: false, recovery_eligible: false, silence_hours: 0, last_owner_action: now() },
    drills: { enabled: false, rate: 0, stats: {} },
    weather: { source: "unconfigured", scenario: "unavailable", heat_index_c: 0, high_heat: false },
    recovery: { stage: "idle", candidate: null, approvals: [], guardians: [], quorum: 2, delay_seconds: 0, unlock_at: null, now: now() },
  };
}

function readState(): State {
  if (!previewMode) return initialState();
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value) return JSON.parse(value) as State;
  } catch {
    // Storage can be disabled in private browsing; the in-memory state still works.
  }
  return initialState();
}

let currentState = readState();
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState)); } catch { /* in-memory fallback */ }
}
export function previewState(): State {
  if (!previewMode) return initialState();
  return structuredClone(currentState);
}

export function previewCommand(path: string, payload: object = {}) {
  const values = payload as Record<string, unknown>;
  let message = "Saved.";
  if (path === "/agent" && typeof values.enabled === "boolean") {
    currentState.agent.enabled = values.enabled;
    message = values.enabled ? "Automation enabled." : "Automation paused.";
  }
  saveState();
  return { state: previewState(), message };
}

export function previewReport(report: FieldReport): State {
  const task = currentState.field_tasks.find((item) => item.id === report.task_id);
  if (!task) return previewState();
  const timestamp = now();
  task.status = "answered";
  task.answer = report.answer;
  task.answered_at = timestamp;
  task.report_id = report.id;
  const action = currentState.actions.find((item) => item.id === task.action_id);
  if (action) {
    action.field_confirmed = report.answer;
    action.executed_at = timestamp;
    action.status = task.gates_decision
      ? report.answer ? "pending" : "rejected"
      : "executed";
    action.execution_mode = task.gates_decision ? "human" : "autonomous";
  }
  if (task.id === "task-fault-check") {
    const asset = currentState.assets.find((item) => item.id === task.subject_id);
    if (asset) asset.metrics.fault_confirmed = report.answer;
    currentState.stats.auto_handled += 1;
    currentState.audit.unshift({ id: crypto.randomUUID(), at: timestamp, event: "worker.response", message: report.answer ? "Fault reported; automatic follow-up created." : "Inverter check completed.", actor: "Worker 1", action_id: action?.id ?? null });
  } else if (task.gates_decision && report.answer) {
    currentState.stats.human_executed += 0;
    currentState.audit.unshift({ id: crypto.randomUUID(), at: timestamp, event: "approval.requested", message: "Worker report sent for supervisor review.", actor: "Worker 1", action_id: action?.id ?? null });
  } else {
    currentState.stats.auto_handled += 1;
    currentState.audit.unshift({ id: crypto.randomUUID(), at: timestamp, event: "worker.response", message: "Routine check completed; maintenance task handled automatically.", actor: "Worker 1", action_id: action?.id ?? null });
  }
  currentState.reports.unshift({
    ...report,
    attachments: report.attachments.map(({ kind, name, data_url }) => ({ kind, name, sha256: "preview", bytes: data_url.length, demo_fixture: false })),
    action_id: task.action_id,
    confirmed_at: timestamp,
  });
  currentState.agent.last_cycle_at = timestamp;
  currentState.agent.last_cycle_changes = 1;
  saveState();
  return previewState();
}
