import { drawCards, shuffle, createDeck } from "./deck.js?v=55";
import { calculateCrunchScore, getSelectionMultiplier } from "./scoring.js?v=55";
import { createDefaultPots, getPotCheckpoint, getTargetForLevel, isPotUnlocked } from "./progression.js?v=55";
import { createCrunchBankCounter, playBustCutin, playCrunchEntryExplanation, playCrunchTotalExplanation } from "./crunchCutscene.js?v=55";
import { ensurePlayableHand } from "./handSafety.js?v=55";
import { clearRunSave, loadRunSave, saveRunState } from "./save.js?v=55";
import { formatCompactNumber } from "./format.js?v=55";
import {
  animateBust,
  animateSelectionResolve,
  animateTargetClear,
  playSfx,
  spawnSparkBurst
} from "./animations.js";

export function createGame(ui) {
  let pendingRunSave = loadRunSave();
  const state = {
    deck: [],
    discard: [],
    stack: [],
    baseStackCount: 2,
    hand: [],
    selectedHandIndexes: [],
    score: 0,
    bestScore: Number(localStorage.getItem("cardCrunchBestScore") ?? 0),
    streak: 0,
    misses: 0,
    maxMisses: 3,
    level: 1,
    target: getTargetForLevel(1),
    pots: loadPots(),
    activePot: null,
    sessionCrunches: 0,
    fever: false,
    turnSeconds: 10,
    timerGraceSeconds: 1,
    timeLeft: 10,
    timerId: null,
    timerToken: 0,
    locked: true,
    status: "start"
  };

  function showMap() {
    stopTimer();
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
    state.deck = shuffle(createDeck());
    state.discard = [];
    state.stack = drawCards(state, state.baseStackCount);
    state.hand = drawCards(state, 4);
    ensurePlayableHand(state);
    state.selectedHandIndexes = [];
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.level = pot?.id ?? 0;
    state.activePot = pot ?? null;
    state.maxMisses = pot ? 1 : 3;
    state.sessionCrunches = 0;
    state.target = pot?.target ?? getTargetForLevel(1);
    state.fever = false;
    state.timeLeft = state.turnSeconds;
    state.locked = false;
    state.status = "playing";
    ui.showStart(false);
    ui.showMap(false);
    ui.showGameOver(false);
    ui.clearMessage();
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
    ui.render(state, handlers);

    const selectedCards = state.selectedHandIndexes.map((index) => state.hand[index]);
    const crunch = calculateCrunchScore({
      baseStack: state.stack,
      selectedCards,
      timeLeft: state.timeLeft,
      streak: state.streak
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

    state.score += crunch.total;
    localStorage.setItem("cardCrunchTotalCrunches", String(Number(localStorage.getItem("cardCrunchTotalCrunches") ?? 0) + selectedCards.length));
    addPotProgress(crunch.total);
    state.bestScore = Math.max(state.bestScore, state.score);
    localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
    state.streak = crunch.streakAfterCrunch;
    localStorage.setItem("cardCrunchBestStreak", String(Math.max(Number(localStorage.getItem("cardCrunchBestStreak") ?? 0), state.streak)));
    state.fever = state.streak >= 15;
    ui.elements.scoreValue.textContent = formatCompactNumber(state.score);
    ui.elements.streakValue.textContent = String(state.streak);
    discardSelectedCards();

    if (state.activePot?.complete) {
      refillHand();
      await clearTarget();
      return;
    }

    startNewRound();
  }

  async function handleTimeout() {
    if (state.locked || state.status !== "playing") return;
    await bust("TIME BUST!");
  }

  async function bust(message, failedSelectionIndex = -1) {
    state.locked = true;
    state.status = "busted";
    stopTimer();
    if (state.fever) playSfx("fever_end");
    playSfx("bust");
    state.misses += 1;
    applyBustPenalty();
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
      gameOver();
      return;
    }
    startNewRound();
  }

  async function clearTarget() {
    stopTimer();
    state.locked = true;
    state.status = "levelClear";
    ui.render(state, handlers);
    ui.setMessage("Pot Filled!", "good");
    playSfx("level_clear");
    await animateTargetClear(ui.elements.shell);
    returnToMap();
  }

  function returnToMap() {
    stopTimer();
    state.selectedHandIndexes = [];
    state.activePot = null;
    state.sessionCrunches = 0;
    pendingRunSave = null;
    clearRunSave();
    state.locked = true;
    state.status = "menu";
    ui.render(state, handlers);
    ui.renderMap(state.pots, handlers);
    ui.renderMenuStats(state);
    ui.showStart(true);
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

  function gameOver() {
    stopTimer();
    state.locked = true;
    state.status = "gameOver";
    pendingRunSave = null;
    clearRunSave();
    playSfx("game_over");
    ui.render(state, handlers);
    ui.showGameOver(true, state.score);
  }

  function addPotProgress(amount) {
    if (!state.activePot) return;
    state.sessionCrunches += amount;
    state.activePot.progress = Math.min(state.activePot.target, state.activePot.progress + amount);
    state.activePot.complete = state.activePot.progress >= state.activePot.target;
    savePots(state.pots);
  }

  function applyBustPenalty() {
    if (!state.activePot || state.sessionCrunches <= 0) return;
    const checkpoint = getPotCheckpoint(state.activePot);
    const penalty = Math.max(0, state.activePot.progress - checkpoint);
    state.sessionCrunches = Math.max(0, state.sessionCrunches - penalty);
    state.activePot.progress = checkpoint;
    state.score = Math.max(0, state.score - penalty);
    savePots(state.pots);
    ui.setMessage(`Back to ${formatCompactNumber(checkpoint)} checkpoint!`, "bad");
  }

  function restoreRun(save, pot) {
    if (!save.hand.length || save.hand.length > 4 || save.stack.length < state.baseStackCount) return false;
    stopTimer();
    state.maxMisses = 1;
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
    state.sessionCrunches = Math.max(0, Number(save.sessionCrunches) || 0);
    state.target = pot.target;
    state.fever = Boolean(save.fever) || state.streak >= 15;
    state.timeLeft = Math.min(state.turnSeconds, Math.max(1, Number(save.timeLeft) || state.turnSeconds));
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

  const handlers = { onCardSelect, onCrunch, onLevelSelect: enterLevel, onExitLevel: returnToMap };
  window.addEventListener("beforeunload", persistRun);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistRun();
  });
  return { state, start, startEndless, showMap, enterLevel, returnToMap, onCardSelect, onCrunch };
}

export function getCrunchPreview(state) {
  const selectedCount = state.selectedHandIndexes.length;
  return {
    canCrunch: selectedCount > 0,
    selectedCount,
    selectionMultiplier: getSelectionMultiplier(selectedCount)
  };
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
