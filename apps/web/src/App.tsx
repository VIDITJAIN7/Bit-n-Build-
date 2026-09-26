import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ClipboardCheck,
  Database,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Radio,
  ShieldCheck,
  Workflow,
  WifiOff,
  X,
} from "lucide-react";
import { getState, request, sendCommand } from "./api";
import {
  cachedState,
  cacheState,
  enqueue,
  listReports,
  syncReports,
} from "./offline";
import { industryIcon } from "./rules";
import type {
  FieldReport,
  LocalReport,
  Method,
  Page,
  State,
  TriggerDraft,
} from "./types";
import { ControlPanel } from "./components/ControlPanel";
import { TriggerBuilder } from "./components/TriggerBuilder";
import { DataPage } from "./components/DataPage";
import { Review } from "./components/Review";
import { Field } from "./components/Field";
import { Recovery } from "./components/Recovery";
import { Audit } from "./components/Audit";
import { SitePicker } from "./components/SitePicker";

const pages = [
  { id: "control", label: "Overview", icon: LayoutGrid },
  { id: "builder", label: "Tasks", icon: Workflow },
  { id: "data", label: "Data", icon: Database },
  { id: "review", label: "Review", icon: ClipboardCheck },
  { id: "field", label: "Field", icon: MapPin },
  { id: "recovery", label: "Access", icon: ShieldCheck },
  { id: "audit", label: "Activity", icon: Activity },
] as const;
const POLL_MS = 4000;
const ROLE_KEY = "workkite-role";
const EMAIL_KEY = "workkite-email";

function readSavedRole(): "admin" | "worker" | null {
  const saved = localStorage.getItem(ROLE_KEY) ?? sessionStorage.getItem(ROLE_KEY);
  if (saved === "admin" || saved === "worker") {
    if (!localStorage.getItem(ROLE_KEY)) localStorage.setItem(ROLE_KEY, saved);
    if (!localStorage.getItem(EMAIL_KEY)) {
      const email = sessionStorage.getItem(EMAIL_KEY);
      if (email) localStorage.setItem(EMAIL_KEY, email);
    }
  }
  sessionStorage.removeItem(ROLE_KEY);
  sessionStorage.removeItem(EMAIL_KEY);
  return saved === "admin" || saved === "worker" ? saved : null;
}

export type BuilderTarget = { triggerId?: string; draft?: TriggerDraft };

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [role, setRole] = useState<"admin" | "worker">(
    () => readSavedRole() ?? "admin",
  );
  const [session, setSession] = useState(
    () => localStorage.getItem(ROLE_KEY) !== null,
  );
  const [accountEmail, setAccountEmail] = useState(
    () => localStorage.getItem(EMAIL_KEY) ?? "",
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [page, setPage] = useState<Page>(() =>
    localStorage.getItem(ROLE_KEY) === "worker" ? "field" : "control",
  );
  const [siteFilter, setSiteFilter] = useState("all");
  const [builder, setBuilder] = useState<BuilderTarget & { nonce: number }>({
    nonce: 0,
  });
  const [reports, setReports] = useState<LocalReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(navigator.onLine);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [now, setNow] = useState(Date.now());
  const commandLock = useRef(false);
  const refreshing = useRef(false);
  const stamp = useRef(0);
  const offline = !connected;
  const notify = useCallback((message: string) => setNotification(message), []);
  useEffect(() => {
    const syncAcrossTabs = () => {
      const savedRole = localStorage.getItem(ROLE_KEY);
      const validRole = savedRole === "admin" || savedRole === "worker";
      setRole(validRole ? savedRole : "admin");
      setSession(validRole);
      setAccountEmail(validRole ? localStorage.getItem(EMAIL_KEY) ?? "" : "");
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, []);
  useEffect(() => {
    const expected = !session
      ? "/login"
      : role === "worker"
        ? "/worker"
        : "/admin";
    if (window.location.pathname !== expected)
      window.history.replaceState({}, "", expected);
    if (session) setPage(role === "worker" ? "field" : "control");
  }, [role, session]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const started = stamp.current;
    try {
      const next = await getState();
      // A command that finished while this poll was in flight has fresher state.
      if (stamp.current !== started) return;
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
    } finally {
      refreshing.current = false;
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
  useEffect(() => {
    // The agent works in the background; the panel follows it without a button.
    if (offline || loading) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !commandLock.current)
        void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [offline, loading, refresh]);
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
  async function command(
    path: string,
    payload: object = {},
    method: Method = "POST",
  ) {
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
      const result = await sendCommand(path, payload, method);
      stamp.current += 1;
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
  async function saveReport(
    report: FieldReport,
    context: Pick<LocalReport, "subject_label" | "question" | "field_labels">,
  ) {
    try {
      await enqueue(report, context);
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
  async function signIn() {
    setLoginError("");
    try {
      const account = await request<{
        email: string;
        role: "admin" | "worker";
      }>("/auth/login", { email: loginEmail, password: loginPassword });
      const next = account.role;
      localStorage.setItem(ROLE_KEY, next);
      localStorage.setItem(EMAIL_KEY, account.email);
      setRole(next);
      setSession(true);
      setAccountEmail(account.email);
      setPage(next === "worker" ? "field" : "control");
      window.history.replaceState(
        {},
        "",
        next === "worker" ? "/worker" : "/admin",
      );
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Sign-in could not complete.",
      );
    }
  }
  function signOut() {
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    setLoginEmail("");
    setLoginPassword("");
    setLoginError("");
    setSession(false);
    setAccountEmail("");
    window.history.replaceState({}, "", "/login");
  }
  const workerMode = role === "worker";
  function openBuilder(target: BuilderTarget = {}) {
    setBuilder((old) => ({ ...target, nonce: old.nonce + 1 }));
    go("builder");
  }
  const pending =
    state?.actions.filter((a) => a.status === "pending").length || 0;
  const openTasks =
    state?.field_tasks.filter((t) => t.status === "open").length || 0;
  const site = state?.sites.find((s) => s.id === siteFilter);
  const SiteIcon = site ? industryIcon(site.industry) : Radio;
  if (!session) {
    return (
      <div className="login-page">
        <div className="login-brand">
          <span>Workkite</span>
        </div>
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <h1>Sign in</h1>
          <label>
            Work email
            <input
              type="email"
              autoComplete="username"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              required
            />
          </label>
          {loginError && (
            <p className="login-error" role="alert">
              {loginError}
            </p>
          )}
          <button className="button primary login-action" type="submit">
            Sign in
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className={`app ${workerMode ? "worker-app" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        className={`sidebar ${sidebar ? "sidebar-open" : ""}`}
        hidden={workerMode}
      >
        <button
          className="brand"
          onClick={() => go("control")}
          aria-label="Workkite home"
        >
          <span>Workkite</span>
        </button>
        <label className="workspace-card site-switcher">
          <span className="workspace-icon">
            <SiteIcon size={18} />
          </span>
          <span className="site-switcher-text">
            <small>{site ? site.industry : "Site"}</small>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              aria-label="Choose a site"
            >
              <option value="all">
                All sites{state ? ` (${state.sites.length})` : ""}
              </option>
              {state?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => (id === "builder" ? openBuilder() : go(id))}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "review" && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
              {id === "field" && openTasks > 0 && (
                <span className="nav-count">{openTasks}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{role === "admin" ? "AD" : "WK"}</span>
            <div>
              <strong>
                {accountEmail || "Signed-in user"}
              </strong>
              <small>
                {role === "admin" ? "Administrator" : "Field worker"}
              </small>
            </div>
            <span className="profile-dot" />
            <button
              className="icon-button"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
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
        <header className={`topbar ${workerMode ? "worker-topbar" : ""}`}>
          {workerMode ? (
            <>
              <div className="worker-topbar-brand">
                <strong>Tasks</strong>
              </div>
              <div className="worker-site-select">
                <span>Site</span>
                <SitePicker
                  sites={state?.sites ?? []}
                  value={siteFilter}
                  onChange={setSiteFilter}
                />
              </div>
              <div className="topbar-right">
                <span className="connection">
                  {offline ? (
                    <WifiOff size={14} />
                  ) : (
                    <span className="status-dot" />
                  )}
                  {offline ? "Offline" : "Online"}
                </span>
                <button
                  className="icon-button"
                  onClick={signOut}
                  aria-label="Sign out"
                >
                  <LogOut size={17} />
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="icon-button mobile-menu"
                onClick={() => setSidebar(!sidebar)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>
              <div className="breadcrumbs">
                <strong>{site ? site.name : "All sites"}</strong>
              </div>
              <div className="topbar-right">
                <span className="connection">
                  {offline ? (
                    <WifiOff size={14} />
                  ) : (
                    <span className="status-dot" />
                  )}
                  {connected ? "Online" : "Offline"}
                </span>
                <button
                  className="icon-button"
                  onClick={signOut}
                  aria-label="Sign out"
                >
                  <LogOut size={17} />
                </button>
              </div>
            </>
          )}
        </header>
        {(offline || error) && state && (
          <div className="offline-banner">
            <WifiOff size={16} />
            <span>
              Showing the last available snapshot. Saved field reports are
              retained.
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
              <h2>Connecting to your workspace…</h2>
            </div>
          ) : !state ? (
            <div className="panel empty">
              <Radio size={35} />
              <h1>Workspace unavailable.</h1>
              <p>{error || "The operations API is not running."}</p>
              <button className="button primary" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {workerMode ? (
                <Field
                  state={state}
                  siteFilter={siteFilter}
                  reports={reports}
                  offline={offline}
                  onSave={saveReport}
                  onSync={synchronize}
                  busy={busy}
                  workerMode
                />
              ) : (
                <>
                  {page === "control" && (
                    <ControlPanel
                      state={state}
                      siteFilter={siteFilter}
                      go={go}
                      openBuilder={openBuilder}
                      command={command}
                      busy={busy || offline}
                      now={now}
                    />
                  )}
                  {page === "builder" && (
                    <TriggerBuilder
                      key={`${builder.triggerId ?? "new"}-${builder.nonce}`}
                      state={state}
                      target={builder}
                      openBuilder={openBuilder}
                      command={command}
                      busy={busy || offline}
                      go={go}
                    />
                  )}
                  {page === "data" && (
                    <DataPage
                      state={state}
                      siteFilter={siteFilter}
                      command={command}
                      busy={busy || offline}
                    />
                  )}
                  {page === "review" && (
                    <Review
                      state={state}
                      siteFilter={siteFilter}
                      go={go}
                      command={command}
                      busy={busy || offline}
                    />
                  )}
                  {page === "field" && (
                    <Field
                      state={state}
                      siteFilter={siteFilter}
                      reports={reports}
                      offline={offline}
                      onSave={saveReport}
                      onSync={synchronize}
                      busy={busy}
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
            </>
          )}
        </main>
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
