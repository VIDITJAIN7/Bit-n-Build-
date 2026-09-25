import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
export function compile() {
  const sources = Object.fromEntries(
    ["OperatingWallet.sol", "MockUSDC.sol"].map((name) => [
      name,
      { content: fs.readFileSync(path.join(root, "src", name), "utf8") },
    ]),
  );
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        try {
          return { contents: fs.readFileSync(require.resolve(name), "utf8") };
        } catch {
          return { error: `Import not found: ${name}` };
        }
      },
    }),
  );
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return Object.fromEntries(
    ["OperatingWallet", "MockUSDC"].map((name) => [
      name,
      output.contracts[`${name}.sol`][name],
    ]),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const artifacts = compile();
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  for (const [name, artifact] of Object.entries(artifacts))
    fs.writeFileSync(
      path.join(root, "artifacts", `${name}.json`),
      JSON.stringify(artifact, null, 2),
    );
  console.log(
    "Compiled OperatingWallet and MockUSDC using local solc; no RPC required.",
  );
}
