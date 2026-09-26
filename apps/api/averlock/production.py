"""Production-only Supabase identity and Postgres persistence adapters."""

from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Callable, Iterable

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .seed import initial_state, now_iso

_workspace_id: ContextVar[str | None] = ContextVar("workkite_workspace_id", default=None)


@contextmanager
def bind_workspace(workspace_id: str):
    token = _workspace_id.set(workspace_id)
    try:
        yield
    finally:
        _workspace_id.reset(token)


def blank_workspace_state() -> dict:
    """Create a usable empty workspace without local/sample operational data."""
    state = initial_state()
    state["workspace"] = {"name": "Workkite workspace"}
    for section in (
        "sites",
        "assets",
        "inventory",
        "suppliers",
        "triggers",
        "actions",
        "field_tasks",
        "reports",
        "audit",
    ):
        state[section] = []
    state["wallet"] = {
        "mode": "unconfigured",
        "balance_cents": 0,
        "agent_spent_cents": 0,
        "agent_spend_day": now_iso()[:10],
        "owner": "unassigned",
        "receipts": [],
    }
    state["agent"].update({"enabled": False, "live_feed": False})
    state["weather"] = {
        "source": "unconfigured",
        "scenario": "unavailable",
        "heat_index_c": None,
        "high_heat": False,
    }
    state["drills"] = {"enabled": False, "rate": 0, "stats": {}}
    state["supervision"].update({"last_owner_action": now_iso(), "backup": None})
    state["recovery"].update(
        {"stage": "idle", "candidate": None, "approvals": [], "guardians": [], "unlock_at": None}
    )
    state["stats"] = {
        "auto_handled": 0,
        "human_executed": 0,
        "rejected": 0,
        "blocked": 0,
        "alerts": 0,
        "field_dispatched": 0,
    }
    return state


class PostgresRepository:
    """Same atomic repository contract as SQLite, scoped by verified workspace."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    def _workspace(self) -> str:
        workspace_id = _workspace_id.get()
        if not workspace_id:
            raise RuntimeError("A verified workspace is required for database access")
        return workspace_id

    def workspace_ids(self) -> list[str]:
        with self._connection() as connection:
            rows = connection.execute(
                "select id from public.workspaces order by created_at"
            ).fetchall()
            return [str(row["id"]) for row in rows]

    @contextmanager
    def _connection(self):
        with psycopg.connect(
            self.connection_string,
            row_factory=dict_row,
            prepare_threshold=None,
        ) as connection:
            yield connection

    def _ensure_state(self, connection, workspace_id: str):
        connection.execute(
            """insert into public.workspace_state(workspace_id, payload)
               values (%s, %s) on conflict (workspace_id) do nothing""",
            (workspace_id, Jsonb(blank_workspace_state())),
        )

    def read(self):
        workspace_id = self._workspace()
        with self._connection() as connection:
            self._ensure_state(connection, workspace_id)
            row = connection.execute(
                "select payload from public.workspace_state where workspace_id = %s",
                (workspace_id,),
            ).fetchone()
            return row["payload"]

    def mutate(self, change: Callable[[dict], object], blobs: Iterable[tuple] = ()):
        workspace_id = self._workspace()
        with self._connection() as connection:
            self._ensure_state(connection, workspace_id)
            row = connection.execute(
                "select payload from public.workspace_state where workspace_id = %s for update",
                (workspace_id,),
            ).fetchone()
            state = row["payload"]
            result = change(state)
            connection.execute(
                """update public.workspace_state set payload = %s, version = version + 1,
                   updated_at = now() where workspace_id = %s""",
                (Jsonb(state), workspace_id),
            )
            connection.executemany(
                """insert into public.workspace_media(id, workspace_id, report_id, kind, data_url)
                   values (%s, %s, %s, %s, %s) on conflict (id) do nothing""",
                [(blob[0], workspace_id, blob[1], blob[2], blob[3]) for blob in blobs],
            )
            return state, result

    def blob(self, blob_id: str):
        with self._connection() as connection:
            row = connection.execute(
                "select data_url from public.workspace_media where workspace_id = %s and id = %s",
                (self._workspace(), blob_id),
            ).fetchone()
            return row["data_url"] if row else None

    def clear_blobs(self):
        with self._connection() as connection:
            connection.execute(
                "delete from public.workspace_media where workspace_id = %s",
                (self._workspace(),),
            )


async def verify_supabase_request(request):
    """Validate the token with Auth and resolve membership under the user's JWT."""
    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    publishable_key = os.environ["SUPABASE_PUBLISHABLE_KEY"]
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        return None
    headers = {"apikey": publishable_key, "Authorization": authorization}
    async with httpx.AsyncClient(timeout=8.0) as client:
        user_response = await client.get(f"{base_url}/auth/v1/user", headers=headers)
        if user_response.status_code != 200:
            return None
        user = user_response.json()
        user_id = user.get("id")
        if not user_id:
            return None
        member_response = await client.get(
            f"{base_url}/rest/v1/workspace_members",
            params={"select": "workspace_id,role,display_name", "user_id": f"eq.{user_id}"},
            headers=headers,
        )
        if member_response.status_code != 200:
            return None
        memberships = member_response.json()
    if len(memberships) != 1:
        return None
    membership = memberships[0]
    return {
        "id": user_id,
        "email": user.get("email", ""),
        "workspace_id": membership["workspace_id"],
        "role": membership["role"],
        "display_name": membership.get("display_name", ""),
    }
