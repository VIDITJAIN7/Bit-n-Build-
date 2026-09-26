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
  ReportFieldDefinition,
} from "../types";
import { time } from "../api";
import { fieldFor, formatValue } from "../rules";
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
async function preparePhoto(
  file: File,
): Promise<{ data_url: string; name: string }> {
  if (typeof createImageBitmap !== "function") {
    if (file.size > 2800000)
      throw new Error(
        "This browser cannot resize the photo; choose an image under 2.8 MB.",
      );
    return { data_url: await asDataURL(file), name: file.name };
  }
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    let quality = 0.84;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Photo resizing is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("Photo compression failed.")),
          "image/jpeg",
          quality,
        ),
      );
      if (blob.size <= 2500000) {
        const stem = file.name.replace(/\.[^.]+$/, "");
        return {
          data_url: await asDataURL(blob),
          name: `${stem || "field-photo"}.jpg`,
        };
      }
      scale *= 0.78;
      quality = Math.max(0.52, quality - 0.06);
    }
    throw new Error(
      "Photo is still too large after resizing. Try a closer, smaller image.",
    );
  } finally {
    bitmap.close();
  }
}
export function Field({
  state,
  siteFilter,
  reports,
  offline,
  onSave,
  onSync,
  busy,
  workerMode = false,
}: {
  state: State;
  siteFilter: string;
  reports: LocalReport[];
  offline: boolean;
  onSave: (
    report: FieldReport,
    context: Pick<LocalReport, "subject_label" | "question" | "field_labels">,
  ) => Promise<boolean>;
  onSync: () => Promise<void>;
  busy: boolean;
  workerMode?: boolean;
}) {
  const [fault, setFault] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [contrast, setContrast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [checklist, setChecklist] = useState<Checklist>({ ...emptyChecklist });
  const [asset, setAsset] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [responses, setResponses] = useState<
    Record<string, string | number | boolean>
  >({});
  const [workerStep, setWorkerStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const outdoorMode = workerMode || hot;
  // Tasks answered on this device but not yet synced stay out of the queue.
  const answeredLocally = new Set(
    reports.filter((r) => r.sync !== "confirmed").map((r) => r.task_id),
  );
  const tasks = state.field_tasks.filter(
    (t) =>
      t.status === "open" &&
      !answeredLocally.has(t.id) &&
      (siteFilter === "all" || t.site_id === siteFilter),
  );
  const task = tasks.find((t) => t.id === selectedId) ?? tasks[0];
  const code = task?.subject_code ?? "";
  const site = state.sites.find((s) => s.id === task?.site_id);
  const subject = state.assets.find((a) => a.id === task?.subject_id);
  const reportFields: ReportFieldDefinition[] = task?.report_fields ?? [];
  const reportSchema = JSON.stringify(reportFields);
  useEffect(() => {
    const definitions = new Map(reportFields.map((field) => [field.key, field]));
    setResponses((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key, value]) => {
          const definition = definitions.get(key);
          if (!definition) return false;
          if (definition.type === "text") return typeof value === "string";
          if (definition.type === "number")
            return typeof value === "number" && Number.isFinite(value);
          return typeof value === "boolean";
        }),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [task?.id, reportSchema]);
  const pendingReports = reports.filter(
    (report) => report.sync !== "confirmed",
  ).length;
  const requiredFieldsComplete = reportFields.every((field) => {
    const value = responses[field.key];
    if (!field.required) return true;
    if (value === undefined || value === "") return false;
    if (typeof value === "string" && !value.trim()) return false;
    return field.type === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : true;
  });
  const valid =
    fault !== null &&
    Object.values(checklist).every(Boolean) &&
    requiredFieldsComplete &&
    attachments.some((a) => a.kind === "photo") &&
    (!outdoorMode || asset.trim().toUpperCase() === code.toUpperCase());
  const stepValid =
    workerStep === 0
      ? fault !== null
      : workerStep === 1
        ? Object.values(checklist).every(Boolean) && requiredFieldsComplete
        : workerStep === 2
          ? attachments.some((item) => item.kind === "photo")
          : asset.trim().toUpperCase() === code.toUpperCase();
  function reset() {
    setFault(null);
    setNote("");
    setChecklist({ ...emptyChecklist });
    setAttachments([]);
    setAsset("");
    setResponses({});
    setWorkerStep(0);
    setError("");
  }
  function choose(id: string) {
    if (id === task?.id) return;
    setSelectedId(id);
    setWorkerStep(0);
    reset();
  }
  function add(attachment: Attachment) {
    setAttachments((old) => [
      ...old.filter((a) => a.kind !== attachment.kind),
      attachment,
    ]);
    setError("");
  }
  async function upload(file: File | undefined, kind: "photo" | "audio") {
    if (!file) return;
    if (kind === "audio" && file.size > 2800000) {
      setError("Use an audio file smaller than 2.8 MB.");
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
      const photo = kind === "photo" ? await preparePhoto(file) : null;
      add({
        kind,
        name: photo?.name ?? file.name,
        data_url: photo?.data_url ?? (await asDataURL(file)),
        demo_fixture: false,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The attachment could not be read.",
      );
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
    const success = await onSave(
      {
        id: crypto.randomUUID(),
        task_id: task.id,
        answer: fault,
        note: note.trim(),
        created_at: new Date().toISOString(),
        asset_code: outdoorMode ? asset.trim().toUpperCase() : code,
        checklist,
        responses,
        attachments,
      },
      {
        subject_label: task.subject_label,
        question: task.question,
        field_labels: Object.fromEntries(
          reportFields.map((field) => [field.key, field.label]),
        ),
      },
    );
    if (success) {
      setSelectedId(null);
      reset();
    }
    setSaving(false);
  }
  const notes = (
    <>
      <label className="note-label">
        Note <span>OPTIONAL</span>
        <textarea
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note"
          rows={3}
        />
      </label>
      <div className="attachment-controls">
        <button className="button secondary" onClick={() => void record()}>
          {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
          {recording ? "Stop" : "Record note"}
        </button>
        <label className="button secondary file-label">
          <Upload size={15} />
          Add audio
          <input
            type="file"
            accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav"
            onChange={(e) => void upload(e.target.files?.[0], "audio")}
          />
        </label>
      </div>
    </>
  );
  const reportRows = reports.length ? (
    [...reports].reverse().map((report) => (
      <div className="report-line" key={report.id}>
        <span className="item-icon neutral">
          <CloudUpload size={19} />
        </span>
        <div className="row-main">
          <strong>
            {report.asset_code} · {report.answer ? "Yes" : "No"}
            {report.question ? ` — ${report.question}` : ""}
          </strong>
          {!workerMode && (
            <small>
              {report.note || "No additional note"} ·{" "}
              {new Date(report.created_at).toLocaleDateString()}{" "}
              {time(report.created_at)}
            </small>
          )}
          {report.responses && Object.keys(report.responses).length > 0 && (
            <div className="report-responses">
              {Object.entries(report.responses).map(([key, value]) => (
                <span key={key}>
                  <strong>{report.field_labels?.[key] ?? key}:</strong>{" "}
                  {String(value)}
                </span>
              ))}
            </div>
          )}
          <div className="report-evidence">
            {report.attachments.map((attachment) =>
              attachment.kind === "photo" ? (
                <a
                  key={attachment.kind}
                  href={attachment.data_url}
                  download={attachment.name}
                >
                  Photo
                </a>
              ) : (
                <audio
                  key={attachment.kind}
                  src={attachment.data_url}
                  controls
                />
              ),
            )}
          </div>
          {report.error && <span className="report-error">{report.error}</span>}
        </div>
        <span
          className={`badge ${report.sync === "confirmed" ? "green-badge" : "warning"}`}
        >
          {report.sync === "confirmed"
            ? "SYNCED"
            : report.sync === "error"
              ? "SAVED · RETRY"
              : "SAVED · PENDING"}
        </span>
      </div>
    ))
  ) : (
    <p className="empty-inline">No saved reports.</p>
  );
  return (
    <div
      className={`${contrast || hot || workerMode ? "high-contrast " : ""}field-page ${hot ? "heat-task " : ""}${workerMode ? "worker-field-mode" : ""}`}
    >
      {!workerMode && (
        <div className="page-heading">
          <h1>Field</h1>
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
      )}
      {!workerMode && (
        <div className="heat-banner">
          <Sun size={24} />
          <div>
            <strong>Outdoor work conditions</strong>
            <p>
              {hot
                ? "High-heat workflow active: larger controls, focused reporting, and equipment readback."
                : "Large touch targets, equipment readback, and offline report syncing."}
            </p>
          </div>
        </div>
      )}
      <div className={`field-layout ${workerMode ? "worker-layout" : ""}`}>
        <section className="panel field-task">
          <div className="field-task-top">
            <span>
              <MapPin size={16} />
              {task
                ? `${site?.name ?? "SITE"} / ${code}`.toUpperCase()
                : "TASKS"}
            </span>
            <span className={`badge ${offline ? "warning" : "green-badge"}`}>
              {offline ? <WifiOff size={13} /> : <Check size={13} />}{" "}
              {offline ? "OFFLINE" : "CONNECTED"}
            </span>
          </div>
          {tasks.length > 1 && (
            <div
              className="task-picker"
              role="radiogroup"
              aria-label="Field tasks"
            >
              {tasks.map((item) => (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={item.id === task?.id}
                  className={item.id === task?.id ? "selected" : ""}
                  onClick={() => choose(item.id)}
                >
                  <strong>{item.subject_code}</strong>
                  <small>
                    {state.sites.find((s) => s.id === item.site_id)?.name}
                    {item.assignee ? ` · ${item.assignee}` : ""}
                    {!workerMode && item.gates_decision
                      ? " · blocks an approval"
                      : ""}
                  </small>
                </button>
              ))}
            </div>
          )}
          {task ? (
            <div className="field-task-body">
              {!workerMode && (
                <div className="field-task-count">
                  EQUIPMENT COMPLIANCE LOG <span>{code}</span>
                </div>
              )}
              <h2>{task.question}</h2>
              {!workerMode && (
                <p>
                  {task.subject_label}. Check it in person and record only what
                  you can observe.
                </p>
              )}
              {task.instructions && (
                <p className="field-task-instructions">{task.instructions}</p>
              )}
              {workerMode && (
                <div
                  className="worker-stepper"
                  role="progressbar"
                  aria-label={`Step ${workerStep + 1} of 4`}
                  aria-valuemin={1}
                  aria-valuemax={4}
                  aria-valuenow={workerStep + 1}
                >
                  <span className="worker-progress-track">
                    <span
                      style={{ width: `${((workerStep + 1) / 4) * 100}%` }}
                    />
                  </span>
                  <strong>
                    {workerStep + 1} / 4 ·{" "}
                    {["Answer", "Checks", "Photo", "Confirm"][workerStep]}
                  </strong>
                </div>
              )}
              {!workerMode && (
                <div className="equipment-figure">
                  <div className="equipment-body">
                    <div className="equipment-label">{code}</div>
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
                    CHECK
                    <br />
                    {code}
                  </div>
                </div>
              )}
              {(!workerMode || workerStep === 0) && (
                <div className="field-choices">
                  <button
                    className={fault === true ? "chosen" : ""}
                    aria-pressed={fault === true}
                    onClick={() => {
                      setFault(true);
                    }}
                  >
                    <Check size={25} />
                    <strong>Yes</strong>
                    {!workerMode && <span>I can confirm it</span>}
                  </button>
                  <button
                    className={fault === false ? "chosen" : ""}
                    aria-pressed={fault === false}
                    onClick={() => {
                      setFault(false);
                    }}
                  >
                    <X size={25} />
                    <strong>No</strong>
                    {!workerMode && <span>Not observed</span>}
                  </button>
                </div>
              )}
              {(!workerMode || workerStep === 1) && (
                <div className="worker-observation-step">
                  <fieldset className="compliance-checks">
                    <legend>
                      {workerMode
                        ? "Safety checks"
                        : "Complete the compliance observations"}
                    </legend>
                    {(
                      [
                        [
                          "asset_matched",
                          workerMode
                            ? "Asset ID matches"
                            : `Equipment label matches ${code}`,
                        ],
                        [
                          "work_area_checked",
                          workerMode
                            ? "Work area is safe"
                            : "Surrounding work area checked",
                        ],
                        [
                          "protective_equipment_checked",
                          workerMode
                            ? "PPE checked"
                            : "Required protective equipment checked",
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={checklist[key]}
                          onChange={(e) =>
                            setChecklist({
                              ...checklist,
                              [key]: e.target.checked,
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  {reportFields.length > 0 && (
                    <fieldset className="worker-response-fields">
                      <legend>
                        {workerMode ? "Details" : "Requested observations"}
                      </legend>
                      {reportFields.map((field) => (
                        <label
                          className="field worker-response-field"
                          key={field.key}
                        >
                          <span>
                            {field.label}
                            {field.required && <b> · REQUIRED</b>}
                          </span>
                          {field.type === "yes_no" ? (
                            <span className="response-choice-row">
                              {[true, false].map((value) => (
                                <button
                                  type="button"
                                  key={String(value)}
                                  className={`button ${responses[field.key] === value ? "primary" : "secondary"}`}
                                  aria-pressed={responses[field.key] === value}
                                  onClick={() =>
                                    setResponses((old) => ({
                                      ...old,
                                      [field.key]: value,
                                    }))
                                  }
                                >
                                  {value ? "Yes" : "No"}
                                </button>
                              ))}
                            </span>
                          ) : (
                            <input
                              type={field.type === "number" ? "number" : "text"}
                              inputMode={
                                field.type === "number" ? "decimal" : undefined
                              }
                              maxLength={
                                field.type === "text" ? 500 : undefined
                              }
                              value={
                                responses[field.key] === undefined ||
                                typeof responses[field.key] === "boolean"
                                  ? ""
                                  : String(responses[field.key])
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                setResponses((old) => {
                                  const next = { ...old };
                                  if (value === "") delete next[field.key];
                                  else if (field.type === "number") {
                                    const parsed = Number(value);
                                    if (Number.isFinite(parsed))
                                      next[field.key] = parsed;
                                    else delete next[field.key];
                                  } else next[field.key] = value;
                                  return next;
                                });
                              }}
                              required={field.required}
                            />
                          )}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              )}
              {(!workerMode || workerStep === 2) && (
                <div className="worker-evidence-step">
                  <span className="attachment-title">
                    {workerMode
                      ? "Photo · required"
                      : "Evidence image · required"}
                  </span>
                  <div className="attachment-controls">
                    <label className="button secondary file-label">
                      <Camera size={16} />
                      Add photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        onChange={(e) =>
                          void upload(e.target.files?.[0], "photo")
                        }
                      />
                    </label>
                  </div>
                  {outdoorMode ? (
                    <details
                      className="source-details"
                      style={{ marginTop: 20 }}
                    >
                      <summary>Add a note or voice note</summary>
                      {notes}
                    </details>
                  ) : (
                    notes
                  )}
                  {attachments.map((attachment) => (
                    <div className="attachment-card" key={attachment.kind}>
                      <div>
                        <strong>{attachment.name}</strong>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${attachment.kind}`}
                          onClick={() =>
                            setAttachments(
                              attachments.filter(
                                (a) => a.kind !== attachment.kind,
                              ),
                            )
                          }
                        >
                          <X size={16} />
                        </button>
                      </div>
                      {attachment.kind === "photo" ? (
                        <img
                          src={attachment.data_url}
                          alt={"Attached field evidence"}
                        />
                      ) : (
                        <audio src={attachment.data_url} controls />
                      )}
                    </div>
                  ))}
                  {error && (
                    <p className="report-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
              {(!workerMode || workerStep === 3) && (
                <div className="worker-confirm-step">
                  {outdoorMode && (
                    <label className="asset-readback">
                      {workerMode
                        ? "Enter equipment ID"
                        : `Read the equipment label and type ${code}`}
                      <input
                        value={asset}
                        onChange={(e) => setAsset(e.target.value)}
                        placeholder="Equipment ID"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  )}
                  {outdoorMode ? (
                    <div style={{ marginTop: 20 }}>
                      <HoldButton
                        onConfirm={() => void save()}
                        disabled={!valid || saving || recording}
                      >
                        {workerMode
                          ? "Hold to save report"
                          : "Hold to save compliance log"}
                      </HoldButton>
                    </div>
                  ) : (
                    <button
                      className="button primary field-save"
                      onClick={() => void save()}
                      disabled={saving || !valid || recording}
                    >
                      <Save size={19} />
                      {saving
                        ? "Saving to this device…"
                        : "Save compliance log"}
                      <ArrowRight size={18} />
                    </button>
                  )}
                </div>
              )}
              {workerMode && workerStep < 3 && (
                <div className="worker-step-controls">
                  {workerStep > 0 && (
                    <button
                      className="button secondary"
                      onClick={() => setWorkerStep((step) => step - 1)}
                    >
                      Back
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={!stepValid}
                    onClick={() =>
                      setWorkerStep((step) => Math.min(3, step + 1))
                    }
                  >
                    Continue
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">
              <CheckCircle2 size={42} />
              <h2>No open tasks</h2>
            </div>
          )}
        </section>
        {!workerMode && (
          <aside className="field-aside">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>The context you need</h2>
                  <p>Live readings from the workspace</p>
                </div>
              </div>
              {subject ? (
                Object.entries(subject.metrics).map(([key, value]) => {
                  const field = fieldFor(state, "assets", key);
                  return (
                    <div className="field-context-row" key={key}>
                      <span className="context-dot amber-bg" />
                      <div>
                        <strong>{field?.label ?? key}</strong>
                        <p>{formatValue(field, value)}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="field-context-row">
                  <span className="context-dot blue-bg" />
                  <div>
                    <strong>
                      {task ? task.subject_label : "No task selected"}
                    </strong>
                    <p>
                      {task ? `Code ${code}` : "Waiting for the next dispatch"}
                    </p>
                  </div>
                </div>
              )}
              {site && (
                <div className="field-context-row">
                  <span className="context-dot green-bg" />
                  <div>
                    <strong>{site.name}</strong>
                    <p>
                      {site.technician || "Site technician"} · next visit in{" "}
                      {site.next_visit_days} days
                    </p>
                  </div>
                </div>
              )}
              <div className="context-bottom">
                <span className="eyebrow small">
                  WHY YOUR OBSERVATION MATTERS
                </span>
                <p>
                  {task?.gates_decision
                    ? "A purchase is waiting on your answer. The observation, image, checklist, and timestamp support the supervisor’s decision; a report alone never authorizes spending."
                    : "Saved with the image, checklist, and timestamp."}
                </p>
              </div>
            </section>
          </aside>
        )}
      </div>
      {workerMode ? (
        reports.length > 0 && (
          <details className="panel reports-panel worker-reports-panel">
            <summary className="worker-reports-summary">
              <strong>Saved reports · {reports.length}</strong>
              <span>
                {pendingReports ? `${pendingReports} to sync` : "Synced"}
              </span>
            </summary>
            <div className="worker-reports-content">
              <button
                className="button secondary"
                disabled={offline || busy || saving || pendingReports === 0}
                onClick={() => void onSync()}
              >
                <RefreshCw size={16} /> Sync
              </button>
              {reportRows}
            </div>
          </details>
        )
      ) : (
        <section className="panel reports-panel">
          <div className="panel-heading">
            <div>
              <h2>
                Reports <span className="count">{reports.length}</span>
              </h2>
            </div>
            <button
              className="button secondary"
              disabled={offline || busy || saving}
              onClick={() => void onSync()}
            >
              <RefreshCw size={15} /> Sync now
            </button>
          </div>
          {reportRows}
        </section>
      )}
    </div>
  );
}
