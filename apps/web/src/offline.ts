import { get, set, update, del } from "idb-keyval";
import type {
  State,
  LocalReport,
  FieldReport,
  IncidentReport,
  LocalIncident,
} from "./types";
import { request, UPLOAD_TIMEOUT_MS } from "./api";

// v2: reports answer generic field tasks instead of one hard-coded inverter check.
const REPORTS = "averlock-reports-v2";
const SNAPSHOT = "averlock-snapshot-v2";
const INCIDENTS = "averlock-incidents-v1";
export const cachedState = () => get<State>(SNAPSHOT);
export const cacheState = (state: State) => set(SNAPSHOT, state);
export async function listReports(): Promise<LocalReport[]> {
  return (await get<LocalReport[]>(REPORTS)) || [];
}
export async function listIncidents(): Promise<LocalIncident[]> {
  return (await get<LocalIncident[]>(INCIDENTS)) || [];
}
export async function enqueue(
  report: FieldReport,
  context: Pick<LocalReport, "subject_label" | "question" | "field_labels">,
) {
  // Resolve only after IndexedDB commits, before displaying SAVED.
  await update<LocalReport[]>(REPORTS, (reports) => [
    ...(reports || []),
    { ...report, ...context, sync: "pending" },
  ]);
}
export async function enqueueIncident(incident: IncidentReport) {
  await update<LocalIncident[]>(INCIDENTS, (incidents) => [
    ...(incidents || []),
    { ...incident, sync: "pending" },
  ]);
}
export async function clearLocalData() {
  await Promise.all([del(REPORTS), del(SNAPSHOT), del(INCIDENTS)]);
}

type Queued = { id: string; sync: "pending" | "confirmed" | "error" };

// Uploads each unconfirmed item once; the server treats a repeated ID as the same item.
async function drain<T extends Queued>(
  key: string,
  path: string,
  payload: (item: T) => object,
) {
  const items = (await get<T[]>(key)) || [];
  for (const item of items) {
    if (item.sync === "confirmed") continue;
    let result: Partial<Queued> & { error?: string };
    try {
      await request(path, payload(item), "POST", UPLOAD_TIMEOUT_MS);
      result = { sync: "confirmed", error: undefined };
    } catch (error) {
      result = {
        sync: "error",
        error: error instanceof Error ? error.message : "Sync failed",
      };
    }
    await update<T[]>(key, (rows) =>
      (rows || []).map((row) => (row.id === item.id ? { ...row, ...result } : row)),
    );
  }
}

let syncing: Promise<void> | null = null;
export function syncReports(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    // Emergencies first: an incident must not wait behind a queue of photo reports.
    await drain<LocalIncident>(INCIDENTS, "/incidents", (local) => ({
      id: local.id,
      site_id: local.site_id,
      kind: local.kind,
      severity: local.severity,
      note: local.note,
      created_at: local.created_at,
      location: local.location,
      attachments: local.attachments,
    }));
    await drain<LocalReport>(REPORTS, "/reports", (local) => ({
      id: local.id,
      task_id: local.task_id,
      answer: local.answer,
      note: local.note,
      created_at: local.created_at,
      asset_code: local.asset_code,
      checklist: local.checklist,
      responses: local.responses,
      attachments: local.attachments,
    }));
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
