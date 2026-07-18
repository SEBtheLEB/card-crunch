import { formatCompactNumber } from "./format.js?v=90";
import { playCrunchShardImpact, playGameSfx } from "./audio.js?v=90";

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
  sharedCardDuration: 680,
  sharedCardStagger: 58,
  interactiveCrunchHits: 3,
  finalCrackHold: 190,
  fadeOutDuration: 160
};
const CARD_SHARD_CONFIG = {
  duration: 760,
  maxReleaseDelay: 230,
  pieceDelayJitter: 16,
  cardDelayStep: 18,
  intakeSparks: 10
};
const FRACTURE_GRID = { width: 72, height: 100 };
const tapBounceTimers = new WeakMap();
const preparedShardSets = new WeakMap();
const fracturePatterns = new WeakMap();
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

export async function playCrunchEntryExplanation({ entry, tier = "normal", bank = null, sourceCards = [] }) {
  if (!entry) return;

  const overlay = createOverlay(tier);
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);
  let restoreSharedCards = () => {};

  try {
    restoreSharedCards = await playEntryCutin(overlay, entry, tier, advance, sourceCards, bank?.element ?? null);
    if (bank) {
      const cards = getActiveCutinCards(overlay);
      await bank.add(entry.points, overlay.querySelector(".cutin-points"), advance, cards);
    }
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    restoreSharedCards();
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
    await (advance.fastForwarded ? sleep(CUTSCENE_CONFIG.fadeOutDuration) : waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration));
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

async function playEntryCutin(overlay, entry, tier, advance, sourceCards = [], bankEl = null) {
  const matched = orderMatchedCardsForEquation(entry);
  const operator = getOperatorText(entry);
  const equation = getEquationText(entry);
  overlay.innerHTML = isMathEntry(entry)
    ? createMathCutinMarkup({ entry, matched, operator, equation, tier })
    : createMatchCutinMarkup({ entry, matched, operator, equation, tier });
  const crunchPrompt = createInteractiveCrunchPrompt(overlay);
  const restoreSharedCards = await transitionSourceCardsIntoCutin(overlay, sourceCards, advance);
  playGameSfx(getEntrySound(entry));
  await playInteractiveCardCrunch(overlay, advance, crunchPrompt, bankEl);
  return restoreSharedCards;
}

function getActiveCutinCards(overlay) {
  const sharedCards = [...overlay.querySelectorAll(".cutin-live-card:not(.dim)")];
  if (sharedCards.length) return sharedCards;
  return [...overlay.querySelectorAll(".cutin-card:not(.dim):not(.cutin-layout-proxy)")];
}

function createInteractiveCrunchPrompt(overlay) {
  const prompt = document.createElement("div");
  prompt.className = "cutin-crunch-prompt";
  prompt.setAttribute("aria-live", "polite");
  prompt.textContent = `TAP TO CRUNCH  0/${CUTSCENE_CONFIG.interactiveCrunchHits}`;
  overlay.appendChild(prompt);
  return prompt;
}

async function playInteractiveCardCrunch(overlay, advance, prompt, bankEl = null) {
  const stage = overlay.querySelector(".cutin-stage");
  const cards = getActiveCutinCards(overlay);
  if (!stage || !cards.length || isCrunchSkipRequested()) return;

  cards.forEach(createCardFractureMap);
  if (bankEl) prepareCutinCardShards(cards, bankEl);

  for (let hit = 1; hit <= CUTSCENE_CONFIG.interactiveCrunchHits; hit += 1) {
    await advance.waitForTap(0);
    if (isCrunchSkipRequested()) return;

    stage.dataset.crunchHit = String(hit);
    overlay.dataset.crunchHit = String(hit);
    cards.forEach((card) => {
      card.dataset.crunchDamage = String(hit);
    });
    playGameSfx(`crunch_hit_${hit}`);
    spawnCrunchDamageBurst(overlay, cards, hit);
    prompt.textContent = hit < CUTSCENE_CONFIG.interactiveCrunchHits
      ? `CRUNCH AGAIN  ${hit}/${CUTSCENE_CONFIG.interactiveCrunchHits}`
      : "BREAK!";
    prompt.classList.toggle("is-final-hit", hit === CUTSCENE_CONFIG.interactiveCrunchHits);
  }

  await sleep(CUTSCENE_CONFIG.finalCrackHold);
  prompt.remove();
}

function spawnCrunchDamageBurst(overlay, cards, hit) {
  const fragment = document.createDocumentFragment();
  const debris = [];

  cards.forEach((card, cardIndex) => {
    const rect = card.getBoundingClientRect();
    const chipCount = 4 + hit * 3;
    for (let index = 0; index < chipCount; index += 1) {
      const chip = document.createElement("i");
      const seed = index + cardIndex * 11 + hit * 17;
      const originX = rect.left + rect.width * (.24 + ((seed * 29) % 53) / 100);
      const originY = rect.top + rect.height * (.18 + ((seed * 19) % 59) / 100);
      const direction = index % 2 === 0 ? -1 : 1;
      const travelX = direction * (20 + (seed % 6) * 9 + hit * 7);
      const travelY = -18 - (seed % 5) * 8 + hit * 13;
      chip.className = `cutin-crunch-chip ${card.classList.contains("card-red") ? "is-red-chip" : "is-dark-chip"}`;
      chip.setAttribute("aria-hidden", "true");
      chip.style.left = `${originX}px`;
      chip.style.top = `${originY}px`;
      chip.style.setProperty("--chip-x", `${travelX}px`);
      chip.style.setProperty("--chip-y", `${travelY}px`);
      chip.style.setProperty("--chip-x-far", `${travelX * 1.18}px`);
      chip.style.setProperty("--chip-y-far", `${travelY + 32}px`);
      chip.style.setProperty("--chip-rotation", `${direction * (70 + seed % 110)}deg`);
      chip.style.setProperty("--chip-delay", `${(index % 4) * 13}ms`);
      chip.style.setProperty("--chip-size", `${5 + seed % 5}px`);
      debris.push(chip);
      fragment.appendChild(chip);
    }

    if (hit === CUTSCENE_CONFIG.interactiveCrunchHits) {
      for (let index = 0; index < 16; index += 1) {
        const crumb = document.createElement("i");
        const seed = index + cardIndex * 23;
        crumb.className = `cutin-crunch-crumb ${index % 4 === 0 ? "is-gold-crumb" : ""}`;
        crumb.setAttribute("aria-hidden", "true");
        crumb.style.left = `${rect.left + rect.width * (.18 + ((seed * 31) % 65) / 100)}px`;
        crumb.style.top = `${rect.top + rect.height * (.34 + ((seed * 17) % 42) / 100)}px`;
        crumb.style.setProperty("--crumb-x", `${((seed % 9) - 4) * 12}px`);
        crumb.style.setProperty("--crumb-y", `${72 + (seed % 6) * 18}px`);
        crumb.style.setProperty("--crumb-delay", `${(index % 8) * 17}ms`);
        crumb.style.setProperty("--crumb-duration", `${430 + (seed % 5) * 55}ms`);
        debris.push(crumb);
        fragment.appendChild(crumb);
      }
    }
  });

  overlay.appendChild(fragment);
  window.setTimeout(() => debris.forEach((node) => node.remove()), hit === CUTSCENE_CONFIG.interactiveCrunchHits ? 820 : 520);
}

function createCardFractureMap(card) {
  if (!card || card.querySelector(".cutin-fracture-map")) return;
  const namespace = "http://www.w3.org/2000/svg";
  const pattern = createFracturePattern(card);
  const layer = document.createElement("span");
  const svg = document.createElementNS(namespace, "svg");
  layer.className = "cutin-fracture-map";
  layer.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${FRACTURE_GRID.width} ${FRACTURE_GRID.height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");

  pattern.stageOne.forEach((points) => appendFracturePath(svg, points, "1", namespace));
  pattern.stageTwo.forEach((points) => appendFracturePath(svg, points, "2", namespace));
  pattern.fragments.forEach((fragment) => {
    const polygon = document.createElementNS(namespace, "polygon");
    polygon.classList.add("cutin-fracture-piece");
    polygon.setAttribute("points", formatFracturePoints(fragment.points));
    svg.appendChild(polygon);
  });

  layer.appendChild(svg);
  card.appendChild(layer);
}

function appendFracturePath(svg, points, stage, namespace) {
  if (points.length < 2) return;
  const path = document.createElementNS(namespace, "polyline");
  path.classList.add("cutin-crack-path", `fracture-stage-${stage}`);
  path.setAttribute("points", formatFracturePoints(points));
  svg.appendChild(path);
}

function createFracturePattern(card) {
  const cached = fracturePatterns.get(card);
  if (cached) return cached;

  const key = card.dataset.cutinCardId || card.dataset.cardId || card.textContent.trim();
  const seed = hashFractureKey(key);
  const random = createSeededRandom(seed);
  const sectorCount = random() > .52 ? 7 : 6;
  const perimeter = 2 * (FRACTURE_GRID.width + FRACTURE_GRID.height);
  const sectorSize = perimeter / sectorCount;
  const offset = random() * sectorSize;
  const entries = Array.from({ length: sectorCount }, (_, index) => {
    const jitter = (random() - .5) * sectorSize * .3;
    const t = wrapPerimeter(offset + index * sectorSize + jitter, perimeter);
    return { t, point: pointOnCardPerimeter(t) };
  }).sort((a, b) => a.t - b.t);

  const center = snapFracturePoint({
    x: FRACTURE_GRID.width * (.5 + (random() - .5) * .09),
    y: FRACTURE_GRID.height * (.52 + (random() - .5) * .09)
  });
  const ring = entries.map(({ point }) => {
    const progress = .55 + random() * .1;
    return snapFracturePoint({
      x: point.x + (center.x - point.x) * progress + (random() - .5) * 2,
      y: point.y + (center.y - point.y) * progress + (random() - .5) * 3
    });
  });
  const core = ring.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const radius = 4 + random() * 3;
    return snapFracturePoint({
      x: center.x + dx / length * radius,
      y: center.y + dy / length * radius
    });
  });

  const spokes = entries.map(({ point }, index) => createAngularFracturePath(point, ring[index], 5, random, 2.2));
  const ringEdges = ring.map((point, index) => createAngularFracturePath(point, ring[(index + 1) % sectorCount], 3, random, 1.6));
  const connectors = ring.map((point, index) => createAngularFracturePath(point, core[index], 3, random, 1.25));
  const coreEdges = core.map((point, index) => createAngularFracturePath(point, core[(index + 1) % sectorCount], 2, random, .7));
  const fragments = [];

  entries.forEach((entry, index) => {
    const nextIndex = (index + 1) % sectorCount;
    const nextEntry = entries[nextIndex];
    const perimeterPoints = getPerimeterArc(entry.t, nextEntry.t, nextEntry.point);
    fragments.push({
      points: joinFracturePaths(
        [entry.point, ...perimeterPoints],
        spokes[nextIndex],
        [...ringEdges[index]].reverse(),
        [...spokes[index]].reverse()
      )
    });
    fragments.push({
      points: joinFracturePaths(
        ringEdges[index],
        connectors[nextIndex],
        [...coreEdges[index]].reverse(),
        [...connectors[index]].reverse()
      )
    });
  });
  fragments.push({ points: joinFracturePaths(...coreEdges) });

  const shuffledIndexes = Array.from({ length: sectorCount }, (_, index) => index);
  for (let index = shuffledIndexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffledIndexes[index], shuffledIndexes[swap]] = [shuffledIndexes[swap], shuffledIndexes[index]];
  }
  const primaryCount = 1 + Math.floor(random() * 3);
  const primaryIndexes = shuffledIndexes.slice(0, primaryCount);
  const secondaryIndexes = shuffledIndexes.slice(primaryCount, primaryCount + 1 + Math.floor(random() * 2));
  const stageOne = [];
  const stageTwo = [];

  primaryIndexes.forEach((index) => {
    const path = spokes[index];
    const firstLength = 2 + Math.floor(random() * 2);
    stageOne.push(path.slice(0, firstLength));
    stageTwo.push(path.slice(firstLength - 1));
    if (random() > .45) stageTwo.push(ringEdges[index].slice(0, 2 + Math.floor(random() * 2)));
  });
  secondaryIndexes.forEach((index) => {
    const pathLength = 3 + Math.floor(random() * 3);
    stageTwo.push(spokes[index].slice(0, pathLength));
  });
  const branchCount = 1 + Math.floor(random() * 3);
  shuffledIndexes.slice(-branchCount).forEach((index) => {
    stageTwo.push(ringEdges[index].slice(0, 2 + Math.floor(random() * 2)));
    if (random() > .55) stageTwo.push(connectors[index].slice(0, 2));
  });

  const pattern = { seed, stageOne, stageTwo, fragments };
  card.dataset.fractureSeed = String(seed);
  fracturePatterns.set(card, pattern);
  return pattern;
}

function createAngularFracturePath(start, end, segmentCount, random, jitterAmount) {
  const points = [snapFracturePoint(start)];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const perpendicular = { x: -dy / length, y: dx / length };
  for (let index = 1; index < segmentCount; index += 1) {
    const progress = index / segmentCount;
    const jitter = (random() - .5) * jitterAmount * (index % 2 === 0 ? .75 : 1);
    points.push(snapFracturePoint({
      x: start.x + dx * progress + perpendicular.x * jitter,
      y: start.y + dy * progress + perpendicular.y * jitter
    }));
  }
  points.push(snapFracturePoint(end));
  return points;
}

function getPerimeterArc(start, end, endPoint) {
  const perimeter = 2 * (FRACTURE_GRID.width + FRACTURE_GRID.height);
  let resolvedEnd = end;
  if (resolvedEnd <= start) resolvedEnd += perimeter;
  const cornerStops = [
    FRACTURE_GRID.width,
    FRACTURE_GRID.width + FRACTURE_GRID.height,
    FRACTURE_GRID.width * 2 + FRACTURE_GRID.height,
    perimeter,
    perimeter + FRACTURE_GRID.width,
    perimeter + FRACTURE_GRID.width + FRACTURE_GRID.height
  ];
  const corners = cornerStops
    .filter((stop) => stop > start && stop < resolvedEnd)
    .map((stop) => pointOnCardPerimeter(stop % perimeter));
  return [...corners, endPoint];
}

function pointOnCardPerimeter(value) {
  const { width, height } = FRACTURE_GRID;
  const perimeter = 2 * (width + height);
  const t = wrapPerimeter(value, perimeter);
  if (t <= width) return snapFracturePoint({ x: t, y: 0 });
  if (t <= width + height) return snapFracturePoint({ x: width, y: t - width });
  if (t <= width * 2 + height) return snapFracturePoint({ x: width - (t - width - height), y: height });
  return snapFracturePoint({ x: 0, y: height - (t - width * 2 - height) });
}

function joinFracturePaths(...paths) {
  const points = [];
  paths.forEach((path) => path.forEach((point) => {
    const previous = points[points.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) points.push(point);
  }));
  return points;
}

function snapFracturePoint(point) {
  return {
    x: Math.max(0, Math.min(FRACTURE_GRID.width, Math.round(point.x))),
    y: Math.max(0, Math.min(FRACTURE_GRID.height, Math.round(point.y)))
  };
}

function formatFracturePoints(points) {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function wrapPerimeter(value, perimeter) {
  return ((value % perimeter) + perimeter) % perimeter;
}

function hashFractureKey(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
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
  overlay.classList.add("is-bonus-screen");
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
  let fastForwarded = false;
  const finishAllWaiters = () => {
    [...waiters].forEach((finish) => finish());
  };
  const onAdvance = (event) => {
    if (event.target?.closest?.(".crunch-skip-text")) return;
    event.preventDefault();
    if (overlay.classList.contains("is-bonus-screen")) {
      fastForwarded = true;
      overlay.classList.add("is-leaving");
      finishAllWaiters();
      return;
    }
    playTapBounce(overlay);
    const [next] = waiters;
    if (next) next();
  };
  const onSkipAll = () => finishAllWaiters();

  overlay.addEventListener("pointerup", onAdvance);
  window.addEventListener(CRUNCH_SKIP_EVENT, onSkipAll);

  return {
    get fastForwarded() {
      return fastForwarded;
    },
    waitForTap(minMs = 0) {
      if (isCrunchSkipRequested() || fastForwarded) return Promise.resolve();
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
      if (isCrunchSkipRequested() || fastForwarded) return Promise.resolve();
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
    <div class="cutin-card card-${card.color} card-${card.suit} ${extraClass}" data-cutin-card-id="${card.id}">
      <span class="cutin-corner">${card.rank}${card.suitSymbol}</span>
      <strong>${card.rank}</strong>
      <span class="cutin-suit">${card.suitSymbol}</span>
    </div>
  `;
}

async function transitionSourceCardsIntoCutin(overlay, sourceCards, advance) {
  const sources = sourceCards
    .filter(({ card, element }) => card?.id && element?.isConnected)
    .map(({ card, element }) => ({ card, element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
  if (!sources.length || isCrunchSkipRequested()) return () => {};

  const targets = [...overlay.querySelectorAll(".cutin-card[data-cutin-card-id]")];
  const hiddenSources = [];
  const animations = [];

  sources.forEach(({ card, element, rect }, index) => {
    const target = targets.find((candidate) => candidate.dataset.cutinCardId === card.id);
    if (!target) return;
    target.classList.add("cutin-shared-target", "cutin-shared-target-hidden", "cutin-layout-proxy");
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      target.classList.remove("cutin-shared-target", "cutin-shared-target-hidden", "cutin-layout-proxy");
      return;
    }

    const flight = element.cloneNode(true);
    flight.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    flight.removeAttribute("id");
    flight.removeAttribute("aria-label");
    flight.setAttribute("aria-hidden", "true");
    flight.dataset.cutinCardId = card.id;
    flight.disabled = true;
    flight.classList.remove(
      "card-selected",
      "card-match-glow",
      "resolve-reference-card",
      "resolve-selected-card",
      "is-vibrating",
      "is-hand-selected",
      "is-staged-card"
    );
    flight.classList.add("cutin-shared-card-flight");
    flight.style.left = `${targetRect.left}px`;
    flight.style.top = `${targetRect.top}px`;
    flight.style.width = `${targetRect.width}px`;
    flight.style.height = `${targetRect.height}px`;

    const translateX = rect.left - targetRect.left;
    const translateY = rect.top - targetRect.top;
    const scaleX = rect.width / targetRect.width;
    const scaleY = rect.height / targetRect.height;
    const delay = index * CUTSCENE_CONFIG.sharedCardStagger;
    const duration = CUTSCENE_CONFIG.sharedCardDuration;

    overlay.appendChild(flight);
    element.classList.add("cutin-shared-source-hidden");
    hiddenSources.push(element);
    const animation = flight.animate([
      {
        transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`,
        filter: "brightness(1.14) drop-shadow(0 0 24px rgba(255, 207, 72, .82))",
        offset: 0
      },
      {
        transform: `translate3d(${translateX * .9}px, ${translateY * .8 - 14}px, 0) scale(${scaleX * 1.025}, ${scaleY * 1.025})`,
        filter: "brightness(1.28) drop-shadow(0 0 34px rgba(255, 215, 92, .95))",
        offset: .24
      },
      {
        transform: `translate3d(${translateX * .24}px, ${translateY * .2 - 9}px, 0) scale(${1 + (scaleX - 1) * .2}, ${1 + (scaleY - 1) * .2})`,
        filter: "brightness(1.18) drop-shadow(0 0 22px rgba(255, 207, 72, .72))",
        offset: .78
      },
      {
        transform: "translate3d(0, 0, 0) scale(1)",
        filter: "brightness(1.08) drop-shadow(0 0 14px rgba(255, 207, 72, .52))",
        offset: 1
      }
    ], {
      duration,
      delay,
      easing: "cubic-bezier(.18, .82, .2, 1)",
      fill: "both"
    });
    animations.push({ animation, target, flight });
  });

  if (!animations.length) return () => {};
  await advance.wait(CUTSCENE_CONFIG.sharedCardDuration + Math.max(0, animations.length - 1) * CUTSCENE_CONFIG.sharedCardStagger);
  animations.forEach(({ animation, target, flight }) => {
    try {
      animation.finish();
    } catch {}
    flight.style.transform = "translate3d(0, 0, 0) scale(1)";
    flight.style.filter = "brightness(1.06) drop-shadow(0 0 14px rgba(255, 207, 72, .5))";
    animation.cancel();
    flight.classList.add("cutin-live-card");
    target.classList.add("cutin-layout-proxy");
  });

  return () => {
    animations.forEach(({ animation, target, flight }) => {
      animation.cancel();
      discardPreparedCardShards(flight);
      target.classList.remove("cutin-shared-target-hidden", "cutin-shared-target-arriving", "cutin-shared-target", "cutin-layout-proxy");
      flight.remove();
    });
    hiddenSources.forEach((element) => element.classList.remove("cutin-shared-source-hidden"));
  };
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
  if (entry.matchType === "rank") return createRepeatedMatchEquation(entry, "rank");
  if (entry.matchType === "suit") return createRepeatedMatchEquation(entry, "suitSymbol");
  if (entry.equation) {
    return `${entry.equation.left} ${entry.equation.operator} ${entry.equation.right} = ${entry.equation.result}`;
  }
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

/* Prebuilds the exact fracture pieces while the player is reading the cut-in.
   The impact frame only starts transforms, avoiding a burst of cloning/layout. */
function prepareCutinCardShards(cardElements, bankEl) {
  const cards = cardElements.filter((card) => card?.isConnected);
  if (!cards.length || !bankEl?.isConnected) return null;

  const existing = preparedShardSets.get(cards[0]);
  if (existing && existing.bankEl === bankEl && cards.every((card) => preparedShardSets.get(card) === existing)) {
    return existing;
  }

  const bankRect = bankEl.getBoundingClientRect();
  const targetX = bankRect.left + bankRect.width / 2;
  const targetY = bankRect.bottom - Math.min(8, bankRect.height * .12);
  const measurements = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
  if (!measurements.length) return null;

  const nodes = [];
  const shards = [];
  const sparks = [];
  const fragment = document.createDocumentFragment();
  const measuredPatterns = measurements.map((measurement) => ({
    ...measurement,
    pattern: createFracturePattern(measurement.card)
  }));
  const totalShardCount = measuredPatterns.reduce((total, { pattern }) => total + pattern.fragments.length, 0);
  let latestArrival = 0;
  let globalShardIndex = 0;

  measuredPatterns.forEach(({ card, rect, pattern }, cardIndex) => {
    pattern.fragments.forEach(({ points }, shardIndex) => {
        const centroid = getFractureCentroid(points);
        const pieceRandom = createSeededRandom(pattern.seed + Math.imul(shardIndex + 1, 2654435761));
        const shard = card.cloneNode(true);
        const pieceX = rect.left + centroid.x / FRACTURE_GRID.width * rect.width;
        const pieceY = rect.top + centroid.y / FRACTURE_GRID.height * rect.height;
        const verticalProgress = centroid.y / FRACTURE_GRID.height;
        const spreadX = (centroid.x - FRACTURE_GRID.width / 2) * .62 + (pieceRandom() - .5) * 9;
        const spreadY = (centroid.y - FRACTURE_GRID.height / 2) * .2 - 10 + (pieceRandom() - .5) * 6;
        const flyX = targetX - pieceX + ((shardIndex % 3) - 1) * 3;
        const flyY = targetY - pieceY;
        const archDirection = pieceX < targetX ? -1 : 1;
        const archWidth = Math.min(58, 24 + Math.abs(flyX) * .075);
        const curveX = spreadX + flyX * .2 + archDirection * archWidth;
        const curveY = spreadY + flyY * .19 - 12;
        const funnelX = flyX * .7 + archDirection * 9;
        const funnelY = flyY * .69;
        const intakeX = flyX * .93 + archDirection * 2;
        const intakeY = flyY * .92;
        const launchDelay = verticalProgress * CARD_SHARD_CONFIG.maxReleaseDelay
          + pieceRandom() * CARD_SHARD_CONFIG.pieceDelayJitter
          + cardIndex * CARD_SHARD_CONFIG.cardDelayStep;
        const travelDuration = CARD_SHARD_CONFIG.duration - verticalProgress * 92 + pieceRandom() * 18;
        const arrivalAt = launchDelay + travelDuration;
        latestArrival = Math.max(latestArrival, arrivalAt);

        shard.classList.add("cutin-card-shard");
        shard.classList.remove(
          "is-shattering",
          "cutin-live-card",
          "cutin-shared-card-flight",
          "cutin-shared-target",
          "cutin-layout-proxy"
        );
        shard.removeAttribute("data-crunch-damage");
        shard.setAttribute("aria-hidden", "true");
        shard.removeAttribute("aria-label");
        shard.querySelectorAll(".cutin-fracture-map").forEach((node) => node.remove());
        shard.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        shard.style.removeProperty("filter");
        shard.style.removeProperty("transform");
        shard.style.left = `${rect.left}px`;
        shard.style.top = `${rect.top}px`;
        shard.style.width = `${rect.width}px`;
        shard.style.height = `${rect.height}px`;
        shard.style.clipPath = createFractureClipPath(points);
        shard.style.transformOrigin = `${centroid.x / FRACTURE_GRID.width * 100}% ${centroid.y / FRACTURE_GRID.height * 100}%`;
        shard.style.setProperty("--shard-break-x", `${spreadX}px`);
        shard.style.setProperty("--shard-break-y", `${spreadY}px`);
        shard.style.setProperty("--shard-curve-x", `${curveX}px`);
        shard.style.setProperty("--shard-curve-y", `${curveY}px`);
        shard.style.setProperty("--shard-funnel-x", `${funnelX}px`);
        shard.style.setProperty("--shard-funnel-y", `${funnelY}px`);
        shard.style.setProperty("--shard-intake-x", `${intakeX}px`);
        shard.style.setProperty("--shard-intake-y", `${intakeY}px`);
        shard.style.setProperty("--shard-fly-x", `${flyX}px`);
        shard.style.setProperty("--shard-fly-y", `${flyY}px`);
        shard.style.setProperty("--shard-delay", `${launchDelay}ms`);
        shard.style.setProperty("--shard-duration", `${travelDuration}ms`);
        const rotation = (pieceRandom() - .5) * 92 + (centroid.x < FRACTURE_GRID.width / 2 ? -12 : 12);
        shard.style.setProperty("--shard-rotation-small", `${rotation * .3}deg`);
        shard.style.setProperty("--shard-rotation-mid", `${rotation * .72}deg`);
        shard.style.setProperty("--shard-rotation", `${rotation}deg`);
        registerShardBankContact(shard, bankEl, {
          progress: (globalShardIndex + 1) / totalShardCount,
          strength: verticalProgress < .28 ? .85 : 1
        });
        globalShardIndex += 1;
        nodes.push(shard);
        shards.push(shard);
        fragment.appendChild(shard);
    });
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
    sparks.push(spark);
    fragment.appendChild(spark);
  }

  document.body.appendChild(fragment);
  const prepared = {
    bankEl,
    cards: measurements.map(({ card }) => card),
    nodes,
    shards,
    sparks,
    latestArrival,
    totalDuration: Math.max(getCardFeedDuration(measurements.length), latestArrival + 90),
    active: false
  };
  prepared.cards.forEach((card) => preparedShardSets.set(card, prepared));
  return prepared;
}

/* Reveals the pre-cut pieces in the same frame the intact cards disappear,
   then feeds them through a staggered top-to-bottom vacuum curve. */
async function feedCutinCardsToBank(cardElements, bankEl, advance = null) {
  const cards = cardElements.filter((card) => card?.isConnected);
  if (!cards.length || !bankEl?.isConnected) return;

  const prepared = prepareCutinCardShards(cards, bankEl);
  if (!prepared) return;
  prepared.active = true;
  prepared.cards.forEach((card) => card.classList.add("is-shattering", "is-consumed-after-shatter"));
  prepared.shards.forEach((shard) => shard.classList.add("is-vacuuming"));
  prepared.sparks.forEach((spark) => spark.classList.add("is-active"));
  bankEl.classList.add("bank-feeding");
  playGameSfx("crunch_vacuum");
  await waitMaybe(advance, prepared.totalDuration);
  discardPreparedShardSet(prepared);
}

function discardPreparedCardShards(card) {
  const prepared = preparedShardSets.get(card);
  if (prepared) discardPreparedShardSet(prepared);
}

function discardPreparedShardSet(prepared) {
  prepared.nodes.forEach((node) => node.remove());
  prepared.cards.forEach((card) => {
    preparedShardSets.delete(card);
    card.classList.remove("is-shattering");
    if (!prepared.active) card.classList.remove("is-consumed-after-shatter");
  });
  prepared.bankEl?.classList.remove("bank-feeding");
}

function registerShardBankContact(shard, bankEl, impact) {
  shard.addEventListener("animationend", (event) => {
    if (event.animationName !== "cutinCardShardVacuum" || !shard.isConnected || !bankEl?.isConnected) return;
    const shardRect = shard.getBoundingClientRect();
    const bankRect = bankEl.getBoundingClientRect();
    const contactPadding = 16;
    const touchesBank = shardRect.right >= bankRect.left - contactPadding
      && shardRect.left <= bankRect.right + contactPadding
      && shardRect.bottom >= bankRect.top - contactPadding
      && shardRect.top <= bankRect.bottom + contactPadding;
    if (touchesBank) playCrunchShardImpact(impact);
  }, { once: true });
}

function createFractureClipPath(points) {
  return `polygon(${points.map(({ x, y }) => (
    `${x / FRACTURE_GRID.width * 100}% ${y / FRACTURE_GRID.height * 100}%`
  )).join(", ")})`;
}

function getFractureCentroid(points) {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function getCardFeedDuration(cardCount) {
  return CARD_SHARD_CONFIG.maxReleaseDelay
    + Math.max(0, cardCount - 1) * CARD_SHARD_CONFIG.cardDelayStep
    + CARD_SHARD_CONFIG.duration
    + 110;
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
