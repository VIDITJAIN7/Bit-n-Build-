"""Atomic repository boundary. Replace this adapter to use Postgres/Supabase."""

import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Callable, Iterable, Protocol

from .seed import SCHEMA_VERSION, initial_state, migrate_state


class Repository(Protocol):
    def read(self) -> dict: ...
    def mutate(
        self, change: Callable[[dict], object], blobs: Iterable[tuple] = ()
    ) -> tuple[dict, object]: ...
    def blob(self, blob_id: str) -> str | None: ...
    def clear_blobs(self) -> None: ...


class SQLiteRepository:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)"
            )
            # Evidence media lives outside the state document so polling stays small.
            db.execute(
                "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, "
                "kind TEXT NOT NULL, data_url TEXT NOT NULL)"
            )
            row = db.execute("SELECT payload FROM state WHERE id=1").fetchone()
            if row is None:
                db.execute(
                    "INSERT OR REPLACE INTO state VALUES (1, ?)", (json.dumps(initial_state()),)
                )
            else:
                state = json.loads(row[0])
                required_sections = {
                    "schema_version",
                    "workspace",
                    "sites",
                    "assets",
                    "inventory",
                    "suppliers",
                    "triggers",
                    "policy",
                    "wallet",
                    "agent",
                    "actions",
                    "field_tasks",
                    "reports",
                    "audit",
                    "counters",
                    "stats",
                    "supervision",
                    "drills",
                    "weather",
                    "recovery",
                }
                if not required_sections.issubset(state):
                    state = initial_state()
                    db.execute("UPDATE state SET payload=? WHERE id=1", (json.dumps(state),))
                elif state.get("schema_version", 0) < SCHEMA_VERSION:
                    state = migrate_state(state)
                    db.execute("UPDATE state SET payload=? WHERE id=1", (json.dumps(state),))

    @contextmanager
    def transaction(self):
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            with db:
                yield db

    def read(self):
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            return json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])

    def mutate(self, change, blobs=()):
        # Serialize decisions, budget updates, receipts, media, and audit in one transaction.
        # Exceptions roll back the entire transition.
        with self.transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            state = json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])
            result = change(state)
            db.execute("UPDATE state SET payload=? WHERE id=1", (json.dumps(state),))
            db.executemany("INSERT OR IGNORE INTO media VALUES (?, ?, ?, ?)", list(blobs))
            return state, result

    def blob(self, blob_id):
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            row = db.execute("SELECT data_url FROM media WHERE id=?", (blob_id,)).fetchone()
            return row[0] if row else None

    def clear_blobs(self):
        with self.transaction() as db:
            db.execute("DELETE FROM media")
