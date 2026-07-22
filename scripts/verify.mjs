import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  ".env.example",
  "auth-config.js",
  "src/main.js",
  "src/authConfig.js",
  "src/supabaseAccount.js",
  "src/audio.js",
  "src/haptics.js",
  "src/input.js",
  "src/cardGestures.js",
  "src/arcadeMode.js",
  "src/dealTiming.js",
  "src/playGames.js",
  "src/fullscreen.js",
  "src/themes.js",
  "src/cardSkins.js",
  "src/cardCollection.js",
  "src/cardCollectionUI.js",
  "src/store.js",
  "src/storeProducts.js",
  "src/storeState.js",
  "src/multiplayer.js",
  "src/realtimeMultiplayer.js",
  "src/multiplayerMode.js",
  "api/matchmaking.js",
  "api/_matchmakingCore.js",
  "api/_redis.js",
  "cloudflare/wrangler.jsonc",
  "cloudflare/src/index.js",
  "cloudflare/src/protocol.js",
  "cloudflare/src/session.js",
  "src/potInfo.js",
  "src/tutorial.js",
  "src/economy.js",
  "src/scoreSurge.js",
  "src/purchases.js",
  "assets/sfx/playing-card.mp3",
  "assets/sfx/deal-hand-1.mp3",
  "assets/sfx/deal-hand-2.mp3",
  "assets/sfx/deal-hand-3.mp3",
  "assets/sfx/deal-hand-4.mp3",
  "assets/card-sets/pink_arcade/card-set.json",
  "assets/card-sets/pink_arcade/backs/default_back.png",
  "assets/card-sets/pink_arcade/previews/full-deck-preview.png",
  "styles/main.css",
  "styles/collection.css",
  "styles/store.css",
  "styles/multiplayer.css",
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
const pinkArcadeManifest = JSON.parse(await readFile(resolve(root, "assets/card-sets/pink_arcade/card-set.json"), "utf8"));
if (pinkArcadeManifest.setId !== "pink_arcade"
  || pinkArcadeManifest.cards?.length !== 52
  || new Set(pinkArcadeManifest.cards.map((card) => card.id)).size !== 52
  || pinkArcadeManifest.filtering !== "nearest") {
  throw new Error("Pink Arcade deck manifest is incomplete or not configured for pixel rendering");
}
await Promise.all(pinkArcadeManifest.cards.map(async (card) => {
  const imagePath = resolve(root, "assets/card-sets/pink_arcade", card.image);
  await access(imagePath);
  const bytes = await readFile(imagePath);
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Pink Arcade card is not a valid PNG: ${card.image}`);
  }
}));
const scoringModule = await import(`../src/scoring.js?verify=${Date.now()}`);
const results = scoringModule.runScoringSelfTests();
if (!Array.isArray(results) || results.some((result) => result.pass === false)) {
  throw new Error("Scoring self-tests failed");
}
const arcadeModeModule = await import(`../src/arcadeMode.js?verify=${Date.now()}`);
const arcadeResults = arcadeModeModule.runArcadeModeSelfTests();
if (!Array.isArray(arcadeResults) || arcadeResults.some((result) => result.pass === false)) {
  throw new Error("Endless Arcade and power-card self-tests failed");
}
const matchmakingModule = await import(`../api/_matchmakingCore.js?verify=${Date.now()}`);
const matchmakingStore = new matchmakingModule.MemoryMatchmakingStore();
const matchNow = Date.now();
const firstJoin = await matchmakingModule.handleMatchmakingAction(matchmakingStore, "join", {
  displayName: "Player One",
  skinId: "classic"
}, matchNow);
const secondJoin = await matchmakingModule.handleMatchmakingAction(matchmakingStore, "join", {
  displayName: "Player Two",
  skinId: "rainbow"
}, matchNow + 20);
const firstMatched = await matchmakingModule.handleMatchmakingAction(matchmakingStore, "poll", {
  ...firstJoin.session
}, matchNow + 40);
if (firstJoin.state !== "waiting"
  || secondJoin.state !== "matched"
  || firstMatched.match?.id !== secondJoin.match?.id
  || firstMatched.match?.opponent?.displayName !== "Player Two"
  || secondJoin.match?.opponent?.displayName !== "Player One"
  || secondJoin.match.endsAt - secondJoin.match.startsAt !== 60_000) {
  throw new Error("Two waiting players were not paired into the same one-minute match");
}
await matchmakingModule.handleMatchmakingAction(matchmakingStore, "score", {
  ...firstJoin.session,
  score: 1200
}, secondJoin.match.startsAt + 1000);
await matchmakingModule.handleMatchmakingAction(matchmakingStore, "score", {
  ...secondJoin.session,
  score: 900
}, secondJoin.match.startsAt + 1100);
const settledMatch = await matchmakingModule.handleMatchmakingAction(matchmakingStore, "poll", {
  ...firstJoin.session
}, secondJoin.match.endsAt + 1);
if (settledMatch.state !== "complete"
  || settledMatch.match.winner !== "you"
  || settledMatch.match.you.score !== 1200
  || settledMatch.match.opponent.score !== 900) {
  throw new Error("Multiplayer score comparison or server-timed result settlement failed");
}
const fairnessStore = new matchmakingModule.MemoryMatchmakingStore();
const fairnessNow = matchNow + 100_000;
const patientJoin = await matchmakingModule.handleMatchmakingAction(fairnessStore, "join", {
  displayName: "Patient Player"
}, fairnessNow);
await matchmakingModule.handleMatchmakingAction(fairnessStore, "poll", {
  ...patientJoin.session
}, fairnessNow + 10_000);
const laterJoin = await matchmakingModule.handleMatchmakingAction(fairnessStore, "join", {
  displayName: "Later Player"
}, fairnessNow + 19_000);
if (laterJoin.state !== "matched" || laterJoin.match.opponent.displayName !== "Patient Player") {
  throw new Error("Active waiting players must retain queue priority after heartbeat polling");
}

const realtimeProtocol = await import(`../cloudflare/src/protocol.js?verify=${Date.now()}`);
const realtimeNow = matchNow + 200_000;
const realtimeMatch = realtimeProtocol.createMatchRecord({
  id: "11111111-1111-4111-8111-111111111111",
  playerA: { id: "22222222-2222-4222-8222-222222222222", displayName: "Socket One", skinId: "classic" },
  playerB: { id: "33333333-3333-4333-8333-333333333333", displayName: "Socket Two", skinId: "pink" },
  now: realtimeNow
});
realtimeMatch.scoreA = 4200;
realtimeMatch.scoreB = 3900;
realtimeProtocol.settleMatch(realtimeMatch, realtimeMatch.endsAt + 1);
const realtimeView = realtimeProtocol.buildMatchView(realtimeMatch, realtimeMatch.playerA.id, realtimeMatch.endsAt + 1);
if (realtimeView?.winner !== "you"
  || realtimeView.you.score !== 4200
  || realtimeView.opponent.score !== 3900
  || realtimeMatch.endsAt - realtimeMatch.startsAt !== 60_000) {
  throw new Error("Cloudflare realtime match protocol did not settle a one-minute duel correctly");
}
const progressionModule = await import(`../src/progression.js?verify=${Date.now()}`);
const challengePots = progressionModule.createDefaultPots();
if (challengePots.length !== 56
  || challengePots.some((pot) => !pot.title || !pot.description || !pot.icon || !pot.difficulty || !pot.gameplayModifier)
  || new Set(challengePots.map((pot) => pot.id)).size !== 56
  || challengePots.some((pot) => !Number.isFinite(pot.target) || pot.target <= 0)
  || new Set(challengePots.map((pot) => pot.chapter)).size < 6
  || challengePots[1].gameplayModifier.suitMatchMultiplier !== 2
  || challengePots[2].gameplayModifier.turnSeconds !== 8
  || challengePots[6].gameplayModifier.allowedSuits?.[0] !== "hearts"
  || challengePots[20].gameplayModifier.allowedMatchTypes?.[0] !== "add"
  || challengePots[55].gameplayModifier.scoreMultiplier !== 6) {
  throw new Error("Data-driven pot challenge definitions are incomplete");
}
const deckModule = await import(`../src/deck.js?verify=${Date.now()}`);
const handSafetyModule = await import(`../src/handSafety.js?verify=${Date.now()}`);
for (const pot of challengePots) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const safetyState = {
      deck: deckModule.shuffle(deckModule.createDeck()),
      discard: [],
      stack: [],
      hand: [],
      baseStackCount: 2,
      activePot: pot
    };
    safetyState.stack = deckModule.drawCards(safetyState, 2);
    safetyState.hand = deckModule.drawCards(safetyState, 4);
    if (!handSafetyModule.ensurePlayableRound(safetyState)
      || !handSafetyModule.hasPlayableCard(safetyState.stack, safetyState.hand, pot.gameplayModifier)) {
      throw new Error(`Pot ${pot.id} can create an unwinnable opening`);
    }
  }
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
const backgroundStyles = await readFile(resolve(root, "styles/main.css"), "utf8");
if (!backgroundStyles.includes("--casino-table-bg:")
  || !backgroundStyles.includes("repeating-linear-gradient(52deg")
  || backgroundStyles.includes("pixel-casino-menu.jpg")
  || backgroundStyles.includes("pixel-casino-table.jpg")) {
  throw new Error("The lightweight top-down felt table background is not connected to the UI");
}
if (!html.includes("pixel-screen-filter") || !html.includes("playLeaderboardButton")) {
  throw new Error("Release UI hooks are missing");
}
if ((html.match(/data-fullscreen-toggle/g) ?? []).length < 2) {
  throw new Error("Menu and gameplay fullscreen controls are missing");
}
if (!html.includes("summaryCoins") || !html.includes("storeCoinsValue") || !html.includes("storeContent")) {
  throw new Error("Economy UI hooks are missing");
}
if (!html.includes('id="potInfoButton"')
  || !html.includes('id="potInfoOverlay"')
  || !html.includes('id="potInfoCrunchList"')) {
  throw new Error("Paused Pot rulebook UI hooks are missing");
}
if (/energy|recharge/i.test(html)) {
  throw new Error("Energy gating must not appear in the unlimited-play UI");
}
if ((html.match(/data-theme-id=/g) ?? []).length !== 3 || !html.includes("gold-table") || !html.includes("knight-deck")) {
  throw new Error("Selectable theme controls are missing");
}
if (!html.includes("storeTabs") || !html.includes("storeCollectionPanel") || !html.includes("storePurchaseOverlay")) {
  throw new Error("Data-driven Store tab or purchase hooks are missing");
}
if (!html.includes("packOpeningOverlay") || !html.includes("collectionDeckList") || !html.includes("collectionDetail")) {
  throw new Error("Mystery pack or 52-card collection UI hooks are missing");
}
if (!html.includes("run-scoreboard") || !html.includes("summaryRecoveryTicker")) {
  throw new Error("Arcade run summary structure is missing");
}
if (!html.includes("tutorialStartButton") || !html.includes("tutorialCoach") || !html.includes("bottom-status")) {
  throw new Error("Live-board tutorial hooks are missing");
}
if (!html.includes('id="endlessArcadeButton"') || !html.includes("ENDLESS ARCADE")) {
  throw new Error("Endless Arcade menu action is missing");
}
if (!html.includes('id="onlineDuelButton"')
  || !html.includes('id="matchmakingScreen"')
  || !html.includes('id="multiplayerResultScreen"')) {
  throw new Error("Online Duel menu, matchmaking, or result UI hooks are missing");
}
if (html.includes('id="matchmakingCountdown"')) {
  throw new Error("Online Duel must open the dealt board without a separate countdown screen");
}
if (!html.includes('data-page="account"')
  || !html.includes('id="cardCrunchGoogleSignInButton"')
  || !html.includes('id="authDiagnostics"')
  || html.includes("STL Account")
  || html.includes("Bit Crush Core")) {
  throw new Error("Dedicated Card Crunch Supabase account UI hooks are missing or copied account branding remains");
}
if (!html.includes("Each pot is a different challenge.")
  || !html.includes("pot-state-legend")
  || (html.match(/menu-chip-add/g) ?? []).length !== 1) {
  throw new Error("Pot challenge copy or unified header actions are missing");
}
if (html.includes('id="tutorialPage"')) {
  throw new Error("Tutorial must use the real game board, not a separate practice layout");
}

const economyModule = await import(`../src/economy.js?verify=${Date.now()}`);

const authConfigModule = await import(`../src/authConfig.js?verify=${Date.now()}`);
const accountModule = await import(`../src/supabaseAccount.js?verify=${Date.now()}`);
const dedicatedAuthConfig = authConfigModule.readAuthConfig({
  supabaseUrl: "https://cardcrunchtest.supabase.co/",
  supabaseAnonKey: "sb_publishable_card_crunch_test",
  appUrl: "https://card-crunch.vercel.app/"
});
authConfigModule.validateAuthConfig(dedicatedAuthConfig);
const authDiagnostics = authConfigModule.getAuthDiagnostics(dedicatedAuthConfig, {
  origin: "https://card-crunch.vercel.app",
  hostname: "card-crunch.vercel.app"
});
if (authDiagnostics.projectRef !== "cardcrunchtest"
  || authDiagnostics.callback !== "https://card-crunch.vercel.app/auth/callback"
  || !Object.values(authDiagnostics.variables).every(Boolean)
  || accountModule.CARD_CRUNCH_NATIVE_CALLBACK !== "cardcrunch://auth/callback"
  || accountModule.CARD_CRUNCH_AUTH_STORAGE_KEY !== "card-crunch-auth-v1") {
  throw new Error("Dedicated Card Crunch Supabase configuration or callback mapping is incomplete");
}
let missingAuthConfigRejected = false;
try { authConfigModule.validateAuthConfig(authConfigModule.readAuthConfig({})); } catch (error) {
  missingAuthConfigRejected = error?.name === "AuthConfigurationError";
}
if (!missingAuthConfigRejected) throw new Error("Missing Card Crunch auth variables must fail validation");
let capturedAuthClientArgs = null;
globalThis.supabase = {
  createClient: (...args) => {
    capturedAuthClientArgs = args;
    return { auth: {} };
  }
};
accountModule.createCardCrunchSupabaseClient(dedicatedAuthConfig);
delete globalThis.supabase;
if (capturedAuthClientArgs?.[0] !== "https://cardcrunchtest.supabase.co"
  || capturedAuthClientArgs?.[1] !== "sb_publishable_card_crunch_test"
  || capturedAuthClientArgs?.[2]?.auth?.storageKey !== "card-crunch-auth-v1"
  || capturedAuthClientArgs?.[2]?.auth?.flowType !== "pkce") {
  throw new Error("Supabase client must use only validated Card Crunch PKCE configuration");
}
const lowReward = economyModule.calculateRunCoinReward({ grossCash: 100_000, bestStreak: 2 });
const highReward = economyModule.calculateRunCoinReward({ grossCash: 1_000_000, bestStreak: 8, potCleared: true });
if (lowReward.total <= 0 || highReward.total <= lowReward.total) {
  throw new Error("Run coin rewards do not scale with performance");
}
if ("energyPerRun" in economyModule.ECONOMY_CONFIG || "calculateRegeneratedEnergy" in economyModule) {
  throw new Error("Energy gating still exists in the economy module");
}
const storeProductsModule = await import(`../src/storeProducts.js?verify=${Date.now()}`);
const storeProducts = storeProductsModule.STORE_PRODUCTS;
const coinPacks = storeProducts.filter((product) => ["generic_card_pack", "themed_card_pack"].includes(product.productType));
const fullDecks = storeProducts.filter((product) => product.productType === "full_deck");
if (new Set(storeProducts.map((product) => product.id)).size !== storeProducts.length
  || coinPacks.length < 4
  || coinPacks.some((product) => product.currencyType !== "coins" || product.cardsAwarded !== 1 || product.unlockEntireCollection || !/pack/i.test(product.displayName))
  || fullDecks.length < 3
  || fullDecks.some((product) => product.currencyType !== "real_money" || !product.unlockEntireCollection || !product.platformProductId || !/full deck/i.test(product.displayName))) {
  throw new Error("Store products do not clearly separate coin packs from verified full-deck purchases");
}
const milestoneReward = economyModule.calculateCrunchMilestoneCoinReward({ fromCash: 90_000, toCash: 310_000 });
if (milestoneReward.milestones !== 3 || milestoneReward.coins !== 30) {
  throw new Error("Crunch cash milestones must award persistent coins exactly once per 100K crossed");
}
const scoreSurgeModule = await import(`../src/scoreSurge.js?verify=${Date.now()}`);
const millionSurge = scoreSurgeModule.createScoreSurgePlan(1_000_000);
const hugeSurgeMilestones = scoreSurgeModule.buildScoreSurgeMilestones(1_000_000_000);
if (scoreSurgeModule.getScoreSurgeTier(9_999).tier !== 0
  || scoreSurgeModule.getScoreSurgeTier(10_000).tier !== 1
  || millionSurge.tier !== 6
  || millionSurge.milestones.length !== 100
  || millionSurge.milestones.some((milestone, index) => milestone !== (index + 1) * 10_000)
  || hugeSurgeMilestones.length > scoreSurgeModule.SCORE_SURGE_CONFIG.maximumVisibleMilestones
  || hugeSurgeMilestones.at(-1) !== 1_000_000_000
  || ![10_000, 20_000, 30_000, 50_000, 80_000, 120_000, 1_000_000]
    .every((milestone) => millionSurge.milestones.includes(milestone))) {
  throw new Error("Value-driven Crunch surge tiers or milestone ramp are incomplete");
}
const cardCollectionModule = await import(`../src/cardCollection.js?verify=${Date.now()}`);
const collectionResults = cardCollectionModule.runCardCollectionSelfTests();
if (!Array.isArray(collectionResults) || collectionResults.some((result) => result.pass === false)) {
  throw new Error("Card collection self-tests failed");
}
const cardSkinModule = await import(`../src/cardSkins.js?verify=${Date.now()}`);
if (!cardSkinModule.getCardSkinAssetUrl({ rank: "A", suit: "hearts" }, "pink_arcade").endsWith("/cards/hearts/ace_hearts.png")
  || !cardSkinModule.getCardSkinAssetUrl({ rank: "10", suit: "diamonds" }, "pink_arcade").endsWith("/cards/diamonds/10_diamonds.png")
  || !cardSkinModule.getCardSkinAssetUrl({ rank: "K", suit: "spades" }, "pink_arcade").endsWith("/cards/spades/king_spades.png")) {
  throw new Error("Pink Arcade rank and suit asset mapping is incorrect");
}

const [cutsceneSource, animationsSource, themeSource, cardSkinSource, cardCollectionSource, cardCollectionUiSource, cardGestureSource, dealTimingSource, gameStateSource, uiSource, storeSource, multiplayerSource, realtimeSource, matchmakingSource, cloudflareSource, css, collectionCss, storeCss, multiplayerCss] = await Promise.all([
  readFile(resolve(root, "src/crunchCutscene.js"), "utf8"),
  readFile(resolve(root, "src/animations.js"), "utf8"),
  readFile(resolve(root, "src/themes.js"), "utf8"),
  readFile(resolve(root, "src/cardSkins.js"), "utf8"),
  readFile(resolve(root, "src/cardCollection.js"), "utf8"),
  readFile(resolve(root, "src/cardCollectionUI.js"), "utf8"),
  readFile(resolve(root, "src/cardGestures.js"), "utf8"),
  readFile(resolve(root, "src/dealTiming.js"), "utf8"),
  readFile(resolve(root, "src/gameState.js"), "utf8"),
  readFile(resolve(root, "src/ui.js"), "utf8"),
  readFile(resolve(root, "src/store.js"), "utf8"),
  readFile(resolve(root, "src/multiplayer.js"), "utf8"),
  readFile(resolve(root, "src/realtimeMultiplayer.js"), "utf8"),
  readFile(resolve(root, "api/_matchmakingCore.js"), "utf8"),
  readFile(resolve(root, "cloudflare/src/index.js"), "utf8"),
  readFile(resolve(root, "styles/main.css"), "utf8"),
  readFile(resolve(root, "styles/collection.css"), "utf8"),
  readFile(resolve(root, "styles/store.css"), "utf8"),
  readFile(resolve(root, "styles/multiplayer.css"), "utf8")
]);
const mainSource = await readFile(resolve(root, "src/main.js"), "utf8");
const tutorialSource = await readFile(resolve(root, "src/tutorial.js"), "utf8");
const audioSource = await readFile(resolve(root, "src/audio.js"), "utf8");
const hapticsSource = await readFile(resolve(root, "src/haptics.js"), "utf8");
const scoringSource = await readFile(resolve(root, "src/scoring.js"), "utf8");
const scoreSurgeSource = await readFile(resolve(root, "src/scoreSurge.js"), "utf8");
const arcadeModeSource = await readFile(resolve(root, "src/arcadeMode.js"), "utf8");
if (!mainSource.includes("initializeMultiplayer")
  || !mainSource.includes("initializeSupabaseAccount")
  || !gameStateSource.includes("startMultiplayerMatch")
  || !gameStateSource.includes("updateMultiplayerClock")
  || !multiplayerSource.includes("hitWaitingCard")
  || !multiplayerSource.includes('elements.screen?.addEventListener("pointerdown"')
  || !multiplayerSource.includes("createCardCrunchInteraction")
  || !multiplayerSource.includes("animateCardDealIn")
  || !multiplayerSource.includes("CardCrunchRealtimeTransport")
  || !multiplayerSource.includes('import { playGameSfx } from "./audio.js')
  || !multiplayerSource.includes('playGameSfx("target_clear")')
  || !multiplayerSource.includes("this.game.startMultiplayerMatch")
  || !multiplayerSource.includes("this.hideWaitingScreen();")
  || !multiplayerSource.includes("this.startMatchClock(generation)")
  || multiplayerSource.includes("matchmakingCountdown")
  || multiplayerSource.includes("countdown.textContent")
  || !realtimeSource.includes("new WebSocket")
  || !realtimeSource.includes("reconnectRoom")
  || !cloudflareSource.includes("export class Matchmaker")
  || !cloudflareSource.includes("export class MatchRoom")
  || !cloudflareSource.includes("acceptWebSocket")
  || !cutsceneSource.includes("export function createCardCrunchInteraction")
  || !matchmakingSource.includes("WAITING_TTL_MS")
  || !matchmakingSource.includes("settleMatch")
  || multiplayerSource.includes("waiting-card-shard")
  || html.includes("matchmakingCardHint")
  || multiplayerCss.includes("waitingShardVacuum")
  || !multiplayerCss.includes("grid-template-rows: auto auto auto minmax(180px, 1fr) auto")
  || !multiplayerCss.includes("multiplayer-scoreboard")) {
  throw new Error("Online Duel matchmaking, waiting-card toy, live clock, or result presentation is incomplete");
}
if (!gameStateSource.includes("playInstantMultiplayerCrunch")
  || !gameStateSource.includes("instantVacuum: true")
  || !gameStateSource.includes("removeCardsOnComplete: true")
  || !gameStateSource.includes("spawnMultiplayerCrunchReward")
  || !animationsSource.includes("export function spawnMultiplayerCrunchReward")
  || !gameStateSource.includes("entry.bankPoints ?? entry.points")
  || !css.includes(".multiplayer-crunch-reward")
  || !gameStateSource.includes("multiplayerStartDelay")
  || !cutsceneSource.includes("crunch()")
  || !cutsceneSource.includes("prepared.instantVacuum")) {
  throw new Error("Online Duel must use the immediate one-hit Crunch and board-first start flow");
}
if (!html.includes("main-menu-screen is-visible is-home-page")
  || !uiSource.includes('classList.toggle("is-home-page"')
  || !css.includes(".main-menu-screen.is-home-page")
  || !css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))")) {
  throw new Error("The home menu must fit one viewport while secondary pages remain scrollable");
}
if (!cutsceneSource.includes("feedCutinCardsToBank") || !cutsceneSource.includes("createPixelShardClip") || !css.includes("cutin-card-shard")) {
  throw new Error("Crunch Bank card-shard animation hooks are missing");
}
if (!cutsceneSource.includes("startPreparedShardPhysics")
  || !cutsceneSource.includes("updateScatteredShard")
  || !cutsceneSource.includes("updateVacuumShard")
  || !cutsceneSource.includes("resolveShardWallCollisions")
  || !cutsceneSource.includes("registerShardBankImpact")
  || !css.includes("cutin-card-shard.is-physics-active")) {
  throw new Error("Physics-driven Crunch Bank shard sequencing is missing");
}
if (!cardCollectionSource.includes("buildCollectiblePool")
  || !cardCollectionSource.includes("equipCollectedCard")
  || !cardCollectionSource.includes("unequipCollectedCard")
  || !cardCollectionSource.includes("CARD_SKIN_RARITIES")
  || !cardCollectionSource.includes("selectWeightedPackReward")
  || !cardCollectionSource.includes("unlockFullDeckSkin")
  || !storeSource.includes("createPendingPackReward")
  || !cardCollectionUiSource.includes("getCardSkinRarity")
  || !storeSource.includes("confirmRealMoneyPurchase")
  || !storeSource.includes("registerVerifiedTransaction")
  || !uiSource.includes("getCardSkinClass")
  || !cutsceneSource.includes("getCardSkinClass")
  || !cutsceneSource.includes('class="card-skin-art"')
  || !cardSkinSource.includes("getCardSkinAssetUrl")
  || !cardSkinSource.includes("mountCardSkinArt")
  || !cardGestureSource.includes("is-pink-arcade")
  || !css.includes(".card.card-skin-pink_arcade")
  || !css.includes(".card-skin-art")
  || !collectionCss.includes(".pack-opening-overlay")
  || !storeCss.includes(".store-tabs")
  || !storeCss.includes(".store-product-card")
  || !collectionCss.includes(".rarity-mythic")
  || !collectionCss.includes(".collection-card-matrix")) {
  throw new Error("Rarity-weighted packs, per-card equips, or collection visuals are incomplete");
}
if (!cutsceneSource.includes("is-consumed-after-shatter") || !css.includes(".cutin-live-card.is-consumed-after-shatter")) {
  throw new Error("Consumed cut-in cards can reappear after the vacuum finishes");
}
if (!animationsSource.includes("const RESOLVE_HIGHLIGHT_DURATION_MS = 700")
  || !animationsSource.includes("await advance.wait(RESOLVE_HIGHLIGHT_DURATION_MS)")
  || animationsSource.includes("waitForTap(RESOLVE_HIGHLIGHT")) {
  throw new Error("Resolved-card highlights must auto-advance after 700ms while remaining skippable");
}
if (!arcadeModeSource.includes("POWER_CARD_TYPES")
  || !arcadeModeSource.includes("resolveArcadeCrunch")
  || !gameStateSource.includes("drawArcadeCard")
  || !uiSource.includes("renderArcadeHand")
  || !uiSource.includes('card.setAttribute("aria-disabled", String(disabled))')
  || !cardGestureSource.includes('fromSide === "right"')
  || !css.includes(".power-card-charged")) {
  throw new Error("Endless Arcade powers, right-side refills, or visuals are incomplete");
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
  cutsceneSource.indexOf("function stepPreparedShardPhysics"),
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
if (!shardFeedSource.includes("await prepared.physicsPromise") || shardFeedSource.includes("waitMaybe(advance")) {
  throw new Error("Card shard vacuum timing must stay independent from tap-to-advance speedups");
}
if (!cutsceneSource.includes("pendingBankEffects")
  || !cutsceneSource.includes("settleBankEffects")
  || !cutsceneSource.includes("nextCreditedAmount")
  || !cutsceneSource.includes("prepared.onImpact?.({ arrived")) {
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
if (!cutsceneSource.includes('setProperty("--shard-origin"')
  || !css.includes("transform-origin: var(--shard-origin")
  || css.includes("@keyframes cutinCardShardVacuum")) {
  throw new Error("Shard physics must share one pivot without the legacy spline animation");
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
  || !selectionResolveSource.includes('emphasizedCards.forEach')
  || !css.includes(".cutin-shared-source-hidden {\n  opacity: 0 !important;")) {
  throw new Error("Consumed hand and table cards must stay absent behind the Crunch cutscene");
}
const animationsCutsceneVersion = animationsSource.match(/from "\.\/crunchCutscene\.js\?v=(\d+)"/)?.[1];
const gameStateCutsceneVersion = gameStateSource.match(/from "\.\/crunchCutscene\.js\?v=(\d+)"/)?.[1];
if (!animationsCutsceneVersion || animationsCutsceneVersion !== gameStateCutsceneVersion) {
  throw new Error("Crunch skip and handoff state must use one shared module instance");
}
if (!cutsceneSource.includes("playInteractiveCardCrunch")
  || !cutsceneSource.includes("prepareCutinCardShards")
  || !cutsceneSource.includes("explosionMinSpeed")
  || !cutsceneSource.includes("vacuumRampForce")
  || !css.includes("cutin-fracture-map")
  || !css.includes("cutin-card-shard.is-physics-active")) {
  throw new Error("Three-hit interactive Crunch damage sequence is missing");
}
if (!cutsceneSource.includes("assignCrunchShakeVectors")
  || !cutsceneSource.includes("getDisplayedCrunchCards")
  || !cutsceneSource.includes("is-crunch-shaking")
  || !cutsceneSource.includes("maxRotationByHit")
  || !cutsceneSource.includes("bounceHeightByHit")
  || !cutsceneSource.includes("durationByHit")
  || !cutsceneSource.includes("pulseBankOnShardImpact")
  || !css.includes("--crunch-shake-x-a")
  || !css.includes("--crunch-shake-r-c")
  || !css.includes("--crunch-bounce-height")
  || !css.includes("--crunch-shake-duration")
  || !css.includes("transform-origin: 50% 50% !important")) {
  throw new Error("Crunch hits must assign bounded, varied per-card shake vectors");
}
if (!audioSource.includes("playCrunchShardImpact")
  || !audioSource.includes("bankShardHeavy")
  || !hapticsSource.includes("bankShard")
  || !audioSource.includes("impactStrength")
  || !audioSource.includes("crunch_vacuum")
  || !audioSource.includes("crunch_hit_3")
  || !cutsceneSource.includes("playCrunchShardImpact({ progress, strength })")) {
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
if (!cutsceneSource.includes("playInlineCrunchBonuses") || !cutsceneSource.includes("entry.bankPoints") || !css.includes("cutin-inline-bonuses")) {
  throw new Error("Crunch multipliers are not integrated into each card cut-in");
}
if (!cutsceneSource.includes("cutin-card-stage")
  || !cutsceneSource.includes("cutin-result-stack")
  || !cutsceneSource.includes("spawnModifierBurst")
  || !cutsceneSource.includes("applyInlineBonus")
  || !css.includes("Build 139: anchored crunch results")
  || !css.includes("cutin-bonus-run")
  || !css.includes("cutin-bonus-pot")) {
  throw new Error("Crunch cards must stay anchored while color-coded modifiers resolve downward");
}
if (!scoringSource.includes("buildCrunchPresentationEntries") || !animationsSource.includes("presentationEntries") || !scoringSource.includes("MATCH_TIER_MULTIPLIERS")) {
  throw new Error("Growing suit and number matches are not consolidated into their final tier");
}
if (!cutsceneSource.includes("playFullHandPrelude") || !cutsceneSource.includes("is-full-hand-prelude") || !css.includes("cutin-full-hand-stage")) {
  throw new Error("The full-hand opening reaction is missing");
}
const fullHandPreludeSource = cutsceneSource.slice(
  cutsceneSource.indexOf("export async function playFullHandPrelude"),
  cutsceneSource.indexOf("export async function playBustCutin")
);
if (!fullHandPreludeSource.includes("playInteractiveCardCrunch")
  || !fullHandPreludeSource.includes("fullHand: true")
  || !fullHandPreludeSource.includes("transitionSourceCardsIntoCutin")
  || !fullHandPreludeSource.includes("bank.add")
  || !selectionResolveSource.includes("onFullHandResolved")) {
  throw new Error("Full Hand must highlight, hand off the live cards, complete three hits, and vacuum into the bank");
}
if (!cutsceneSource.includes("createCrunchScoreSurge")
  || !cutsceneSource.includes("playScoreSurgeMilestone")
  || !cutsceneSource.includes("queueMilestoneBeat")
  || !cutsceneSource.includes("spawnScoreMilestoneCoinSpill")
  || !cutsceneSource.includes("spawnCrunchCoinReward")
  || !cutsceneSource.includes("createRollingBankDisplay")
  || !cutsceneSource.includes("formatRollingBankNumber")
  || !cutsceneSource.includes("spawnCollectibleCoinBreak")
  || !cutsceneSource.includes("crunch-collectible-coin")
  || !cutsceneSource.includes("coinRewards.award")
  || !scoreSurgeSource.includes("buildScoreSurgeMilestones")
  || !cutsceneSource.includes("BANK_ROLL_MILESTONE_PAUSE_MS")
  || !cutsceneSource.includes("BANK_MILESTONE_PARTICLE_CAP")
  || !css.includes("is-entry-score-surge-anchored")
  || css.includes("is-entry-score-surge-centered")
  || css.includes(".score-panel.is-hud-bank-floating.is-major-score-ramp-active {\n  top: 50%")
  || !css.includes("entry-score-surge-skip")
  || !css.includes("crunch-coin-reward-toast")
  || !css.includes("crunch-coin-collection")
  || !css.includes("crunch-collectible-coin")
  || !audioSource.includes("score_ramp_tick")
  || !audioSource.includes("coin_milestone")
  || !audioSource.includes("coin_collect")) {
  throw new Error("Exact 10K Crunch Bank rolls, anchored surges, or milestone coin showers are missing");
}
if (!cutsceneSource.includes("forceSettleAfter: 620")
  || !cutsceneSource.includes("vacuumRampDuration: 1120")
  || !css.includes("clamp(168px, 24dvh, 290px)")) {
  throw new Error("Crunch staging or accelerated vacuum timing regressed");
}
if (!uiSource.includes("renderBonusBankAction")
  || !uiSource.includes('dataset.action === "bonus-bank-ad"')
  || !uiSource.includes("elements._bonusBankOffer")
  || uiSource.includes('className = "bonus-bank-offer"')
  || !css.includes(".crunch-button.crunch-ad-offer")
  || css.includes(".bonus-bank-offer")) {
  throw new Error("The post-bank rewarded offer must occupy the idle Crunch action instead of a popup");
}
if (!gameStateSource.includes("Math.min(Math.round(depositAmount * BONUS_BANK_RATE), remaining)")
  || !gameStateSource.includes("{ completesPot }")) {
  throw new Error("Post-bank rewards must cap to and identify the exact pot remainder");
}
if (!mainSource.includes("activePressTargets") || mainSource.includes('classList.add("tap-pop")')) {
  throw new Error("Stable press feedback regression guards are missing");
}
if (!tutorialSource.includes("Full Crunch") || !tutorialSource.includes("Bank Your Cash") || !tutorialSource.includes("Minus Crunch")) {
  throw new Error("Tutorial lessons do not cover full-hand, banking, and arithmetic Crunches");
}
if (!tutorialSource.includes("guideStackByStep")
  || !gameStateSource.includes("tutorialGuideStackByStep")
  || !uiSource.includes("syncTutorialGuidance")
  || !css.includes("tutorial-guided-reference")
  || !css.includes("liveTutorialReference")) {
  throw new Error("Tutorial hand and reference-card guidance is missing");
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
if (!dealTimingSource.includes("getRoundDealDuration") || !gameStateSource.includes("dealToken !== state.timerToken") || !gameStateSource.includes("finishHandDeal(4,")) {
  throw new Error("The turn timer must wait for the hand deal to finish");
}
if (!gameStateSource.includes("finishHandDeal(4, { announceReady: Boolean(pot) || gameMode === MULTIPLAYER_MODE })")
  || !gameStateSource.includes("if (announceReady) ui.playInitialReadyPulse()")
  || gameStateSource.indexOf("ui.playInitialReadyPulse()") > gameStateSource.indexOf("startTimer();", gameStateSource.indexOf("function finishHandDeal"))
  || !uiSource.includes("playInitialReadyPulse()")
  || !uiSource.includes("is-initial-ready-pulse")
  || !css.includes("handCardsReadyPulse")
  || !css.includes("tableCardsReadyPulse")) {
  throw new Error("The initial pot deal must finish with a one-shot ready pulse before the timer starts");
}
if (!gameStateSource.includes("ui.syncResolvedHud(state)")
  || !gameStateSource.includes("ui.beginRoundHandoff(state)")
  || !gameStateSource.includes("ui.finishRoundHandoff()")
  || gameStateSource.includes("ui.elements.scoreValue.textContent")
  || !uiSource.includes("syncHudCountersWithoutMotion")
  || !css.includes(".game-shell.is-round-handoff .timer-fill")) {
  throw new Error("Round dealing must not replay score juice or animate HUD resets");
}
if (!uiSource.includes("pot-grid-row")
  || !uiSource.includes("pot-chapter-heading")
  || !uiSource.includes("getPotRuleFacts")
  || !uiSource.includes("createPotDetailPanel")
  || !uiSource.includes("selectingSamePot")
  || !uiSource.includes("dataset.potState")
  || !uiSource.includes("pot-lock-summary")
  || !css.includes(".pot-detail-shell.is-open")
  || !css.includes("Build 154: readable Pot challenge states")
  || !css.includes("Build 155: scalable Pot challenge catalog")
  || !gameStateSource.includes("gameplayModifier: state.activePot?.gameplayModifier")
  || !gameStateSource.includes("minimumBankStreak")
  || !gameStateSource.includes("minimumBankCash")
  || !gameStateSource.includes("ensurePlayableRound")) {
  throw new Error("Expandable challenge pots or their gameplay modifiers are missing");
}
if (!html.includes("pot-page-fixed")
  || !html.includes("pot-scroll-region")
  || !uiSource.includes('classList.toggle("is-pots-page"')
  || !uiSource.includes("alignPotRowToTop")
  || uiSource.includes("keepPotPanelVisible")
  || !css.includes("Build 162: fixed Pot controls")
  || !css.includes(".pot-scroll-region .pot-chapter-heading")
  || !css.includes("position: sticky")) {
  throw new Error("Pot controls must stay fixed while selected challenge rows align inside their own scroller");
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
if (!cardCollectionUiSource.includes("captureCollectionViewportState")
  || !cardCollectionUiSource.includes("restoreCollectionViewportState")
  || !cardCollectionUiSource.includes("matrix.scrollLeft = viewportState.left")
  || !cardCollectionUiSource.includes("focus({ preventScroll: true })")
  || !cardCollectionUiSource.includes("renderCardCollection({ preserveMatrixScroll: false })")) {
  throw new Error("Card collection toggles must preserve the card matrix scroll position and focus");
}
if (!cardSkinSource.includes("getCardVisualColorClass")
  || !cardSkinSource.includes('reason === "card-equip" || reason === "card-unequip"')
  || !uiSource.includes("getCardVisualColorClass(card)")
  || !cutsceneSource.includes("getCardVisualColorClass(card)")
  || !cardCollectionSource.includes("resolveCardSkinFromState")
  || !collectionCss.includes(".collection-card-slot.card-green")
  || !collectionCss.includes(".card-skin-rainbow")) {
  throw new Error("Equipped per-card skins and the green Club palette must stay consistent in game and cut-ins");
}
const roundStartSource = gameStateSource.slice(
  gameStateSource.indexOf("function startNewRound("),
  gameStateSource.indexOf("function startTimer()")
);
if (!roundStartSource.includes("ui.clearMessage();") || !uiSource.includes("messageGeneration")) {
  throw new Error("Round message cleanup regression guards are missing");
}
if (!roundStartSource.includes("dealNextTable(retainedTableCards)")
  || !gameStateSource.includes("getUncrunchedTableCards(crunch.resolution)")
  || !gameStateSource.includes("state.stack = [...freshCards, ...retained]")
  || !uiSource.includes("const existing = new Map()")
  || !uiSource.includes('motion: "hand-shift"')) {
  throw new Error("Untouched table cards must persist and slide right before replacement deals");
}
if (!uiSource.includes("animateSummaryNumber") || !css.includes("Arcade run summary")) {
  throw new Error("Arcade run summary counters or styles are missing");
}

const fullscreenSource = await readFile(resolve(root, "src/fullscreen.js"), "utf8");
if (!fullscreenSource.includes("requestFullscreen") || !fullscreenSource.includes("exitFullscreen")) {
  throw new Error("Fullscreen API hooks are missing");
}

console.log(`Verified ${results.length} scoring cases, ${arcadeResults.length} Endless Arcade and power-card cases, unlimited play, economy rewards, arcade run summary, round message cleanup, selectable themes and card skins, fullscreen controls, release UI hooks, and card-shard VFX.`);
