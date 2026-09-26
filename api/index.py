"""Vercel FastAPI entry point for all /api/* routes."""

from urllib.parse import parse_qsl, urlencode
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from averlock.main import app as fastapi_app  # noqa: E402


class VercelApiRouter:
    """Restore the original API path after Vercel rewrites it to this function."""

    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            query_items = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
            requested_path = next(
                (value for key, value in query_items if key == "__workkite_path"),
                None,
            )
            if requested_path is not None:
                path = requested_path.lstrip("/")
                scope = dict(scope)
                scope["path"] = f"/api/{path}" if path else "/api"
                scope["raw_path"] = scope["path"].encode()
                scope["query_string"] = urlencode(
                    [(key, value) for key, value in query_items if key != "__workkite_path"]
                ).encode()
        await self.application(scope, receive, send)


app = VercelApiRouter(fastapi_app)
