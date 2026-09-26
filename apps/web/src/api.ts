import type { Method, State } from "./types";
import { authClient } from "./auth";

export async function request<T>(
  path: string,
  body?: object,
  method?: Method,
): Promise<T> {
  const verb = method ?? (body === undefined ? "GET" : "POST");
  const { data } = authClient ? await authClient.auth.getSession() : { data: { session: null } };
  const response = await fetch(`/api${path}`, {
    method: verb,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(data.session?.access_token
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : Array.isArray(error.detail)
          ? "Check the highlighted values and try again."
          : `Request failed (${response.status})`,
    );
  }
  return response.json();
}
export const getState = () => request<State>("/state");
export const sendCommand = (
  path: string,
  body: object = {},
  method: Method = "POST",
) => request<{ state: State; message: string }>(path, body, method);
export const mediaUrl = (reportId: string, kind: "photo" | "audio") =>
  `/api/reports/${encodeURIComponent(reportId)}/media/${kind}`;
export async function loadEvidence(reportId: string, kind: "photo" | "audio") {
  const { data } = authClient
    ? await authClient.auth.getSession()
    : { data: { session: null } };
  const response = await fetch(mediaUrl(reportId, kind), {
    headers: data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : undefined,
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error("Evidence could not be loaded.");
  return URL.createObjectURL(await response.blob());
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
export const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function ago(date: string | null, now = Date.now()) {
  if (!date) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(date)) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
