import { getCrunchPreview } from "./crunchPreview.js";
import { getLevelProgress } from "./progression.js";
import { createCard } from "./cardView.js";

export function renderHud(elements, state) {
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

export function renderStack(elements, state) {
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

export function renderCrunch(elements, state, handlers) {
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

export function renderHand(elements, state, handlers) {
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

export function getStackSignature(state) {
  return state.stack.map((card) => card.id).join("|");
}

export function getHandSignature(state) {
  return [
    state.hand.map((card) => card.id).join("|"),
    state.selectedHandIndexes.join("|"),
    state.locked ? "locked" : "open",
    state.status
  ].join("::");
}
