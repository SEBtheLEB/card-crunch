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

const platformConfig = Object.freeze({
  baseUrl: String(process.env.VITE_STL_PLATFORM_URL || "").trim(),
  clientId: String(process.env.VITE_STL_CLIENT_ID || "card-crunch-mobile").trim(),
  gameId: String(process.env.VITE_STL_GAME_ID || "c32010e4-b054-4b59-a636-aa2c5a991d64").trim(),
  developmentRedirectUri: String(process.env.VITE_STL_REDIRECT_URI_DEV || "cardcrunch-dev://auth/callback").trim(),
  productionRedirectUri: String(process.env.VITE_STL_REDIRECT_URI_PROD || "cardcrunch://auth/callback").trim()
});
await writeFile(
  resolve(output, "platform-config.js"),
  `globalThis.__CARD_CRUNCH_STL_CONFIG__ = Object.freeze(${JSON.stringify(platformConfig)});\n`,
  "utf8"
);

if (!platformConfig.baseUrl || !platformConfig.clientId || !platformConfig.gameId) {
  console.warn("Card Crunch STL Platform build is missing one or more VITE_STL_PLATFORM_URL, VITE_STL_CLIENT_ID, or VITE_STL_GAME_ID values.");
}

console.log(`Built Card Crunch web assets in ${output}`);
