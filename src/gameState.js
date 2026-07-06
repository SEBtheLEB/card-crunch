import { drawCards, shuffle, createDeck } from "./deck.js?v=66";
import { calculateCrunchScore, evaluateStackAdd, getSelectionMultiplier } from "./scoring.js?v=66";
import { createDefaultPots, getTargetForLevel, isPotUnlocked } from "./progression.js?v=66";
import { createCrunchBankCounter, playBustCutin, playCrunchEntryExplanation, playCrunchTotalExplanation } from "./crunchCutscene.js?v=66";
import { ensurePlayableHand } from "./handSafety.js?v=66";
import { clearRunSave, consumeShieldToken, hasShieldToken, loadRunSave, saveRunState } from "./save.js?v=66";
import { formatCompactNumber } from "./format.js?v=66";
import { adManager } from "./ads.js?v=66";
import {
  animateBust,
  animateSelectionResolve,
  animateTargetClear,
  playSfx,
  spawnSparkBurst
} from "./animations.js";

const RUN_MULTIPLIER_MAX = 10;
const RUN_MULTIPLIER_BASE_STEP = 0.2;
const RUN_MULTIPLIER_COMBO_STEP = 0.1;
const SHIELD_SAVE_RATE = 0.25;
const RECOVERY_RATE = 0.5;
const BONUS_BANK_RATE = 0.25;

export function createGame(ui) {
  let pendingRunSave = loadRunSave();
  const state = {
    deck: [],
    discard: [],
    stack: [],
    baseStackCount: 2,
    hand: [],
    selectedHandIndexes: [],
    score: 0, // Run Money: temporary, unbanked, at risk
    bestScore: Number(localStorage.getItem("cardCrunchBestScore") ?? 0),
    streak: 0,
    misses: 0,
    maxMisses: 3,
    level: 1,
    target: getTargetForLevel(1),
    pots: loadPots(),
    activePot: null,
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
    safeBankShieldActive: false,
    // Rewarded ad locks (one use per run / per deposit)
    reviveAdUsedThisRun: false,
    recoveryAdUsedThisRun: false,
    bonusBankAdUsedForLastDeposit: true,
    hintAdUsedThisRun: false,
    rewardAdInProgress: false,
    runStartedAt: 0
  };

  function showMap() {
    stopTimer();
    ui.hideBonusBankOffer();
    state.locked = true;
    state.status = "menu";
    ui.renderMap(state.pots, handlers, pendingRunSave?.activePotId);
    ui.renderMenuStats(state);
    ui.showStart(true);
    ui.showGameOver(false);
    ui.showMap(false);
  }

  function enterLevel(levelId) {
    const pot = state.pots.find((item) => item.id === levelId);
    if (!pot || pot.complete || !isPotUnlocked(state.pots, levelId)) return;
    if (pendingRunSave?.activePotId === levelId && restoreRun(pendingRunSave, pot)) return;
    pendingRunSave = null;
    clearRunSave();
    start(pot);
  }

  function start(pot = state.pots.find((item) => !item.complete) ?? state.pots[0]) {
    stopTimer();
    ui.hideBonusBankOffer();
    state.deck = shuffle(createDeck());
    state.discard = [];
    state.stack = drawCards(state, state.baseStackCount);
    state.hand = drawCards(state, 4);
    ensurePlayableHand(state);
    state.selectedHandIndexes = [];
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.maxMisses = 3;
    state.level = pot?.id ?? 0;
    state.activePot = pot ?? null;
    state.target = pot?.target ?? getTargetForLevel(1);
    state.fever = false;
    state.bankMultiplier = 1;
    state.bestRunMultiplier = 1;
    state.bestRunStreak = 0;
    state.bankedThisRun = 0;
    state.lastBankDeposit = 0;
    state.lostUnbankedMoney = 0;
    state.shieldSaved = 0;
    state.recoveredAmount = 0;
    state.reviveAdUsedThisRun = false;
    state.recoveryAdUsedThisRun = false;
    state.bonusBankAdUsedForLastDeposit = true;
    state.hintAdUsedThisRun = false;
    state.rewardAdInProgress = false;
    state.safeBankShieldActive = Boolean(pot) && hasShieldToken();
    state.runStartedAt = Date.now();
    state.timeLeft = state.turnSeconds;
    state.locked = false;
    state.status = "playing";
    ui.showStart(false);
    ui.showMap(false);
    ui.showGameOver(false);
    ui.clearMessage();
    if (state.safeBankShieldActive) ui.setMessage("Shield armed: busting out auto-banks 25%", "good");
    ui.render(state, handlers);
    persistRun();
    startTimer();
  }

  function startEndless() {
    pendingRunSave = null;
    clearRunSave();
    start(null);
  }

  function onCardSelect(handIndex) {
    if (state.locked || state.status !== "playing") return;
    ui.hideBonusBankOffer();
    playSfx(state.selectedHandIndexes.includes(handIndex) ? "card_deselect" : "card_select");
    if (state.selectedHandIndexes.includes(handIndex)) {
      state.selectedHandIndexes = state.selectedHandIndexes.filter((index) => index !== handIndex);
    } else {
      state.selectedHandIndexes.push(handIndex);
    }
    ui.render(state, handlers);
    persistRun();
  }

  async function onCrunch() {
    if (state.locked || state.status !== "playing" || state.selectedHandIndexes.length === 0) return;
    state.locked = true;
    state.status = "crunching";
    stopTimer();
    ui.hideBonusBankOffer();
    ui.render(state, handlers);

    const selectedCards = state.selectedHandIndexes.map((index) => state.hand[index]);
    const crunch = calculateCrunchScore({
      baseStack: state.stack,
      selectedCards,
      timeLeft: state.timeLeft,
      streak: state.streak,
      runMultiplier: state.bankMultiplier
    });

    playSfx("crunch_start");

    if (!crunch.success) {
      await animateSelectionResolve({
        selectedHandCards: state.selectedHandIndexes.map((index) => ui.getHandCardElement(index)),
        baseStackCards: ui.getAllStackCardElements(),
        resolution: crunch.resolution,
        fail: true,
        onEntryResolved: async (entry) => {
          ui.setMessage(entry.cutinLabel ?? entry.label, "good");
          await playCrunchEntryExplanation({
            entry: createCutsceneEntry(entry),
            tier: "normal"
          });
        }
      });
      await playBustCutin({
        failedCard: crunch.resolution.failedCard,
        activeStack: crunch.resolution.activeStack
      });
      await bust("BUST!", crunch.resolution.failedIndex);
      return;
    }

    const crunchBank = createCrunchBankCounter({
      panelEl: ui.elements.scorePanel,
      labelEl: ui.elements.scoreLabel,
      valueEl: ui.elements.scoreValue,
      startingValue: state.score
    });
    try {
      await animateSelectionResolve({
        selectedHandCards: state.selectedHandIndexes.map((index) => ui.getHandCardElement(index)),
        baseStackCards: ui.getAllStackCardElements(),
        resolution: crunch.resolution,
        fail: false,
        onEntryResolved: async (entry, index) => {
          ui.setMessage(crunch.cutscene.entries[index]?.label ?? entry.cutinLabel ?? entry.label, "good");
          await playCrunchEntryExplanation({
            entry: crunch.cutscene.entries[index] ?? createCutsceneEntry(entry),
            tier: crunch.cutscene.tier,
            bank: crunchBank
          });
        }
      });

      await playCrunchTotalExplanation({
        total: crunch.cutscene.total,
        scoreEl: ui.elements.scoreValue,
        tier: crunch.cutscene.tier,
        breakdown: crunch.breakdown,
        bank: crunchBank
      });
      ui.setMessage(`+${formatCompactNumber(crunch.total)} Crunch`, "good");
    } catch (error) {
      crunchBank.remove();
      throw error;
    }

    // Money stays as unbanked Run Money — the pot only fills when banking.
    state.score += crunch.total;
    localStorage.setItem("cardCrunchTotalCrunches", String(Number(localStorage.getItem("cardCrunchTotalCrunches") ?? 0) + selectedCards.length));
    state.bestScore = Math.max(state.bestScore, state.score);
    localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
    state.streak = crunch.streakAfterCrunch;
    localStorage.setItem("cardCrunchBestStreak", String(Math.max(Number(localStorage.getItem("cardCrunchBestStreak") ?? 0), state.streak)));
    state.bestRunStreak = Math.max(state.bestRunStreak, state.streak);
    state.fever = state.streak >= 15;
    raiseBankMultiplier(selectedCards.length);
    ui.elements.scoreValue.textContent = formatCompactNumber(state.score);
    ui.elements.streakValue.textContent = String(state.streak);
    discardSelectedCards();
    startNewRound();
  }

  function raiseBankMultiplier(selectedCount) {
    const step = RUN_MULTIPLIER_BASE_STEP + RUN_MULTIPLIER_COMBO_STEP * Math.max(0, selectedCount - 1);
    state.bankMultiplier = Math.min(RUN_MULTIPLIER_MAX, Math.round((state.bankMultiplier + step) * 10) / 10);
    state.bestRunMultiplier = Math.max(state.bestRunMultiplier, state.bankMultiplier);
  }

  async function bankRun() {
    if (state.locked || state.status !== "playing" || !state.activePot || state.score <= 0) return;
    state.locked = true;
    stopTimer();
    ui.hideBonusBankOffer();

    const amount = state.score;
    depositToPot(amount);
    state.bankedThisRun += amount;
    state.lastBankDeposit = amount;
    state.bonusBankAdUsedForLastDeposit = false;
    state.score = 0;
    state.bankMultiplier = 1;

    playSfx("bank");
    ui.setMessage(`BANKED $${formatCompactNumber(amount)}! Multi reset to x1`, "good");
    ui.playBankJuice(amount);
    ui.render(state, handlers);
    persistRun();
    await sleep(620);

    if (state.activePot.complete) {
      await clearTarget();
      return;
    }

    state.locked = false;
    state.status = "playing";
    ui.render(state, handlers);
    persistRun();
    startTimer();
    offerBonusBankAd(amount);
  }

  function offerBonusBankAd(depositAmount) {
    if (state.bonusBankAdUsedForLastDeposit) return;
    if (!adManager.canShowRewardedAd()) return;
    const bonus = Math.round(depositAmount * BONUS_BANK_RATE);
    if (bonus <= 0) return;

    ui.showBonusBankOffer(bonus, async () => {
      // Guard against stale offers: only the most recent deposit qualifies.
      if (state.rewardAdInProgress || state.bonusBankAdUsedForLastDeposit || state.status !== "playing" || state.locked) return;
      if (Math.round(state.lastBankDeposit * BONUS_BANK_RATE) !== bonus) return;
      state.rewardAdInProgress = true;
      state.bonusBankAdUsedForLastDeposit = true;
      state.locked = true;
      stopTimer();
      ui.render(state, handlers);

      const earned = await adManager.showRewardedAd("bonusBank");
      state.rewardAdInProgress = false;
      if (earned) {
        depositToPot(bonus);
        state.bankedThisRun += bonus;
        playSfx("bank");
        ui.setMessage(`+$${formatCompactNumber(bonus)} bank bonus!`, "good");
        ui.playBankJuice(bonus);
        persistRun();
        if (state.activePot?.complete) {
          await clearTarget();
          return;
        }
      }
      state.locked = false;
      state.status = "playing";
      ui.render(state, handlers);
      startTimer();
    });
  }

  async function onHintAd() {
    if (state.locked || state.status !== "playing" || state.hintAdUsedThisRun || state.rewardAdInProgress) return;
    if (!adManager.canShowRewardedAd()) return;
    state.rewardAdInProgress = true;
    state.hintAdUsedThisRun = true;
    state.locked = true;
    stopTimer();
    ui.render(state, handlers);

    const earned = await adManager.showRewardedAd("hint");
    state.rewardAdInProgress = false;
    if (earned) {
      const hintIndex = state.hand.findIndex((card) => card && evaluateStackAdd(state.stack, card).valid);
      if (hintIndex >= 0) {
        ui.setMessage("This card crunches!", "good");
        ui.flashHint(hintIndex);
      } else {
        ui.setMessage("No single-card crunch right now", "bad");
      }
    }
    state.locked = false;
    state.status = "playing";
    ui.render(state, handlers);
    startTimer();
  }

  async function handleTimeout() {
    if (state.locked || state.status !== "playing") return;
    await bust("TIME BUST!");
  }

  async function bust(message, failedSelectionIndex = -1) {
    state.locked = true;
    state.status = "busted";
    stopTimer();
    ui.hideBonusBankOffer();
    if (state.fever) playSfx("fever_end");
    playSfx("bust");
    state.misses += 1;
    state.streak = 0;
    state.fever = false;
    ui.setMessage(message, "bad");
    ui.render(state, handlers);
    await animateBust({
      boardEl: ui.elements.shell,
      stackCards: ui.getAllStackCardElements(),
      handCard: failedSelectionIndex >= 0 ? ui.getHandCardElement(state.selectedHandIndexes[failedSelectionIndex]) : null,
      protectedBust: false
    });
    discardSelectedCards();
    if (state.misses >= state.maxMisses) {
      refillHand();
      endRun();
      return;
    }
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
    returnToMap();
  }

  /* Out of lives: unbanked Run Money is now at risk. The shield (if armed)
     fires immediately; the rest waits on the summary screen where the
     player may revive or recover via rewarded ads. */
  function endRun() {
    stopTimer();
    ui.hideBonusBankOffer();
    state.locked = true;
    state.status = "runEnded";
    pendingRunSave = null;
    clearRunSave();
    playSfx("game_over");

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

    state.lostUnbankedMoney = state.score;
    ui.render(state, handlers);
    showRunSummary();
  }

  function showRunSummary() {
    ui.showRunSummary({
      banked: state.bankedThisRun,
      lost: state.lostUnbankedMoney,
      shieldSaved: state.shieldSaved,
      recovered: state.recoveredAmount,
      bestMultiplier: state.bestRunMultiplier,
      bestStreak: state.bestRunStreak,
      pot: state.activePot,
      canRevive:
        !state.reviveAdUsedThisRun &&
        !state.activePot?.complete &&
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
    if (state.status !== "runEnded" || state.reviveAdUsedThisRun || state.rewardAdInProgress || state.activePot?.complete) return;
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
    ui.setMessage("REVIVED! 1 life left — bank it or risk it", "good");
    ui.playReviveJuice();
    startNewRound();
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
    finalizeRunLoss();
    const pot = state.activePot && !state.activePot.complete ? state.activePot : state.pots.find((item) => !item.complete);
    if (!pot || !isPotUnlocked(state.pots, pot.id)) {
      returnToMap();
      return;
    }
    start(pot);
  }

  function returnToMap() {
    finalizeRunLoss();
    stopTimer();
    ui.hideBonusBankOffer();
    state.selectedHandIndexes = [];
    state.activePot = null;
    pendingRunSave = null;
    clearRunSave();
    state.locked = true;
    state.status = "menu";
    ui.render(state, handlers);
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
    ui.showGameOver(false);
    ui.showStart(true);
    ui.showMap(false);
  }

  /* Exit Pot mid-run: keep the run resumable instead of forfeiting cash. */
  function exitAndSave() {
    if (state.status !== "playing") return;
    stopTimer();
    ui.hideBonusBankOffer();
    persistRun();
    pendingRunSave = loadRunSave();
    state.locked = true;
    state.status = "menu";
    ui.renderMap(state.pots, handlers, pendingRunSave?.activePotId);
    ui.renderMenuStats(state);
    ui.showStart(true);
    ui.showMenuPage("pots");
    ui.showMap(false);
  }

  function startNewRound() {
    const hasReplacementSlots = state.hand.some((card) => !card);
    state.stack.forEach((card) => state.discard.push(card));
    state.stack = drawCards(state, state.baseStackCount);
    refillHand({ allowOccupiedSafety: !hasReplacementSlots });
    state.selectedHandIndexes = [];
    state.timeLeft = state.turnSeconds;
    state.status = "playing";
    state.locked = false;
    ui.render(state, handlers);
    persistRun();
    startTimer();
  }

  function startTimer() {
    stopTimer();
    const token = state.timerToken;
    const startedAt = performance.now();
    const totalMs = Math.max(0, state.timeLeft + state.timerGraceSeconds) * 1000;
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

  function discardSelectedCards() {
    const selected = new Set(state.selectedHandIndexes);
    state.hand = state.hand.map((card, index) => {
      if (selected.has(index)) {
        if (card) state.discard.push(card);
        return null;
      }
      return card;
    });
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

    ensurePlayableHand(state, {
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

  function restoreRun(save, pot) {
    if (!save.hand.length || save.hand.length > 4 || save.stack.length < state.baseStackCount) return false;
    stopTimer();
    state.maxMisses = 3;
    state.deck = save.deck;
    state.discard = save.discard;
    state.stack = save.stack;
    state.hand = save.hand;
    state.selectedHandIndexes = save.selectedHandIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < state.hand.length);
    state.score = Math.max(0, Number(save.score) || 0);
    state.bestScore = Math.max(state.bestScore, Number(save.bestScore) || 0);
    state.streak = Math.max(0, Number(save.streak) || 0);
    state.misses = Math.min(state.maxMisses - 1, Math.max(0, Number(save.misses) || 0));
    state.level = pot.id;
    state.activePot = pot;
    state.target = pot.target;
    state.fever = Boolean(save.fever) || state.streak >= 15;
    state.timeLeft = Math.min(state.turnSeconds, Math.max(1, Number(save.timeLeft) || state.turnSeconds));
    state.bankMultiplier = Math.min(RUN_MULTIPLIER_MAX, Math.max(1, Number(save.bankMultiplier) || 1));
    state.bestRunMultiplier = Math.max(state.bankMultiplier, Number(save.bestRunMultiplier) || 1);
    state.bestRunStreak = Math.max(state.streak, Number(save.bestRunStreak) || 0);
    state.bankedThisRun = Math.max(0, Number(save.bankedThisRun) || 0);
    state.lastBankDeposit = Math.max(0, Number(save.lastBankDeposit) || 0);
    state.bonusBankAdUsedForLastDeposit = save.bonusBankAdUsedForLastDeposit !== false;
    state.reviveAdUsedThisRun = Boolean(save.reviveAdUsedThisRun);
    state.recoveryAdUsedThisRun = false;
    state.hintAdUsedThisRun = Boolean(save.hintAdUsedThisRun);
    state.rewardAdInProgress = false;
    state.safeBankShieldActive = Boolean(save.safeBankShieldActive) && hasShieldToken();
    state.lostUnbankedMoney = 0;
    state.shieldSaved = 0;
    state.recoveredAmount = 0;
    state.runStartedAt = Date.now();
    state.locked = false;
    state.status = "playing";
    pendingRunSave = null;
    ui.showStart(false);
    ui.showMap(false);
    ui.showGameOver(false);
    ui.setMessage("Run restored", "good");
    ensurePlayableHand(state);
    ui.render(state, handlers);
    persistRun();
    startTimer();
    return true;
  }

  function persistRun() {
    saveRunState(state);
  }

  const handlers = {
    onCardSelect,
    onCrunch,
    onBank: bankRun,
    onLevelSelect: enterLevel,
    onExitLevel: exitAndSave
  };
  window.addEventListener("beforeunload", persistRun);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistRun();
  });
  return {
    state,
    start,
    startEndless,
    showMap,
    enterLevel,
    returnToMap,
    playAgain,
    exitAndSave,
    onCardSelect,
    onCrunch,
    bankRun,
    onReviveAd,
    onRecoverAd,
    onHintAd
  };
}

export function getCrunchPreview(state) {
  const selectedCount = state.selectedHandIndexes.length;
  return {
    canCrunch: selectedCount > 0,
    selectedCount,
    selectionMultiplier: getSelectionMultiplier(selectedCount)
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
    matchedCards: entry.matchedCards,
    equation: entry.equation,
    label: entry.cutinLabel ?? entry.label,
    isDouble,
    multiplier: isDouble ? 2 : 1
  };
}
