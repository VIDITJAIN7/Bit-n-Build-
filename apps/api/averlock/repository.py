"""Atomic repository boundary. Replace this adapter to use Postgres/Supabase."""

import json
import sqlite3
from pathlib import Path
from typing import Callable, Protocol

from .seed import initial_state


class Repository(Protocol):
    def read(self) -> dict: ...
    def mutate(self, change: Callable[[dict], object]) -> tuple[dict, object]: ...


class SQLiteRepository:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)"
            )
            db.execute("INSERT OR IGNORE INTO state VALUES (1, ?)", (json.dumps(initial_state()),))

    def connect(self):
        return sqlite3.connect(self.path, timeout=15)

    def read(self):
        with self.connect() as db:
            return json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])

    def mutate(self, change):
        # Serialize decisions, budget updates, receipts, and audit in one transaction.
        # Exceptions roll back the entire transition.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])
            result = change(state)
            db.execute("UPDATE state SET payload=? WHERE id=1", (json.dumps(state),))
            return state, result
