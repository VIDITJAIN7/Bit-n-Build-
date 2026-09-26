export type PolicyResult = {
  auto_allowed: boolean;
  level: "low" | "review" | "high";
  score: number;
  reasons: string[];
  hard_blocks: string[];
  required_approvals: number;
};
export type Receipt = {
  id: string;
  mode: string;
  amount_cents: number;
  at: string;
  recipient: string;
  action_id: string;
};
export type Source = "assets" | "inventory";
export type Subject = {
  source: Source;
  id: string;
  code: string;
  label: string;
};
export type ActionKind = "purchase" | "work_order" | "field_check" | "notify";
export type Action = {
  id: string;
  title: string;
  kind: ActionKind;
  amount_cents: number;
  site_id: string;
  subject: Subject;
  trigger_id: string | null;
  trigger_name: string;
  supplier_id?: string;
  supplier?: string;
  recipient?: string;
  sku?: string;
  quantity?: number;
  explanation: string;
  status: "pending" | "scheduled" | "executed" | "rejected" | "blocked" | "drill_resolved";
  drill_result?: "caught" | "missed";
  canary_expected?: string;
  policy: PolicyResult;
  approvals: string[];
  requires_field_check: boolean;
  field_question?: string;
  field_task_id: string | null;
  field_confirmed: boolean | null;
  verification_requested: boolean;
  created_at: string;
  scheduled_for?: string | null;
  agent_decision?: { handling: string; reason: string };
  execution_mode?: "autonomous" | "human";
  executed_at?: string;
  receipt: Receipt | null;
};
export type FieldTask = {
  id: string;
  action_id: string | null;
  trigger_id: string | null;
  site_id: string;
  subject_id: string;
  subject_code: string;
  subject_label: string;
  question: string;
  instructions?: string;
  assignee?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  report_fields: ReportFieldDefinition[];
  gates_decision: boolean;
  status: "open" | "answered" | "cancelled";
  created_at: string;
  answer: boolean | null;
  answered_at: string | null;
  report_id: string | null;
};
export type ReportFieldType = "text" | "number" | "yes_no";
export type ReportFieldDefinition = {
  key: string;
  label: string;
  type: ReportFieldType;
  required: boolean;
};
export type Attachment = {
  kind: "photo" | "audio";
  name: string;
  data_url: string;
  demo_fixture: boolean;
};
export type StoredAttachment = Omit<Attachment, "data_url"> & {
  sha256: string;
  bytes: number;
};
export type Checklist = {
  asset_matched: boolean;
  work_area_checked: boolean;
  protective_equipment_checked: boolean;
};
export type FieldReport = {
  id: string;
  task_id: string;
  answer: boolean;
  note: string;
  created_at: string;
  asset_code: string;
  checklist: Checklist;
  responses?: Record<string, string | number | boolean>;
  attachments: Attachment[];
};
export type ServerReport = Omit<FieldReport, "attachments"> & {
  attachments: StoredAttachment[];
  action_id: string | null;
  confirmed_at: string;
};
export type LocalReport = FieldReport & {
  sync: "pending" | "confirmed" | "error";
  error?: string;
  subject_label?: string;
  question?: string;
  field_labels?: Record<string, string>;
};
export type AuditEvent = {
  id: string;
  at: string;
  event: string;
  message: string;
  actor: string;
  action_id: string | null;
};
export type Site = {
  id: string;
  name: string;
  industry: string;
  location: string;
  technician: string;
  next_visit_days: number;
};
export type MetricValue = number | string | boolean;
export type Asset = {
  id: string;
  site_id: string;
  code: string;
  name: string;
  type: string;
  metrics: Record<string, MetricValue>;
};
export type InventoryItem = {
  id: string;
  site_id: string;
  sku: string;
  name: string;
  stock: number;
  minimum: number;
  reorder_to: number;
};
export type Supplier = {
  id: string;
  name: string;
  approved: boolean;
  recipient: string;
  lead_days: number;
  catalog: Record<string, number>;
};
export type FieldType = "number" | "text" | "boolean";
export type SchemaField = {
  key: string;
  label: string;
  unit: string;
  type: FieldType;
  values: string[];
};
export type Op = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "contains";
export type Condition = { field: string; op: Op; value: MetricValue };
export type ActionType =
  | "notify"
  | "work_order"
  | "restock"
  | "field_check"
  | "purchase";
export type TriggerAction = {
  type: ActionType;
  title: string;
  question: string;
  supplier_id: string | null;
  amount_cents: number | null;
  requires_field_check: boolean;
  report_fields: ReportFieldDefinition[];
  assignee: string;
};
export type TriggerDraft = {
  name: string;
  description: string;
  source: Source;
  site_id: string;
  mode: "auto" | "manual";
  match: "all" | "any";
  conditions: Condition[];
  action: TriggerAction;
  cooldown_minutes: number;
  enabled: boolean;
};
export type Trigger = TriggerDraft & {
  id: string;
  created_by: "template" | "operator";
  created_at: string;
  runtime: {
    firing: Record<string, string>;
    last_fired: Record<string, string>;
    matches: string[];
    evaluated_at: string | null;
    last_fired_at: string | null;
    stats: { fired: number; auto: number; review: number; blocked: number };
  };
};
export type Preview = {
  expression: string;
  count: number;
  matches: {
    id: string;
    code: string;
    name: string;
    site: string;
    evidence: string;
  }[];
};
export type State = {
  workspace: { name: string };
  integrations: {
    telemetry: { provider: string; endpoint_url: string; enabled: boolean };
    inventory: { provider: string; endpoint_url: string; enabled: boolean };
    workforce: { provider: string; endpoint_url: string; enabled: boolean };
    wallet: {
      provider: string;
      rpc_url: string;
      chain_id: string;
      contract_address: string;
      wallet_connect_project_id: string;
      enabled: boolean;
    };
  };
  sites: Site[];
  assets: Asset[];
  inventory: InventoryItem[];
  suppliers: Supplier[];
  triggers: Trigger[];
  schema: Record<Source, SchemaField[]>;
  actions: Action[];
  field_tasks: FieldTask[];
  reports: ServerReport[];
  audit: AuditEvent[];
  stats: {
    auto_handled: number;
    human_executed: number;
    rejected: number;
    blocked: number;
    alerts: number;
    field_dispatched: number;
  };
  agent: {
    enabled: boolean;
    live_feed: boolean;
    cycles: number;
    last_cycle_at: string | null;
    last_cycle_changes: number;
    interval_seconds: number;
    planner: string;
  };
  wallet: {
    balance_cents: number;
    agent_spent_cents: number;
    mode: string;
    owner: string;
    receipts: Receipt[];
  };
  policy: {
    agent_per_action_cents: number;
    agent_daily_cents: number;
    supervisor_limit_cents: number;
    known_recipients: string[];
    typical_purchase_cents: number;
  };
  supervision: {
    backup_active: boolean;
    recovery_eligible: boolean;
    silence_hours: number;
    last_owner_action: string;
  };
  drills: {
    enabled: boolean;
    rate: number;
    stats: Record<
      string,
      { caught: number; missed: number; enhanced: boolean; pass_streak: number }
    >;
  };
  weather: {
    source: string;
    scenario: string;
    heat_index_c: number;
    high_heat: boolean;
  };
  recovery: {
    stage: "idle" | "voting" | "timelock" | "complete";
    candidate: string | null;
    approvals: string[];
    guardians: string[];
    quorum: number;
    delay_seconds: number;
    unlock_at: string | null;
    now: string;
  };
};
export type Method = "POST" | "PUT" | "PATCH" | "DELETE";
export type Command = (
  path: string,
  payload?: object,
  method?: Method,
) => Promise<boolean>;
export type Page =
  | "control"
  | "builder"
  | "data"
  | "review"
  | "field"
  | "recovery"
  | "audit"
  | "integrations";
