"""Vercel Python entry point for the existing FastAPI application."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from averlock.main import app  # noqa: E402,F401
