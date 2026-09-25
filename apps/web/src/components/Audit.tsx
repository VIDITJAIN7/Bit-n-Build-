import { useState } from "react";
import { Download, Search, CheckCircle2 } from "lucide-react";
import type { State } from "../types";
import { time } from "../api";

export function Audit({ state }: { state: State }) {
  const [query, setQuery] = useState("");
  const rows = [...state.audit]
    .reverse()
    .filter((event) =>
      `${event.message} ${event.event} ${event.actor}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              exported_at: new Date().toISOString(),
              mode: "local-demo",
              events: state.audit,
              receipts: state.wallet.receipts,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "averlock-audit.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span />
            TRACE EVERY DECISION
          </p>
          <h1>A record you can follow.</h1>
          <p className="subtitle">
            Proposals, evidence, approvals, and execution in one local audit
            trail.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={download}
          disabled={!state.audit.length}
        >
          <Download size={16} />
          Export JSON
        </button>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Activity log <span className="count">{state.audit.length}</span>
          </h2>
          <label className="search">
            <Search size={16} />
            <input
              placeholder="Search activity…"
              aria-label="Search activity"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="audit-list">
          {rows.length ? (
            rows.map((event) => (
              <article className="audit-row" key={event.id}>
                <span className="audit-symbol">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <span className="event-name">{event.event}</span>
                  <h3>{event.message}</h3>
                  <p>
                    {event.actor.replaceAll("-", " ")}
                    {event.action_id ? ` · ${event.action_id}` : ""}
                  </p>
                </div>
                <time title={new Date(event.at).toLocaleString()}>
                  {time(event.at)}
                </time>
              </article>
            ))
          ) : (
            <div className="empty">
              <Search size={30} />
              <h2>
                {query
                  ? "No matching activity."
                  : "The story starts with an action."}
              </h2>
              <p>
                {query
                  ? "Try another search term."
                  : "Run the demo scenario to create your first audit events."}
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="footnote">
        This is a local SQLite audit log, not an immutable or externally
        attested ledger.
      </p>
    </>
  );
}
