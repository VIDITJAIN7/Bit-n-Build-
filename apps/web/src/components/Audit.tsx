import { useState } from "react";
import { Download, Search, CheckCircle2, Receipt } from "lucide-react";
import type { State } from "../types";
import { money, time } from "../api";

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
              mode: state.wallet.mode,
              events: state.audit,
              receipts: state.wallet.receipts,
              chain_transactions: state.chain.transactions ?? [],
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
    link.download = "workkite-activity.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Activity</h1>
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
      {state.wallet.receipts.length > 0 && (
        <section className="panel payments-panel">
          <div className="panel-heading">
            <h2>
              Payments <span className="count">{state.wallet.receipts.length}</span>
            </h2>
          </div>
          <div className="audit-list">
            {[...state.wallet.receipts]
              .reverse()
              .slice(0, 8)
              .map((receipt) => (
                <article className="audit-row" key={receipt.id}>
                  <span className="audit-symbol">
                    <Receipt size={17} />
                  </span>
                  <div>
                    <span className="event-name">
                      {receipt.tx ? `local chain · block ${receipt.block}` : receipt.mode}
                    </span>
                    <h3>
                      {money(receipt.amount_cents)} to {receipt.recipient}
                    </h3>
                    <p>
                      {receipt.signer ? `${receipt.signer.replaceAll("-", " ")} · ` : ""}
                      {receipt.action_id}
                      {receipt.tx && (
                        <>
                          {" · "}
                          <code title={receipt.tx}>
                            {receipt.tx.slice(0, 12)}…{receipt.tx.slice(-6)}
                          </code>
                        </>
                      )}
                    </p>
                  </div>
                  <time title={new Date(receipt.at).toLocaleString()}>
                    {time(receipt.at)}
                  </time>
                </article>
              ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Activity <span className="count">{state.audit.length}</span>
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
                  : "No activity yet."}
              </h2>
              {query && <p>Try another search term.</p>}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
