import asyncio
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from api.index import VercelApiRouter


def test_vercel_rewrite_restores_nested_api_path_and_keeps_query_parameters():
    received = {}

    async def capture(scope, receive, send):
        received.update(scope)

    scope = {
        "type": "http",
        "path": "/api/index",
        "raw_path": b"/api/index",
        "query_string": urlencode(
            {
                "__workkite_path": "actions/action-123/decision",
                "view": "compact",
            }
        ).encode(),
    }

    asyncio.run(VercelApiRouter(capture)(scope, None, None))

    assert received["path"] == "/api/actions/action-123/decision"
    assert received["raw_path"] == b"/api/actions/action-123/decision"
    assert received["query_string"] == b"view=compact"


def test_vercel_adapter_passes_lifespan_scopes_unchanged():
    received = {}

    async def capture(scope, receive, send):
        received.update(scope)

    scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
    asyncio.run(VercelApiRouter(capture)(scope, None, None))

    assert received == scope
