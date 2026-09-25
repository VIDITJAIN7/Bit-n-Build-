import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.exists():
    raise SystemExit("Run python scripts/setup.py first")
sys.exit(subprocess.call([str(python), "-m", "pytest", "tests", "-q"], cwd=root / "apps/api"))
