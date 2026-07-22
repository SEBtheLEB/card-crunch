import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const entries = ["index.html", "privacy-policy.html", "manifest.json", "service-worker.js", "assets", "src", "styles"];

for (const envFile of [resolve(root, ".env.local"), resolve(root, ".env")]) {
  try { process.loadEnvFile(envFile); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

const authConfig = Object.freeze({
  supabaseUrl: String(process.env.VITE_SUPABASE_URL || "").trim(),
  supabaseAnonKey: String(process.env.VITE_SUPABASE_ANON_KEY || "").trim(),
  appUrl: String(process.env.VITE_APP_URL || "").trim()
});
const vendorDirectory = resolve(output, "assets", "vendor");
await mkdir(vendorDirectory, { recursive: true });
await cp(
  resolve(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js"),
  resolve(vendorDirectory, "supabase.js")
);
await writeFile(
  resolve(output, "auth-config.js"),
  `globalThis.__CARD_CRUNCH_AUTH_CONFIG__ = Object.freeze(${JSON.stringify(authConfig)});\n`,
  "utf8"
);

if (!authConfig.supabaseUrl || !authConfig.supabaseAnonKey || !authConfig.appUrl) {
  console.warn("Card Crunch auth build is missing one or more VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or VITE_APP_URL values.");
}

console.log(`Built Card Crunch web assets in ${output}`);
