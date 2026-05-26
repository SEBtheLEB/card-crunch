import { drawCards, shuffle, createDeck } from "./deck.js";
import { calculateCrunchScore } from "./scoring.js";
import { getTargetForLevel } from "./progression.js";
import { GAME_CONFIG } from "./config.js";
import { discardSelectedCards, getSelectedCards, refillHand, toggleSelectedIndex } from "./hand.js";
import { loadBestScore, saveBestScore } from "./storage.js";
import { createTurnTimer } from "./timer.js";
import { showCrunchFailResult, showCrunchSuccessResult } from "./resultOverlay.js";
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
    baseStackCount: GAME_CONFIG.baseStackCount,
    hand: [],
    selectedHandIndexes: [],
    score: 0,
    bestScore: loadBestScore(),
    streak: 0,
    misses: 0,
    maxMisses: GAME_CONFIG.maxMisses,
    level: 1,
    target: getTargetForLevel(1),
    fever: false,
    turnSeconds: GAME_CONFIG.turnSeconds,
    timeLeft: GAME_CONFIG.turnSeconds,
    locked: true,
    status: "start"
  };

  const timer = createTurnTimer({
    getState: () => state,
    onTick: () => ui.render(state, handlers),
    onWarning: () => {
      playSfx("timer_warning");
      const rect = ui.elements.timerShell.getBoundingClientRect();
      spawnSparkBurst(rect.left + rect.width * .82, rect.top + rect.height / 2, state.fever ? 18 : 10, state.fever ? "fever" : "red");
    },
    onTimeout: handleTimeout
  });

  function start() {
    timer.stop();
    state.deck = shuffle(createDeck());
    state.discard = [];
    state.stack = drawCards(state, state.baseStackCount);
    state.hand = drawCards(state, GAME_CONFIG.handSize);
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
    timer.start();
  }

  function onCardSelect(handIndex) {
    if (state.locked || state.status !== "playing") return;
    playSfx(state.selectedHandIndexes.includes(handIndex) ? "card_deselect" : "card_select");
    state.selectedHandIndexes = toggleSelectedIndex(state.selectedHandIndexes, handIndex);
    ui.render(state, handlers);
  }

  async function onCrunch() {
    if (state.locked || state.status !== "playing" || state.selectedHandIndexes.length === 0) return;
    state.locked = true;
    state.status = "crunching";
    timer.stop();
    ui.render(state, handlers);

    const selectedCards = getSelectedCards(state.hand, state.selectedHandIndexes);
    const crunch = calculateCrunchScore({
      baseStack: state.stack,
      selectedCards,
      timeLeft: state.timeLeft,
      streak: state.streak
    });

    playSfx("crunch_start");

    if (!crunch.success) {
      const selectedHandCards = state.selectedHandIndexes.map((index) => ui.getHandCardElement(index));
      await animateSelectionResolve({
        selectedHandCards,
        baseStackCards: ui.getAllStackCardElements(),
        resolution: crunch.resolution,
        fail: true
      });
      await showCrunchFailResult({ resolution: crunch.resolution, selectedCards, message: "Crunch Failed" });
      await bust("BUST!", crunch.resolution.failedIndex);
      return;
    }

    const selectedHandCards = state.selectedHandIndexes.map((index) => ui.getHandCardElement(index));
    await animateSelectionResolve({
      selectedHandCards,
      baseStackCards: ui.getAllStackCardElements(),
      resolution: crunch.resolution,
      fail: false
    });

    await showCrunchSuccessResult(crunch, selectedCards);

    await animateCrunch({
      stackCards: ui.getAllStackCardElements(),
      crunchButton: ui.elements.crunchButton,
      scoreEl: ui.elements.scoreValue,
      breakdown: [],
      points: crunch.total,
      fever: crunch.streakAfterCrunch >= 15
    });

    state.score += crunch.total;
    state.bestScore = Math.max(state.bestScore, state.score);
    saveBestScore(state.bestScore);
    state.streak = crunch.streakAfterCrunch;
    state.fever = state.streak >= 15;
    ui.elements.scoreValue.textContent = state.score.toLocaleString();
    ui.elements.streakValue.textContent = String(state.streak);
    discardSelectedCards(state);
    refillHand(state, GAME_CONFIG.handSize);
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
    timer.stop();
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
    discardSelectedCards(state);
    refillHand(state, GAME_CONFIG.handSize);
    if (state.misses >= state.maxMisses) {
      gameOver();
      return;
    }
    startNewRound();
  }

  async function clearTarget() {
    timer.stop();
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
    timer.start();
  }

  function gameOver() {
    timer.stop();
    state.locked = true;
    state.status = "gameOver";
    playSfx("game_over");
    ui.render(state, handlers);
    ui.showGameOver(true, state.score);
  }

  const handlers = { onCardSelect, onCrunch };
  return { state, start, onCardSelect, onCrunch };
}

