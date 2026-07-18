import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  "src/main.js",
  "src/audio.js",
  "src/haptics.js",
  "src/input.js",
  "src/cardGestures.js",
  "src/playGames.js",
  "src/fullscreen.js",
  "src/themes.js",
  "src/cardSkins.js",
  "src/tutorial.js",
  "src/economy.js",
  "src/purchases.js",
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
if (!html.includes("summaryCoins") || !html.includes("energyGateScreen") || !html.includes("buyEnergyButton")) {
  throw new Error("Economy UI hooks are missing");
}
if ((html.match(/data-theme-id=/g) ?? []).length !== 3 || !html.includes("gold-table") || !html.includes("knight-deck")) {
  throw new Error("Selectable theme controls are missing");
}
if ((html.match(/data-card-skin-id=/g) ?? []).length !== 5 || !html.includes("skin-preview-rainbow")) {
  throw new Error("Selectable card skin controls are missing");
}
if (!html.includes("run-scoreboard") || !html.includes("summaryRecoveryTicker")) {
  throw new Error("Arcade run summary structure is missing");
}
if (!html.includes("tutorialStartButton") || !html.includes("tutorialCoach") || !html.includes("bottom-status")) {
  throw new Error("Live-board tutorial hooks are missing");
}
if (html.includes('id="tutorialPage"')) {
  throw new Error("Tutorial must use the real game board, not a separate practice layout");
}

const economyModule = await import(`../src/economy.js?verify=${Date.now()}`);
const lowReward = economyModule.calculateRunCoinReward({ grossCash: 100_000, bestStreak: 2 });
const highReward = economyModule.calculateRunCoinReward({ grossCash: 1_000_000, bestStreak: 8, potCleared: true });
if (lowReward.total <= 0 || highReward.total <= lowReward.total) {
  throw new Error("Run coin rewards do not scale with performance");
}
const regen = economyModule.calculateRegeneratedEnergy({
  energy: 10,
  updatedAt: 1_000,
  now: 1_000 + economyModule.ECONOMY_CONFIG.energyRegenMs * 2
});
if (regen.energy !== 12 || economyModule.ECONOMY_CONFIG.energyPerRun !== 5 || economyModule.ECONOMY_CONFIG.energyMax !== 30) {
  throw new Error("Energy regeneration or run cost is incorrect");
}

const [cutsceneSource, animationsSource, themeSource, cardSkinSource, cardGestureSource, gameStateSource, uiSource, css] = await Promise.all([
  readFile(resolve(root, "src/crunchCutscene.js"), "utf8"),
  readFile(resolve(root, "src/animations.js"), "utf8"),
  readFile(resolve(root, "src/themes.js"), "utf8"),
  readFile(resolve(root, "src/cardSkins.js"), "utf8"),
  readFile(resolve(root, "src/cardGestures.js"), "utf8"),
  readFile(resolve(root, "src/gameState.js"), "utf8"),
  readFile(resolve(root, "src/ui.js"), "utf8"),
  readFile(resolve(root, "styles/main.css"), "utf8")
]);
const mainSource = await readFile(resolve(root, "src/main.js"), "utf8");
const tutorialSource = await readFile(resolve(root, "src/tutorial.js"), "utf8");
const audioSource = await readFile(resolve(root, "src/audio.js"), "utf8");
if (!cutsceneSource.includes("feedCutinCardsToBank") || !cutsceneSource.includes("createPixelShardClip") || !css.includes("cutin-card-shard")) {
  throw new Error("Crunch Bank card-shard animation hooks are missing");
}
if (!cutsceneSource.includes("createShardImpactSchedule") || !cutsceneSource.includes("schedulePreparedShardImpacts") || !cutsceneSource.includes("rowReleaseDelays") || !css.includes("cutinCardShardVacuum")) {
  throw new Error("Crunch Bank vacuum sequencing or shard contact hooks are missing");
}
if (!cutsceneSource.includes("is-consumed-after-shatter") || !css.includes(".cutin-live-card.is-consumed-after-shatter")) {
  throw new Error("Consumed cut-in cards can reappear after the vacuum finishes");
}
if (!cutsceneSource.includes("showPreparedCardAssembly") || !cutsceneSource.includes("is-precut-piece") || !css.includes("precutCardHitThree")) {
  throw new Error("Preassembled shard damage states are missing");
}
if (!cutsceneSource.includes("createPrecutSeamOverlay") || !cutsceneSource.includes("createCardFractureMap") || !css.includes("precutFractureNodeGrow") || !css.includes("precutCrackConnect")) {
  throw new Error("Classic connected Crunch fractures are missing");
}
if (!cutsceneSource.includes("ensureCrunchDebrisEmitter") || !cutsceneSource.includes("drawPixelCrumb") || !css.includes("cutin-crunch-debris-canvas")) {
  throw new Error("Canvas-rendered Crunch crumbs are missing");
}
if (!cutsceneSource.includes("getShardGrid") || !cutsceneSource.includes("const shardTemplate = card.cloneNode(true)")) {
  throw new Error("Adaptive multi-card shard preparation is missing");
}
const shardContactSource = cutsceneSource.slice(
  cutsceneSource.indexOf("function createShardImpactSchedule"),
  cutsceneSource.indexOf("function createPixelShardClip")
);
if (shardContactSource.includes("getBoundingClientRect")) {
  throw new Error("Shard bank impacts must not force layout reads");
}
if (shardContactSource.includes("animationend")) {
  throw new Error("Shard bank audio must not depend on unreliable animationend events");
}
if (!cutsceneSource.includes("transitionSourceCardsIntoCutin") || !cutsceneSource.includes("data-cutin-card-id") || !css.includes("cutin-shared-card-flight")) {
  throw new Error("Shared card-to-cutin transitions are missing");
}
const selectionResolveSource = animationsSource.slice(
  animationsSource.indexOf("export async function animateSelectionResolve"),
  animationsSource.indexOf("function applyResolveSpotlight")
);
if (!selectionResolveSource.includes("RESOLVE_HANDOFF_DELAY") || selectionResolveSource.includes("popStoredLabel")) {
  throw new Error("Crunch highlights must hand directly into the cut-in without a transient label");
}
if (!cutsceneSource.includes("is-shared-handoff") || !css.includes("cutsceneBackdropIn")) {
  throw new Error("Blink-free shared-card cut-in backdrop is missing");
}
if (!cutsceneSource.includes("playInteractiveCardCrunch") || !cutsceneSource.includes("prepareCutinCardShards") || !cutsceneSource.includes("--shard-burst-x") || !css.includes("cutin-fracture-map") || !css.includes("--shard-rest-x") || !css.includes("cutin-card-shard.is-vacuuming")) {
  throw new Error("Three-hit interactive Crunch damage sequence is missing");
}
if (!audioSource.includes("playCrunchShardImpact") || !audioSource.includes("SHARD_IMPACT_MIN_INTERVAL") || !audioSource.includes("crunch_vacuum") || !audioSource.includes("crunch_hit_3")) {
  throw new Error("Crunch Bank impact mixing or vacuum audio is missing");
}

if (!css.includes("--pixel-card-silhouette") || !css.includes("visibility: hidden")) {
  throw new Error("Pixel silhouettes or consumed-card hiding are missing");
}

if (!themeSource.includes("cardCrunchTheme") || !themeSource.includes("card-crunch-theme-change")) {
  throw new Error("Persistent theme selection hooks are missing");
}
if (!css.includes('html[data-theme="gold-table"]') || !css.includes('html[data-theme="knight-deck"]')) {
  throw new Error("Gold Table or Knight Deck styles are missing");
}
if (!cardSkinSource.includes("cardCrunchCardSkin") || !cardSkinSource.includes("spawnRainbowCardTrail")) {
  throw new Error("Persistent card skin selection or rainbow trails are missing");
}
if (!cardGestureSource.includes("bindCardGesture") || !cardGestureSource.includes("spawnCardFlightTrail") || !uiSource.includes("selectedCardTray")) {
  throw new Error("Tap/flick staging controls or card flight trails are missing");
}
if (!cutsceneSource.includes("is-bonus-screen") || !cutsceneSource.includes("fastForwarded")) {
  throw new Error("One-tap Bonus Crunch fast-forward is missing");
}
if (!mainSource.includes("activePressTargets") || mainSource.includes('classList.add("tap-pop")')) {
  throw new Error("Stable press feedback regression guards are missing");
}
if (!tutorialSource.includes("Full Crunch") || !tutorialSource.includes("Bank Your Cash") || !tutorialSource.includes("Minus Crunch")) {
  throw new Error("Tutorial lessons do not cover full-hand, banking, and arithmetic Crunches");
}
if (!gameStateSource.includes("startTutorial") || !gameStateSource.includes("advanceTutorialLesson") || !gameStateSource.includes("playCrunchEntryExplanation")) {
  throw new Error("Tutorial does not run through the live game-state and Crunch pipeline");
}
if (!cardGestureSource.includes("flightAnimations") || !uiSource.includes("card-layout-moving")) {
  throw new Error("Card transfer stability guards are missing");
}
if (!css.includes('html[data-card-skin="dark"]') || !css.includes('html[data-card-skin="pink"]') || !css.includes('html[data-card-skin="gold"]') || !css.includes('html[data-card-skin="rainbow"]')) {
  throw new Error("One or more card skin styles are missing");
}
if (!gameStateSource.includes("function startNewRound() {\n    ui.clearMessage();") || !uiSource.includes("messageGeneration")) {
  throw new Error("Round message cleanup regression guards are missing");
}
if (!uiSource.includes("animateSummaryNumber") || !css.includes("Arcade run summary")) {
  throw new Error("Arcade run summary counters or styles are missing");
}

const fullscreenSource = await readFile(resolve(root, "src/fullscreen.js"), "utf8");
if (!fullscreenSource.includes("requestFullscreen") || !fullscreenSource.includes("exitFullscreen")) {
  throw new Error("Fullscreen API hooks are missing");
}

console.log(`Verified ${results.length} scoring cases, economy rewards, energy regeneration, arcade run summary, round message cleanup, selectable themes and card skins, fullscreen controls, release UI hooks, and card-shard VFX.`);
