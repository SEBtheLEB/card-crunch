const RESULT_TIMING = {
  stepDelay: 95,
  successHold: 620,
  failHold: 720,
  countDuration: 520
};

export async function showCrunchSuccessResult(crunch, selectedCards) {
  const overlay = createOverlay(crunch.crunchTier === "full" ? "full" : "success");
  overlay.panel.innerHTML = buildSuccessMarkup(crunch, selectedCards);
  document.body.appendChild(overlay.root);
  await revealResultSteps(overlay.panel);
  await countUpTotal(overlay.panel.querySelector("[data-result-total]"), crunch.total);
  await sleep(crunch.crunchTier === "full" ? RESULT_TIMING.successHold + 320 : RESULT_TIMING.successHold);
  overlay.root.classList.add("is-leaving");
  await sleep(180);
  overlay.root.remove();
}

export async function showCrunchFailResult({ resolution, selectedCards, message = "Crunch Failed" }) {
  const overlay = createOverlay("fail");
  overlay.panel.innerHTML = buildFailMarkup({ resolution, selectedCards, message });
  document.body.appendChild(overlay.root);
  await revealResultSteps(overlay.panel);
  await sleep(RESULT_TIMING.failHold);
  overlay.root.classList.add("is-leaving");
  await sleep(180);
  overlay.root.remove();
}

function createOverlay(tone) {
  const root = document.createElement("section");
  root.className = `crunch-result-overlay result-${tone}`;
  root.setAttribute("aria-live", "assertive");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("role", "dialog");

  const panel = document.createElement("div");
  panel.className = "crunch-result-panel";
  root.appendChild(panel);
  return { root, panel };
}

function buildSuccessMarkup(crunch, selectedCards) {
  const isFull = crunch.crunchTier === "full";
  const title = isFull ? "FULL CRUNCH!" : "CRUNCH SUCCESS";
  const kicker = isFull ? "All 4 cards used! Massive Bonus!" : "Sequence locked in.";
  const equation = crunch.equationText || crunch.resolution.history[0]?.reasonText || "Valid Crunch";
  const cardLine = selectedCards.map(cardLabel).join("  ->  ");
  const steps = crunch.explanationSteps.map((step, index) => `
    <li class="result-step score-tone-${step.tone}" style="--step-index:${index}">
      <span>${step.label}</span>
      <strong>${step.value}</strong>
      <em>${step.detail}</em>
    </li>
  `).join("");

  return `
    <p class="result-kicker">${kicker}</p>
    <h2>${title}</h2>
    <div class="result-equation">${equation}</div>
    <div class="result-selected">Selected: <strong>${cardLine}</strong></div>
    <ol class="result-steps">${steps}</ol>
    <div class="result-total">
      <span>Final Score</span>
      <strong data-result-total>+0</strong>
    </div>
  `;
}

function buildFailMarkup({ resolution, selectedCards, message }) {
  const failedCard = resolution?.failedCard;
  const validBeforeFail = resolution?.history?.length ?? 0;
  const cardLine = selectedCards.map(cardLabel).join("  ->  ");
  const reason = failedCard
    ? `${cardLabel(failedCard)} did not match suit, rank, sum, or difference against the current stack.`
    : "Selected cards did not complete a valid result.";

  return `
    <p class="result-kicker">No points earned.</p>
    <h2>${message}</h2>
    <div class="result-equation result-fail-line">${reason}</div>
    <div class="result-selected">Selected: <strong>${cardLine || "No cards selected"}</strong></div>
    <ol class="result-steps">
      <li class="result-step is-visible score-tone-total">
        <span>Resolved Before Bust</span>
        <strong>${validBeforeFail}</strong>
        <em>Earlier valid cards are lost when any selected card fails.</em>
      </li>
      <li class="result-step is-visible score-tone-fever">
        <span>Final Score</span>
        <strong>+0</strong>
        <em>Bust resets the streak and adds a miss.</em>
      </li>
    </ol>
  `;
}

async function revealResultSteps(panel) {
  const steps = [...panel.querySelectorAll(".result-step")];
  for (const step of steps) {
    await sleep(RESULT_TIMING.stepDelay);
    step.classList.add("is-visible");
  }
}

async function countUpTotal(element, total) {
  if (!element) return;
  const startedAt = performance.now();
  while (true) {
    const elapsed = performance.now() - startedAt;
    const progress = Math.min(1, elapsed / RESULT_TIMING.countDuration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = `+${Math.round(total * eased).toLocaleString()}`;
    if (progress >= 1) break;
    await sleep(16);
  }
  element.classList.add("result-total-pop");
}

function cardLabel(card) {
  if (!card) return "Unknown";
  return `${card.rank}${card.suitSymbol}`;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
