import { drawCards, shuffle, createDeck } from "./deck.js";
import { calculateCrunchScore, getSelectionMultiplier } from "./scoring.js";
import { getTargetForLevel } from "./progression.js";
import {
  animateBust,
  animateCrunch,
  animateSelectionResolve,
  animateTargetClear,
  playSfx,
  spawnSparkBurst
} from "./animations.js";

export function createGame(ui) {
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
    fever: false,
    turnSeconds: 10,
    timeLeft: 10,
    timerId: null,
    timerToken: 0,
    locked: true,
    status: "start"
  };

  function start() {
    stopTimer();
    state.deck = shuffle(createDeck());
    state.discard = [];
    state.stack = drawCards(state, state.baseStackCount);
    state.hand = drawCards(state, 4);
    state.selectedHandIndexes = [];
    state.score = 0;
    state.streak = 0;
    state.misses = 0;
    state.level = 1;
    state.target = getTargetForLevel(state.level);
    state.fever = false;
    state.timeLeft = state.turnSeconds;
    state.locked = false;
    state.status = "playing";
    ui.showStart(false);
    ui.showGameOver(false);
    ui.clearMessage();
    ui.render(state, handlers);
    startTimer();
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
        fail: true
      });
      await bust("BUST!", crunch.resolution.failedIndex);
      return;
    }

    await animateSelectionResolve({
      selectedHandCards: state.selectedHandIndexes.map((index) => ui.getHandCardElement(index)),
      baseStackCards: ui.getAllStackCardElements(),
      resolution: crunch.resolution,
      fail: false
    });

    await animateCrunch({
      stackCards: ui.getAllStackCardElements(),
      crunchButton: ui.elements.crunchButton,
      scoreEl: ui.elements.scoreValue,
      breakdown: crunch.breakdown,
      points: crunch.total,
      fever: crunch.streakAfterCrunch >= 15
    });

    state.score += crunch.total;
    state.bestScore = Math.max(state.bestScore, state.score);
    localStorage.setItem("cardCrunchBestScore", String(state.bestScore));
    state.streak = crunch.streakAfterCrunch;
    state.fever = state.streak >= 15;
    ui.elements.scoreValue.textContent = state.score.toLocaleString();
    ui.elements.streakValue.textContent = String(state.streak);
    discardSelectedCards();
    refillHand();
    ui.render(state, handlers);

    if (state.score >= state.target) {
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
    refillHand();
    if (state.misses >= state.maxMisses) {
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
    ui.setMessage("Target Cleared!", "good");
    playSfx("level_clear");
    await animateTargetClear(ui.elements.shell);
    state.level += 1;
    state.target = getTargetForLevel(state.level);
    state.misses = 0;
    startNewRound();
  }

  function startNewRound() {
    state.stack.forEach((card) => state.discard.push(card));
    state.stack = drawCards(state, state.baseStackCount);
    state.selectedHandIndexes = [];
    state.timeLeft = state.turnSeconds;
    state.status = "playing";
    state.locked = false;
    ui.render(state, handlers);
    startTimer();
  }

  function startTimer() {
    stopTimer();
    const token = state.timerToken;
    const startedAt = performance.now();
    const totalMs = state.turnSeconds * 1000;
    let warned = false;

    state.timerId = window.setInterval(() => {
      if (token !== state.timerToken || state.locked || state.status !== "playing") return;
      const elapsed = performance.now() - startedAt;
      state.timeLeft = Math.max(0, (totalMs - elapsed) / 1000);
      if (!warned && state.timeLeft <= 3) {
        warned = true;
        playSfx("timer_warning");
        const rect = ui.elements.timerShell.getBoundingClientRect();
        spawnSparkBurst(rect.left + rect.width * .82, rect.top + rect.height / 2, state.fever ? 18 : 10, state.fever ? "fever" : "red");
      }
      ui.render(state, handlers);
      if (state.timeLeft <= 0) handleTimeout();
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
    state.hand = state.hand.filter((card, index) => {
      if (selected.has(index)) {
        state.discard.push(card);
        return false;
      }
      return true;
    });
    state.selectedHandIndexes = [];
  }

  function refillHand() {
    while (state.hand.length < 4) {
      state.hand.push(drawCards(state, 1)[0]);
    }
  }

  function gameOver() {
    stopTimer();
    state.locked = true;
    state.status = "gameOver";
    playSfx("game_over");
    ui.render(state, handlers);
    ui.showGameOver(true, state.score);
  }

  const handlers = { onCardSelect, onCrunch };
  return { state, start, onCardSelect, onCrunch };
}

export function getCrunchPreview(state) {
  const selectedCount = state.selectedHandIndexes.length;
  return {
    canCrunch: selectedCount > 0,
    selectedCount,
    selectionMultiplier: getSelectionMultiplier(selectedCount)
  };
}
