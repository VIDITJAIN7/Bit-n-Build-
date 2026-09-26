import { useState } from "react";
import {
  Camera,
  Check,
  CircleAlert,
  Droplets,
  Flame,
  HeartPulse,
  MapPin,
  ShieldAlert,
  Siren,
  Thermometer,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ago, mediaUrl } from "../api";
import { preparePhoto } from "../media";
import type {
  Attachment,
  Command,
  IncidentKind,
  IncidentReport,
  LocalIncident,
  Severity,
  State,
} from "../types";
import { HoldButton, buzz } from "./HoldButton";

export const INCIDENT_KINDS: Record<
  IncidentKind,
  { label: string; icon: LucideIcon }
> = {
  injury: { label: "Injury", icon: HeartPulse },
  heat: { label: "Heat illness", icon: Thermometer },
  fire: { label: "Fire or smoke", icon: Flame },
  electrical: { label: "Electrical", icon: Zap },
  spill: { label: "Spill or leak", icon: Droplets },
  security: { label: "Security", icon: ShieldAlert },
  other: { label: "Other hazard", icon: CircleAlert },
};
const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: "critical", label: "Critical", hint: "Someone is hurt or in danger" },
  { value: "serious", label: "Serious", hint: "Work must stop" },
  { value: "minor", label: "Minor", hint: "Near miss or small hazard" },
];

function position(): Promise<IncidentReport["location"]> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (fix) =>
        resolve({
          lat: fix.coords.latitude,
          lon: fix.coords.longitude,
          accuracy_m: Math.min(100000, fix.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

/** Unscheduled emergency and safety logging: two big choices, then hold to send. */
export function IncidentReporter({
  state,
  siteFilter,
  onReport,
  onClose,
}: {
  state: State;
  siteFilter: string;
  onReport: (incident: IncidentReport) => Promise<boolean>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [site, setSite] = useState(siteFilter === "all" ? "" : siteFilter);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Attachment | null>(null);
  const [shareLocation, setShareLocation] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const ready = kind !== null && severity !== null && site !== "";
  async function attach(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await preparePhoto(file);
      setPhoto({ kind: "photo", demo_fixture: false, ...prepared });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo could not be read.");
    }
  }
  async function send() {
    if (!kind || !severity || !site || sending) return;
    setSending(true);
    const saved = await onReport({
      id: crypto.randomUUID(),
      site_id: site,
      kind,
      severity,
      note: note.trim(),
      created_at: new Date().toISOString(),
      location: shareLocation ? await position() : null,
      attachments: photo ? [photo] : [],
    });
    setSending(false);
    if (saved) onClose();
  }
  return (
    <section className="panel incident-reporter" aria-labelledby="incident-title">
      <div className="incident-reporter-head">
        <h2 id="incident-title">
          <Siren size={22} /> Report an incident
        </h2>
        <button className="icon-button" onClick={onClose} aria-label="Close incident report">
          <X size={20} />
        </button>
      </div>
      <p className="incident-emergency" role="note">
        If anyone is in danger, call your local emergency number first. This
        report alerts your supervisors; it does not call emergency services.
      </p>
      <fieldset className="incident-kinds">
        <legend>What happened?</legend>
        {(Object.keys(INCIDENT_KINDS) as IncidentKind[]).map((value) => {
          const { label, icon: Icon } = INCIDENT_KINDS[value];
          return (
            <button
              type="button"
              key={value}
              className={kind === value ? "chosen" : ""}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                buzz(15);
              }}
            >
              <Icon size={26} />
              {label}
            </button>
          );
        })}
      </fieldset>
      <fieldset className="incident-severity">
        <legend>How serious?</legend>
        {SEVERITIES.map((item) => (
          <button
            type="button"
            key={item.value}
            className={`severity-${item.value} ${severity === item.value ? "chosen" : ""}`}
            aria-pressed={severity === item.value}
            onClick={() => {
              setSeverity(item.value);
              buzz(15);
            }}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </fieldset>
      {siteFilter === "all" && (
        <label className="field incident-site">
          <span>Site</span>
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Choose the site</option>
            {state.sites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <details className="source-details incident-extras">
        <summary>Add a note or photo (optional)</summary>
        <label className="note-label">
          Note
          <textarea
            maxLength={1000}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who, where, what you can see"
          />
        </label>
        <div className="attachment-controls">
          <label className="button secondary file-label">
            <Camera size={16} />
            {photo ? "Replace photo" : "Add photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => void attach(e.target.files?.[0])}
            />
          </label>
          {photo && (
            <button className="button secondary" onClick={() => setPhoto(null)}>
              <X size={15} /> Remove photo
            </button>
          )}
        </div>
        {photo && (
          <img className="incident-photo" src={photo.data_url} alt="Incident scene" />
        )}
      </details>
      <label className="incident-location">
        <input
          type="checkbox"
          checked={shareLocation}
          onChange={(e) => setShareLocation(e.target.checked)}
        />
        <MapPin size={18} /> Attach my location
      </label>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      <HoldButton onConfirm={() => void send()} disabled={!ready || sending}>
        {sending ? "Saving…" : "Hold to send incident"}
      </HoldButton>
      <p className="incident-offline-note">
        Saved on this phone first and sent as soon as there is a connection.
      </p>
    </section>
  );
}

/** The worker's own incident reports, with delivery and acknowledgement status. */
export function IncidentHistory({
  state,
  incidents,
}: {
  state: State;
  incidents: LocalIncident[];
}) {
  if (!incidents.length) return null;
  const server = new Map(state.incidents.map((item) => [item.id, item]));
  return (
    <section className="panel incident-history" aria-label="Your incident reports">
      {[...incidents].reverse().slice(0, 5).map((incident) => {
        const received = server.get(incident.id);
        const { label, icon: Icon } = INCIDENT_KINDS[incident.kind];
        return (
          <div className="incident-history-row" key={incident.id}>
            <Icon size={20} />
            <span>
              <strong>
                {label} · {incident.severity}
              </strong>
              <small>{new Date(incident.created_at).toLocaleString()}</small>
            </span>
            <span
              className={`badge ${received?.status === "acknowledged" ? "green-badge" : "warning"}`}
            >
              {received?.status === "acknowledged"
                ? "Acknowledged"
                : incident.sync === "confirmed"
                  ? "Delivered"
                  : incident.sync === "error"
                    ? "Saved · retry"
                    : "Saved · sending"}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** Supervisor alerts for open incidents, pinned above everything else. */
export function IncidentAlerts({
  state,
  siteFilter,
  command,
  busy,
  now,
}: {
  state: State;
  siteFilter: string;
  command: Command;
  busy: boolean;
  now: number;
}) {
  const order: Record<Severity, number> = { critical: 0, serious: 1, minor: 2 };
  const open = state.incidents
    .filter(
      (item) =>
        item.status === "open" &&
        (siteFilter === "all" || item.site_id === siteFilter),
    )
    .sort((a, b) => order[a.severity] - order[b.severity]);
  if (!open.length) return null;
  return (
    <section className="panel incident-alerts" role="alert">
      <div className="panel-heading">
        <div className="section-title">
          <Siren size={18} />
          <h2>Open incidents</h2>
          <span className="count">{open.length}</span>
        </div>
      </div>
      {open.map((incident) => {
        const { label, icon: Icon } = INCIDENT_KINDS[incident.kind];
        const site = state.sites.find((item) => item.id === incident.site_id);
        const hasPhoto = incident.attachments.some((a) => a.kind === "photo");
        return (
          <article className={`incident-alert severity-${incident.severity}`} key={incident.id}>
            <span className="item-icon">
              <Icon size={20} />
            </span>
            <div className="row-main">
              <span className="row-title">
                {label}
                <span className="badge warning">{incident.severity}</span>
              </span>
              <span className="row-detail">
                {site?.name ?? incident.site_id} · reported{" "}
                {ago(incident.received_at, now)}
                {incident.location && (
                  <>
                    {" · "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${incident.location.lat}&mlon=${incident.location.lon}#map=18/${incident.location.lat}/${incident.location.lon}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      location ±{Math.round(incident.location.accuracy_m)} m
                    </a>
                  </>
                )}
              </span>
              {incident.note && <p className="incident-note">{incident.note}</p>}
            </div>
            {hasPhoto && (
              <a href={mediaUrl(incident.id, "photo", "incidents")} target="_blank" rel="noreferrer">
                <img
                  className="incident-thumb"
                  src={mediaUrl(incident.id, "photo", "incidents")}
                  alt={`${label} scene`}
                  loading="lazy"
                />
              </a>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                command(`/incidents/${incident.id}/acknowledge`, {
                  actor: state.wallet.owner,
                })
              }
            >
              <Check size={15} />
              Acknowledge
            </button>
          </article>
        );
      })}
    </section>
  );
}
