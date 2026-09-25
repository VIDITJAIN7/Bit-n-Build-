import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(python)) {
  console.error("Run npm run setup first.");
  process.exit(1);
}
const backend = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "averlock.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  { cwd: path.join(root, "apps/api"), stdio: "inherit" },
);
const frontend = spawn(
  process.execPath,
  [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
  { cwd: path.join(root, "apps/web"), stdio: "inherit" },
);
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  backend.kill();
  frontend.kill();
  process.exitCode = code;
}
backend.on("error", (error) => {
  console.error(error);
  stop(1);
});
frontend.on("error", (error) => {
  console.error(error);
  stop(1);
});
backend.on("exit", (code) => {
  if (!closing) stop(code || 0);
});
frontend.on("exit", (code) => {
  if (!closing) stop(code || 0);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
