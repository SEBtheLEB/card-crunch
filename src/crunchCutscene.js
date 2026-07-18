import { formatCompactNumber } from "./format.js?v=84";
import { playGameSfx } from "./audio.js?v=84";

export const CRUNCH_SKIP_EVENT = "card-crunch-skip-all";

const CUTSCENE_CONFIG = {
  showEveryResolvedCard: true,
  maxFullCutinsPerCrunch: 2,
  minCutinAdvanceDelay: 650,
  minFullCutinAdvanceDelay: 820,
  minMiniAdvanceDelay: 420,
  minFinalFlyDelay: 520,
  minFinalCloseDelay: 620,
  minBustAdvanceDelay: 620,
  autoBonusStepDuration: 620,
  fadeOutDuration: 160
};
const CARD_SHARD_CONFIG = {
  columns: 4,
  rows: 4,
  duration: 760,
  intakeSparks: 10
};
const tapBounceTimers = new WeakMap();
let skipAllRequested = false;
let skipTextElement = null;
let skipTextLocks = 0;

export function resetCrunchSkipRequest() {
  skipAllRequested = false;
  skipTextLocks = 0;
  removeCrunchSkipText();
}

export function isCrunchSkipRequested() {
  return skipAllRequested;
}

export function requestCrunchSkipAll() {
  if (skipAllRequested) return;
  skipAllRequested = true;
  skipTextElement?.classList.add("is-skipping");
  window.dispatchEvent(new CustomEvent(CRUNCH_SKIP_EVENT));
}

export function showCrunchSkipText() {
  skipTextLocks += 1;
  ensureCrunchSkipText();
}

export function hideCrunchSkipText() {
  skipTextLocks = Math.max(0, skipTextLocks - 1);
  if (skipTextLocks === 0) removeCrunchSkipText();
}

function ensureCrunchSkipText() {
  if (skipTextElement?.isConnected) return skipTextElement;
  skipTextElement = document.createElement("button");
  skipTextElement.type = "button";
  skipTextElement.className = "crunch-skip-text";
  skipTextElement.textContent = "TAP TO SKIP";
  skipTextElement.setAttribute("aria-label", "Skip the crunch animation");
  skipTextElement.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestCrunchSkipAll();
  });
  document.body.appendChild(skipTextElement);
  if (skipAllRequested) skipTextElement.classList.add("is-skipping");
  return skipTextElement;
}

function removeCrunchSkipText() {
  skipTextElement?.remove();
  skipTextElement = null;
}

export function createCrunchBankCounter({ panelEl = null, labelEl = null, valueEl = null, startingValue = 0 } = {}) {
  const useHudPanel = Boolean(panelEl && valueEl);
  const sourceLabelEl = labelEl;
  const sourceValueEl = valueEl;
  const element = useHudPanel ? panelEl.cloneNode(true) : document.createElement("div");
  const originalLabel = sourceLabelEl?.innerHTML ?? "";
  const originalValue = sourceValueEl?.textContent ?? "0";
  const placement = {
    parent: null,
    nextSibling: null,
    placeholder: null,
    sourcePanelEl: null,
    clone: false
  };
  let finished = false;
  let counterValueEl = valueEl;

  if (useHudPanel) {
    const rect = panelEl.getBoundingClientRect();
    placement.sourcePanelEl = panelEl;
    placement.clone = true;
    element.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    element.style.setProperty("--bank-top", `${Math.max(rect.top, 10)}px`);
    element.style.setProperty("--bank-width", `${rect.width}px`);
    element.style.setProperty("--bank-height", `${rect.height}px`);
    document.body.appendChild(element);
    element.classList.add("is-crunch-bank", "is-hud-bank-floating");
    element.setAttribute("aria-label", "Crunch Bank");
    panelEl.classList.add("is-bank-source-covered");
    const cloneLabelEl = element.querySelector(".hud-label");
    counterValueEl = element.querySelector("strong");
    if (cloneLabelEl) cloneLabelEl.textContent = "Crunch Bank";
    if (counterValueEl) counterValueEl.textContent = "0";
  } else {
    element.className = "cutin-bank-counter";
    element.innerHTML = `
      <span>Crunch Bank</span>
      <strong>0</strong>
    `;
    document.body.appendChild(element);
    counterValueEl = element.querySelector("strong");
  }

  let value = 0;

  return {
    element,
    get value() {
      return value;
    },
    async add(amount, sourceEl, advance = null, cardElements = []) {
      const previous = value;
      value += amount;
      if (cardElements.length) {
        playGameSfx("score_step");
        const feedDuration = getCardFeedDuration(cardElements.length);
        await Promise.all([
          feedCutinCardsToBank(cardElements, element, advance),
          countBankTo(counterValueEl, previous, value, advance, feedDuration)
        ]);
      } else {
        await flyValueToBank(sourceEl, element, amount, advance);
        await countBankTo(counterValueEl, previous, value, advance);
      }
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async setValue(nextValue, sourceEl, flyLabel = nextValue, advance = null) {
      await flyValueToBank(sourceEl, element, flyLabel, advance);
      const previous = value;
      value = nextValue;
      await countBankTo(counterValueEl, previous, value, advance);
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async rampTo(nextValue, advance = null) {
      const previous = value;
      value = nextValue;
      await countBankTo(counterValueEl, previous, value, advance);
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async finishToScore(scoreEl, advance = null) {
      finished = true;
      element.classList.add("bank-final-flash");
      await waitMaybe(advance, 260);
      if (useHudPanel) {
        const cloneLabelEl = element.querySelector(".hud-label");
        if (cloneLabelEl) cloneLabelEl.innerHTML = originalLabel;
        element.setAttribute("aria-label", "Score");
        await countBankTo(counterValueEl, value, startingValue + value, advance);
        element.classList.add("score-bump");
        await waitMaybe(advance, 320);
        if (sourceLabelEl) sourceLabelEl.innerHTML = originalLabel;
        if (sourceValueEl) sourceValueEl.textContent = formatCompactNumber(startingValue + value);
        restoreHudBank(element, placement);
      } else {
        flyGhostToScore(counterValueEl, scoreEl.getBoundingClientRect());
        await waitMaybe(advance, 620);
        element.remove();
      }
    },
    remove() {
      if (useHudPanel) {
        restoreHudBank(element, placement);
        if (!finished) {
          if (sourceLabelEl) sourceLabelEl.innerHTML = originalLabel;
          if (sourceValueEl) sourceValueEl.textContent = originalValue;
        }
      } else {
        element.remove();
      }
    }
  };
}

function restoreHudBank(element, placement = {}) {
  placement.sourcePanelEl?.classList.remove("is-bank-source-covered");
  if (placement.clone) {
    element.remove();
    return;
  }

  if (placement.placeholder?.parentNode) {
    placement.placeholder.parentNode.insertBefore(element, placement.placeholder);
    placement.placeholder.remove();
  } else if (placement.parent && element.parentNode !== placement.parent) {
    placement.parent.insertBefore(element, placement.nextSibling);
  }

  element.classList.remove("is-crunch-bank", "is-hud-bank-floating", "bank-final-flash", "bank-bump", "score-bump");
  element.style.removeProperty("--bank-top");
  element.style.removeProperty("--bank-width");
  element.style.removeProperty("--bank-height");
}

export async function playCrunchExplanation({ cutscene, scoreEl }) {
  if (!cutscene?.entries?.length) return;

  const overlay = createOverlay(cutscene.tier);
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);

  try {
    const fullEntries = chooseFullEntries(cutscene.entries);
    for (const entry of cutscene.entries) {
      if (fullEntries.includes(entry)) {
        await playEntryCutin(overlay, entry, cutscene.tier, advance);
      } else {
        await playMiniEntry(overlay, entry, advance);
      }
    }

    await playFinalTotal(overlay, cutscene.total, scoreEl, cutscene.tier, advance);
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    advance.destroy();
    overlay.remove();
  }
}

export async function playCrunchEntryExplanation({ entry, tier = "normal", bank = null }) {
  if (!entry) return;

  const overlay = createOverlay(tier);
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);

  try {
    await playEntryCutin(overlay, entry, tier, advance);
    if (bank) {
      const cards = [...overlay.querySelectorAll(".cutin-card:not(.dim)")];
      await bank.add(entry.points, overlay.querySelector(".cutin-points"), advance, cards);
    }
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    advance.destroy();
    overlay.remove();
  }
}

export async function playCrunchTotalExplanation({ total, scoreEl, tier = "normal", breakdown = [], bank = null }) {
  const overlay = createOverlay(tier);
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);

  try {
    if (bank) {
      await playCrunchBonusSteps(overlay, breakdown, total, tier, advance, bank);
      if (bank.value !== total) await bank.rampTo(total, advance);
      await bank.finishToScore(scoreEl, advance);
    } else {
      await playFinalTotal(overlay, total, scoreEl, tier, advance);
    }
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    advance.destroy();
    overlay.remove();
  }
}

export async function playBustCutin({ failedCard, activeStack = [] }) {
  const overlay = createOverlay("fail");
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);
  try {
    overlay.innerHTML = `
      <div class="cutin-stage cutin-fail-stage">
        <div class="cutin-dim-stack">${activeStack.slice(0, 4).map((card) => createCutinCardMarkup(card, "dim")).join("")}</div>
        ${failedCard ? createCutinCardMarkup(failedCard, "answer fail") : ""}
        <div class="cutin-label cutin-bust">BUST!</div>
        <div class="cutin-subtitle">NO MATCH FOUND</div>
      </div>
    `;
    await advance.waitForTap(CUTSCENE_CONFIG.minBustAdvanceDelay);
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    advance.destroy();
    overlay.remove();
  }
}

function chooseFullEntries(entries) {
  if (CUTSCENE_CONFIG.showEveryResolvedCard && entries.length <= CUTSCENE_CONFIG.maxFullCutinsPerCrunch) {
    return entries;
  }
  return [...entries]
    .sort((a, b) => b.points - a.points)
    .slice(0, CUTSCENE_CONFIG.maxFullCutinsPerCrunch);
}

async function playEntryCutin(overlay, entry, tier, advance) {
  const matched = orderMatchedCardsForEquation(entry);
  const operator = getOperatorText(entry);
  const equation = getEquationText(entry);
  overlay.innerHTML = isMathEntry(entry)
    ? createMathCutinMarkup({ entry, matched, operator, equation, tier })
    : createMatchCutinMarkup({ entry, matched, operator, equation, tier });
  playGameSfx(getEntrySound(entry));
  await advance.waitForTap(tier === "full" ? CUTSCENE_CONFIG.minFullCutinAdvanceDelay : CUTSCENE_CONFIG.minCutinAdvanceDelay);
}

function createMathCutinMarkup({ entry, matched, operator, equation, tier }) {
  return `
    <div class="cutin-stage cutin-math-stage ${tier === "full" ? "cutin-full" : ""}">
      <div class="cutin-expression-row">
        ${createCutinCardMarkup(matched[0], "source source-1")}
        <div class="cutin-operator cutin-inline-operator">${operator}</div>
        ${createCutinCardMarkup(matched[1], "source source-2")}
      </div>
      <div class="cutin-answer-wrap">
        ${createCutinCardMarkup(entry.card, "answer")}
      </div>
      <div class="cutin-equation">${equation}</div>
      <div class="cutin-label">${entry.label}</div>
      <div class="cutin-points">+${formatCompactNumber(entry.points)}</div>
    </div>
  `;
}

function createMatchCutinMarkup({ entry, matched, operator, equation, tier }) {
  return `
    <div class="cutin-stage cutin-match-stage ${tier === "full" ? "cutin-full" : ""}">
      <div class="cutin-match-row">
        ${matched.map((card, index) => createCutinCardMarkup(card, `source source-${index + 1}`)).join("")}
        ${createCutinCardMarkup(entry.card, "answer")}
      </div>
      <div class="cutin-operator">${operator}</div>
      <div class="cutin-equation">${equation}</div>
      <div class="cutin-label">${entry.label}</div>
      <div class="cutin-points">+${formatCompactNumber(entry.points)}</div>
    </div>
  `;
}

async function playMiniEntry(overlay, entry, advance) {
  overlay.innerHTML = `
    <div class="cutin-mini">
      ${createCutinCardMarkup(entry.card, "answer mini-card")}
      <div>
        <strong>${entry.label}</strong>
        <span>+${formatCompactNumber(entry.points)}</span>
      </div>
    </div>
  `;
  await advance.waitForTap(CUTSCENE_CONFIG.minMiniAdvanceDelay);
}

async function playFinalTotal(overlay, total, scoreEl, tier, advance, bank = null) {
  overlay.innerHTML = `
    <div class="cutin-final ${tier === "full" ? "cutin-final-full" : ""}">
      <span>${tier === "full" ? "FULL CRUNCH!" : "CRUNCH!"}</span>
      <strong>+${formatCompactNumber(total)}</strong>
      ${tier === "full" ? "<em>ALL 4 CARDS USED</em>" : ""}
    </div>
  `;

  const totalEl = overlay.querySelector(".cutin-final strong");
  playGameSfx("score_total");
  await advance.waitForTap(CUTSCENE_CONFIG.minFinalFlyDelay);
  if (bank) {
    await bank.setValue(total, totalEl, total, advance);
    await bank.finishToScore(scoreEl, advance);
  } else {
    flyGhostToScore(totalEl, scoreEl.getBoundingClientRect());
    await advance.waitForTap(CUTSCENE_CONFIG.minFinalCloseDelay);
  }
  playGameSfx("score_arrive");
}

async function playCrunchBonusSteps(overlay, breakdown, total, tier, advance, bank) {
  const steps = breakdown.filter((step) => step.kind !== "base" && step.kind !== "total");
  if (!steps.length) return;

  overlay.innerHTML = `
    <div class="cutin-bonus-page ${tier === "full" ? "cutin-full" : ""}">
      <span>Bonus Crunch</span>
      <div class="cutin-bonus-row">
        ${steps.map((step) => `
          <div class="cutin-bonus-chip cutin-bonus-${step.tone ?? "total"}">
            <em>${step.label}</em>
            <strong>${step.value}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  playGameSfx("score_step");
  await waitMaybe(advance, CUTSCENE_CONFIG.autoBonusStepDuration);
  await bank.rampTo(total, advance);
}

function createOverlay(tier) {
  const overlay = document.createElement("section");
  overlay.className = `crunch-cutscene-overlay cutscene-${tier}`;
  overlay.setAttribute("aria-live", "assertive");
  overlay.setAttribute("aria-label", "Crunch explanation. Tap to advance.");
  document.body.classList.add("is-crunch-focus-active");
  showCrunchSkipText();
  return overlay;
}

function createAdvanceController(overlay) {
  const waiters = new Set();
  const finishAllWaiters = () => {
    [...waiters].forEach((finish) => finish());
  };
  const onAdvance = (event) => {
    if (event.target?.closest?.(".crunch-skip-text")) return;
    event.preventDefault();
    playTapBounce(overlay);
    const [next] = waiters;
    if (next) next();
  };
  const onSkipAll = () => finishAllWaiters();

  overlay.addEventListener("pointerup", onAdvance);
  window.addEventListener(CRUNCH_SKIP_EVENT, onSkipAll);

  return {
    waitForTap(minMs = 0) {
      if (isCrunchSkipRequested()) return Promise.resolve();
      return new Promise((resolve) => {
        let finished = false;
        let canAdvance = minMs <= 0;
        let tapped = false;
        const finish = () => {
          if (finished || !canAdvance || !tapped) return;
          finished = true;
          window.clearTimeout(timeoutId);
          waiters.delete(tapToAdvance);
          resolve();
        };
        const timeoutId = window.setTimeout(() => {
          canAdvance = true;
          finish();
        }, minMs);
        const tapToAdvance = () => {
          tapped = true;
          canAdvance = true;
          finish();
        };
        waiters.add(tapToAdvance);
      });
    },
    wait(ms) {
      if (isCrunchSkipRequested()) return Promise.resolve();
      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeoutId);
          waiters.delete(finish);
          resolve();
        };
        const timeoutId = window.setTimeout(finish, ms);
        waiters.add(finish);
      });
    },
    destroy() {
      waiters.clear();
      document.body.classList.remove("is-crunch-focus-active");
      overlay.removeEventListener("pointerup", onAdvance);
      window.removeEventListener(CRUNCH_SKIP_EVENT, onSkipAll);
      hideCrunchSkipText();
    }
  };
}

function playTapBounce(overlay) {
  const target = overlay.querySelector(".cutin-stage, .cutin-final, .cutin-mini, .cutin-bonus-page, .cutin-bonus-step");
  if (!target) return;
  target.classList.add("cutin-tap-bounce");
  window.clearTimeout(tapBounceTimers.get(target));
  tapBounceTimers.set(target, window.setTimeout(() => {
    target.classList.remove("cutin-tap-bounce");
    tapBounceTimers.delete(target);
  }, 180));
}

function createCutinCardMarkup(card, extraClass = "") {
  if (!card) return "";
  return `
    <div class="cutin-card card-${card.color} card-${card.suit} ${extraClass}">
      <span class="cutin-corner">${card.rank}${card.suitSymbol}</span>
      <strong>${card.rank}</strong>
      <span class="cutin-suit">${card.suitSymbol}</span>
    </div>
  `;
}

function orderMatchedCardsForEquation(entry) {
  if (entry.matchType !== "subtract" || entry.matchedCards.length < 2) return entry.matchedCards;
  return [...entry.matchedCards].sort((a, b) => b.value - a.value);
}

function getOperatorText(entry) {
  if (entry.matchType === "add") return "+";
  if (entry.matchType === "subtract") return "-";
  if (entry.matchType === "rank") return getMatchOperatorText(entry, "MATCH");
  if (entry.matchType === "suit") return getMatchOperatorText(entry, "SUIT");
  return "CRUNCH";
}

function getEquationText(entry) {
  if (entry.equation) {
    return `${entry.equation.left} ${entry.equation.operator} ${entry.equation.right} = ${entry.equation.result}`;
  }
  if (entry.matchType === "rank") return createRepeatedMatchEquation(entry, "rank");
  if (entry.matchType === "suit") return createRepeatedMatchEquation(entry, "suitSymbol");
  return entry.label;
}

function isMathEntry(entry) {
  return entry.matchType === "add" || entry.matchType === "subtract";
}

function getEntrySound(entry) {
  if ((entry.matchedCards?.length ?? 0) > 1 && (entry.matchType === "rank" || entry.matchType === "suit")) return "double_match";
  if (entry.matchType === "suit") return "suit_match";
  if (entry.matchType === "rank") return "rank_match";
  if (entry.matchType === "add" || entry.matchType === "subtract") return "math_combo";
  return "card_resolve";
}

function getMatchOperatorText(entry, fallback) {
  const matchCount = (entry.matchedCards?.length ?? 0) + 1;
  if (matchCount >= 3) return getMatchCountName(matchCount);
  return fallback;
}

function getMatchCountName(count) {
  if (count === 3) return "TRIPLE";
  if (count === 4) return "QUAD";
  if (count === 5) return "FIVE-WAY";
  return `${count}X`;
}

function createRepeatedMatchEquation(entry, key) {
  return [...(entry.matchedCards ?? []), entry.card]
    .map((card) => card?.[key])
    .filter(Boolean)
    .join(" = ");
}

function flyGhostToScore(sourceEl, scoreRect) {
  if (!sourceEl) return;
  const sourceRect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true);
  ghost.className = "cutin-flying-points";
  ghost.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
  ghost.style.top = `${sourceRect.top + sourceRect.height / 2}px`;
  ghost.style.setProperty("--fly-x", `${scoreRect.left + scoreRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`);
  ghost.style.setProperty("--fly-y", `${scoreRect.top + scoreRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`);
  document.body.appendChild(ghost);
  window.setTimeout(() => ghost.remove(), 620);
}

/* Turns the explanation cards into clipped pixel shards and feeds them into
   the floating Crunch Bank while its number rolls upward. */
async function feedCutinCardsToBank(cardElements, bankEl, advance = null) {
  const cards = cardElements.filter((card) => card?.isConnected);
  if (!cards.length || !bankEl?.isConnected) return;

  const bankRect = bankEl.getBoundingClientRect();
  const targetX = bankRect.left + bankRect.width / 2;
  const targetY = bankRect.bottom - Math.min(8, bankRect.height * .12);
  const measurements = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
  if (!measurements.length) return;

  const nodes = [];
  const fragment = document.createDocumentFragment();

  measurements.forEach(({ card, rect }, cardIndex) => {
    card.classList.add("is-shattering");
    for (let row = 0; row < CARD_SHARD_CONFIG.rows; row += 1) {
      for (let column = 0; column < CARD_SHARD_CONFIG.columns; column += 1) {
        const shardIndex = row * CARD_SHARD_CONFIG.columns + column;
        const shard = card.cloneNode(true);
        const cellWidth = 100 / CARD_SHARD_CONFIG.columns;
        const cellHeight = 100 / CARD_SHARD_CONFIG.rows;
        const pieceX = rect.left + (column + .5) * (rect.width / CARD_SHARD_CONFIG.columns);
        const pieceY = rect.top + (row + .5) * (rect.height / CARD_SHARD_CONFIG.rows);
        const centerColumn = (CARD_SHARD_CONFIG.columns - 1) / 2;
        const centerRow = (CARD_SHARD_CONFIG.rows - 1) / 2;
        const spreadX = (column - centerColumn) * 19 + ((shardIndex + cardIndex) % 3 - 1) * 5;
        const spreadY = (row - centerRow) * 13 - 8 - (shardIndex % 2) * 4;
        const flyX = targetX - pieceX + ((shardIndex % 3) - 1) * 3;
        const flyY = targetY - pieceY;

        shard.classList.add("cutin-card-shard");
        shard.classList.remove("is-shattering");
        shard.setAttribute("aria-hidden", "true");
        shard.removeAttribute("aria-label");
        shard.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        shard.style.left = `${rect.left}px`;
        shard.style.top = `${rect.top}px`;
        shard.style.width = `${rect.width}px`;
        shard.style.height = `${rect.height}px`;
        shard.style.clipPath = createPixelShardClip(column, row, shardIndex + cardIndex);
        shard.style.transformOrigin = `${(column + .5) * cellWidth}% ${(row + .5) * cellHeight}%`;
        shard.style.setProperty("--shard-break-x", `${spreadX}px`);
        shard.style.setProperty("--shard-break-y", `${spreadY}px`);
        shard.style.setProperty("--shard-mid-x", `${spreadX + flyX * .38}px`);
        shard.style.setProperty("--shard-mid-y", `${spreadY + flyY * .38}px`);
        shard.style.setProperty("--shard-fly-x", `${flyX}px`);
        shard.style.setProperty("--shard-fly-y", `${flyY}px`);
        const rotation = (column - row) * 26 + (shardIndex % 2 ? 18 : -18);
        shard.style.setProperty("--shard-rotation-small", `${rotation * .3}deg`);
        shard.style.setProperty("--shard-rotation-mid", `${rotation * .72}deg`);
        shard.style.setProperty("--shard-rotation", `${rotation}deg`);
        nodes.push(shard);
        fragment.appendChild(shard);
      }
    }
  });

  for (let index = 0; index < CARD_SHARD_CONFIG.intakeSparks; index += 1) {
    const spark = document.createElement("i");
    spark.className = "bank-intake-spark";
    spark.setAttribute("aria-hidden", "true");
    spark.style.left = `${targetX}px`;
    spark.style.top = `${targetY}px`;
    const intakeX = ((index % 5) - 2) * 8;
    const intakeY = -8 - (index % 3) * 7;
    spark.style.setProperty("--intake-x", `${intakeX}px`);
    spark.style.setProperty("--intake-y", `${intakeY}px`);
    spark.style.setProperty("--intake-x-far", `${intakeX * 1.45}px`);
    spark.style.setProperty("--intake-y-far", `${intakeY * 1.6}px`);
    spark.style.setProperty("--intake-delay", `${Math.max(250, CARD_SHARD_CONFIG.duration - 190) + index * 22}ms`);
    nodes.push(spark);
    fragment.appendChild(spark);
  }

  document.body.appendChild(fragment);
  bankEl.classList.add("bank-feeding");
  const totalDuration = getCardFeedDuration(measurements.length);
  await waitMaybe(advance, totalDuration);
  nodes.forEach((node) => node.remove());
  bankEl.classList.remove("bank-feeding");
}

function createPixelShardClip(column, row, variant) {
  const cellWidth = 100 / CARD_SHARD_CONFIG.columns;
  const cellHeight = 100 / CARD_SHARD_CONFIG.rows;
  const overlap = .35;
  const x0 = Math.max(0, column * cellWidth - overlap);
  const x1 = Math.min(100, (column + 1) * cellWidth + overlap);
  const y0 = Math.max(0, row * cellHeight - overlap);
  const y1 = Math.min(100, (row + 1) * cellHeight + overlap);
  const stepX = 3.4 + (variant % 3) * .7;
  const stepY = 3.5 + ((variant + row) % 3) * .65;
  const topShift = variant % 2 === 0 ? stepY : 0;
  const bottomShift = variant % 2 === 0 ? 0 : stepY;

  return `polygon(
    ${x0}% ${y0 + topShift}%,
    ${x0 + stepX}% ${y0 + topShift}%,
    ${x0 + stepX}% ${y0}%,
    ${x1 - stepX}% ${y0}%,
    ${x1 - stepX}% ${y0 + stepY}%,
    ${x1}% ${y0 + stepY}%,
    ${x1}% ${y1 - bottomShift}%,
    ${x1 - stepX}% ${y1 - bottomShift}%,
    ${x1 - stepX}% ${y1}%,
    ${x0 + stepX}% ${y1}%,
    ${x0 + stepX}% ${y1 - stepY}%,
    ${x0}% ${y1 - stepY}%
  )`;
}

function getCardFeedDuration(cardCount) {
  return CARD_SHARD_CONFIG.duration
    + Math.max(0, cardCount - 1) * 22
    + 70;
}

async function flyValueToBank(sourceEl, bankEl, value, advance = null) {
  if (!sourceEl || !bankEl) return;
  const sourceRect = sourceEl.getBoundingClientRect();
  const bankRect = bankEl.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "cutin-bank-fly";
  ghost.textContent = typeof value === "number" ? `+${formatCompactNumber(value)}` : String(value);
  ghost.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
  ghost.style.top = `${sourceRect.top + sourceRect.height / 2}px`;
  ghost.style.setProperty("--fly-x", `${bankRect.left + bankRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`);
  ghost.style.setProperty("--fly-y", `${bankRect.top + bankRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`);
  document.body.appendChild(ghost);
  await waitMaybe(advance, 520);
  ghost.remove();
}

async function countBankTo(valueEl, from, to, advance = null, duration = 520) {
  if (!valueEl) return;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    let finished = false;
    let lastRendered = "";
    const done = () => {
      if (finished) return;
      finished = true;
      valueEl.textContent = formatCompactNumber(to);
      resolve();
    };
    if (advance) advance.wait(duration).then(done);
    const tick = (now) => {
      if (finished) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      const rendered = formatCompactNumber(value);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        valueEl.textContent = rendered;
      }
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        done();
      }
    };
    requestAnimationFrame(tick);
  });
}

function waitMaybe(advance, ms) {
  return advance ? advance.wait(ms) : sleep(ms);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
