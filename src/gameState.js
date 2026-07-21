import { drawCards, shuffle, createDeck } from "./deck.js?v=164";
import { calculateCrunchScore, evaluateStackAdd, getSelectionMultiplier } from "./scoring.js?v=164";
import {
  ARCADE_CONFIG,
  ARCADE_MODE,
  POWER_CARD_TYPES,
  drawArcadeCard,
  getArcadeStackMultiplier,
  isArcadeMode,
  isPowerCard,
  resolveArcadeCrunch
} from "./arcadeMode.js?v=164";
import { createDefaultPots, getTargetForLevel, isPotUnlocked } from "./progression.js?v=164";
import { createCrunchBankCounter, playBustCutin, playCrunchEntryExplanation, playCrunchTotalExplanation, playFullHandPrelude, resetCrunchSkipRequest } from "./crunchCutscene.js?v=173";
import { ensurePlayableRound } from "./handSafety.js?v=164";
import { clearRunSave, consumeShieldToken, grantShieldToken, hasShieldToken } from "./save.js?v=164";
import { formatCompactNumber } from "./format.js?v=164";
import { adManager } from "./ads.js?v=164";
import { submitBestScore } from "./playGames.js?v=164";
import { calculateRunCoinReward, ECONOMY_CONFIG, economy } from "./economy.js?v=164";
import { purchaseManager } from "./purchases.js?v=166";
import { mergeCardCollectionSnapshot } from "./cardCollection.js?v=167";
import { storeState } from "./storeState.js?v=167";
import { getRoundDealDuration } from "./dealTiming.js?v=164";
import { MULTIPLAYER_MATCH_SECONDS, MULTIPLAYER_MODE, isMultiplayerMode } from "./multiplayerMode.js?v=169";
import {
  animateBust,
  animateSelectionResolve,
  animateTargetClear,
  playSfx,
  spawnSparkBurst
} from "./animations.js?v=173";

const RUN_MULTIPLIER_MAX = 10;
const RUN_MULTIPLIER_BASE_STEP = 0.2;
const RUN_MULTIPLIER_COMBO_STEP = 0.1;
const SHIELD_SAVE_RATE = 0.25;
const RECOVERY_RATE = 0.5;
const BONUS_BANK_RATE = 0.25;

export function createGame(ui) {
  // Runs are intentionally session-only. Remove snapshots created by older
  // releases so reopening Card Crunch always starts with a clean run.
  clearRunSave();
  let economyActionPending = false;
  let tutorialSession = null;
  const state = {
    deck: [],
    discard: [],
    stack: [],
    baseStackCount: 2,
    hand: [],
    selectedHandIndexes: [],
    gameMode: "menu",
    multiplayer: null,
    arcadePlayedCards: [],
    arcadeCardsCrunchedThisRun: 0,
    arcadePowerCardsUsedThisRun: 0,
    score: 0, // Run Money: temporary, unbanked, at risk
    bestScore: Number(localStorage.getItem("cardCrunchBestScore") ?? 0),
    streak: 0,
    misses: 0,
    maxMisses: 3,
    level: 1,
    target: getTargetForLevel(1),
    pots: loadPots(),
    activePot: null,
    replayingCompletedPot: false,
    fever: false,
    turnSeconds: 10,
    timerGraceSeconds: 1,
    timeLeft: 10,
    timerId: null,
    timerToken: 0,
    locked: true,
    status: "start",
    // Push-your-luck banking
    bankMultiplier: 1,
    bestRunMultiplier: 1,
    bestRunStreak: 0,
    bankedThisRun: 0,
    lastBankDeposit: 0,
    lostUnbankedMoney: 0,
    shieldSaved: 0,
    recoveredAmount: 0,
    runGrossCash: 0,
    coinsEarnedThisRun: 0,
    coinRewardGranted: 0,
    crunchMilestoneCoinsEarned: 0,
    safeBankShieldActive: false,
    // Rewarded ad locks (one use per run / per deposit)
    reviveAdUsedThisRun: false,
    recoveryAdUsedThisRun: false,
    bonusBankAdUsedForLastDeposit: true,
    hintAdUsedThisRun: false,
    rewardAdInProgress: false,
    runStartedAt: 0,
    isTutorial: false,
    tutorialBankStep: false,
    tutorialExpectedIndexes: [],
    tutorialGuideStackByStep: [],
    dealHandCount: 0,
    dealTableCount: 0
  };

  function showMap() {
    stopTimer();
    ui.hidePotInfo({ immediate: true });
    ui.hideBonusBankOffer();
    ui.clearMessage();
    state.locked = true;
    state.status = "menu";
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
    ui.showStart(true);
    ui.showGameOver(false);
    ui.showMap(false);
  }

  function enterLevel(levelId) {
    const pot = state.pots.find((item) => item.id === levelId);
    if (!pot || !isPotUnlocked(state.pots, levelId)) return;
    clearRunSave();
    requestNewRun(pot);
  }

  function requestNewRun(pot = null, gameMode = pot ? "pot" : "endless", multiplayer = null) {
    start(pot, { gameMode, multiplayer });
    return true;
  }

  function start(pot = state.pots.find((item) => !item.complete) ?? state.pots[0], { gameMode = pot ? "pot" : "endless", multiplayer = null } = {}) {
    stopTimer();
    ui.hidePotInfo({ immediate: true });
    ui.hideBonusBankOffer();
    tutorialSession?.hooks?.onExit?.();
    tutorialSession = null;
    state.isTutorial = false;
    state.gameMode = gameMode;
    state.multiplayer = gameMode === MULTIPLAYER_MODE ? createMultiplayerState(multiplayer) : null;
    state.activePot = pot ?? null;
    state.tutorialBankStep = false;
    state.tutorialExpectedIndexes = [];
    state.tutorialGuideStackByStep = [];
    state.deck = shuffle(createDeck());
    state.discard = [];
    state.stack = drawCards(state, state.baseStackCount);
    state.hand = drawCards(state, 4);
    if (gameMode !== ARCADE_MODE) ensurePlayableRound(state);
    state.selectedHandIndexes = [];
    state.arcadePlayedCards = [];
    state.arcadeCardsCrunchedThisRun = 0;
    state.arcadePowerCardsUsedThisRun = 0;
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.maxMisses = gameMode === MULTIPLAYER_MODE
      ? 3
      : gameMode === ARCADE_MODE
      ? ARCADE_CONFIG.maxLives
      : Math.max(1, Number(pot?.gameplayModifier?.maxLives ?? 3));
    state.level = pot?.id ?? 0;
    state.replayingCompletedPot = Boolean(pot?.complete);
    state.target = pot?.target ?? getTargetForLevel(1);
    state.turnSeconds = gameMode === MULTIPLAYER_MODE
      ? MULTIPLAYER_MATCH_SECONDS
      : gameMode === ARCADE_MODE
      ? ARCADE_CONFIG.turnSeconds
      : Math.max(3, Number(pot?.gameplayModifier?.turnSeconds ?? 10));
    state.fever = false;
    state.bankMultiplier = getStartingRunMultiplier(state);
    state.bestRunMultiplier = state.bankMultiplier;
    state.bestRunStreak = 0;
    state.bankedThisRun = 0;
    state.lastBankDeposit = 0;
    state.lostUnbankedMoney = 0;
    state.shieldSaved = 0;
    state.recoveredAmount = 0;
    state.runGrossCash = 0;
    state.coinsEarnedThisRun = 0;
    state.coinRewardGranted = 0;
    state.crunchMilestoneCoinsEarned = 0;
    state.reviveAdUsedThisRun = false;
    state.recoveryAdUsedThisRun = false;
    state.bonusBankAdUsedForLastDeposit = true;
    state.hintAdUsedThisRun = false;
    state.rewardAdInProgress = false;
    state.safeBankShieldActive = Boolean(pot) && !state.replayingCompletedPot && hasShieldToken();
    state.runStartedAt = Date.now();
    state.timeLeft = state.turnSeconds;
    state.dealHandCount = 4;
    state.dealTableCount = state.baseStackCount;
    state.locked = true;
    state.status = "playing";
    ui.showStart(false);
    ui.showMap(false);
    ui.showGameOver(false);
    ui.clearMessage();
    if (state.safeBankShieldActive) ui.setMessage("Shield armed: busting out auto-banks 25%", "good");
    ui.render(state, handlers);
    finishHandDeal(4, { announceReady: Boolean(pot) });
  }

  function startEndless() {
    startEndlessArcade();
  }

  function startEndlessArcade() {
    clearRunSave();
    requestNewRun(null, ARCADE_MODE);
  }

  function startMultiplayerMatch(multiplayer) {
    clearRunSave();
    requestNewRun(null, MULTIPLAYER_MODE, multiplayer);
  }

  function startTutorial(lessons, hooks = {}) {
    if (!Array.isArray(lessons) || lessons.length === 0) return;
    stopTimer();
    ui.hideBonusBankOffer();
    ui.clearMessage();
    tutorialSession?.hooks?.onExit?.();
    tutorialSession = { lessons, hooks, index: 0 };

    state.deck = [];
    state.discard = [];
    state.selectedHandIndexes = [];
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.maxMisses = 3;
    state.turnSeconds = 10;
    state.level = 0;
    state.target = 0;
    state.activePot = null;
    state.replayingCompletedPot = false;
    state.fever = false;
    state.bankMultiplier = 1;
    state.bestRunMultiplier = 1;
    state.bestRunStreak = 0;
    state.bankedThisRun = 0;
    state.runGrossCash = 0;
    state.hintAdUsedThisRun = false;
    state.safeBankShieldActive = false;
    state.timeLeft = state.turnSeconds;
    state.isTutorial = true;
    state.gameMode = "tutorial";
    state.arcadePlayedCards = [];
    state.locked = false;
    state.status = "playing";

    ui.showStart(false);
    ui.showMap(false);
    ui.showGameOver(false);
    loadTutorialLesson();
  }

  function loadTutorialLesson() {
    const lesson = tutorialSession?.lessons?.[tutorialSession.index];
    if (!lesson) {
      void completeTutorial();
      return;
    }

    state.stack = [...lesson.table];
    state.hand = [...lesson.hand];
    state.selectedHandIndexes = [];
    state.tutorialExpectedIndexes = [...(lesson.expected ?? [])];
    state.tutorialGuideStackByStep = (lesson.guideStackByStep ?? []).map((indexes) => [...indexes]);
    state.tutorialBankStep = lesson.type === "bank";
    state.timeLeft = state.turnSeconds;
    state.locked = false;
    state.status = "playing";
    ui.clearMessage();
    ui.render(state, handlers);
    tutorialSession.hooks?.onLesson?.({
      lesson,
      index: tutorialSession.index,
      total: tutorialSession.lessons.length,
      score: state.score,
      multiplier: state.bankMultiplier
    });
  }

  async function advanceTutorialLesson() {
    await sleep(520);
    if (!tutorialSession || !state.isTutorial) return;
    tutorialSession.index += 1;
    loadTutorialLesson();
  }

  async function completeTutorial() {
    if (!tutorialSession || !state.isTutorial) return;
    state.locked = true;
    state.status = "tutorialComplete";
    state.tutorialBankStep = false;
    state.tutorialExpectedIndexes = [];
    state.tutorialGuideStackByStep = [];
    ui.render(state, handlers);
    tutorialSession.hooks?.onComplete?.();
    playSfx("target_clear");
    await sleep(1800);
    exitTutorial();
  }

  function exitTutorial() {
    if (!state.isTutorial && !tutorialSession) return;
    stopTimer();
    ui.hideBonusBankOffer();
    ui.clearMessage();
    const hooks = tutorialSession?.hooks;
    tutorialSession = null;
    state.isTutorial = false;
    state.tutorialBankStep = false;
    state.tutorialExpectedIndexes = [];
    state.tutorialGuideStackByStep = [];
    state.selectedHandIndexes = [];
    state.locked = true;
    state.status = "menu";
    hooks?.onExit?.();
    ui.render(state, handlers);
    showMap();
    ui.showMenuPage("home");
  }

  function onCardSelect(handIndex) {
    if (state.locked || state.status !== "playing" || state.tutorialBankStep) return;
    if (isArcadeMode(state)) {
      playArcadeCard(handIndex);
      return;
    }
    ui.hideBonusBankOffer();
    playSfx(state.selectedHandIndexes.includes(handIndex) ? "card_deselect" : "card_select");
    if (state.selectedHandIndexes.includes(handIndex)) {
      state.selectedHandIndexes = state.selectedHandIndexes.filter((index) => index !== handIndex);
    } else {
      const maxSelection = getMaximumSelection(state);
      if (state.selectedHandIndexes.length >= maxSelection) {
        ui.setMessage(`This Pot allows ${maxSelection} card${maxSelection === 1 ? "" : "s"} per Crunch`, "bad", 1200);
        return;
      }
      state.selectedHandIndexes.push(handIndex);
    }
    ui.render(state, handlers);
  }

  function playArcadeCard(handIndex) {
    const card = state.hand[handIndex];
    if (!card) return;
    const cardElement = ui.getHandCardElement(handIndex);
    const cardRect = cardElement?.getBoundingClientRect?.();
    ui.hideBonusBankOffer();
    playSfx("card_select");

    state.hand[handIndex] = drawArcadeCard(state, { fromRight: true });
    if (isPowerCard(card)) state.arcadePowerCardsUsedThisRun += 1;

    if (card.powerType === POWER_CARD_TYPES.TIME) {
      stopTimer();
      state.timeLeft = Math.min(ARCADE_CONFIG.maxTimeSeconds, state.timeLeft + ARCADE_CONFIG.timeCardSeconds);
      playSfx("timer_warning");
      ui.setMessage(`TIME CARD +${ARCADE_CONFIG.timeCardSeconds}s`, "good", 1100);
      if (cardRect) {
        spawnSparkBurst(cardRect.left + cardRect.width / 2, cardRect.top + cardRect.height / 2, 16, "fever");
      }
      ui.render(state, handlers);
      startTimer();
      return;
    }

    state.arcadePlayedCards.push(card);
    ui.render(state, handlers);
  }

  async function onCrunch() {
    const arcadeRun = isArcadeMode(state);
    const multiplayerRun = isMultiplayerMode(state);
    const selectedCount = arcadeRun ? state.arcadePlayedCards.length : state.selectedHandIndexes.length;
    const preview = getCrunchPreview(state);
    if (state.locked || state.status !== "playing" || !preview.canCrunch || selectedCount === 0) return;
    state.locked = true;
    state.status = "crunching";
    if (!multiplayerRun) stopTimer();
    ui.hideBonusBankOffer();
    ui.clearMessage();
    resetCrunchSkipRequest();
    ui.render(state, handlers);

    const selectedCards = arcadeRun
      ? [...state.arcadePlayedCards]
      : state.selectedHandIndexes.map((index) => state.hand[index]);
    const selectedCardElements = arcadeRun
      ? ui.getArcadePlayedCardElements()
      : state.selectedHandIndexes.map((index) => ui.getHandCardElement(index));
    const crunch = calculateCrunchScore({
      baseStack: state.stack,
      selectedCards,
      timeLeft: state.timeLeft,
      streak: state.streak,
      runMultiplier: state.bankMultiplier,
      gameplayModifier: state.activePot?.gameplayModifier,
      resolutionOverride: arcadeRun ? resolveArcadeCrunch(state.stack, selectedCards) : null,
      selectionMultiplierOverride: arcadeRun ? getArcadeStackMultiplier(selectedCards.length) : null,
      selectionLabel: arcadeRun ? "ARCADE STACK" : "HAND",
      enableFullHand: !arcadeRun
    });
    const retainedTableCards = crunch.success
      ? getUncrunchedTableCards(crunch.resolution)
      : [];

    if (multiplayerRun) {
      const previewPoints = crunch.success ? crunch.total : crunch.partial?.success ? crunch.partial.total : 0;
      if (previewPoints > 0) state.multiplayer?.callbacks?.onScorePreview?.(state.score + previewPoints);
    }

    playSfx("crunch_start");

    if (state.isTutorial && !isTutorialSelectionCorrect()) {
      await rejectTutorialSelection(crunch);
      return;
    }

    if (!crunch.success) {
      const partial = crunch.partial?.success ? crunch.partial : null;
      const partialBank = partial ? createActiveCrunchBankCounter() : null;
      try {
        await animateSelectionResolve({
          selectedHandCards: selectedCardElements,
          baseStackCards: ui.getAllStackCardElements(),
          resolution: crunch.resolution,
          fail: true,
          presentationEntries: partial?.cutscene.entries ?? null,
          onEntryResolved: async (entry, _index, transition) => {
            await playCrunchEntryExplanation({
              entry: partial ? entry : createCutsceneEntry(entry),
              tier: partial?.cutscene.tier ?? "normal",
              bank: partialBank,
              sourceCards: transition?.sourceCards
            });
          }
        });
        if (partialBank) {
          await playCrunchTotalExplanation({
            total: partial.cutscene.total,
            scoreEl: ui.elements.scoreValue,
            tier: partial.cutscene.tier,
            bank: partialBank
          });
        }
      } catch (error) {
        partialBank?.remove();
        throw error;
      }

      if (partial) {
        const validCardCount = crunch.resolution.history.length;
        state.score += partial.total;
        state.runGrossCash += partial.total;
        if (arcadeRun) state.arcadeCardsCrunchedThisRun += validCardCount;
        recordCrunchedCards(validCardCount);
        state.bestScore = Math.max(state.bestScore, state.score);
        localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
        ui.syncResolvedHud(state);
        state.multiplayer?.callbacks?.onScoreChange?.(state.score);
      }
      await playBustCutin({
        failedCard: crunch.resolution.failedCard,
        activeStack: crunch.resolution.activeStack
      });
      await bust("BUST!", crunch.resolution.failedIndex, selectedCardElements);
      return;
    }

    const crunchBank = createActiveCrunchBankCounter();
    try {
      await animateSelectionResolve({
        selectedHandCards: selectedCardElements,
        baseStackCards: ui.getAllStackCardElements(),
        resolution: crunch.resolution,
        fail: false,
        presentationEntries: crunch.cutscene.entries,
        fullHand: crunch.cutscene.fullHand,
        fullHandCards: selectedCards,
        onFullHandResolved: async (transition) => {
          await playFullHandPrelude({
            cards: selectedCards,
            fullHand: crunch.cutscene.fullHand,
            sourceCards: transition?.sourceCards,
            bank: crunchBank
          });
        },
        onEntryResolved: async (entry, _index, transition) => {
          await playCrunchEntryExplanation({
            entry,
            tier: crunch.cutscene.tier,
            bank: crunchBank,
            sourceCards: transition?.sourceCards
          });
        }
      });

      await playCrunchTotalExplanation({
        total: crunch.cutscene.total,
        scoreEl: ui.elements.scoreValue,
        tier: crunch.cutscene.tier,
        bank: crunchBank
      });
      ui.setMessage(`+${formatCompactNumber(crunch.total)} Crunch`, "good");
    } catch (error) {
      crunchBank.remove();
      throw error;
    }

    // Money stays as unbanked Run Money - the pot only fills when banking.
    state.score += crunch.total;
    state.runGrossCash += crunch.total;
    state.streak = crunch.streakAfterCrunch;
    state.bestRunStreak = Math.max(state.bestRunStreak, state.streak);
    const enteringFever = !state.fever && state.streak >= 15;
    state.fever = state.streak >= 15;
    if (enteringFever) playSfx("fever_start");
    raiseBankMultiplier(selectedCards.length);
    if (arcadeRun) state.arcadeCardsCrunchedThisRun += selectedCards.length;
    ui.syncResolvedHud(state);
    discardSelectedCards();

    if (state.isTutorial) {
      await advanceTutorialLesson();
      return;
    }

    recordCrunchedCards(selectedCards.length);
    state.bestScore = Math.max(state.bestScore, state.score);
    state.multiplayer?.callbacks?.onScoreChange?.(state.score);
    localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
    localStorage.setItem("cardCrunchBestStreak", String(Math.max(Number(localStorage.getItem("cardCrunchBestStreak") ?? 0), state.streak)));
    if (completeMultiplayerIfPending()) return;
    startNewRound({ retainedTableCards });
  }

  function createActiveCrunchBankCounter() {
    return createCrunchBankCounter({
      panelEl: ui.elements.scorePanel,
      labelEl: ui.elements.scoreLabel,
      valueEl: ui.elements.scoreValue,
      startingValue: state.score,
      coinRewards: {
        cashMilestone: ECONOMY_CONFIG.crunchCashMilestone,
        coinsPerMilestone: ECONOMY_CONFIG.coinsPerCrunchMilestone,
        getBalance: () => economy.getSnapshot().coins,
        award: awardCrunchMilestoneCoins
      }
    });
  }

  function recordCrunchedCards(count) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    if (!safeCount) return;
    localStorage.setItem(
      "cardCrunchTotalCrunches",
      String(Number(localStorage.getItem("cardCrunchTotalCrunches") ?? 0) + safeCount)
    );
  }

  function isTutorialSelectionCorrect() {
    const expected = state.tutorialExpectedIndexes ?? [];
    return state.selectedHandIndexes.length === expected.length
      && state.selectedHandIndexes.every((index, position) => index === expected[position]);
  }

  async function rejectTutorialSelection(crunch) {
    if (crunch.success) {
      state.locked = false;
      state.status = "playing";
      ui.setMessage("Follow the lesson order shown above", "bad", 2200);
      ui.render(state, handlers);
      return;
    }

    await animateSelectionResolve({
      selectedHandCards: state.selectedHandIndexes.map((index) => ui.getHandCardElement(index)),
      baseStackCards: ui.getAllStackCardElements(),
      resolution: crunch.resolution,
      fail: true,
      retainConsumedSources: false,
      onEntryResolved: async (entry, _index, transition) => {
        await playCrunchEntryExplanation({
          entry: createCutsceneEntry(entry),
          tier: "normal",
          sourceCards: transition?.sourceCards
        });
      }
    });
    await playBustCutin({
      failedCard: crunch.resolution.failedCard,
      activeStack: crunch.resolution.activeStack
    });
    state.selectedHandIndexes = [];
    state.locked = false;
    state.status = "playing";
    ui.setMessage("Try again - follow the lesson above", "bad", 2200);
    ui.render(state, handlers);
  }

  function raiseBankMultiplier(selectedCount) {
    const modifier = state.activePot?.gameplayModifier;
    const step = RUN_MULTIPLIER_BASE_STEP
      + RUN_MULTIPLIER_COMBO_STEP * Math.max(0, selectedCount - 1)
      + Math.max(0, Number(modifier?.multiplierStepBonus ?? 0));
    const maximum = Math.max(1, Number(modifier?.multiplierMax ?? RUN_MULTIPLIER_MAX));
    state.bankMultiplier = Math.min(maximum, Math.round((state.bankMultiplier + step) * 10) / 10);
    state.bestRunMultiplier = Math.max(state.bestRunMultiplier, state.bankMultiplier);
  }

  async function bankRun() {
    if (state.isTutorial) {
      await bankTutorialCash();
      return;
    }
    const minimumBankStreak = Number(state.activePot?.gameplayModifier?.minBankStreak ?? 0);
    const minimumBankCash = Number(state.activePot?.gameplayModifier?.minimumBankCash ?? 0);
    if (state.locked || state.status !== "playing" || !state.activePot || state.score <= 0 || state.streak < minimumBankStreak || state.score < minimumBankCash) return;
    state.locked = true;
    stopTimer();
    ui.hideBonusBankOffer();

    const amount = state.score;
    depositToPot(amount);
    state.bankedThisRun += amount;
    state.lastBankDeposit = amount;
    state.bonusBankAdUsedForLastDeposit = false;
    state.score = 0;
    state.bankMultiplier = getStartingRunMultiplier(state);

    playSfx("bank");
    ui.setMessage(`BANKED $${formatCompactNumber(amount)}! Multi reset to x${formatRunMultiplier(state.bankMultiplier)}`, "good");
    ui.playBankJuice(amount);
    ui.render(state, handlers);
    await sleep(620);

    if (state.activePot.complete && !state.replayingCompletedPot) {
      await clearTarget();
      return;
    }

    state.locked = false;
    state.status = "playing";
    ui.render(state, handlers);
    startTimer();
    if (!state.replayingCompletedPot) offerBonusBankAd(amount);
  }

  async function bankTutorialCash() {
    if (state.locked || state.status !== "playing" || !state.tutorialBankStep || state.score <= 0) return;
    state.locked = true;
    const amount = state.score;
    state.score = 0;
    state.bankMultiplier = 1;
    playSfx("bank");
    ui.setMessage(`BANKED $${formatCompactNumber(amount)}! Multi reset to x1`, "good", 0);
    ui.playBankJuice(amount);
    ui.render(state, handlers);
    await sleep(720);
    await completeTutorial();
  }

  function offerBonusBankAd(depositAmount) {
    if (state.bonusBankAdUsedForLastDeposit) return;
    if (!adManager.canShowRewardedAd()) return;
    const remaining = Math.max(0, (state.activePot?.target ?? 0) - (state.activePot?.progress ?? 0));
    const bonus = Math.min(Math.round(depositAmount * BONUS_BANK_RATE), remaining);
    if (bonus <= 0) return;
    const completesPot = bonus >= remaining;

    ui.showBonusBankOffer(bonus, async () => {
      ui.hideBonusBankOffer();
      // Guard against stale offers: only the most recent deposit qualifies.
      if (state.rewardAdInProgress || state.bonusBankAdUsedForLastDeposit || state.status !== "playing" || state.locked) return;
      const currentRemaining = Math.max(0, (state.activePot?.target ?? 0) - (state.activePot?.progress ?? 0));
      const eligibleBonus = Math.min(Math.round(state.lastBankDeposit * BONUS_BANK_RATE), currentRemaining);
      if (eligibleBonus !== bonus) return;
      state.rewardAdInProgress = true;
      state.bonusBankAdUsedForLastDeposit = true;
      state.locked = true;
      stopTimer();
      ui.render(state, handlers);

      const earned = await adManager.showRewardedAd("bonusBank");
      state.rewardAdInProgress = false;
      if (earned) {
        const deposited = depositToPot(bonus);
        state.bankedThisRun += deposited;
        playSfx("bank");
        ui.setMessage(`+$${formatCompactNumber(deposited)} bank bonus!`, "good");
        ui.playBankJuice(deposited);
        if (state.activePot?.complete) {
          await clearTarget();
          return;
        }
      }
      state.locked = false;
      state.status = "playing";
      ui.render(state, handlers);
      startTimer();
    }, { completesPot });
  }

  async function onHintAd() {
    if (state.isTutorial && !state.locked && state.status === "playing") {
      const nextIndex = state.tutorialExpectedIndexes.find((index) => !state.selectedHandIndexes.includes(index));
      if (Number.isInteger(nextIndex)) {
        ui.setMessage("This is the next card", "good");
        ui.flashHint(nextIndex);
      } else if (state.tutorialBankStep) {
        ui.setMessage("Tap BANK to protect your practice cash", "good");
      }
      return;
    }
    if (state.locked || state.status !== "playing" || state.hintAdUsedThisRun || state.rewardAdInProgress) return;
    if (!adManager.canShowRewardedAd()) return;
    state.rewardAdInProgress = true;
    state.hintAdUsedThisRun = true;
    state.locked = true;
    stopTimer();
    ui.render(state, handlers);

    const earned = await adManager.showRewardedAd("hint");
    state.rewardAdInProgress = false;
    state.locked = false;
    state.status = "playing";
    // Render (and rebuild the hand) BEFORE flashing the hint, otherwise the
    // unlock re-render replaces the card element and wipes the glow.
    ui.render(state, handlers);
    startTimer();
    if (earned) {
      const hintIndex = state.hand.findIndex((card) => card && evaluateStackAdd(state.stack, card, state.activePot?.gameplayModifier).valid);
      if (hintIndex >= 0) {
        ui.setMessage("This card crunches!", "good");
        ui.flashHint(hintIndex);
      } else {
        ui.setMessage("No single-card crunch right now", "bad");
      }
    }
  }

  async function handleTimeout() {
    if (state.locked || state.status !== "playing") return;
    await bust("TIME BUST!");
  }

  async function bust(message, failedSelectionIndex = -1, resolvedCardElements = null) {
    const multiplayerRun = isMultiplayerMode(state);
    state.locked = true;
    state.status = "busted";
    if (!multiplayerRun) stopTimer();
    ui.hideBonusBankOffer();
    if (state.fever) playSfx("fever_end");
    playSfx("bust");
    state.misses += 1;
    state.streak = 0;
    state.fever = false;
    if (isArcadeMode(state) || multiplayerRun) state.bankMultiplier = 1;
    ui.setMessage(message, "bad");
    ui.render(state, handlers);
    await animateBust({
      boardEl: ui.elements.shell,
      stackCards: ui.getAllStackCardElements(),
      handCard: failedSelectionIndex >= 0
        ? resolvedCardElements?.[failedSelectionIndex] ?? ui.getHandCardElement(state.selectedHandIndexes[failedSelectionIndex])
        : null,
      protectedBust: false
    });
    discardSelectedCards();
    if (!multiplayerRun && state.misses >= state.maxMisses) {
      refillHand();
      endRun();
      return;
    }
    if (completeMultiplayerIfPending()) return;
    startNewRound();
  }

  async function clearTarget() {
    stopTimer();
    ui.hideBonusBankOffer();
    state.locked = true;
    state.status = "levelClear";
    ui.render(state, handlers);
    ui.setMessage("Pot Filled!", "good");
    playSfx("level_clear");
    await animateTargetClear(ui.elements.shell);
    finishClearedRun();
  }

  function finishClearedRun() {
    stopTimer();
    ui.clearMessage();
    state.locked = true;
    state.status = "runEnded";
    state.score = 0;
    state.lostUnbankedMoney = 0;
    clearRunSave();
    submitBestScore(state.bestScore);
    grantRunCoins({ potCleared: true });
    ui.render(state, handlers);
    showRunSummary();
  }

  /* Out of lives: unbanked Run Money is now at risk. The shield (if armed)
     fires immediately; the rest waits on the summary screen where the
     player may revive or recover via rewarded ads. */
  function endRun() {
    stopTimer();
    ui.hideBonusBankOffer();
    ui.clearMessage();
    state.locked = true;
    state.status = "runEnded";
    clearRunSave();
    playSfx("game_over");
    submitBestScore(state.bestScore);

    if (state.safeBankShieldActive && state.activePot && state.score > 0) {
      const saved = Math.round(state.score * SHIELD_SAVE_RATE);
      if (saved > 0) {
        depositToPot(saved);
        state.shieldSaved += saved;
        state.bankedThisRun += saved;
        state.score -= saved;
      }
      state.safeBankShieldActive = false;
      consumeShieldToken();
    }

    state.lostUnbankedMoney = isArcadeMode(state) ? 0 : state.score;
    grantRunCoins({ potCleared: Boolean(state.activePot?.complete && !state.replayingCompletedPot) });
    ui.render(state, handlers);
    showRunSummary();
  }

  function grantRunCoins({ potCleared = false } = {}) {
    const reward = calculateRunCoinReward({
      grossCash: state.runGrossCash,
      bestStreak: state.bestRunStreak,
      potCleared
    });
    const delta = Math.max(0, reward.total - state.coinRewardGranted);
    if (delta > 0) economy.addCoins(delta);
    state.coinRewardGranted += delta;
    state.coinsEarnedThisRun = state.crunchMilestoneCoinsEarned + state.coinRewardGranted;
    ui.renderMenuStats(state);
    return reward;
  }

  function awardCrunchMilestoneCoins(amount) {
    const awarded = economy.addCoins(amount);
    if (awarded <= 0) return economy.getSnapshot().coins;
    state.crunchMilestoneCoinsEarned += awarded;
    state.coinsEarnedThisRun = state.crunchMilestoneCoinsEarned + state.coinRewardGranted;
    ui.renderMenuStats(state);
    return economy.getSnapshot().coins;
  }

  function showRunSummary() {
    ui.showRunSummary({
      mode: state.gameMode,
      finalScore: state.score,
      cardsCrunched: state.arcadeCardsCrunchedThisRun,
      powerCardsUsed: state.arcadePowerCardsUsedThisRun,
      banked: state.bankedThisRun,
      lost: state.lostUnbankedMoney,
      shieldSaved: state.shieldSaved,
      recovered: state.recoveredAmount,
      bestMultiplier: state.bestRunMultiplier,
      bestStreak: state.bestRunStreak,
      coinsEarned: state.coinsEarnedThisRun,
      pot: state.activePot,
      potReplay: state.replayingCompletedPot,
      canRevive:
        !isArcadeMode(state) &&
        !state.reviveAdUsedThisRun &&
        (!state.activePot?.complete || state.replayingCompletedPot) &&
        !state.rewardAdInProgress &&
        adManager.canShowRewardedAd(),
      canRecover:
        state.lostUnbankedMoney > 0 &&
        !state.recoveryAdUsedThisRun &&
        Boolean(state.activePot) &&
        !state.activePot?.complete &&
        !state.rewardAdInProgress &&
        adManager.canShowRewardedAd()
    });
  }

  async function onReviveAd() {
    if (state.status !== "runEnded" || state.reviveAdUsedThisRun || state.rewardAdInProgress || (state.activePot?.complete && !state.replayingCompletedPot)) return;
    state.rewardAdInProgress = true;
    state.reviveAdUsedThisRun = true;
    showRunSummary();
    const earned = await adManager.showRewardedAd("revive");
    state.rewardAdInProgress = false;
    if (!earned) {
      showRunSummary();
      return;
    }
    // Resume the same run: 1 life, Run Money and multiplier intact.
    state.misses = state.maxMisses - 1;
    state.lostUnbankedMoney = 0;
    ui.showGameOver(false);
    ui.playReviveJuice();
    playSfx("revive");
    startNewRound();
    ui.setMessage("REVIVED! 1 life left - bank it or risk it", "good");
  }

  async function onRecoverAd() {
    if (state.status !== "runEnded" || state.recoveryAdUsedThisRun || state.rewardAdInProgress || state.lostUnbankedMoney <= 0 || !state.activePot || state.activePot.complete) return;
    state.rewardAdInProgress = true;
    state.recoveryAdUsedThisRun = true;
    showRunSummary();
    const earned = await adManager.showRewardedAd("recoverLost");
    state.rewardAdInProgress = false;
    if (!earned) {
      showRunSummary();
      return;
    }
    const recovered = Math.round(state.lostUnbankedMoney * RECOVERY_RATE);
    depositToPot(recovered);
    state.recoveredAmount += recovered;
    state.lostUnbankedMoney = Math.max(0, state.lostUnbankedMoney - recovered);
    state.score = 0;
    playSfx("bank");
    savePots(state.pots);
    if (state.activePot.complete) grantRunCoins({ potCleared: true });
    showRunSummary();
  }

  /* The loss becomes final when the player leaves the summary screen. */
  function finalizeRunLoss() {
    if (state.status !== "runEnded") return;
    const runDurationMs = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
    const justUnlockedPot = Boolean(state.activePot?.complete);
    state.score = 0;
    state.lostUnbankedMoney = 0;
    state.bankMultiplier = 1;
    adManager.registerCompletedRun({ durationMs: runDurationMs });
    adManager.maybeShowInterstitial({ runDurationMs, justUnlockedPot });
  }

  function playAgain() {
    if (state.status !== "runEnded" && state.status !== "menu") return;
    const replayArcade = isArcadeMode(state);
    finalizeRunLoss();
    if (replayArcade) {
      startEndlessArcade();
      return;
    }
    const pot = state.replayingCompletedPot
      ? state.activePot
      : state.activePot && !state.activePot.complete
        ? state.activePot
        : state.pots.find((item) => !item.complete);
    if (!pot || !isPotUnlocked(state.pots, pot.id)) {
      returnToMap();
      return;
    }
    requestNewRun(pot);
  }

  function returnToMap() {
    if (state.isTutorial) {
      exitTutorial();
      return;
    }
    const returnHome = isArcadeMode(state);
    finalizeRunLoss();
    stopTimer();
    ui.hideBonusBankOffer();
    ui.clearMessage();
    clearRunSave();
    resetRunSession();
    ui.render(state, handlers);
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
    ui.showGameOver(false);
    ui.showStart(true);
    ui.showMap(false);
    if (returnHome) ui.showMenuPage("home");
  }

  async function onCoinAd() {
    if (economyActionPending || !economy.canClaimCoinAd() || !adManager.canShowRewardedAd()) return;
    economyActionPending = true;
    ui.setStoreStatus("Loading coin drop...", "neutral");
    const earned = await adManager.showRewardedAd("coinDrop");
    economyActionPending = false;
    if (!earned) {
      ui.setStoreStatus("Coin reward was not claimed.", "bad");
      refreshEconomy();
      return;
    }
    const amount = economy.claimCoinAd();
    playSfx("score_arrive");
    ui.setStoreStatus(`+${formatCompactNumber(amount)} coins added.`, "good");
    refreshEconomy();
  }

  function buyShieldWithCoins() {
    if (economyActionPending || hasShieldToken()) return;
    if (!economy.spendCoins(ECONOMY_CONFIG.shieldCoinCost)) {
      ui.setStoreStatus(`You need ${ECONOMY_CONFIG.shieldCoinCost} coins.`, "bad");
      return;
    }
    grantShieldToken();
    playSfx("bank");
    ui.setStoreStatus("Safe Bank Shield armed for your next Pot run.", "good");
    refreshEconomy();
  }

  async function buyCoinPack() {
    if (economyActionPending) return;
    economyActionPending = true;
    ui.setStoreStatus("Opening Google Play purchase...", "neutral");
    const result = await purchaseManager.buy(ECONOMY_CONFIG.coinPackProductId);
    economyActionPending = false;
    if (!result.success) {
      ui.setStoreStatus("Coin Vault activates in the signed Android Google Play build.", "neutral");
      return;
    }
    economy.addCoins(ECONOMY_CONFIG.coinPackAmount);
    playSfx("score_arrive");
    ui.setStoreStatus(`+${formatCompactNumber(ECONOMY_CONFIG.coinPackAmount)} coins purchased.`, "good");
    refreshEconomy();
  }

  function refreshEconomy() {
    ui.renderMenuStats(state);
  }

  function applyCloudProgress(gameEntry = {}) {
    const stats = gameEntry.stats && typeof gameEntry.stats === "object" ? gameEntry.stats : {};
    state.bestScore = Math.max(state.bestScore, Math.floor(Number(stats.bestScore) || 0));
    state.bestRunStreak = Math.max(state.bestRunStreak, Math.floor(Number(stats.bestStreak) || 0));
    localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
    localStorage.setItem("cardCrunchBestStreak", String(Math.max(
      Number(localStorage.getItem("cardCrunchBestStreak")) || 0,
      Number(stats.bestStreak) || 0
    )));
    localStorage.setItem("cardCrunchTotalCrunches", String(Math.max(
      Number(localStorage.getItem("cardCrunchTotalCrunches")) || 0,
      Number(stats.totalCrunches) || 0
    )));

    const remotePots = Array.isArray(gameEntry.progress?.pots) ? gameEntry.progress.pots : [];
    for (const remote of remotePots) {
      const local = state.pots.find((pot) => pot.id === Number(remote?.id));
      if (!local) continue;
      local.progress = Math.min(local.target, Math.max(local.progress, Number(remote.progress) || 0));
      local.complete = local.complete || remote.complete === true || local.progress >= local.target;
    }
    savePots(state.pots);

    const localCoins = economy.getSnapshot().coins;
    const remoteCoins = Math.max(0, Math.floor(Number(stats.coins) || 0));
    if (remoteCoins > localCoins) economy.addCoins(remoteCoins - localCoins);
    mergeCardCollectionSnapshot(gameEntry.progress?.cardCollection);
    storeState.mergeRemoteSnapshot(gameEntry.progress?.store);
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
  }

  /* Leaving a run forfeits all temporary progress. Banked pot progress and
     other permanent save data are untouched. */
  function exitRun() {
    if (state.isTutorial) {
      exitTutorial();
      return;
    }
    if (state.status !== "playing") return;
    if (isMultiplayerMode(state)) {
      state.locked = true;
      state.status = "multiplayerEnded";
      ui.render(state, handlers);
      state.multiplayer?.callbacks?.onForfeit?.();
      return;
    }
    const returnHome = isArcadeMode(state);
    stopTimer();
    ui.hidePotInfo({ immediate: true });
    ui.hideBonusBankOffer();
    ui.clearMessage();
    clearRunSave();
    resetRunSession();
    ui.render(state, handlers);
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
    ui.showStart(true);
    ui.showMenuPage(returnHome ? "home" : "pots");
    ui.showMap(false);
  }

  function startNewRound({ retainedTableCards = [] } = {}) {
    const multiplayerRun = isMultiplayerMode(state);
    if (!multiplayerRun) stopTimer();
    ui.clearMessage();
    if (isArcadeMode(state)) {
      const tableDealCount = dealNextTable(retainedTableCards);
      state.arcadePlayedCards = [];
      state.selectedHandIndexes = [];
      state.timeLeft = state.turnSeconds;
      state.status = "playing";
      state.dealHandCount = 0;
      state.dealTableCount = tableDealCount;
      state.locked = true;
      ui.beginRoundHandoff(state);
      ui.render(state, handlers);
      finishHandDeal(0, { tableDealCount, announceReady: true });
      return;
    }
    const hasReplacementSlots = state.hand.some((card) => !card);
    const replacementCount = state.hand.filter((card) => !card).length;
    const tableDealCount = dealNextTable(retainedTableCards);
    refillHand({ allowOccupiedSafety: !hasReplacementSlots });
    state.selectedHandIndexes = [];
    if (!multiplayerRun) state.timeLeft = state.turnSeconds;
    state.status = "playing";
    state.dealHandCount = replacementCount;
    state.dealTableCount = tableDealCount;
    state.locked = true;
    ui.beginRoundHandoff(state);
    ui.render(state, handlers);
    finishHandDeal(replacementCount, { tableDealCount, announceReady: true });
  }

  function updateMultiplayerClock(seconds) {
    if (!isMultiplayerMode(state) || !state.multiplayer) return;
    state.timeLeft = Math.max(0, Math.min(MULTIPLAYER_MATCH_SECONDS, Number(seconds) || 0));
    if (state.timeLeft <= 0) state.multiplayer.timeExpired = true;
    ui.renderMatchHud?.(state);
  }

  function updateMultiplayerOpponent(opponent = {}) {
    if (!isMultiplayerMode(state) || !state.multiplayer) return;
    state.multiplayer.opponent = {
      ...state.multiplayer.opponent,
      ...opponent,
      score: Math.max(Number(state.multiplayer.opponent?.score) || 0, Number(opponent.score) || 0)
    };
    ui.renderMatchHud?.(state);
  }

  function finishMultiplayerMatch(match = null) {
    if (!isMultiplayerMode(state) || !state.multiplayer) return true;
    state.timeLeft = 0;
    state.multiplayer.timeExpired = true;
    if (match?.opponent) updateMultiplayerOpponent(match.opponent);
    if (match?.status !== "complete") {
      if (state.status === "playing") {
        state.locked = true;
        state.status = "multiplayerWaitingResult";
        ui.setMessage("TIME! Confirming scores...", "good", 0);
        ui.render(state, handlers);
      }
      return false;
    }
    state.multiplayer.pendingResult = match;
    if (state.status === "crunching" || state.status === "busted") return false;
    state.locked = true;
    state.status = "multiplayerEnded";
    stopTimer();
    ui.clearMessage();
    ui.render(state, handlers);
    state.multiplayer.callbacks?.onResultReady?.(match);
    return true;
  }

  function completeMultiplayerIfPending() {
    if (!isMultiplayerMode(state) || !state.multiplayer?.pendingResult) return false;
    return finishMultiplayerMatch(state.multiplayer.pendingResult);
  }

  function returnFromMultiplayer() {
    if (!isMultiplayerMode(state) && state.status !== "multiplayerEnded" && state.status !== "multiplayerWaitingResult") return;
    stopTimer();
    ui.clearMessage();
    clearRunSave();
    resetRunSession();
    ui.render(state, handlers);
    ui.renderMenuStats(state);
    ui.showGameOver(false);
    ui.showStart(true);
    ui.showMenuPage("home");
    ui.showMap(false);
  }

  function finishHandDeal(replacementCount, { tableDealCount = state.baseStackCount, announceReady = false } = {}) {
    const dealToken = state.timerToken;
    const reducedMotion = document.documentElement.classList.contains("reduce-motion");
    const dealDuration = getRoundDealDuration(replacementCount, tableDealCount, reducedMotion);
    window.setTimeout(() => {
      if (dealToken !== state.timerToken || state.status !== "playing") return;
      state.dealHandCount = 0;
      state.dealTableCount = 0;
      state.locked = false;
      ui.render(state, handlers);
      ui.finishRoundHandoff();
      if (announceReady) ui.playInitialReadyPulse();
      if (!isMultiplayerMode(state)) startTimer();
    }, dealDuration);
  }

  function getUncrunchedTableCards(resolution) {
    const consumedIds = new Set(
      (resolution?.history ?? []).flatMap((entry) => (entry.matchedCards ?? []).map((card) => card?.id))
    );
    return state.stack.filter((card) => card?.id && !consumedIds.has(card.id));
  }

  function dealNextTable(retainedTableCards = []) {
    const retainedIds = new Set(retainedTableCards.map((card) => card?.id).filter(Boolean));
    const retained = state.stack
      .filter((card) => retainedIds.has(card?.id))
      .slice(0, state.baseStackCount);

    state.stack.forEach((card) => {
      if (!retainedIds.has(card?.id)) state.discard.push(card);
    });

    const freshCards = drawCards(state, Math.max(0, state.baseStackCount - retained.length));
    // Fresh cards enter from the left; an untouched table card owns the right slot.
    state.stack = [...freshCards, ...retained];
    return freshCards.length;
  }

  function startTimer({ resume = false } = {}) {
    if (isMultiplayerMode(state)) return;
    stopTimer();
    const token = state.timerToken;
    const startedAt = performance.now();
    // The hidden grace second is granted once at the start of a turn. Resuming
    // the paused rulebook must not create extra time by repeatedly reopening it.
    const totalMs = Math.max(0, state.timeLeft + (resume ? 0 : state.timerGraceSeconds)) * 1000;
    let warned = false;

    state.timerId = window.setInterval(() => {
      if (token !== state.timerToken || state.locked || state.status !== "playing") return;
      const elapsed = performance.now() - startedAt;
      const rawRemaining = Math.max(0, (totalMs - elapsed) / 1000);
      state.timeLeft = Math.max(0, rawRemaining - state.timerGraceSeconds);
      if (!warned && state.timeLeft <= 3) {
        warned = true;
        playSfx("timer_warning");
        const rect = ui.elements.timerShell.getBoundingClientRect();
        spawnSparkBurst(rect.left + rect.width * .82, rect.top + rect.height / 2, state.fever ? 18 : 10, state.fever ? "fever" : "red");
      }
      ui.render(state, handlers);
      if (rawRemaining <= 0) handleTimeout();
    }, 100);
  }

  function stopTimer() {
    state.timerToken += 1;
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function openPotInfo() {
    if (!state.activePot || state.isTutorial || isArcadeMode(state)) return;
    if (state.status !== "playing" || state.locked) return;
    stopTimer();
    state.status = "pausedInfo";
    state.locked = true;
    ui.render(state, handlers);
    ui.showPotInfo(state.activePot);
  }

  function closePotInfo() {
    if (state.status !== "pausedInfo") {
      ui.hidePotInfo();
      return;
    }
    ui.hidePotInfo();
    state.status = "playing";
    state.locked = false;
    ui.render(state, handlers);
    startTimer({ resume: true });
  }

  function resetRunSession() {
    state.deck = [];
    state.discard = [];
    state.stack = [];
    state.hand = [];
    state.selectedHandIndexes = [];
    state.gameMode = "menu";
    state.multiplayer = null;
    state.arcadePlayedCards = [];
    state.arcadeCardsCrunchedThisRun = 0;
    state.arcadePowerCardsUsedThisRun = 0;
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.level = 0;
    state.activePot = null;
    state.replayingCompletedPot = false;
    state.target = getTargetForLevel(1);
    state.fever = false;
    state.turnSeconds = 10;
    state.maxMisses = 3;
    state.timeLeft = state.turnSeconds;
    state.dealHandCount = 0;
    state.dealTableCount = 0;
    state.bankMultiplier = 1;
    state.bestRunMultiplier = 1;
    state.bestRunStreak = 0;
    state.bankedThisRun = 0;
    state.lastBankDeposit = 0;
    state.lostUnbankedMoney = 0;
    state.shieldSaved = 0;
    state.recoveredAmount = 0;
    state.runGrossCash = 0;
    state.coinsEarnedThisRun = 0;
    state.coinRewardGranted = 0;
    state.crunchMilestoneCoinsEarned = 0;
    state.safeBankShieldActive = false;
    state.reviveAdUsedThisRun = false;
    state.recoveryAdUsedThisRun = false;
    state.bonusBankAdUsedForLastDeposit = true;
    state.hintAdUsedThisRun = false;
    state.rewardAdInProgress = false;
    state.runStartedAt = 0;
    state.locked = true;
    state.status = "menu";
  }

  function discardSelectedCards() {
    if (isArcadeMode(state)) {
      state.arcadePlayedCards.forEach((card) => {
        if (card && !isPowerCard(card)) state.discard.push(card);
      });
      state.arcadePlayedCards = [];
      state.selectedHandIndexes = [];
      return;
    }
    const selected = new Set(state.selectedHandIndexes);
    const survivingCards = state.hand.filter((card, index) => {
      if (selected.has(index)) {
        if (card) state.discard.push(card);
        return false;
      }
      return Boolean(card);
    });
    const openSlots = Math.max(0, 4 - survivingCards.length);
    state.hand = [...Array(openSlots).fill(null), ...survivingCards].slice(-4);
    state.selectedHandIndexes = [];
  }

  function refillHand({ allowOccupiedSafety = false } = {}) {
    const replacementIndexes = [];

    while (state.hand.length < 4) state.hand.push(null);
    if (state.hand.length > 4) state.hand = state.hand.slice(0, 4);

    for (let index = 0; index < 4; index += 1) {
      if (!state.hand[index]) {
        state.hand[index] = drawCards(state, 1)[0];
        replacementIndexes.push(index);
      }
    }

    ensurePlayableRound(state, {
      allowedIndexes: replacementIndexes,
      replaceOccupied: allowOccupiedSafety
    });
  }

  /* Pot Money: permanent, saved immediately. Only banking, the shield,
     recovery ads, and bank bonuses reach this. */
  function depositToPot(amount) {
    if (!state.activePot || amount <= 0) return 0;
    const before = state.activePot.progress;
    state.activePot.progress = Math.min(state.activePot.target, state.activePot.progress + amount);
    state.activePot.complete = state.activePot.progress >= state.activePot.target;
    savePots(state.pots);
    return state.activePot.progress - before;
  }

  const handlers = {
    onCardSelect,
    onCrunch,
    onBank: bankRun,
    onLevelSelect: enterLevel,
    onExitLevel: exitRun,
    onOpenPotInfo: openPotInfo,
    onClosePotInfo: closePotInfo
  };
  return {
    state,
    start,
    startEndless,
    startEndlessArcade,
    startMultiplayerMatch,
    startTutorial,
    showMap,
    enterLevel,
    returnToMap,
    playAgain,
    exitRun,
    updateMultiplayerClock,
    updateMultiplayerOpponent,
    finishMultiplayerMatch,
    returnFromMultiplayer,
    openPotInfo,
    closePotInfo,
    onCardSelect,
    onCrunch,
    bankRun,
    onReviveAd,
    onRecoverAd,
    onHintAd,
    onCoinAd,
    buyShieldWithCoins,
    buyCoinPack,
    refreshEconomy,
    applyCloudProgress
  };
}

export function getCrunchPreview(state) {
  const arcadeRun = isArcadeMode(state);
  const selectedCount = arcadeRun ? state.arcadePlayedCards.length : state.selectedHandIndexes.length;
  const modifier = arcadeRun ? null : state.activePot?.gameplayModifier;
  const minimumSelection = Math.max(1, Math.min(4, Number(modifier?.minSelection ?? 1)));
  const maximumSelection = arcadeRun ? Infinity : getMaximumSelection(state);
  const canCrunch = selectedCount >= minimumSelection && selectedCount <= maximumSelection;
  let idleLabel = "SELECT CARDS";
  if (minimumSelection > 1) idleLabel = `SELECT ${minimumSelection} CARDS`;
  else if (Number.isFinite(maximumSelection) && maximumSelection < 4) idleLabel = `SELECT UP TO ${maximumSelection}`;
  return {
    canCrunch,
    selectedCount,
    minimumSelection,
    maximumSelection,
    idleLabel,
    selectionMultiplier: arcadeRun ? getArcadeStackMultiplier(selectedCount) : getSelectionMultiplier(selectedCount)
  };
}

function getMaximumSelection(state) {
  if (isArcadeMode(state)) return Infinity;
  return Math.max(1, Math.min(4, Number(state.activePot?.gameplayModifier?.maxSelection ?? 4)));
}

function getStartingRunMultiplier(state) {
  if (isArcadeMode(state)) return 1;
  return Math.max(1, Number(state.activePot?.gameplayModifier?.startingRunMultiplier ?? 1));
}

function createMultiplayerState(options = {}) {
  const match = options?.match || {};
  return {
    matchId: String(match.id || ""),
    startsAt: Number(match.startsAt) || 0,
    endsAt: Number(match.endsAt) || 0,
    serverOffsetMs: Number(options.serverOffsetMs) || 0,
    you: { ...(match.you || {}), score: 0 },
    opponent: { ...(match.opponent || {}), score: Number(match.opponent?.score) || 0 },
    timeExpired: false,
    pendingResult: null,
    callbacks: {
      onScorePreview: typeof options.onScorePreview === "function" ? options.onScorePreview : null,
      onScoreChange: typeof options.onScoreChange === "function" ? options.onScoreChange : null,
      onForfeit: typeof options.onForfeit === "function" ? options.onForfeit : null,
      onResultReady: typeof options.onResultReady === "function" ? options.onResultReady : null
    }
  };
}

export function formatRunMultiplier(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function loadPots() {
  try {
    const saved = JSON.parse(localStorage.getItem("cardCrunchLevelPots") ?? "null");
    const defaults = createDefaultPots();
    if (!Array.isArray(saved)) return defaults;
    return defaults.map((pot) => {
      const savedPot = saved.find((item) => item.id === pot.id);
      const progress = Math.min(pot.target, Math.max(0, Number(savedPot?.progress ?? 0)));
      return { ...pot, progress, complete: progress >= pot.target };
    });
  } catch {
    return createDefaultPots();
  }
}

function savePots(pots) {
  localStorage.setItem("cardCrunchLevelPots", JSON.stringify(pots.map(({ id, progress }) => ({ id, progress }))));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCutsceneEntry(entry) {
  const isDouble = entry.matchedCards.length > 1 && (entry.matchType === "rank" || entry.matchType === "suit");
  return {
    card: entry.card,
    matchType: entry.matchType,
    points: entry.basePoints,
    displayPoints: entry.basePoints,
    bankPoints: entry.basePoints * Math.max(1, Number(entry.powerMultiplier) || 1),
    matchedCards: entry.matchedCards,
    equation: entry.equation,
    sequenceValues: entry.sequenceValues ?? null,
    sequenceRanks: entry.sequenceRanks ?? null,
    label: entry.cutinLabel ?? entry.label,
    powerType: entry.powerType ?? null,
    powerMultiplier: entry.powerMultiplier ?? 1,
    resolvedCard: entry.resolvedCard ?? null,
    resolvedLabel: entry.resolvedLabel ?? null,
    inlineBonuses: entry.powerMultiplier > 1
      ? [{ label: entry.powerLabel ?? "POWER CARD", value: `x${entry.powerMultiplier}`, tone: "power", kind: "entry-multiplier", multiplier: entry.powerMultiplier }]
      : [],
    isDouble,
    multiplier: isDouble ? 2 : 1
  };
}
