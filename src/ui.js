import { getCrunchPreview } from "./gameState.js";
import { getLevelProgress } from "./progression.js";

export function createUI() {
  const renderCache = { hand: "", stack: "" };
  const elements = {
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
    restartButton: document.querySelector("#restartButton")
  };

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

function renderHud(elements, state) {
  const levelProgress = getLevelProgress(state.score, state.level ?? 1);
  elements.scoreValue.textContent = state.score.toLocaleString();
  elements.streakValue.textContent = String(state.streak ?? 0);
  elements.timerValue.textContent = `${Math.ceil(state.timeLeft)}s`;
  elements.missValue.textContent = `${state.misses}/${state.maxMisses}`;
  elements.deckValue.textContent = String(state.deck.length);
  elements.levelValue.textContent = String(state.level ?? 1);
  elements.targetValue.textContent = levelProgress.target.toLocaleString();
  elements.targetFill.style.setProperty("--target-progress", `${levelProgress.progress}`);
  elements.timerRing.style.setProperty("--timer-progress", `${state.timeLeft / state.turnSeconds}`);
  elements.timerShell.classList.toggle("timer-danger", state.timeLeft <= 3 && state.status === "playing");
  elements.shell.classList.toggle("fever-mode", Boolean(state.fever));
}

function renderStack(elements, state) {
  elements.tableZone.innerHTML = '<div class="combo-line" id="comboLine"></div>';
  elements.tableZone.style.setProperty("--stack-count", String(state.stack.length));
  elements.tableZone.style.setProperty("--stack-size", "clamp(118px, 40vw, 190px)");
  state.stack.forEach((card, index) => {
    const slot = document.createElement("div");
    slot.className = "table-card-slot stack-slot base-stack-card";
    slot.dataset.stackSlot = String(index);
    slot.style.setProperty("--stack-rotate", `${index === 0 ? -4 : 4}deg`);
    slot.appendChild(createCard(card, { stackIndex: index }));
    elements.tableZone.appendChild(slot);
  });
}

function renderCrunch(elements, state, handlers) {
  const preview = getCrunchPreview(state);
  elements.storedValue.textContent = "???";
  elements.stackMultiplierValue.textContent = `x${preview.selectionMultiplier}`;
  elements.crunchButton.disabled = state.locked || state.status !== "playing" || !preview.canCrunch;
  elements.crunchButton.textContent = preview.canCrunch ? `CRUNCH ${preview.selectedCount}` : "SELECT CARDS";
  elements.crunchButton.classList.toggle("crunch-ready", preview.canCrunch);
  elements.crunchButton.classList.toggle("crunch-greedy", preview.selectedCount >= 3);
  elements.crunchButton.classList.toggle("crunch-danger", preview.canCrunch && state.timeLeft <= 3);
  elements.crunchButton.onclick = handlers.onCrunch;
}

function renderHand(elements, state, handlers) {
  elements.handZone.innerHTML = "";
  state.hand.forEach((card, index) => {
    const button = createCard(card, { handIndex: index, isButton: true });
    const order = state.selectedHandIndexes.indexOf(index);
    if (order >= 0) {
      button.classList.add("is-hand-selected");
      button.dataset.order = String(order + 1);
    }
    button.disabled = state.locked || state.status !== "playing";
    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      handlers.onCardSelect(index);
    });
    elements.handZone.appendChild(button);
  });
}

function createCard(card, options = {}) {
  const element = document.createElement(options.isButton ? "button" : "div");
  element.className = `card card-${card.color} card-${card.suit}`;
  element.type = options.isButton ? "button" : undefined;
  element.setAttribute("aria-label", `${card.rank} of ${card.suit}`);

  if (Number.isInteger(options.handIndex)) {
    element.dataset.handIndex = String(options.handIndex);
    element.style.setProperty("--fan-rotate", `${[-8, -3, 3, 8][options.handIndex] ?? 0}deg`);
  }
  if (Number.isInteger(options.stackIndex)) {
    element.dataset.stackCard = String(options.stackIndex);
  }

  const numericPips = Number.isInteger(card.value) && card.value > 1 && card.value <= 10
    ? Array.from({ length: card.value }, () => `<span>${card.suitSymbol}</span>`).join("")
    : `<span class="hero-pip">${card.suitSymbol}</span>`;

  element.innerHTML = `
    <span class="card-corner card-corner-top">
      <span>${card.rank}</span>
      <span>${card.suitSymbol}</span>
    </span>
    <span class="card-center">
      <span class="card-rank">${card.rank}</span>
      <span class="card-pips" aria-hidden="true">${numericPips}</span>
    </span>
    <span class="card-corner card-corner-bottom">
      <span>${card.rank}</span>
      <span>${card.suitSymbol}</span>
    </span>
  `;

  return element;
}

function getStackSignature(state) {
  return state.stack.map((card) => card.id).join("|");
}

function getHandSignature(state) {
  return [
    state.hand.map((card) => card.id).join("|"),
    state.selectedHandIndexes.join("|"),
    state.locked ? "locked" : "open",
    state.status
  ].join("::");
}
