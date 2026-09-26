import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Braces,
  CirclePlay,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { money, request } from "../api";
import {
  ACTIONS,
  OPS,
  SOURCES,
  blankDraft,
  draftOf,
  emptyAction,
  expression,
} from "../rules";
import type {
  ActionType,
  Command,
  Condition,
  Page,
  Preview,
  ReportFieldDefinition,
  ReportFieldType,
  SchemaField,
  Source,
  State,
  TriggerDraft,
} from "../types";
import type { BuilderTarget } from "../App";

function payload(draft: TriggerDraft, fields: SchemaField[]): TriggerDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    conditions: draft.conditions.map((condition) => {
      const field = fields.find((f) => f.key === condition.field);
      const raw = condition.value;
      if (
        field?.type === "number" &&
        typeof raw === "string" &&
        raw.trim() !== ""
      ) {
        const number = Number(raw);
        return { ...condition, value: Number.isNaN(number) ? raw : number };
      }
      if (field?.type === "boolean" && typeof raw === "string")
        return { ...condition, value: raw === "true" };
      return condition;
    }),
  };
}

function problems(draft: TriggerDraft) {
  const list: string[] = [];
  if (draft.name.trim().length < 3) list.push("Give the task a name.");
  if (draft.mode === "auto" && !draft.conditions.length)
    list.push("Automatic tasks need at least one condition.");
  if (draft.conditions.some((c) => String(c.value).trim() === ""))
    list.push("Every condition needs a value.");
  const action = draft.action;
  if (
    action.type === "field_check" ||
    (action.type === "purchase" && action.requires_field_check)
  ) {
    const keys = action.report_fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length)
      list.push("Worker report fields need unique keys.");
    if (action.report_fields.some((field) => !field.label.trim()))
      list.push("Give every worker report field a label.");
  }
  if (action.type === "field_check" && !action.question.trim())
    list.push("Write the question for the technician.");
  if (action.type === "purchase") {
    if (!action.title.trim()) list.push("Name the item to purchase.");
    if (!action.supplier_id) list.push("Choose a supplier.");
    if (!action.amount_cents) list.push("Enter the purchase amount.");
    if (action.requires_field_check && !action.question.trim())
      list.push("Write the confirmation question.");
  }
  return list;
}

function defaultReportFields(): ReportFieldDefinition[] {
  return [
    {
      key: "observed_condition",
      label: "Observed condition confirmed?",
      type: "yes_no",
      required: true,
    },
    {
      key: "measurement",
      label: "Measurement or reading",
      type: "number",
      required: false,
    },
    {
      key: "technician_notes",
      label: "Technician notes",
      type: "text",
      required: false,
    },
  ];
}

function WorkerFieldsEditor({
  fields,
  onChange,
}: {
  fields: ReportFieldDefinition[];
  onChange: (fields: ReportFieldDefinition[]) => void;
}) {
  function addField() {
    if (fields.length >= 12) return;
    let index = fields.length + 1;
    while (fields.some((field) => field.key === `worker_field_${index}`))
      index += 1;
    onChange([
      ...fields,
      {
        key: `worker_field_${index}`,
        label: "New worker field",
        type: "text",
        required: false,
      },
    ]);
  }
  function patchField(index: number, patch: Partial<ReportFieldDefinition>) {
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }
  return (
    <div className="worker-fields-editor">
      <div className="form-heading compact-heading">
        <div>
          <h3>Worker report fields</h3>
          <p>
            These fields appear on the worker’s task form and are checked again
            by the server.
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={addField}
          disabled={fields.length >= 12}
        >
          <Plus size={15} /> Add field
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="hint">
          No extra fields yet. Workers will still provide the standard answer,
          safety checklist, photo, and optional note.
        </p>
      ) : (
        fields.map((field, index) => (
          <div className="worker-field-row" key={`${field.key}-${index}`}>
            <label className="field grow">
              <span>Prompt shown to worker</span>
              <input
                maxLength={40}
                value={field.label}
                onChange={(event) =>
                  patchField(index, { label: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Response</span>
              <select
                value={field.type}
                onChange={(event) =>
                  patchField(index, {
                    type: event.target.value as ReportFieldType,
                  })
                }
              >
                <option value="text">Short text</option>
                <option value="number">Number / measurement</option>
                <option value="yes_no">Yes / no</option>
              </select>
            </label>
            <label className="checkbox-row worker-required">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) =>
                  patchField(index, { required: event.target.checked })
                }
              />
              Required
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove ${field.label}`}
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function TriggerBuilder({
  state,
  target,
  openBuilder,
  command,
  busy,
  go,
}: {
  state: State;
  target: BuilderTarget;
  openBuilder: (target?: BuilderTarget) => void;
  command: Command;
  busy: boolean;
  go: (page: Page) => void;
}) {
  const existing = target.triggerId
    ? state.triggers.find((t) => t.id === target.triggerId)
    : undefined;
  const [draft, setDraft] = useState<TriggerDraft>(() =>
    existing ? draftOf(existing) : (target.draft ?? blankDraft("assets")),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const fields = state.schema[draft.source];
  const body = useMemo(() => payload(draft, fields), [draft, fields]);
  const issues = problems(draft);
  useEffect(() => {
    if (
      (body.mode === "auto" && !body.conditions.length) ||
      body.conditions.some((c) => String(c.value).trim() === "")
    ) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    const timer = window.setTimeout(() => {
      // Matches depend only on the "when" part; an unfinished action must not block them.
      const probe = { ...body, name: "Preview", action: emptyAction("notify") };
      request<Preview>("/triggers/preview", probe)
        .then((result) => {
          setPreview(result);
          setPreviewError("");
        })
        .catch((error: unknown) => {
          setPreview(null);
          setPreviewError(
            error instanceof Error ? error.message : "Preview unavailable",
          );
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [body]);
  const update = (patch: Partial<TriggerDraft>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const updateAction = (patch: Partial<TriggerDraft["action"]>) =>
    setDraft((old) => ({ ...old, action: { ...old.action, ...patch } }));
  const setCondition = (index: number, patch: Partial<Condition>) =>
    setDraft((old) => ({
      ...old,
      conditions: old.conditions.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    }));
  function defaultCondition(field: SchemaField | undefined): Condition {
    if (!field) return { field: "", op: "gt", value: "" };
    const op = OPS.find((o) => o.types.includes(field.type))!.value;
    const value = field.type === "boolean" ? "true" : (field.values[0] ?? "");
    return { field: field.key, op, value };
  }
  function changeSource(source: Source) {
    const firstNumber = state.schema[source].find((f) => f.type === "number");
    setDraft((old) => ({
      ...old,
      source,
      conditions: firstNumber ? [defaultCondition(firstNumber)] : [],
      action: emptyAction(source === "inventory" ? "restock" : "work_order"),
    }));
  }
  function changeField(index: number, key: string) {
    const field = fields.find((f) => f.key === key);
    setCondition(index, defaultCondition(field));
  }
  function changeAction(type: ActionType) {
    const defaults: Partial<TriggerDraft["action"]> =
      type === "work_order"
        ? { title: "Inspect {name}" }
        : type === "notify"
          ? { title: "{name} needs attention" }
          : type === "field_check"
            ? {
                question: "Is the problem visible on {code}?",
                report_fields: defaultReportFields(),
              }
            : type === "purchase"
              ? {
                  title: "Replace {name}",
                  supplier_id: state.suppliers[0]?.id ?? null,
                  amount_cents: 50000,
                }
              : {};
    updateAction({ ...emptyAction(type), ...defaults });
  }
  async function save() {
    const ok = existing
      ? await command(`/triggers/${existing.id}`, body, "PUT")
      : await command("/triggers", body);
    if (ok) go("control");
  }
  async function remove() {
    if (!existing || !window.confirm(`Delete “${existing.name}”?`)) return;
    if (await command(`/triggers/${existing.id}`, {}, "DELETE")) go("control");
  }
  const action = draft.action;
  const supplier = state.suppliers.find((s) => s.id === action.supplier_id);
  const known = new Set(state.policy.known_recipients);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {existing ? existing.name : "New task"}
          </h1>
        </div>
        <button className="button secondary" onClick={() => go("control")}>
          <ArrowLeft size={16} />
          Cancel
        </button>
      </div>
      <div className="builder-grid">
        <div className="builder-main">
          <section className="panel form-section">
            <div className="form-heading">
              <span className="step">1</span>
              <div>
                <h2>Details</h2>
              </div>
            </div>
            <label className="field">
              <span>Name</span>
              <input
                value={draft.name}
                maxLength={80}
                placeholder="e.g. Compressor drawing too much current"
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Description (optional)</span>
              <input
                value={draft.description}
                maxLength={200}
                placeholder="Why this matters to the operators"
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <div className="segmented" role="radiogroup" aria-label="Mode">
              {(
                [
                  [
                    "auto",
                    "Automatic",
                    "",
                  ],
                  [
                    "manual",
                    "On demand",
                    "",
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={draft.mode === value}
                  className={draft.mode === value ? "selected" : ""}
                  onClick={() => update({ mode: value })}
                >
                  <strong>{label}</strong>
                  {hint && <small>{hint}</small>}
                </button>
              ))}
            </div>
          </section>
          <section className="panel form-section">
            <div className="form-heading">
              <span className="step">2</span>
              <div>
                <h2>When</h2>
              </div>
            </div>
            <div className="form-row">
              <div
                className="segmented compact"
                role="radiogroup"
                aria-label="Data source"
              >
                {(Object.keys(SOURCES) as Source[]).map((source) => (
                  <button
                    key={source}
                    role="radio"
                    aria-checked={draft.source === source}
                    className={draft.source === source ? "selected" : ""}
                    onClick={() =>
                      source !== draft.source && changeSource(source)
                    }
                  >
                    <strong>{SOURCES[source].label}</strong>
                  </button>
                ))}
              </div>
              <label className="field inline">
                <span>Site</span>
                <select
                  value={draft.site_id}
                  onChange={(e) => update({ site_id: e.target.value })}
                >
                  <option value="all">All sites</option>
                  {state.sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="conditions">
              {draft.conditions.map((condition, index) => {
                const field = fields.find((f) => f.key === condition.field);
                const ops = OPS.filter(
                  (o) => !field || o.types.includes(field.type),
                );
                return (
                  <div className="condition-row" key={index}>
                    <span className="condition-join">
                      {index === 0
                        ? "If"
                        : draft.match === "all"
                          ? "and"
                          : "or"}
                    </span>
                    <select
                      aria-label="Field"
                      value={condition.field}
                      onChange={(e) => changeField(index, e.target.value)}
                    >
                      {!field && <option value="">Choose a field</option>}
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.unit && f.unit !== "units" ? ` (${f.unit})` : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Operator"
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, {
                          op: e.target.value as Condition["op"],
                        })
                      }
                    >
                      {ops.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {field?.type === "boolean" ? (
                      <select
                        aria-label="Value"
                        value={String(condition.value)}
                        onChange={(e) =>
                          setCondition(index, { value: e.target.value })
                        }
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <>
                        <input
                          aria-label="Value"
                          inputMode={
                            field?.type === "number" ? "decimal" : "text"
                          }
                          list={
                            field?.type === "text"
                              ? `values-${index}`
                              : undefined
                          }
                          value={String(condition.value)}
                          onChange={(e) =>
                            setCondition(index, { value: e.target.value })
                          }
                        />
                        {field?.type === "text" && (
                          <datalist id={`values-${index}`}>
                            {field.values.map((v) => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                    <button
                      className="icon-button"
                      aria-label="Remove condition"
                      onClick={() =>
                        update({
                          conditions: draft.conditions.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
              <div className="form-row">
                <button
                  className="button secondary"
                  disabled={draft.conditions.length >= 6}
                  onClick={() =>
                    update({
                      conditions: [
                        ...draft.conditions,
                        defaultCondition(
                          fields.find((f) => f.type === "number") ?? fields[0],
                        ),
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  Add condition
                </button>
                {draft.conditions.length > 1 && (
                  <label className="field inline">
                    <span>Match</span>
                    <select
                      value={draft.match}
                      onChange={(e) =>
                        update({
                          match: e.target.value as TriggerDraft["match"],
                        })
                      }
                    >
                      <option value="all">All conditions</option>
                      <option value="any">Any condition</option>
                    </select>
                  </label>
                )}
              </div>
              {draft.mode === "manual" && !draft.conditions.length && (
                <p className="hint">
                  No conditions: the task targets every{" "}
                  {SOURCES[draft.source].noun} in the chosen site.
                </p>
              )}
            </div>
          </section>
          <section className="panel form-section">
            <div className="form-heading">
              <span className="step">3</span>
              <div>
                <h2>Action</h2>
              </div>
            </div>
            <div className="action-cards" role="radiogroup" aria-label="Action">
              {(Object.keys(ACTIONS) as ActionType[]).map((type) => {
                const meta = ACTIONS[type];
                const Icon = meta.icon;
                const unavailable =
                  type === "restock" && draft.source !== "inventory";
                return (
                  <button
                    key={type}
                    role="radio"
                    aria-checked={action.type === type}
                    className={`action-card ${action.type === type ? "selected" : ""}`}
                    disabled={unavailable}
                    title={
                      unavailable
                        ? "Restocking needs inventory as the source"
                        : undefined
                    }
                    onClick={() => action.type !== type && changeAction(type)}
                  >
                    <Icon size={18} />
                    <strong>{meta.label}</strong>
                  </button>
                );
              })}
            </div>
            {(action.type === "work_order" || action.type === "notify") && (
              <label className="field">
                <span>
                  {action.type === "notify" ? "Alert text" : "Work order title"}
                </span>
                <input
                  value={action.title}
                  maxLength={120}
                  onChange={(e) => updateAction({ title: e.target.value })}
                />
              </label>
            )}
            {action.type === "field_check" && (
              <>
                <label className="field">
                  <span>Task instructions for the worker</span>
                  <input
                    value={action.question}
                    maxLength={160}
                    onChange={(e) => updateAction({ question: e.target.value })}
                  />
                </label>
                <WorkerFieldsEditor
                  fields={action.report_fields}
                  onChange={(report_fields) => updateAction({ report_fields })}
                />
              </>
            )}
            {(action.type === "work_order" ||
              action.type === "field_check") && (
              <label className="field">
                <span>Assigned worker</span>
                <input
                  value={action.assignee}
                  maxLength={80}
                  placeholder="Use this site's assigned technician"
                  onChange={(event) =>
                    updateAction({ assignee: event.target.value })
                  }
                />
                <small>
                  The background agent creates and assigns a field task when
                  this task matches.
                </small>
              </label>
            )}
            {action.type === "purchase" && (
              <>
                <div className="form-row">
                  <label className="field grow">
                    <span>Item</span>
                    <input
                      value={action.title}
                      maxLength={120}
                      onChange={(e) => updateAction({ title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Amount (USD)</span>
                    <input
                      inputMode="decimal"
                      value={
                        action.amount_cents ? action.amount_cents / 100 : ""
                      }
                      onChange={(e) => {
                        const dollars = Number(e.target.value);
                        updateAction({
                          amount_cents:
                            e.target.value && !Number.isNaN(dollars)
                              ? Math.round(dollars * 100)
                              : null,
                        });
                      }}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Supplier</span>
                  <select
                    value={action.supplier_id ?? ""}
                    onChange={(e) =>
                      updateAction({ supplier_id: e.target.value || null })
                    }
                  >
                    {state.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.approved ? "approved" : "not approved"} ·{" "}
                        {known.has(s.recipient)
                          ? "known destination"
                          : "new destination"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={action.requires_field_check}
                    onChange={(e) =>
                      updateAction({
                        requires_field_check: e.target.checked,
                        question:
                          e.target.checked && !action.question
                            ? "Is the fault visible on {code}?"
                            : action.question,
                        report_fields:
                          e.target.checked && action.report_fields.length === 0
                            ? defaultReportFields()
                            : action.report_fields,
                      })
                    }
                  />
                  Require a technician’s on-site confirmation before approval
                </label>
                {action.requires_field_check && (
                  <>
                    <label className="field">
                      <span>Task instructions for the worker</span>
                      <input
                        value={action.question}
                        maxLength={160}
                        onChange={(e) =>
                          updateAction({ question: e.target.value })
                        }
                      />
                    </label>
                    <WorkerFieldsEditor
                      fields={action.report_fields}
                      onChange={(report_fields) =>
                        updateAction({ report_fields })
                      }
                    />
                  </>
                )}
              </>
            )}
            <label className="field inline">
              <span>Re-fire at most every</span>
              <input
                type="number"
                min={0}
                max={10080}
                value={draft.cooldown_minutes}
                onChange={(e) =>
                  update({
                    cooldown_minutes: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
              <span>minutes per record</span>
            </label>
          </section>
        </div>
        <aside className="builder-aside">
          <section className="panel preview-panel">
            <div className="panel-heading">
              <div>
                <h2>Matches</h2>
              </div>
              <Sparkles size={18} />
            </div>
            <div className="expression-box">
              <Braces size={14} />
              <code>{expression(body)}</code>
            </div>
            {previewError ? (
              <p className="report-error preview-error">{previewError}</p>
            ) : preview ? (
              <>
                <p className="preview-count">
                  <strong>{preview.count}</strong>{" "}
                  {preview.count === 1 ? "record matches" : "records match"} now
                </p>
                <ul className="preview-matches">
                  {preview.matches.map((match) => (
                    <li key={match.id}>
                      <strong>
                        {match.code} · {match.name}
                      </strong>
                      <small>
                        {match.site}
                        {match.evidence ? ` · ${match.evidence}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted small-text">
                Add a condition.
              </p>
            )}
            <div className="preview-policy">
              <ShieldCheck size={15} />
              <p>
                Any action from this rule must meet the workspace policy: the
                agent may spend at most{" "}
                {money(state.policy.agent_per_action_cents)} per action and{" "}
                {money(state.policy.agent_daily_cents)} per day, only with
                approved suppliers and known payment destinations.
                {action.type === "purchase" && action.amount_cents
                  ? action.amount_cents > state.policy.agent_per_action_cents ||
                    action.requires_field_check ||
                    !supplier?.approved ||
                    !known.has(supplier?.recipient ?? "")
                    ? " This purchase will wait for a person in the review queue."
                    : " This purchase can run autonomously within the daily budget."
                  : ""}
              </p>
            </div>
          </section>
          <section className="panel builder-actions">
            {issues.length > 0 && (
              <ul className="issues">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <button
              className="button primary"
              disabled={busy || issues.length > 0}
              onClick={() => void save()}
            >
              {existing ? <Save size={16} /> : <CirclePlay size={16} />}
              {existing ? "Save changes" : "Create task"}
            </button>
            {existing && (
              <button
                className="button danger-quiet"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 size={15} />
                Delete task
              </button>
            )}
          </section>
          <section className="panel existing-triggers">
            <div className="panel-heading">
              <h2>Tasks</h2>
            </div>
            {state.triggers.map((trigger) => (
              <button
                key={trigger.id}
                className={`existing-row ${trigger.id === existing?.id ? "current" : ""}`}
                onClick={() => openBuilder({ triggerId: trigger.id })}
              >
                <span>
                  <strong>{trigger.name}</strong>
                  <small>
                    {ACTIONS[trigger.action.type].short} ·{" "}
                    {trigger.mode === "manual" ? "manual" : "automatic"}
                    {trigger.enabled ? "" : " · paused"}
                  </small>
                </span>
                <Pencil size={14} />
              </button>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
