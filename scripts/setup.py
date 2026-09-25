"""Create the repository-local Python environment and install pinned dependencies."""

import os
import subprocess
import venv
from pathlib import Path

root = Path(__file__).resolve().parents[1]
environment = root / ".venv"
if not environment.exists():
    venv.create(environment, with_pip=True)
python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
subprocess.run(
    [str(python), "-m", "pip", "install", "-r", str(root / "apps/api/requirements.txt")], check=True
)
print("Python backend ready. Start both services with npm run dev.")
