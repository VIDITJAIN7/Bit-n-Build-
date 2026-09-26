import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
// --chain runs payments, owner decisions and recovery on a local Hardhat devnet.
const withChain = process.argv.includes("--chain");
const CHAIN_RPC = "http://127.0.0.1:8545";
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    const value = match[2].replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
    process.env[match[1]] = value;
  }
}
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(python)) {
  console.error("Run npm run setup first.");
  process.exit(1);
}

async function chainReady() {
  try {
    const response = await fetch(CHAIN_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let chain = null;
if (withChain) {
  const compiled = spawnSync(
    process.execPath,
    [path.join(root, "contracts/compile.mjs")],
    { cwd: path.join(root, "contracts"), stdio: "inherit" },
  );
  if (compiled.status !== 0) process.exit(compiled.status || 1);
  if (await chainReady()) {
    console.log(`Using the local chain already running at ${CHAIN_RPC}.`);
  } else {
    // Development accounts are unlocked on this node: a demo network, never real funds.
    chain = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/hardhat/dist/src/cli.js"),
        "node",
        "--port",
        "8545",
      ],
      { cwd: path.join(root, "contracts"), stdio: ["ignore", "ignore", "inherit"] },
    );
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      await sleep(500);
      ready = await chainReady();
    }
    if (!ready) {
      console.error(`The local chain did not start at ${CHAIN_RPC}.`);
      chain.kill();
      process.exit(1);
    }
    console.log(`Local Hardhat devnet running at ${CHAIN_RPC}.`);
  }
  process.env.WORKKITE_WALLET = "local-chain";
  process.env.WORKKITE_CHAIN_RPC ??= CHAIN_RPC;
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
  chain?.kill();
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
chain?.on("exit", (code) => {
  if (!closing) stop(code || 0);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
