import { get, set, update, del } from "idb-keyval";
import type { State, LocalReport, FieldReport } from "./types";
import { request } from "./api";

const REPORTS = "averlock-reports-v1";
const SNAPSHOT = "averlock-snapshot-v1";
export const cachedState = () => get<State>(SNAPSHOT);
export const cacheState = (state: State) => set(SNAPSHOT, state);
export async function listReports(): Promise<LocalReport[]> {
  return (await get<LocalReport[]>(REPORTS)) || [];
}
export async function enqueue(report: FieldReport) {
  // Resolve only after IndexedDB commits, before displaying SAVED.
  await update<LocalReport[]>(REPORTS, (reports) => [
    ...(reports || []),
    { ...report, sync: "pending" },
  ]);
}
export async function clearLocalData() {
  await Promise.all([del(REPORTS), del(SNAPSHOT)]);
}
let syncing: Promise<void> | null = null;
export function syncReports(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    for (const local of await listReports()) {
      if (local.sync === "confirmed") continue;
      const report: FieldReport = {
        id: local.id,
        action_id: local.action_id,
        fault: local.fault,
        note: local.note,
        created_at: local.created_at,
        asset_id: local.asset_id,
        checklist: local.checklist,
        attachments: local.attachments,
      };
      try {
        await request("/reports", report);
        await update<LocalReport[]>(REPORTS, (rows) =>
          (rows || []).map((row) =>
            row.id === report.id
              ? { ...row, sync: "confirmed", error: undefined }
              : row,
          ),
        );
      } catch (error) {
        await update<LocalReport[]>(REPORTS, (rows) =>
          (rows || []).map((row) =>
            row.id === report.id
              ? {
                  ...row,
                  sync: "error",
                  error: error instanceof Error ? error.message : "Sync failed",
                }
              : row,
          ),
        );
      }
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
