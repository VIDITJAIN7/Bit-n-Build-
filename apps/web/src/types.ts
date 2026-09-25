export type PolicyResult = {
  auto_allowed: boolean;
  level: string;
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
export type Action = {
  id: string;
  title: string;
  kind: string;
  amount_cents: number;
  supplier?: string;
  recipient?: string;
  explanation: string;
  status: "pending" | "executed" | "rejected" | "blocked" | "drill_resolved";
  drill_result?: string;
  policy: PolicyResult;
  approvals: string[];
  requires_field?: boolean;
  verification_requested: boolean;
  field_fault: boolean | null;
  created_at: string;
  execution_mode?: string;
  receipt: Receipt | null;
};
export type Attachment = {
  kind: "photo" | "audio";
  name: string;
  data_url: string;
  demo_fixture: boolean;
};
export type Checklist = {
  asset_matched: boolean;
  work_area_checked: boolean;
  protective_equipment_checked: boolean;
};
export type FieldReport = {
  id: string;
  action_id: string;
  fault: boolean;
  note: string;
  created_at: string;
  confirmed_at?: string;
  asset_id: string;
  checklist: Checklist;
  attachments: Attachment[];
};
export type LocalReport = FieldReport & {
  sync: "pending" | "confirmed" | "error";
  error?: string;
};
export type AuditEvent = {
  id: string;
  at: string;
  event: string;
  message: string;
  actor: string;
  action_id: string | null;
};
export type State = {
  site: {
    name: string;
    location: string;
    asset: string;
    temperature: number;
    vibration: string;
    errors: number;
    maintenance_days: number;
    technician: string;
  };
  inventory: { sku: string; name: string; stock: number; minimum: number }[];
  suppliers: {
    id: string;
    name: string;
    price_cents: number;
    delivery_days: number;
    approved: boolean;
  }[];
  actions: Action[];
  reports: FieldReport[];
  audit: AuditEvent[];
  scenario_ran: boolean;
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
    clock_offset_seconds: number;
  };
};
export type Command = (path: string, payload?: object) => Promise<boolean>;
export type Page = "overview" | "review" | "field" | "recovery" | "audit";
