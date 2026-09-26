import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Database, Pencil, Plus, Trash2, X } from "lucide-react";
import { money } from "../api";
import { fieldFor, formatValue, industryIcon } from "../rules";
import type { Command, MetricValue, State } from "../types";

type Tab = "assets" | "inventory" | "suppliers" | "sites";
const KEY = /^[a-z][a-z0-9_]{0,31}$/;

function parseValue(raw: string): MetricValue {
  const text = raw.trim();
  if (text === "true" || text === "false") return text === "true";
  if (text !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

function parsePairs(text: string, numeric = false) {
  const pairs: Record<string, MetricValue> = {};
  for (const line of text.split(/[\n,]/)) {
    const [key, ...rest] = line.split(/[=:]/);
    if (!key?.trim() || !rest.length) continue;
    const value = parseValue(rest.join("="));
    pairs[numeric ? key.trim().toUpperCase() : key.trim()] = numeric
      ? Math.round(Number(value) * 100)
      : value;
  }
  return pairs;
}

function Editable({
  value,
  display,
  label,
  onSave,
  numeric = false,
  disabled = false,
}: {
  value: MetricValue;
  display?: ReactNode;
  label: string;
  onSave: (raw: string) => void;
  numeric?: boolean;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);
  if (!editing)
    return (
      <button
        className="editable"
        disabled={disabled}
        aria-label={`Edit ${label}`}
        onClick={() => setEditing(true)}
      >
        {display ?? String(value)}
        <Pencil size={11} />
      </button>
    );
  const commit = () => {
    setEditing(false);
    if (text.trim() !== String(value)) onSave(text);
  };
  return (
    <input
      className="editable-input"
      autoFocus
      aria-label={label}
      inputMode={numeric ? "decimal" : "text"}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

export function DataPage({
  state,
  siteFilter,
  command,
  busy,
}: {
  state: State;
  siteFilter: string;
  command: Command;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Tab>("assets");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [newMetric, setNewMetric] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const inSite = (siteId: string) =>
    siteFilter === "all" || siteId === siteFilter;
  const siteName = (id: string) =>
    state.sites.find((s) => s.id === id)?.name ?? id;
  const known = new Set(state.policy.known_recipients);
  const patch = (collection: Tab, id: string, body: object) =>
    command(`/data/${collection}/${id}`, body, "PATCH");
  const remove = (collection: Tab, id: string, label: string) => {
    if (window.confirm(`Delete ${label}? Tasks will no longer use it.`))
      void command(`/data/${collection}/${id}`, {}, "DELETE");
  };
  const set = (key: string, value: string) =>
    setForm((old) => ({ ...old, [key]: value }));
  const defaultSite =
    siteFilter !== "all" ? siteFilter : (state.sites[0]?.id ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = (key: string, fallback = "") =>
      (form[key] ?? fallback).trim();
    const number = (key: string, fallback = 0) =>
      value(key) === "" ? fallback : Number(value(key));
    const bodies: Record<Tab, object> = {
      assets: {
        site_id: value("site_id", defaultSite),
        code: value("code"),
        name: value("name"),
        type: value("type"),
        metrics: parsePairs(value("metrics")),
      },
      inventory: {
        site_id: value("site_id", defaultSite),
        sku: value("sku"),
        name: value("name"),
        stock: number("stock"),
        minimum: number("minimum"),
        reorder_to: value("reorder_to") ? number("reorder_to") : null,
      },
      suppliers: {
        name: value("name"),
        recipient: value("recipient"),
        lead_days: number("lead_days", 1),
        approved: form.approved === "true",
        catalog: parsePairs(value("catalog"), true),
      },
      sites: {
        name: value("name"),
        industry: value("industry"),
        location: value("location"),
        technician: value("technician"),
        next_visit_days: number("next_visit_days", 7),
      },
    };
    if (await command(`/data/${tab}`, bodies[tab])) {
      setForm({});
      setAdding(false);
    }
  }
  const tabs: { id: Tab; label: string; count: number }[] = [
    {
      id: "assets",
      label: "Assets & equipment",
      count: state.assets.filter((a) => inSite(a.site_id)).length,
    },
    {
      id: "inventory",
      label: "Inventory",
      count: state.inventory.filter((i) => inSite(i.site_id)).length,
    },
    { id: "suppliers", label: "Suppliers", count: state.suppliers.length },
    { id: "sites", label: "Sites", count: state.sites.length },
  ];
  const siteSelect = (
    <label className="field">
      <span>Site</span>
      <select
        value={form.site_id ?? defaultSite}
        onChange={(e) => set("site_id", e.target.value)}
      >
        {state.sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </label>
  );
  const input = (
    key: string,
    label: string,
    placeholder = "",
    required = true,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={form[key] ?? ""}
        placeholder={placeholder}
        required={required}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Data</h1>
        </div>
        <button className="button primary" onClick={() => setAdding(!adding)}>
          {adding ? <X size={16} /> : <Plus size={16} />}
          {adding
            ? "Cancel"
            : `Add ${tab === "inventory" ? "item" : tab.replace(/s$/, "")}`}
        </button>
      </div>
      <div className="tabs data-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "selected" : ""}
            onClick={() => {
              setTab(item.id);
              setAdding(false);
              setForm({});
            }}
          >
            {item.label} <span>{item.count}</span>
          </button>
        ))}
      </div>
      {adding && (
        <form className="panel add-form" onSubmit={(e) => void submit(e)}>
          {tab === "assets" && (
            <>
              {siteSelect}
              {input("code", "Code", "PMP-03")}
              {input("name", "Name", "Coolant pump 03")}
              {input("type", "Type", "Pump")}
              <label className="field wide">
                <span>Readings (one per line, key=value)</span>
                <textarea
                  rows={3}
                  value={form.metrics ?? ""}
                  placeholder={"pressure_bar=4.2\ntemperature_c=41"}
                  onChange={(e) => set("metrics", e.target.value)}
                />
              </label>
            </>
          )}
          {tab === "inventory" && (
            <>
              {siteSelect}
              {input("sku", "SKU", "BELT-7")}
              {input("name", "Item", "Drive belt")}
              {input("stock", "Stock on hand", "4")}
              {input("minimum", "Minimum", "2")}
              {input("reorder_to", "Reorder level", "6", false)}
            </>
          )}
          {tab === "suppliers" && (
            <>
              {input("name", "Name", "Northline Parts")}
              {input("recipient", "Payment destination", "vendor-f")}
              {input("lead_days", "Lead time (days)", "2")}
              <label className="field">
                <span>Approved</span>
                <select
                  value={form.approved ?? "false"}
                  onChange={(e) => set("approved", e.target.value)}
                >
                  <option value="false">Not yet approved</option>
                  <option value="true">Approved supplier</option>
                </select>
              </label>
              <label className="field wide">
                <span>Catalog (SKU=price in USD, one per line)</span>
                <textarea
                  rows={3}
                  value={form.catalog ?? ""}
                  placeholder={"BELT-7=18.50\nX14=66"}
                  onChange={(e) => set("catalog", e.target.value)}
                />
              </label>
            </>
          )}
          {tab === "sites" && (
            <>
              {input("name", "Site name", "North Depot")}
              {input("industry", "Industry", "Fleet depot")}
              {input("location", "Location", "Sharjah, UAE", false)}
              {input("technician", "Assigned worker", "Worker name", false)}
              {input("next_visit_days", "Next visit (days)", "4", false)}
            </>
          )}
          <div className="add-form-actions">
            <button className="button primary" disabled={busy} type="submit">
              <Plus size={15} />
              Add to workspace
            </button>
          </div>
        </form>
      )}
      <section className="panel data-panel">
        {tab === "assets" && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Site</th>
                  <th>Live readings</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.assets
                  .filter((asset) => inSite(asset.site_id))
                  .map((asset) => {
                    const draftMetric = newMetric[asset.id];
                    return (
                      <tr key={asset.id}>
                        <td>
                          <strong className="mono">{asset.code}</strong>
                          <Editable
                            value={asset.name}
                            label={`${asset.code} name`}
                            disabled={busy}
                            onSave={(raw) =>
                              void patch("assets", asset.id, {
                                name: raw.trim(),
                              })
                            }
                          />
                        </td>
                        <td>{asset.type}</td>
                        <td>{siteName(asset.site_id)}</td>
                        <td>
                          <div className="metric-chips">
                            {Object.entries(asset.metrics).map(
                              ([key, value]) => {
                                const field = fieldFor(state, "assets", key);
                                return (
                                  <span className="metric-chip" key={key}>
                                    <span>{field?.label ?? key}</span>
                                    <Editable
                                      value={value}
                                      display={formatValue(field, value)}
                                      label={`${asset.code} ${field?.label ?? key}`}
                                      numeric={typeof value === "number"}
                                      disabled={busy}
                                      onSave={(raw) =>
                                        void patch("assets", asset.id, {
                                          metrics: { [key]: parseValue(raw) },
                                        })
                                      }
                                    />
                                    <button
                                      className="chip-remove"
                                      aria-label={`Remove ${key} from ${asset.code}`}
                                      disabled={busy}
                                      onClick={() =>
                                        void patch("assets", asset.id, {
                                          metrics: { [key]: null },
                                        })
                                      }
                                    >
                                      <X size={11} />
                                    </button>
                                  </span>
                                );
                              },
                            )}
                            {draftMetric ? (
                              <form
                                className="metric-add"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  if (!KEY.test(draftMetric.key)) return;
                                  void patch("assets", asset.id, {
                                    metrics: {
                                      [draftMetric.key]: parseValue(
                                        draftMetric.value,
                                      ),
                                    },
                                  }).then((ok) => {
                                    if (ok)
                                      setNewMetric((old) => {
                                        const next = { ...old };
                                        delete next[asset.id];
                                        return next;
                                      });
                                  });
                                }}
                              >
                                <input
                                  aria-label="Reading name"
                                  placeholder="pressure_bar"
                                  value={draftMetric.key}
                                  autoFocus
                                  onChange={(e) =>
                                    setNewMetric({
                                      ...newMetric,
                                      [asset.id]: {
                                        ...draftMetric,
                                        key: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <input
                                  aria-label="Reading value"
                                  placeholder="4.2"
                                  value={draftMetric.value}
                                  onChange={(e) =>
                                    setNewMetric({
                                      ...newMetric,
                                      [asset.id]: {
                                        ...draftMetric,
                                        value: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <button
                                  className="button secondary"
                                  disabled={busy || !KEY.test(draftMetric.key)}
                                >
                                  Add
                                </button>
                              </form>
                            ) : (
                              <button
                                className="chip-add"
                                disabled={busy}
                                onClick={() =>
                                  setNewMetric({
                                    ...newMetric,
                                    [asset.id]: { key: "", value: "" },
                                  })
                                }
                              >
                                <Plus size={12} /> reading
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Delete ${asset.code}`}
                            disabled={busy}
                            onClick={() =>
                              remove("assets", asset.id, asset.code)
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {tab === "inventory" && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Site</th>
                  <th>Stock on hand</th>
                  <th>Minimum</th>
                  <th>Reorder level</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.inventory
                  .filter((item) => inSite(item.site_id))
                  .map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="mono">{item.sku}</strong>
                        <span>{item.name}</span>
                      </td>
                      <td>{siteName(item.site_id)}</td>
                      {(["stock", "minimum", "reorder_to"] as const).map(
                        (key) => (
                          <td key={key}>
                            <Editable
                              value={item[key]}
                              label={`${item.sku} ${key.replace("_", " ")}`}
                              numeric
                              disabled={busy}
                              onSave={(raw) =>
                                void patch("inventory", item.id, {
                                  [key]: Math.max(
                                    0,
                                    Math.round(Number(raw) || 0),
                                  ),
                                })
                              }
                            />
                          </td>
                        ),
                      )}
                      <td>
                        <span
                          className={`badge ${item.stock < item.minimum ? "warning" : "green-badge"}`}
                        >
                          {item.stock < item.minimum
                            ? `${item.minimum - item.stock} below minimum`
                            : "OK"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${item.sku}`}
                          disabled={busy}
                          onClick={() =>
                            remove(
                              "inventory",
                              item.id,
                              `${item.name} (${item.sku})`,
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "suppliers" && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Approved</th>
                  <th>Lead time</th>
                  <th>Payment destination</th>
                  <th>Catalog</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.name}</strong>
                    </td>
                    <td>
                      <label className="toggle compact">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${supplier.name} approved`}
                          checked={supplier.approved}
                          disabled={busy}
                          onChange={(e) =>
                            void patch("suppliers", supplier.id, {
                              approved: e.target.checked,
                            })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <Editable
                        value={supplier.lead_days}
                        display={`${supplier.lead_days} days`}
                        label={`${supplier.name} lead time`}
                        numeric
                        disabled={busy}
                        onSave={(raw) =>
                          void patch("suppliers", supplier.id, {
                            lead_days: Math.max(
                              0,
                              Math.round(Number(raw) || 0),
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Editable
                        value={supplier.recipient}
                        display={<code>{supplier.recipient}</code>}
                        label={`${supplier.name} payment destination`}
                        disabled={busy}
                        onSave={(raw) =>
                          void patch("suppliers", supplier.id, {
                            recipient: raw.trim(),
                          })
                        }
                      />
                      <span
                        className={`badge ${known.has(supplier.recipient) ? "green-badge" : "warning"}`}
                      >
                        {known.has(supplier.recipient) ? "known" : "new"}
                      </span>
                    </td>
                    <td>
                      <div className="metric-chips">
                        {Object.entries(supplier.catalog).map(
                          ([sku, price]) => (
                            <span className="metric-chip" key={sku}>
                              <span>{sku}</span>
                              <Editable
                                value={price / 100}
                                display={money(price)}
                                label={`${supplier.name} ${sku} price`}
                                numeric
                                disabled={busy}
                                onSave={(raw) =>
                                  void patch("suppliers", supplier.id, {
                                    catalog: {
                                      [sku]: Math.max(
                                        1,
                                        Math.round(Number(raw) * 100),
                                      ),
                                    },
                                  })
                                }
                              />
                            </span>
                          ),
                        )}
                      </div>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${supplier.name}`}
                        disabled={busy}
                        onClick={() =>
                          remove("suppliers", supplier.id, supplier.name)
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "sites" && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Industry</th>
                  <th>Location</th>
                  <th>Technician</th>
                  <th>Next visit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.sites.map((site) => {
                  const Icon = industryIcon(site.industry);
                  return (
                    <tr key={site.id}>
                      <td>
                        <span className="site-name">
                          <Icon size={16} />
                          <Editable
                            value={site.name}
                            label={`${site.name} name`}
                            disabled={busy}
                            onSave={(raw) =>
                              void patch("sites", site.id, { name: raw.trim() })
                            }
                          />
                        </span>
                      </td>
                      <td>{site.industry}</td>
                      <td>{site.location}</td>
                      <td>
                        <Editable
                          value={site.technician}
                          label={`${site.name} technician`}
                          disabled={busy}
                          onSave={(raw) =>
                            void patch("sites", site.id, {
                              technician: raw.trim(),
                            })
                          }
                        />
                      </td>
                      <td>
                        <Editable
                          value={site.next_visit_days}
                          display={`in ${site.next_visit_days} days`}
                          label={`${site.name} next visit`}
                          numeric
                          disabled={busy}
                          onSave={(raw) =>
                            void patch("sites", site.id, {
                              next_visit_days: Math.max(
                                0,
                                Math.round(Number(raw) || 0),
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${site.name}`}
                          disabled={busy}
                          onClick={() => remove("sites", site.id, site.name)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-caption">
          <Database size={14} /> Changes appear in Activity.
        </div>
      </section>
    </>
  );
}
