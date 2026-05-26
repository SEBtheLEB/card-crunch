import {
  getHandSignature,
  getStackSignature,
  renderCrunch,
  renderHand,
  renderHud,
  renderStack
} from "./uiRenderers.js";

export function createUI() {
  const renderCache = { hand: "", stack: "" };
  const elements = getUIElements();

  return {
    elements,
    render(state, handlers) {
      renderHud(elements, state);

      const stackSignature = getStackSignature(state);
      if (renderCache.stack !== stackSignature) {
        renderStack(elements, state);
        renderCache.stack = stackSignature;
      }

      renderCrunch(elements, state, handlers);

      const handSignature = getHandSignature(state);
      if (renderCache.hand !== handSignature) {
        renderHand(elements, state, handlers);
        renderCache.hand = handSignature;
      }

      elements.shell.classList.toggle("is-locked", state.locked);
    },
    setMessage(message, tone = "neutral") {
      elements.comboLabel.textContent = message;
      elements.comboLabel.dataset.tone = tone;
      elements.comboLabel.classList.remove("pop-message");
      requestAnimationFrame(() => elements.comboLabel.classList.add("pop-message"));
    },
    clearMessage() {
      elements.comboLabel.textContent = "";
      elements.comboLabel.dataset.tone = "neutral";
    },
    showStart(show) {
      elements.startScreen.classList.toggle("is-visible", show);
      elements.startScreen.setAttribute("aria-hidden", String(!show));
    },
    showGameOver(show, score = 0) {
      elements.finalScore.textContent = score.toLocaleString();
      elements.gameOverScreen.classList.toggle("is-visible", show);
      elements.gameOverScreen.setAttribute("aria-hidden", String(!show));
    },
    getHandCardElement(index) {
      return elements.handZone.querySelector(`[data-hand-index="${index}"]`);
    },
    getAllStackCardElements() {
      return [...elements.tableZone.querySelectorAll("[data-stack-card]")];
    }
  };
}

function getUIElements() {
  return {
    shell: document.querySelector("#gameShell"),
    tableZone: document.querySelector("#tableZone"),
    handZone: document.querySelector("#handZone"),
    scoreValue: document.querySelector("#scoreValue"),
    streakValue: document.querySelector("#streakValue"),
    timerValue: document.querySelector("#timerValue"),
    timerRing: document.querySelector("#timerRing"),
    timerShell: document.querySelector("#timerShell"),
    levelValue: document.querySelector("#levelValue"),
    targetValue: document.querySelector("#targetValue"),
    targetFill: document.querySelector("#targetFill"),
    storedValue: document.querySelector("#storedValue"),
    stackMultiplierValue: document.querySelector("#stackMultiplierValue"),
    crunchButton: document.querySelector("#crunchButton"),
    missValue: document.querySelector("#missValue"),
    deckValue: document.querySelector("#deckValue"),
    comboLabel: document.querySelector("#comboLabel"),
    startScreen: document.querySelector("#startScreen"),
    gameOverScreen: document.querySelector("#gameOverScreen"),
    finalScore: document.querySelector("#finalScore"),
    startButton: document.querySelector("#startButton"),
    rulesButton: document.querySelector("#rulesButton"),
    rulesPanel: document.querySelector("#rulesPanel"),
    restartButton: document.querySelector("#restartButton")
  };
}
