import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const assets = fs
  .readdirSync(path.join(dist, "assets"))
  .map((name) => `/assets/${name}`);
const precache = [
  "/",
  "/index.html",
  "/icon.svg",
  "/manifest.webmanifest",
  ...assets,
];
const hash = createHash("sha256")
  .update(assets.join(","))
  .digest("hex")
  .slice(0, 12);
const worker = fs
  .readFileSync(path.join(dist, "sw.js"), "utf8")
  .replace("'averlock-web-v1'", JSON.stringify(`averlock-web-${hash}`))
  .replace(
    "['/', '/icon.svg', '/manifest.webmanifest']",
    JSON.stringify(precache),
  );
fs.writeFileSync(path.join(dist, "sw.js"), worker);
console.log(`Prepared ${precache.length} offline assets for ${hash}.`);
