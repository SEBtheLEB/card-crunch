import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  "src/main.js",
  "src/audio.js",
  "src/haptics.js",
  "src/input.js",
  "src/cardGestures.js",
  "src/dealTiming.js",
  "src/playGames.js",
  "src/fullscreen.js",
  "src/themes.js",
  "src/cardSkins.js",
  "src/tutorial.js",
  "src/economy.js",
  "src/purchases.js",
  "assets/sfx/playing-card.mp3",
  "assets/sfx/deal-hand-1.mp3",
  "assets/sfx/deal-hand-2.mp3",
  "assets/sfx/deal-hand-3.mp3",
  "assets/sfx/deal-hand-4.mp3",
  "styles/main.css",
  "capacitor.config.json"
];

await Promise.all(required.map((file) => access(resolve(root, file))));
if ((await stat(resolve(root, "assets/sfx/playing-card.mp3"))).size <= 0) {
  throw new Error("Card-play sample is empty");
}
for (let index = 1; index <= 4; index += 1) {
  if ((await stat(resolve(root, `assets/sfx/deal-hand-${index}.mp3`))).size <= 0) {
    throw new Error(`Deal sample ${index} is empty`);
  }
}

const scoringModule = await import(`../src/scoring.js?verify=${Date.now()}`);
const results = scoringModule.runScoringSelfTests();
if (!Array.isArray(results) || results.some((result) => result.pass === false)) {
  throw new Error("Scoring self-tests failed");
}

const { formatCompactNumber } = await import(`../src/format.js?verify=${Date.now()}`);
const dealTimingModule = await import(`../src/dealTiming.js?verify=${Date.now()}`);
const compactCases = [
  [100_000, "100K"],
  [100_000_000, "100M"],
  [2_500_000_000, "2.5B"]
];
if (compactCases.some(([value, expected]) => formatCompactNumber(value) !== expected)) {
  throw new Error("Compact number formatting failed");
}
const firstDealStart = dealTimingModule.getDealStartDelay(0);
const secondDealStart = dealTimingModule.getDealStartDelay(1);
if (secondDealStart - firstDealStart < dealTimingModule.DEAL_TIMING.flightMs) {
  throw new Error("Sequential card deals overlap before the previous card lands");
}
if (dealTimingModule.getRoundDealDuration(2, 2) <= dealTimingModule.getRoundDealDuration(0, 2)) {
  throw new Error("Round deal duration does not include replacement hand cards");
}
if (dealTimingModule.getRoundDealDuration(4, 2) >= 2000) {
  throw new Error("A full six-card deal must finish in under two seconds");
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

const [cutsceneSource, animationsSource, themeSource, cardSkinSource, cardGestureSource, dealTimingSource, gameStateSource, uiSource, css] = await Promise.all([
  readFile(resolve(root, "src/crunchCutscene.js"), "utf8"),
  readFile(resolve(root, "src/animations.js"), "utf8"),
  readFile(resolve(root, "src/themes.js"), "utf8"),
  readFile(resolve(root, "src/cardSkins.js"), "utf8"),
  readFile(resolve(root, "src/cardGestures.js"), "utf8"),
  readFile(resolve(root, "src/dealTiming.js"), "utf8"),
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
if (!animationsSource.includes("const RESOLVE_HIGHLIGHT_DURATION_MS = 700")
  || !animationsSource.includes("await advance.wait(RESOLVE_HIGHLIGHT_DURATION_MS)")
  || animationsSource.includes("waitForTap(RESOLVE_HIGHLIGHT")) {
  throw new Error("Resolved-card highlights must auto-advance after 700ms while remaining skippable");
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
const shardFeedSource = cutsceneSource.slice(
  cutsceneSource.indexOf("async function feedCutinCardsToBank"),
  cutsceneSource.indexOf("function discardPreparedCardShards")
);
if (!shardFeedSource.includes("await sleep(prepared.totalDuration)") || shardFeedSource.includes("waitMaybe(advance")) {
  throw new Error("Card shard vacuum timing must stay independent from tap-to-advance speedups");
}
if (!cutsceneSource.includes("pendingBankEffects") || !cutsceneSource.includes("settleBankEffects") || !cutsceneSource.includes("countBankBy")) {
  throw new Error("Detached Crunch Bank effects must be tracked through the final score merge");
}
if (!cutsceneSource.includes("activeBankFeeds") || !cutsceneSource.includes("beginBankFeed") || !cutsceneSource.includes("endBankFeed")) {
  throw new Error("Overlapping card vacuums must keep the Crunch Bank feed state active");
}
if (!cutsceneSource.includes("clearPreparedDamageArtifacts") || !cutsceneSource.includes('querySelectorAll(".cutin-fracture-map")')) {
  throw new Error("Fracture overlays must be removed as soon as cards shatter");
}
const preparedAssemblySource = cutsceneSource.slice(
  cutsceneSource.indexOf("function showPreparedCardAssembly"),
  cutsceneSource.indexOf("async function feedCutinCardsToBank")
);
if (!preparedAssemblySource.includes("hit >= CUTSCENE_CONFIG.interactiveCrunchHits") || !preparedAssemblySource.includes("clearPreparedDamageArtifacts(prepared)")) {
  throw new Error("Third-hit scattering must clear fracture art before the vacuum starts");
}
if (!cutsceneSource.includes('classList.toggle("is-shattered-piece"') || !css.includes(".cutin-card-shard.is-shattered-piece::before") || !css.includes("box-shadow: none !important")) {
  throw new Error("Vacuuming shards must not inherit card frames or decorative overlays");
}
if (!cutsceneSource.includes('setProperty("--shard-origin"') || !css.includes("transform-origin: var(--shard-origin") || /cutinCardShardVacuum[\s\S]{0,500}\b18%/.test(css)) {
  throw new Error("Shard scatter and vacuum animations must share one pivot without a dead hold");
}
if (!cutsceneSource.includes("transitionSourceCardsIntoCutin") || !cutsceneSource.includes("data-cutin-card-id") || !css.includes("cutin-shared-card-flight")) {
  throw new Error("Shared card-to-cutin transitions are missing");
}
const selectionResolveSource = animationsSource.slice(
  animationsSource.indexOf("export async function animateSelectionResolve"),
  animationsSource.indexOf("function applyResolveSpotlight")
);
if (!selectionResolveSource.includes("advance.wait(RESOLVE_HIGHLIGHT_DURATION_MS)")
  || selectionResolveSource.includes("waitForTap(RESOLVE_HIGHLIGHT")
  || selectionResolveSource.includes("popStoredLabel")) {
  throw new Error("Crunch highlights must auto-advance into the cut-in without a mandatory tap");
}
if (!cutsceneSource.includes("is-shared-handoff") || !css.includes("cutsceneBackdropIn")) {
  throw new Error("Blink-free shared-card cut-in backdrop is missing");
}
const sharedHandoffSource = cutsceneSource.slice(
  cutsceneSource.indexOf("async function transitionSourceCardsIntoCutin"),
  cutsceneSource.indexOf("function orderMatchedCardsForEquation")
);
if (!sharedHandoffSource.includes("await waitForPaint()")
  || sharedHandoffSource.indexOf("await waitForPaint()") > sharedHandoffSource.indexOf('element.classList.add("cutin-shared-source-hidden")')
  || !sharedHandoffSource.includes("activateSharedHandoff(overlay)")
  || !css.includes("is-shared-handoff.is-handoff-ready::after")) {
  throw new Error("Shared cards must be painted before their live sources are hidden");
}
if (sharedHandoffSource.includes('classList.remove("cutin-shared-source-hidden")')
  || !sharedHandoffSource.includes("target.remove()")
  || !selectionResolveSource.includes('[handCard, ...matchedCards].forEach')
  || !css.includes(".cutin-shared-source-hidden {\n  opacity: 0 !important;")) {
  throw new Error("Consumed hand and table cards must stay absent behind the Crunch cutscene");
}
if (!animationsSource.includes('from "./crunchCutscene.js?v=124"') || !gameStateSource.includes('from "./crunchCutscene.js?v=124"')) {
  throw new Error("Crunch skip and handoff state must use one shared module instance");
}
if (!cutsceneSource.includes("playInteractiveCardCrunch") || !cutsceneSource.includes("prepareCutinCardShards") || !cutsceneSource.includes("--shard-burst-x") || !css.includes("cutin-fracture-map") || !css.includes("--shard-rest-x") || !css.includes("cutin-card-shard.is-vacuuming")) {
  throw new Error("Three-hit interactive Crunch damage sequence is missing");
}
if (!audioSource.includes("playCrunchShardImpact") || !audioSource.includes("SHARD_IMPACT_MIN_INTERVAL") || !audioSource.includes("crunch_vacuum") || !audioSource.includes("crunch_hit_3")) {
  throw new Error("Crunch Bank impact mixing or vacuum audio is missing");
}
if (!audioSource.includes("playing-card.mp3") || !audioSource.includes("playCardThrowSample") || !audioSource.includes("CARD_PLAY_VARIANTS") || !audioSource.includes("lastCardPlayVariant")) {
  throw new Error("Varied sampled card-play audio is missing");
}
if (!audioSource.includes("DEAL_SAMPLE_URLS") || !audioSource.includes("playDealSample") || !audioSource.includes("dealSamplePool") || !cardGestureSource.includes('playGameSfx("card_deal")')) {
  throw new Error("Sequential hand and table deal audio is missing");
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
if (!gameStateSource.includes("survivingCards") || !gameStateSource.includes("Array(openSlots).fill(null)")) {
  throw new Error("Hand survivors must compact right before replacement cards are dealt");
}
const exitRunSource = gameStateSource.slice(
  gameStateSource.indexOf("function exitRun()"),
  gameStateSource.indexOf("function startNewRound()")
);
const resetRunSource = gameStateSource.slice(
  gameStateSource.indexOf("function resetRunSession()"),
  gameStateSource.indexOf("function discardSelectedCards()")
);
if (!exitRunSource.includes("clearRunSave();") || !exitRunSource.includes("resetRunSession();")
  || !resetRunSource.includes("state.score = 0;") || !resetRunSource.includes("state.bankMultiplier = 1;")
  || !resetRunSource.includes("state.activePot = null;")) {
  throw new Error("Exiting a run must discard all temporary run progress");
}
if (gameStateSource.includes("restoreRun(") || gameStateSource.includes("persistRun(")
  || gameStateSource.includes("loadRunSave") || gameStateSource.includes("saveRunState")
  || uiSource.includes("FREE RESUME") || uiSource.includes("hasSavedRun")
  || !mainSource.includes("game.exitRun")) {
  throw new Error("Run resume behavior must stay disabled");
}
if (!cardGestureSource.includes("export function animateCardDealIn") || !uiSource.includes("animateCardDealIn") || !css.includes("card-deal-pending")) {
  throw new Error("Left-to-right hand refill dealing or its flight trail is missing");
}
if (!cardGestureSource.includes('motion: "deal"') || !cardGestureSource.includes("getDealStartDelay") || !uiSource.includes('motion: shiftsWithinHand ? "hand-shift"')) {
  throw new Error("Paced card deal or synchronized survivor shift is missing");
}
const handSignatureSource = uiSource.slice(
  uiSource.indexOf("function getHandSignature(state)"),
  uiSource.indexOf("function getRunEndCopy") > uiSource.indexOf("function getHandSignature(state)")
    ? uiSource.indexOf("function getRunEndCopy")
    : uiSource.length
);
if (!uiSource.includes("syncHandInteractionState(elements, state)")
  || handSignatureSource.includes("state.locked")
  || !cardGestureSource.includes('event.animationName !== "cardDealLand"')
  || !css.includes("var(--deal-landing-ms, 140ms)")) {
  throw new Error("Deal completion must unlock cards without rebuilding or blinking the hand");
}
if (!dealTimingSource.includes("getRoundDealDuration") || !gameStateSource.includes("dealToken !== state.timerToken") || !gameStateSource.includes("finishHandDeal(4)")) {
  throw new Error("The turn timer must wait for the hand deal to finish");
}
if (!gameStateSource.includes("ui.syncResolvedHud(state)")
  || !gameStateSource.includes("ui.beginRoundHandoff(state)")
  || !gameStateSource.includes("ui.finishRoundHandoff()")
  || gameStateSource.includes("ui.elements.scoreValue.textContent")
  || !uiSource.includes("syncHudCountersWithoutMotion")
  || !css.includes(".game-shell.is-round-handoff .timer-fill")) {
  throw new Error("Round dealing must not replay score juice or animate HUD resets");
}
if (!uiSource.includes("(state.dealHandCount ?? 0) + index") || !cardGestureSource.includes('zone === "table"')) {
  throw new Error("Table cards must deal after all replacement hand cards");
}
if (!uiSource.includes("const currentIndex = Number(button.dataset.handIndex)")) {
  throw new Error("Repositioned hand cards must select their current slot");
}
if (!css.includes('html[data-card-skin="dark"]') || !css.includes('html[data-card-skin="pink"]') || !css.includes('html[data-card-skin="gold"]') || !css.includes('html[data-card-skin="rainbow"]')) {
  throw new Error("One or more card skin styles are missing");
}
const roundStartSource = gameStateSource.slice(
  gameStateSource.indexOf("function startNewRound()"),
  gameStateSource.indexOf("function startTimer()")
);
if (!roundStartSource.includes("ui.clearMessage();") || !uiSource.includes("messageGeneration")) {
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
