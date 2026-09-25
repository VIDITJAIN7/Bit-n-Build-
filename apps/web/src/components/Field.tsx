import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  CloudUpload,
  Contrast,
  MapPin,
  Mic,
  RefreshCw,
  Save,
  Square,
  Sun,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import type {
  State,
  LocalReport,
  FieldReport,
  Attachment,
  Checklist,
  Command,
} from "../types";
import { time } from "../api";
import { HoldButton } from "./HoldButton";

const emptyChecklist: Checklist = {
  asset_matched: false,
  work_area_checked: false,
  protective_equipment_checked: false,
};
function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function samplePhoto(): Attachment {
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 450;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e7e8d5";
  ctx.fillRect(0, 0, 700, 450);
  ctx.fillStyle = "#d6d5be";
  ctx.fillRect(0, 320, 700, 130);
  ctx.fillStyle = "#fafbf3";
  ctx.fillRect(235, 60, 205, 300);
  ctx.strokeStyle = "#6e7d69";
  ctx.lineWidth = 4;
  ctx.strokeRect(235, 60, 205, 300);
  ctx.fillStyle = "#53634d";
  ctx.fillRect(270, 120, 135, 70);
  ctx.fillStyle = "#becfa0";
  ctx.font = "20px monospace";
  ctx.fillText("FAULT 04", 280, 162);
  ctx.fillStyle = "#ad3830";
  ctx.beginPath();
  ctx.arc(290, 233, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#69775c";
  ctx.font = "19px monospace";
  ctx.fillText("INV-04", 280, 97);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(270, 275 + i * 10, 135, 3);
  }
  ctx.fillStyle = "#314b27";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("SAMPLE ILLUSTRATION — NOT A SITE PHOTO", 90, 410);
  return {
    kind: "photo",
    name: "Demo evidence illustration.png",
    data_url: canvas.toDataURL("image/png"),
    demo_fixture: true,
  };
}

export function Field({
  state,
  reports,
  offline,
  simulatedOffline,
  setSimulatedOffline,
  onSave,
  onSync,
  busy,
  command,
}: {
  state: State;
  reports: LocalReport[];
  offline: boolean;
  simulatedOffline: boolean;
  setSimulatedOffline: (value: boolean) => void;
  onSave: (report: FieldReport) => Promise<boolean>;
  onSync: () => Promise<void>;
  busy: boolean;
  command: Command;
}) {
  const [fault, setFault] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [contrast, setContrast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [checklist, setChecklist] = useState<Checklist>({ ...emptyChecklist });
  const [asset, setAsset] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timeout = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (media.current?.state === "recording") media.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );
  const hot = state.weather.high_heat;
  const task = state.actions.find(
    (a) => a.verification_requested && a.status === "pending",
  );
  const valid =
    fault !== null &&
    Object.values(checklist).every(Boolean) &&
    attachments.some((a) => a.kind === "photo") &&
    (!hot || asset.trim().toUpperCase() === "INV-04");
  function add(attachment: Attachment) {
    setAttachments((old) => [
      ...old.filter((a) => a.kind !== attachment.kind),
      attachment,
    ]);
    setError("");
  }
  async function upload(file: File | undefined, kind: "photo" | "audio") {
    if (!file) return;
    if (file.size > 2800000) {
      setError("Use an attachment smaller than 2.8 MB for this local demo.");
      return;
    }
    if (
      !(
        kind === "photo"
          ? /^image\/(jpeg|png|webp)$/
          : /^audio\/(webm|ogg|mp4|mpeg|wav)(;.*)?$/
      ).test(file.type)
    ) {
      setError("Use JPG/PNG/WebP photos or WebM/OGG/MP4/MP3/WAV audio.");
      return;
    }
    try {
      add({
        kind,
        name: file.name,
        data_url: await asDataURL(file),
        demo_fixture: false,
      });
    } catch {
      setError("The attachment could not be read.");
    }
  }
  async function record() {
    if (recording) {
      media.current?.stop();
      return;
    }
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setError(
          "Recording is not supported here. Upload an audio file instead.",
        );
        return;
      }
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mime) throw new Error("No supported audio format");
      const recorder = new MediaRecorder(stream.current, { mimeType: mime });
      media.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        void (async () => {
          stream.current?.getTracks().forEach((track) => track.stop());
          setRecording(false);
          if (timeout.current) clearTimeout(timeout.current);
          const blob = new Blob(chunks, { type: mime });
          if (blob.size > 2800000) {
            setError("Recording exceeded 2.8 MB. Record a shorter note.");
            return;
          }
          add({
            kind: "audio",
            name: "Field voice note",
            data_url: await asDataURL(blob),
            demo_fixture: false,
          });
        })().catch(() => setError("Audio could not be saved."));
      };
      recorder.start();
      setRecording(true);
      setError("");
      timeout.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 45000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      setError(
        "Microphone access was unavailable. You can upload audio or use a text note.",
      );
    }
  }
  async function save() {
    if (!task || !valid || fault === null || saving) return;
    setSaving(true);
    const success = await onSave({
      id: crypto.randomUUID(),
      action_id: task.id,
      fault,
      note: note.trim(),
      created_at: new Date().toISOString(),
      asset_id: hot ? asset.trim().toUpperCase() : "INV-04",
      checklist,
      attachments,
    });
    if (success) {
      setSaved(true);
      setFault(null);
      setNote("");
      setChecklist({ ...emptyChecklist });
      setAttachments([]);
      setAsset("");
    }
    setSaving(false);
  }
  const notes = (
    <>
      <label className="note-label">
        Field note <span>OPTIONAL</span>
        <textarea
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything else the supervisor should know?"
          rows={3}
        />
      </label>
      <div className="attachment-controls">
        <button className="button secondary" onClick={() => void record()}>
          {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
          {recording ? "Stop recording" : "Record voice note"}
        </button>
        <label className="button secondary file-label">
          <Upload size={15} />
          Upload audio
          <input
            type="file"
            accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav"
            onChange={(e) => void upload(e.target.files?.[0], "audio")}
          />
        </label>
      </div>
    </>
  );
  return (
    <div
      className={`${contrast || hot ? "high-contrast " : ""}field-page ${hot ? "heat-task" : ""}`}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span />
            DESIGNED FOR THE REAL WORLD
          </p>
          <h1>Eyes on the equipment.</h1>
          <p className="subtitle">
            A complete compliance record. Built to stay with you offline.
          </p>
        </div>
        <button
          className="button secondary"
          aria-pressed={contrast || hot}
          onClick={() => setContrast(!contrast)}
          disabled={hot}
        >
          <Contrast size={17} />
          {hot
            ? "Sunlight mode · heat active"
            : contrast
              ? "Standard contrast"
              : "Sunlight mode"}
        </button>
      </div>
      <div className="heat-banner">
        <Sun size={24} />
        <div>
          <strong>
            {state.weather.heat_index_c}°C heat index · {state.weather.source}
          </strong>
          <p>
            {hot
              ? "Larger controls, optional notes collapsed, and one deliberate asset readback before saving."
              : "Heat conditions are simulated. A weather adapter can supply this reading later."}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={offline || busy}
          onClick={() => command("/weather/scenario", { hot: !hot })}
        >
          {hot ? "Use warm scenario" : "Simulate high heat"}
        </button>
      </div>
      <div className="field-layout">
        <section className="panel field-task">
          <div className="field-task-top">
            <span>
              <MapPin size={16} />
              SITE 07 / INVERTER 04
            </span>
            <span className={`badge ${offline ? "warning" : "green-badge"}`}>
              {offline ? <WifiOff size={13} /> : <Check size={13} />}{" "}
              {offline
                ? simulatedOffline
                  ? "DEMO OFFLINE"
                  : "OFFLINE"
                : "CONNECTED"}
            </span>
          </div>
          {task ? (
            <div className="field-task-body">
              <div className="field-task-count">
                EQUIPMENT COMPLIANCE LOG <span>INV-04</span>
              </div>
              <h2>
                Is the red fault
                <br />
                indicator active?
              </h2>
              <p>Check the front panel. Record only what you can observe.</p>
              <div className="equipment-figure">
                <div className="equipment-body">
                  <div className="equipment-label">INV / 04</div>
                  <div className="equipment-screen">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="equipment-status">
                    <span />
                    <i />
                  </div>
                  <div className="equipment-vents" />
                </div>
                <div className="figure-callout">
                  <span />
                  CHECK THE
                  <br />
                  RED INDICATOR
                </div>
              </div>
              <div className="field-choices">
                <button
                  className={fault === true ? "chosen" : ""}
                  aria-pressed={fault === true}
                  onClick={() => {
                    setFault(true);
                    setSaved(false);
                  }}
                >
                  <Check size={25} />
                  <strong>Yes</strong>
                  <span>Red light is active</span>
                </button>
                <button
                  className={fault === false ? "chosen" : ""}
                  aria-pressed={fault === false}
                  onClick={() => {
                    setFault(false);
                    setSaved(false);
                  }}
                >
                  <X size={25} />
                  <strong>No</strong>
                  <span>No visible fault</span>
                </button>
              </div>
              <fieldset className="compliance-checks">
                <legend>Complete the compliance observations</legend>
                {(
                  [
                    ["asset_matched", "Equipment label matches INV-04"],
                    ["work_area_checked", "Surrounding work area checked"],
                    [
                      "protective_equipment_checked",
                      "Required protective equipment checked",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={checklist[key]}
                      onChange={(e) =>
                        setChecklist({ ...checklist, [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <span className="attachment-title">
                Evidence image · required
              </span>
              <div className="attachment-controls">
                <label className="button secondary file-label">
                  <Camera size={16} />
                  Add photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    onChange={(e) => void upload(e.target.files?.[0], "photo")}
                  />
                </label>
                <button
                  className="button secondary"
                  onClick={() => add(samplePhoto())}
                >
                  Use demo illustration
                </button>
              </div>
              {hot ? (
                <details className="source-details" style={{ marginTop: 20 }}>
                  <summary>Optional notes & voice recording</summary>
                  {notes}
                </details>
              ) : (
                notes
              )}
              {attachments.map((attachment) => (
                <div className="attachment-card" key={attachment.kind}>
                  <div>
                    <strong>
                      {attachment.name}
                      {attachment.demo_fixture ? " · SIMULATED EVIDENCE" : ""}
                    </strong>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${attachment.kind}`}
                      onClick={() =>
                        setAttachments(
                          attachments.filter((a) => a.kind !== attachment.kind),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {attachment.kind === "photo" ? (
                    <img
                      src={attachment.data_url}
                      alt={
                        attachment.demo_fixture
                          ? "Labeled sample inverter illustration"
                          : "Attached field evidence"
                      }
                    />
                  ) : (
                    <audio src={attachment.data_url} controls />
                  )}
                </div>
              ))}
              {hot && (
                <label className="asset-readback">
                  Read the equipment label and type INV-04
                  <input
                    value={asset}
                    onChange={(e) => setAsset(e.target.value)}
                    placeholder="Equipment ID"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              )}
              {error && (
                <p className="report-error" role="alert">
                  {error}
                </p>
              )}
              {hot ? (
                <div style={{ marginTop: 20 }}>
                  <HoldButton
                    onConfirm={() => void save()}
                    disabled={!valid || saving || recording}
                  >
                    Hold to save compliance log
                  </HoldButton>
                </div>
              ) : (
                <button
                  className="button primary field-save"
                  onClick={() => void save()}
                  disabled={saving || !valid || recording}
                >
                  <Save size={19} />
                  {saving ? "Saving to this device…" : "Save compliance log"}
                  <ArrowRight size={18} />
                </button>
              )}
              <p className="field-save-help" role="status">
                {saved ? (
                  <>
                    <CheckCircle2 size={14} />
                    Saved on this device. Check sync status below.
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    Timestamped locally. Confirmed after server acceptance.
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="empty">
              <CheckCircle2 size={42} />
              <h2>No field task waiting.</h2>
              <p>
                Request physical verification from the review queue to begin.
              </p>
            </div>
          )}
        </section>
        <aside className="field-aside">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>The context you need</h2>
                <p>Provided by the site planner</p>
              </div>
            </div>
            <div className="field-context-row">
              <span className="context-dot amber-bg" />
              <div>
                <strong>Vibration is above normal</strong>
                <p>78°C · 13 recorded error events</p>
              </div>
            </div>
            <div className="field-context-row">
              <span className="context-dot blue-bg" />
              <div>
                <strong>No replacement fan in stock</strong>
                <p>Cooling fan X14 · 0 available</p>
              </div>
            </div>
            <div className="field-context-row">
              <span className="context-dot green-bg" />
              <div>
                <strong>A visit is already scheduled</strong>
                <p>Alex Rivera · In 3 days</p>
              </div>
            </div>
            <div className="context-bottom">
              <span className="eyebrow small">
                WHY YOUR OBSERVATION MATTERS
              </span>
              <p>
                The fault observation, image, checklist, and timestamp support
                the supervisor’s decision. Voice notes provide optional context.
                A report alone never authorizes spending.
              </p>
            </div>
          </section>
          <section className="offline-card">
            <WifiOff size={23} />
            <h3>Try an interrupted connection.</h3>
            <p>
              Turn on the local simulation, save a report, then reconnect and
              sync.
            </p>
            <label className="switch-row">
              <span>Simulate offline</span>
              <input
                type="checkbox"
                role="switch"
                checked={simulatedOffline}
                onChange={(e) => setSimulatedOffline(e.target.checked)}
              />
            </label>
            <small>
              Full offline page reload works in the production preview after one
              connected visit. Audio recording requires microphone permission;
              uploads remain available.
            </small>
          </section>
        </aside>
      </div>
      <section className="panel reports-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Your compliance records{" "}
              <span className="count">{reports.length}</span>
            </h2>
            <p>Images, audio, checklist, and timestamps persist in IndexedDB</p>
          </div>
          <button
            className="button secondary"
            disabled={offline || busy || saving}
            onClick={() => void onSync()}
          >
            <RefreshCw size={15} />
            Sync now
          </button>
        </div>
        {reports.length ? (
          [...reports].reverse().map((report) => (
            <div className="report-line" key={report.id}>
              <span className="item-icon neutral">
                <CloudUpload size={19} />
              </span>
              <div className="row-main">
                <strong>
                  {report.asset_id} · Fault indicator{" "}
                  {report.fault ? "active" : "not active"}
                </strong>
                <small>
                  {report.note || "No additional note"} ·{" "}
                  {new Date(report.created_at).toLocaleDateString()}{" "}
                  {time(report.created_at)}
                </small>
                <div className="report-evidence">
                  {report.attachments.map((a) =>
                    a.kind === "photo" ? (
                      <a key={a.kind} href={a.data_url} download={a.name}>
                        {a.demo_fixture
                          ? "Download sample evidence"
                          : "Download photo"}
                      </a>
                    ) : (
                      <audio key={a.kind} src={a.data_url} controls />
                    ),
                  )}
                </div>
                {report.error && (
                  <span className="report-error">{report.error}</span>
                )}
              </div>
              <span
                className={`badge ${report.sync === "confirmed" ? "green-badge" : "warning"}`}
              >
                {report.sync === "confirmed"
                  ? "CONFIRMED"
                  : report.sync === "error"
                    ? "SYNC FAILED · SAVED"
                    : "PENDING SYNC · SAVED"}
              </span>
            </div>
          ))
        ) : (
          <p className="empty-inline">
            Your next record will appear here, with a clear save and sync
            status.
          </p>
        )}
      </section>
    </div>
  );
}
