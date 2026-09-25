import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  Menu,
  Radio,
  RotateCcw,
  ShieldCheck,
  WifiOff,
  X,
} from "lucide-react";
import { getState, sendCommand } from "./api";
import {
  cachedState,
  cacheState,
  clearLocalData,
  enqueue,
  listReports,
  syncReports,
} from "./offline";
import type { FieldReport, LocalReport, Page, State } from "./types";
import { Overview } from "./components/Overview";
import { Review } from "./components/Review";
import { Field } from "./components/Field";
import { Recovery } from "./components/Recovery";
import { Audit } from "./components/Audit";

const pages = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "review", label: "Review queue", icon: ClipboardCheck },
  { id: "field", label: "Field console", icon: MapPin },
  { id: "recovery", label: "Authority & recovery", icon: ShieldCheck },
  { id: "audit", label: "Activity log", icon: Activity },
] as const;
export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [reports, setReports] = useState<LocalReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(navigator.onLine);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [help, setHelp] = useState(false);
  const commandLock = useRef(false);
  const offline = !connected || simulatedOffline;
  const notify = useCallback((message: string) => setNotification(message), []);
  const refresh = useCallback(async () => {
    try {
      const next = await getState();
      setState(next);
      setError("");
      await cacheState(next).catch(() =>
        notify(
          "Browser storage is unavailable. Offline snapshots cannot be saved.",
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The local API is unavailable.",
      );
    }
  }, [notify]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cached = await cachedState();
        if (active && cached) setState(cached);
        const local = await listReports();
        if (active) setReports(local);
      } catch {
        if (active) notify("Local browser storage is unavailable.");
      }
      if (active) {
        await refresh();
        setLoading(false);
      }
    })();
    const online = () => setConnected(true);
    const offlineEvent = () => setConnected(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineEvent);
    return () => {
      active = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineEvent);
    };
  }, [refresh, notify]);
  const synchronize = useCallback(async () => {
    if (offline) return;
    try {
      await syncReports();
      const local = await listReports();
      setReports(local);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Unable to sync reports.");
    }
  }, [offline, refresh, notify]);
  useEffect(() => {
    if (!offline && !loading) void synchronize();
  }, [offline, loading, synchronize]);
  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(""), 8000);
    return () => clearTimeout(timer);
  }, [notification]);
  async function command(path: string, payload: object = {}) {
    if (commandLock.current) return false;
    if (offline) {
      notify(
        "You are offline. Field reports can still be saved on this device.",
      );
      return false;
    }
    commandLock.current = true;
    setBusy(true);
    try {
      const result = await sendCommand(path, payload);
      setState(result.state);
      setError("");
      notify(result.message);
      await cacheState(result.state).catch(() =>
        notify("Action completed, but browser snapshot storage failed."),
      );
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action could not complete.");
      return false;
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  }
  async function saveReport(report: FieldReport) {
    try {
      await enqueue(report);
      setReports(await listReports());
      notify("Compliance report saved on this device.");
      if (!offline) await synchronize();
      return true;
    } catch {
      notify(
        "Could not save locally. Check available browser storage and try again.",
      );
      return false;
    }
  }
  function go(next: Page) {
    setPage(next);
    setSidebar(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function reset() {
    if (
      !window.confirm(
        "Reset the local demo? This clears simulated actions, audit history, recovery, and this browser’s saved field reports.",
      )
    )
      return;
    if (await command("/demo/reset")) {
      await clearLocalData();
      setReports([]);
      await refresh();
      go("overview");
    }
  }
  const pending =
    state?.actions.filter((a) => a.status === "pending").length || 0;
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
        <button
          className="brand"
          onClick={() => go("overview")}
          aria-label="Averlock home"
        >
          <span className="brand-mark">
            <svg viewBox="0 0 32 32">
              <path d="m16 4 12 25h-7l-5-11-5 11H4L16 4Z" fill="currentColor" />
            </svg>
          </span>
          <span>
            averlock<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Radio size={18} />
          </span>
          <div>
            <strong>Desert Ridge</strong>
            <small>Solar operations</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "review" && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="autonomy-status">
            <span className="status-dot" />
            <div>
              <strong>Autonomy with boundaries</strong>
              <small>Policy enforced on every action</small>
            </div>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(!help)}>
            <CircleHelp size={16} />
            Demo guide
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar">MK</span>
            <div>
              <strong>
                {state?.wallet.owner === "replacement-supervisor"
                  ? "Leena Thomas"
                  : "Maya Kapoor"}
              </strong>
              <small>Supervisor · demo role</small>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebar(!sidebar)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{pages.find((p) => p.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <FlaskConical size={13} />
              LOCAL DEMO
            </span>
            <span className="connection">
              {offline ? (
                <WifiOff size={14} />
              ) : (
                <span className="status-dot" />
              )}
              {simulatedOffline
                ? "Offline simulation"
                : connected
                  ? "Online"
                  : "Offline"}
            </span>
            <button
              className="icon-button"
              onClick={() => void reset()}
              disabled={busy || offline}
              aria-label="Reset local demo"
              title="Reset local demo"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </header>
        {help && (
          <div className="demo-guide">
            <div>
              <strong>A five-minute walkthrough</strong>
              <p>
                Start the agent → request field verification → save a compliance
                report offline → reconnect and sync → approve the replacement.
                Enable the announced drill program in Review. Advance the
                availability clock in Recovery to demonstrate backup routing and
                guardian recovery.
              </p>
              <small>
                All identities and wallet payments in this UI are simulated. No
                external service is connected.
              </small>
            </div>
            <button
              className="icon-button"
              onClick={() => setHelp(false)}
              aria-label="Close demo guide"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {(offline || error) && state && (
          <div className="offline-banner">
            <WifiOff size={16} />
            <span>
              {simulatedOffline
                ? "Offline simulation is on. Reports stay on this device until you reconnect."
                : "Showing the last available site snapshot. Saved field reports are retained."}
              {error && !offline ? ` ${error}` : ""}
            </span>
            {!offline && (
              <button onClick={() => void refresh()}>Reconnect</button>
            )}
          </div>
        )}
        <main id="main" className="page-content">
          {loading && !state ? (
            <div className="empty loading">
              <LoaderCircle className="spin" size={28} />
              <h2>Connecting to the local workspace…</h2>
            </div>
          ) : !state ? (
            <div className="panel empty">
              <Radio size={35} />
              <h1>Start the local services.</h1>
              <p>{error || "The operations API is not running."}</p>
              <code>npm run dev</code>
              <button className="button primary" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Overview
                  state={state}
                  go={go}
                  command={command}
                  busy={busy || offline}
                />
              )}
              {page === "review" && (
                <Review
                  state={state}
                  go={go}
                  command={command}
                  busy={busy || offline}
                />
              )}
              {page === "field" && (
                <Field
                  state={state}
                  reports={reports}
                  offline={offline}
                  simulatedOffline={simulatedOffline}
                  setSimulatedOffline={setSimulatedOffline}
                  onSave={saveReport}
                  onSync={synchronize}
                  busy={busy}
                  command={command}
                />
              )}
              {page === "recovery" && (
                <Recovery
                  state={state}
                  command={command}
                  busy={busy || offline}
                />
              )}
              {page === "audit" && <Audit state={state} />}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <ShieldCheck size={13} />
            Autonomy without losing human control.
          </span>
          <span>AVERLOCK / LOCAL WORKSPACE</span>
        </footer>
      </div>
      {notification && (
        <div className="toast" role="status" aria-live="polite">
          <span>{notification}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotification("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
