import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import {
  CARD_CRUNCH_STL_BASE_URL,
  normalizeSTLPlatformBaseUrl,
  validateSTLPlatformConfig
} from "../src/stlPlatformConfig.js";

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

await mkdir(resolve(output, "src/vendor"), { recursive: true });
await build({
  entryPoints: [resolve(root, "scripts/capacitor-secure-storage-entry.mjs")],
  bundle: true,
  format: "esm",
  legalComments: "none",
  minify: true,
  outfile: resolve(output, "src/vendor/capacitor-secure-storage.js"),
  platform: "browser",
  target: "es2022"
});

const platformConfig = Object.freeze({
  baseUrl: normalizeSTLPlatformBaseUrl(process.env.VITE_STL_PLATFORM_URL || CARD_CRUNCH_STL_BASE_URL),
  clientId: String(process.env.VITE_STL_CLIENT_ID || "card-crunch-mobile").trim(),
  gameId: String(process.env.VITE_STL_GAME_ID || "c32010e4-b054-4b59-a636-aa2c5a991d64").trim(),
  developmentRedirectUri: String(process.env.VITE_STL_REDIRECT_URI_DEV || "cardcrunch-dev://auth/callback").trim(),
  productionRedirectUri: String(process.env.VITE_STL_REDIRECT_URI_PROD || "cardcrunch://auth/callback").trim()
});
validateSTLPlatformConfig(platformConfig, { hostname: "card-crunch.vercel.app" });
await writeFile(
  resolve(output, "platform-config.js"),
  `globalThis.__CARD_CRUNCH_STL_CONFIG__ = Object.freeze(${JSON.stringify(platformConfig)});\n`,
  "utf8"
);

console.log(`Built Card Crunch web assets in ${output}`);
