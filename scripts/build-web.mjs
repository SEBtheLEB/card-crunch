import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const entries = ["index.html", "privacy-policy.html", "manifest.json", "service-worker.js", "assets", "src", "styles"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

console.log(`Built Card Crunch web assets in ${output}`);
