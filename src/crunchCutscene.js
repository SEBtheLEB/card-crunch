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
  columns: 4,
  rows: 4,
  duration: 740,
  rowDurationStep: 38,
  rowReleaseDelays: [0, 100, 168, 218],
  columnDelayStep: 12,
  cardDelayStep: 18,
  intakeSparks: 10
};
const CRUNCH_DEBRIS_CONFIG = {
  maxParticles: 320,
  devicePixelRatioCap: 1.35,
  particlesPerHit: [0, 12, 20, 40],
  gravity: 1480,
  maxLifetime: 2200
};
const tapBounceTimers = new WeakMap();
const preparedShardSets = new WeakMap();
const crunchDebrisEmitters = new WeakMap();
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
        const feedDuration = getCardFeedDuration(cardElements.length, getShardGrid(cardElements.length));
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

  const shardGrid = getShardGrid(cards.length);
  cards.forEach((card) => createCardFractureMap(card, shardGrid));
  const prepared = bankEl ? prepareCutinCardShards(cards, bankEl, shardGrid) : null;

  for (let hit = 1; hit <= CUTSCENE_CONFIG.interactiveCrunchHits; hit += 1) {
    await advance.waitForTap(0);
    if (isCrunchSkipRequested()) return;

    stage.dataset.crunchHit = String(hit);
    overlay.dataset.crunchHit = String(hit);
    cards.forEach((card) => {
      card.dataset.crunchDamage = String(hit);
    });
    if (prepared) showPreparedCardAssembly(prepared, hit);
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
  const emitter = ensureCrunchDebrisEmitter(overlay);
  const activeCards = cards.filter((card) => card?.isConnected);
  if (!emitter || !activeCards.length) return;

  const reduceMotion = document.documentElement.classList.contains("reduce-motion")
    || document.body.classList.contains("reduce-motion");
  const desiredPerCard = reduceMotion
    ? Math.min(5, CRUNCH_DEBRIS_CONFIG.particlesPerHit[hit] ?? 5)
    : CRUNCH_DEBRIS_CONFIG.particlesPerHit[hit] ?? 12;
  const available = Math.max(0, CRUNCH_DEBRIS_CONFIG.maxParticles - emitter.particles.length);
  const perCard = Math.min(desiredPerCard, Math.floor(available / activeCards.length));

  activeCards.forEach((card, cardIndex) => {
    const rect = card.getBoundingClientRect();
    let randomState = ((hit + 1) * 2654435761 + (cardIndex + 3) * 2246822519 + Math.round(rect.left * 17)) >>> 0;
    const nextRandom = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    const palette = card.classList.contains("card-red")
      ? ["#fff0c6", "#e74a5f", "#792031"]
      : ["#fff0c6", "#26324b", "#111827"];

    for (let index = 0; index < perCard; index += 1) {
      const horizontalBias = nextRandom() < .5 ? -1 : 1;
      const size = 3 + Math.floor(nextRandom() * (hit === 3 ? 7 : 5));
      emitter.particles.push({
        x: rect.left + rect.width * (.12 + nextRandom() * .76),
        y: rect.top + rect.height * (.16 + nextRandom() * .66),
        vx: horizontalBias * (65 + nextRandom() * (150 + hit * 42)),
        vy: -(190 + nextRandom() * (210 + hit * 42)),
        gravity: CRUNCH_DEBRIS_CONFIG.gravity * (.86 + nextRandom() * .28),
        drag: .986 + nextRandom() * .008,
        size,
        length: size + 2 + Math.floor(nextRandom() * 7),
        vertical: nextRandom() > .55,
        color: index % 7 === 0 ? "#ffc83d" : palette[index % palette.length],
        edge: index % 7 === 0 ? "#8c4c05" : palette[2],
        age: 0,
        delay: (index % 8) * 10,
        maxAge: CRUNCH_DEBRIS_CONFIG.maxLifetime - Math.floor(nextRandom() * 280)
      });
    }
  });

  startCrunchDebrisEmitter(emitter);
}

function ensureCrunchDebrisEmitter(overlay) {
  const existing = crunchDebrisEmitters.get(overlay);
  if (existing?.canvas?.isConnected) return existing;

  const canvas = document.createElement("canvas");
  canvas.className = "cutin-crunch-debris-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return null;

  const emitter = {
    overlay,
    canvas,
    context,
    particles: [],
    running: false,
    lastFrame: 0,
    width: 0,
    height: 0,
    dpr: 1
  };
  syncCrunchDebrisCanvas(emitter);
  overlay.appendChild(canvas);
  crunchDebrisEmitters.set(overlay, emitter);
  return emitter;
}

function syncCrunchDebrisCanvas(emitter) {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, CRUNCH_DEBRIS_CONFIG.devicePixelRatioCap);
  if (emitter.width === width && emitter.height === height && emitter.dpr === dpr) return;
  emitter.width = width;
  emitter.height = height;
  emitter.dpr = dpr;
  emitter.canvas.width = Math.round(width * dpr);
  emitter.canvas.height = Math.round(height * dpr);
  emitter.canvas.style.width = `${width}px`;
  emitter.canvas.style.height = `${height}px`;
  emitter.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  emitter.context.imageSmoothingEnabled = false;
}

function startCrunchDebrisEmitter(emitter) {
  if (emitter.running) return;
  emitter.running = true;
  emitter.lastFrame = performance.now();

  const drawFrame = (now) => {
    if (!emitter.canvas.isConnected || !emitter.overlay.isConnected) {
      emitter.running = false;
      emitter.particles.length = 0;
      return;
    }

    syncCrunchDebrisCanvas(emitter);
    const deltaSeconds = Math.min(.034, Math.max(.001, (now - emitter.lastFrame) / 1000));
    emitter.lastFrame = now;
    const { context, width, height, particles } = emitter;
    context.clearRect(0, 0, width, height);

    let writeIndex = 0;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.age += deltaSeconds * 1000;
      if (particle.age < particle.delay) {
        particles[writeIndex] = particle;
        writeIndex += 1;
        continue;
      }

      particle.vy += particle.gravity * deltaSeconds;
      particle.vx *= Math.pow(particle.drag, deltaSeconds * 60);
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      if (particle.y > height + 24 || particle.age > particle.maxAge || particle.x < -60 || particle.x > width + 60) continue;

      const fade = particle.age > particle.maxAge - 260
        ? Math.max(0, (particle.maxAge - particle.age) / 260)
        : 1;
      drawPixelCrumb(context, particle, fade);
      particles[writeIndex] = particle;
      writeIndex += 1;
    }
    particles.length = writeIndex;

    if (particles.length) {
      window.requestAnimationFrame(drawFrame);
    } else {
      emitter.running = false;
      context.clearRect(0, 0, width, height);
    }
  };

  window.requestAnimationFrame(drawFrame);
}

function drawPixelCrumb(context, particle, opacity) {
  const x = Math.round(particle.x);
  const y = Math.round(particle.y);
  const width = particle.vertical ? particle.size : particle.length;
  const height = particle.vertical ? particle.length : particle.size;
  context.globalAlpha = opacity;
  context.fillStyle = particle.edge;
  context.fillRect(x - 1, y - 1, width + 2, height + 2);
  context.fillStyle = particle.color;
  context.fillRect(x, y, width, height);
  context.fillStyle = "rgba(255, 248, 200, .72)";
  context.fillRect(x, y, Math.max(1, Math.floor(width * .55)), 1);
  if (width >= 7 || height >= 7) {
    context.clearRect(x + width - 2, y + height - 2, 2, 2);
  }
  context.globalAlpha = 1;
}

function getShardGrid(cardCount) {
  if (cardCount <= 2) return { columns: 4, rows: 4 };
  return { columns: 3, rows: 3 };
}

function createCardFractureMap(card, grid = CARD_SHARD_CONFIG) {
  if (!card || card.querySelector(".cutin-fracture-map")) return;
  const namespace = "http://www.w3.org/2000/svg";
  const layer = document.createElement("span");
  const svg = document.createElementNS(namespace, "svg");
  layer.className = "cutin-fracture-map";
  layer.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const variant = row * grid.columns + column;
      const polygon = document.createElementNS(namespace, "polygon");
      polygon.classList.add("cutin-fracture-piece");
      polygon.setAttribute("points", getPixelShardPolygon(column, row, variant, grid.columns, grid.rows)
        .map(([x, y]) => `${x},${y}`)
        .join(" "));
      svg.appendChild(polygon);
    }
  }

  layer.appendChild(svg);
  card.appendChild(layer);
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
function prepareCutinCardShards(cardElements, bankEl, requestedGrid = null) {
  const cards = cardElements.filter((card) => card?.isConnected);
  if (!cards.length || !bankEl?.isConnected) return null;
  const grid = requestedGrid ?? getShardGrid(cards.length);

  const existing = preparedShardSets.get(cards[0]);
  if (existing
    && existing.bankEl === bankEl
    && existing.grid.columns === grid.columns
    && existing.grid.rows === grid.rows
    && cards.every((card) => preparedShardSets.get(card) === existing)) {
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
  const seams = [];
  const fragment = document.createDocumentFragment();
  const totalShardCount = measurements.length * grid.rows * grid.columns;
  let latestArrival = 0;

  measurements.forEach(({ card, rect }, cardIndex) => {
    const seam = createPrecutSeamOverlay(card, rect, grid);
    if (seam) {
      seams.push(seam);
      nodes.push(seam);
      fragment.appendChild(seam);
    }

    const shardTemplate = card.cloneNode(true);
    shardTemplate.querySelectorAll(".cutin-fracture-map").forEach((node) => node.remove());
    shardTemplate.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    shardTemplate.classList.remove(
      "is-shattering",
      "cutin-live-card",
      "cutin-shared-card-flight",
      "cutin-shared-target",
      "cutin-layout-proxy"
    );
    shardTemplate.removeAttribute("data-crunch-damage");
    shardTemplate.removeAttribute("aria-label");

    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const shardIndex = row * grid.columns + column;
        const shard = shardTemplate.cloneNode(true);
        const cellWidth = 100 / grid.columns;
        const cellHeight = 100 / grid.rows;
        const pieceX = rect.left + (column + .5) * (rect.width / grid.columns);
        const pieceY = rect.top + (row + .5) * (rect.height / grid.rows);
        const centerColumn = (grid.columns - 1) / 2;
        const centerRow = (grid.rows - 1) / 2;
        const spreadX = (column - centerColumn) * 19 + ((shardIndex + cardIndex) % 3 - 1) * 5;
        const spreadY = (row - centerRow) * 13 - 8 - (shardIndex % 2) * 4;
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
        const rowDelay = CARD_SHARD_CONFIG.rowReleaseDelays[row] ?? row * 55;
        const launchDelay = rowDelay + column * CARD_SHARD_CONFIG.columnDelayStep + cardIndex * CARD_SHARD_CONFIG.cardDelayStep;
        const travelDuration = CARD_SHARD_CONFIG.duration - row * CARD_SHARD_CONFIG.rowDurationStep + ((column + cardIndex) % 3) * 5;
        const arrivalAt = launchDelay + travelDuration;
        latestArrival = Math.max(latestArrival, arrivalAt);

        shard.classList.add("cutin-card-shard");
        shard.setAttribute("aria-hidden", "true");
        shard.style.removeProperty("filter");
        shard.style.removeProperty("transform");
        shard.style.left = `${rect.left}px`;
        shard.style.top = `${rect.top}px`;
        shard.style.width = `${rect.width}px`;
        shard.style.height = `${rect.height}px`;
        shard.style.clipPath = createPixelShardClip(column, row, shardIndex, grid.columns, grid.rows);
        shard.style.transformOrigin = `${(column + .5) * cellWidth}% ${(row + .5) * cellHeight}%`;
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
        const rotation = (column - row) * 26 + (shardIndex % 2 ? 18 : -18);
        shard.style.setProperty("--shard-rotation-small", `${rotation * .3}deg`);
        shard.style.setProperty("--shard-rotation-mid", `${rotation * .72}deg`);
        shard.style.setProperty("--shard-rotation", `${rotation}deg`);
        registerShardBankContact(shard, bankEl, {
          progress: (cardIndex * grid.rows * grid.columns + shardIndex + 1) / totalShardCount,
          strength: row === 0 ? .85 : 1
        });
        nodes.push(shard);
        shards.push(shard);
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
    seams,
    grid,
    latestArrival,
    totalDuration: Math.max(getCardFeedDuration(measurements.length, grid), latestArrival + 90),
    active: false
  };
  prepared.cards.forEach((card) => preparedShardSets.set(card, prepared));
  return prepared;
}

function createPrecutSeamOverlay(card, rect, grid) {
  const fractureMap = card.querySelector(".cutin-fracture-map");
  if (!fractureMap) return null;

  const seam = fractureMap.cloneNode(true);
  seam.className = "precut-seam-overlay";
  seam.setAttribute("aria-hidden", "true");
  seam.style.left = `${rect.left}px`;
  seam.style.top = `${rect.top}px`;
  seam.style.width = `${rect.width}px`;
  seam.style.height = `${rect.height}px`;
  seam.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));

  let nodeIndex = 0;
  for (let row = 1; row < grid.rows; row += 1) {
    for (let column = 1; column < grid.columns; column += 1) {
      const node = document.createElement("i");
      node.className = "precut-fracture-node";
      node.style.left = `${column / grid.columns * 100}%`;
      node.style.top = `${row / grid.rows * 100}%`;
      node.style.setProperty("--node-delay", `${nodeIndex * 14}ms`);
      seam.appendChild(node);
      nodeIndex += 1;
    }
  }
  return seam;
}

function showPreparedCardAssembly(prepared, hit) {
  if (!prepared || prepared.active) return;
  prepared.cards.forEach((card) => card.classList.add("is-precut-source"));
  prepared.shards.forEach((shard) => {
    shard.classList.add("is-precut-piece");
    shard.classList.toggle("is-precut-light", hit === 1);
    shard.classList.toggle("is-precut-heavy", hit >= 2);
    shard.dataset.crunchDamage = String(hit);
  });
  prepared.seams.forEach((seam) => {
    seam.classList.toggle("is-growing", hit >= 2);
    seam.classList.toggle("is-break-ready", hit >= 3);
  });
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
  prepared.shards.forEach((shard) => {
    shard.classList.remove("is-precut-piece", "is-precut-light", "is-precut-heavy");
    shard.removeAttribute("data-crunch-damage");
    shard.classList.add("is-vacuuming");
  });
  prepared.seams.forEach((seam) => seam.remove());
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
    card.classList.remove("is-shattering", "is-precut-source");
    if (!prepared.active) card.classList.remove("is-consumed-after-shatter");
  });
  prepared.bankEl?.classList.remove("bank-feeding");
}

function registerShardBankContact(shard, bankEl, impact) {
  shard.addEventListener("animationend", (event) => {
    if (event.animationName !== "cutinCardShardVacuum" || !shard.isConnected || !bankEl?.isConnected) return;
    // Every path is calculated to terminate inside the intake. Avoiding a
    // geometry read here prevents a forced layout for every arriving shard.
    playCrunchShardImpact(impact);
  }, { once: true });
}

function createPixelShardClip(column, row, variant, columns, rows) {
  return `polygon(${getPixelShardPolygon(column, row, variant, columns, rows)
    .map(([x, y]) => `${x}% ${y}%`)
    .join(", ")})`;
}

function getPixelShardPolygon(column, row, variant, columns = CARD_SHARD_CONFIG.columns, rows = CARD_SHARD_CONFIG.rows) {
  const cellWidth = 100 / columns;
  const cellHeight = 100 / rows;
  const overlap = .35;
  const x0 = Math.max(0, column * cellWidth - overlap);
  const x1 = Math.min(100, (column + 1) * cellWidth + overlap);
  const y0 = Math.max(0, row * cellHeight - overlap);
  const y1 = Math.min(100, (row + 1) * cellHeight + overlap);
  const stepX = 3.4 + (variant % 3) * .7;
  const stepY = 3.5 + ((variant + row) % 3) * .65;
  const topShift = variant % 2 === 0 ? stepY : 0;
  const bottomShift = variant % 2 === 0 ? 0 : stepY;

  return [
    [x0, y0 + topShift],
    [x0 + stepX, y0 + topShift],
    [x0 + stepX, y0],
    [x1 - stepX, y0],
    [x1 - stepX, y0 + stepY],
    [x1, y0 + stepY],
    [x1, y1 - bottomShift],
    [x1 - stepX, y1 - bottomShift],
    [x1 - stepX, y1],
    [x0 + stepX, y1],
    [x0 + stepX, y1 - stepY],
    [x0, y1 - stepY]
  ];
}

function getCardFeedDuration(cardCount, grid = CARD_SHARD_CONFIG) {
  const lastRow = grid.rows - 1;
  const lastColumn = grid.columns - 1;
  const finalRowDelay = CARD_SHARD_CONFIG.rowReleaseDelays[lastRow] ?? lastRow * 55;
  const finalTravelDuration = CARD_SHARD_CONFIG.duration - lastRow * CARD_SHARD_CONFIG.rowDurationStep + 10;
  return finalRowDelay
    + lastColumn * CARD_SHARD_CONFIG.columnDelayStep
    + Math.max(0, cardCount - 1) * CARD_SHARD_CONFIG.cardDelayStep
    + finalTravelDuration
    + 90;
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
