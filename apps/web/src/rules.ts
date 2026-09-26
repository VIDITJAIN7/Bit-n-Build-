import {
  Bell,
  Building2,
  ClipboardCheck,
  Factory,
  PackagePlus,
  RadioTower,
  Server,
  ShoppingCart,
  Snowflake,
  Sun,
  Truck,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { money } from "./api";
import type {
  ActionType,
  FieldType,
  MetricValue,
  Op,
  SchemaField,
  Source,
  State,
  Trigger,
  TriggerDraft,
} from "./types";

export const OPS: { value: Op; label: string; types: FieldType[] }[] = [
  { value: "gt", label: ">", types: ["number"] },
  { value: "gte", label: "≥", types: ["number"] },
  { value: "lt", label: "<", types: ["number"] },
  { value: "lte", label: "≤", types: ["number"] },
  { value: "eq", label: "=", types: ["number", "text", "boolean"] },
  { value: "neq", label: "≠", types: ["number", "text", "boolean"] },
  { value: "contains", label: "contains", types: ["text"] },
];
export const opLabel = (op: Op) =>
  OPS.find((item) => item.value === op)?.label ?? op;

export const SOURCES: Record<Source, { label: string; noun: string }> = {
  assets: { label: "Assets & equipment", noun: "asset" },
  inventory: { label: "Inventory", noun: "item" },
};

export const ACTIONS: Record<
  ActionType,
  { label: string; short: string; icon: LucideIcon; description: string }
> = {
  notify: {
    label: "Raise an alert",
    short: "Alert",
    icon: Bell,
    description:
      "Flag the record in the overview and activity log. Nothing is spent.",
  },
  work_order: {
    label: "Create a work order",
    short: "Work order",
    icon: Wrench,
    description:
      "Assign the site technician. Work orders move no money, so the agent files them itself.",
  },
  restock: {
    label: "Restock inventory",
    short: "Restock",
    icon: PackagePlus,
    description:
      "Order up to the reorder level from the cheapest approved supplier that arrives before the next site visit.",
  },
  field_check: {
    label: "Request a field check",
    short: "Field check",
    icon: ClipboardCheck,
    description:
      "Assign a yes/no field task. The worker records the result with photo evidence.",
  },
  purchase: {
    label: "Propose a purchase",
    short: "Purchase",
    icon: ShoppingCart,
    description:
      "Buy a fixed item from a chosen supplier. Spending limits decide whether a person must approve.",
  },
};

export function industryIcon(industry: string): LucideIcon {
  const text = industry.toLowerCase();
  if (text.includes("solar")) return Sun;
  if (text.includes("telecom") || text.includes("tower")) return RadioTower;
  if (text.includes("cold") || text.includes("freez")) return Snowflake;
  if (text.includes("fleet") || text.includes("logistic")) return Truck;
  if (text.includes("data") || text.includes("server")) return Server;
  if (text.includes("warehouse") || text.includes("retail")) return Warehouse;
  if (text.includes("plant") || text.includes("factory")) return Factory;
  return Building2;
}

export const emptyAction = (type: ActionType = "notify") => ({
  type,
  title: "",
  question: "",
  supplier_id: null,
  amount_cents: null,
  requires_field_check: false,
  report_fields: [],
  assignee: "",
});

export const blankDraft = (source: Source = "assets"): TriggerDraft => ({
  name: "",
  description: "",
  source,
  site_id: "all",
  mode: "auto",
  match: "all",
  conditions: [],
  action: emptyAction(source === "inventory" ? "restock" : "work_order"),
  cooldown_minutes: 30,
  enabled: true,
});

export function fieldFor(state: State, source: Source, key: string) {
  return state.schema[source].find((field) => field.key === key);
}

export function formatValue(
  field: SchemaField | undefined,
  value: MetricValue,
) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  const unit = field?.unit ?? "";
  if (!unit || unit === "units") return String(value);
  return unit === "%" || unit.startsWith("°")
    ? `${value}${unit}`
    : `${value} ${unit}`;
}

export function expression(draft: TriggerDraft) {
  if (!draft.conditions.length)
    return `(every ${draft.source} record in scope)`;
  const parts = draft.conditions.map((condition) => {
    const value =
      typeof condition.value === "string"
        ? JSON.stringify(condition.value)
        : String(condition.value);
    return `${draft.source}.${condition.field} ${condition.op} ${value}`;
  });
  return `(${parts.join(draft.match === "all" ? " and " : " or ")})`;
}

export function actionSummary(state: State, trigger: TriggerDraft) {
  const action = trigger.action;
  switch (action.type) {
    case "restock":
      return "Restock from the best eligible supplier";
    case "work_order":
      return `Work order · ${action.title || "Inspect {name}"}`;
    case "field_check":
      return `Ask on site · ${action.question}`;
    case "notify":
      return `Alert · ${action.title || "{name} needs attention"}`;
    case "purchase": {
      const supplier = state.suppliers.find((s) => s.id === action.supplier_id);
      const gate = action.requires_field_check
        ? " · needs field confirmation"
        : "";
      return `${action.title} · ${money(action.amount_cents ?? 0)} from ${supplier?.name ?? "unknown supplier"}${gate}`;
    }
  }
}

export type RecordRow = {
  id: string;
  code: string;
  name: string;
  site_id: string;
  values: Record<string, MetricValue>;
};

export function recordIndex(state: State) {
  const sites = new Map(state.sites.map((site) => [site.id, site.name]));
  const rows = new Map<string, RecordRow>();
  for (const asset of state.assets) {
    rows.set(asset.id, {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      site_id: asset.site_id,
      values: {
        name: asset.name,
        code: asset.code,
        type: asset.type,
        site: sites.get(asset.site_id) ?? "",
        ...asset.metrics,
      },
    });
  }
  for (const item of state.inventory) {
    rows.set(item.id, {
      id: item.id,
      code: item.sku,
      name: item.name,
      site_id: item.site_id,
      values: {
        name: item.name,
        code: item.sku,
        sku: item.sku,
        site: sites.get(item.site_id) ?? "",
        stock: item.stock,
        minimum: item.minimum,
        reorder_to: item.reorder_to,
        shortfall: Math.max(0, item.minimum - item.stock),
      },
    });
  }
  return rows;
}

export function draftOf(trigger: Trigger): TriggerDraft {
  return {
    name: trigger.name,
    description: trigger.description,
    source: trigger.source,
    site_id: trigger.site_id,
    mode: trigger.mode,
    match: trigger.match,
    conditions: trigger.conditions.map((condition) => ({ ...condition })),
    action: {
      ...trigger.action,
      report_fields: trigger.action.report_fields ?? [],
      assignee: trigger.action.assignee ?? "",
    },
    cooldown_minutes: trigger.cooldown_minutes,
    enabled: trigger.enabled,
  };
}

