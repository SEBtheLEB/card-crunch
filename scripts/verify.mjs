import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  "src/main.js",
  "src/audio.js",
  "src/haptics.js",
  "src/input.js",
  "src/playGames.js",
  "src/fullscreen.js",
  "styles/main.css",
  "capacitor.config.json"
];

await Promise.all(required.map((file) => access(resolve(root, file))));

const scoringModule = await import(`../src/scoring.js?verify=${Date.now()}`);
const results = scoringModule.runScoringSelfTests();
if (!Array.isArray(results) || results.some((result) => result.pass === false)) {
  throw new Error("Scoring self-tests failed");
}

const { formatCompactNumber } = await import(`../src/format.js?verify=${Date.now()}`);
const compactCases = [
  [100_000, "100K"],
  [100_000_000, "100M"],
  [2_500_000_000, "2.5B"]
];
if (compactCases.some(([value, expected]) => formatCompactNumber(value) !== expected)) {
  throw new Error("Compact number formatting failed");
}

const html = await readFile(resolve(root, "index.html"), "utf8");
if (!html.includes("pixel-screen-filter") || !html.includes("playLeaderboardButton")) {
  throw new Error("Release UI hooks are missing");
}
if ((html.match(/data-fullscreen-toggle/g) ?? []).length !== 2) {
  throw new Error("Menu and gameplay fullscreen controls are missing");
}

const [cutsceneSource, css] = await Promise.all([
  readFile(resolve(root, "src/crunchCutscene.js"), "utf8"),
  readFile(resolve(root, "styles/main.css"), "utf8")
]);
if (!cutsceneSource.includes("feedCutinCardsToBank") || !cutsceneSource.includes("createPixelShardClip") || !css.includes("cutin-card-shard")) {
  throw new Error("Crunch Bank card-shard animation hooks are missing");
}

if (!css.includes("--pixel-card-silhouette") || !css.includes("visibility: hidden")) {
  throw new Error("Pixel silhouettes or consumed-card hiding are missing");
}

const fullscreenSource = await readFile(resolve(root, "src/fullscreen.js"), "utf8");
if (!fullscreenSource.includes("requestFullscreen") || !fullscreenSource.includes("exitFullscreen")) {
  throw new Error("Fullscreen API hooks are missing");
}

console.log(`Verified ${results.length} scoring cases, compact values, fullscreen controls, release UI hooks, and card-shard VFX.`);
