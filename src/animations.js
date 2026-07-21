import {
  CRUNCH_SKIP_EVENT,
  hideCrunchSkipText,
  isCrunchSkipRequested,
  showCrunchSkipText
} from "./crunchCutscene.js?v=173";
import { playGameSfx } from "./audio.js?v=164";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RESOLVE_HIGHLIGHT_DURATION_MS = 700;

function createSequenceAdvanceController() {
  const waiters = new Set();
  const finishAllWaiters = () => {
    [...waiters].forEach((finish) => finish(true));
  };
  const onAdvance = (event) => {
    if (event.target?.closest?.(".crunch-skip-text")) return;
    if (document.querySelector(".crunch-cutscene-overlay")) return;
    event.preventDefault();
    const [next] = waiters;
    if (next) next();
  };
  const onSkipAll = () => finishAllWaiters();

  document.addEventListener("pointerup", onAdvance, { capture: true });
  window.addEventListener(CRUNCH_SKIP_EVENT, onSkipAll);

  return {
    waitForTap(minMs = 0) {
      if (isCrunchSkipRequested()) return Promise.resolve();
      return new Promise((resolve) => {
        let finished = false;
        let canAdvance = minMs <= 0;
        const finish = () => {
          if (finished || !canAdvance) return;
          finished = true;
          window.clearTimeout(guardId);
          waiters.delete(tapToAdvance);
          resolve();
        };
        const tapToAdvance = (force = false) => {
          if (force) canAdvance = true;
          finish();
        };
        const guardId = window.setTimeout(() => {
          canAdvance = true;
        }, minMs);
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
      document.removeEventListener("pointerup", onAdvance, { capture: true });
      window.removeEventListener(CRUNCH_SKIP_EVENT, onSkipAll);
    }
  };
}

function waitForAnimation(advance, ms) {
  return advance ? advance.wait(ms) : sleep(ms);
}

export const soundHooks = {
  card_select: null,
  card_deselect: null,
  valid_add: null,
  invalid_card: null,
  bust: null,
  crunch_start: null,
  suit_match: null,
  rank_match: null,
  math_combo: null,
  double_match: null,
  score_step: null,
  score_total: null,
  score_arrive: null,
  bank: null,
  revive: null,
  no_match: null,
  timer_warning: null,
  target_clear: null,
  level_clear: null,
  fever_start: null,
  fever_end: null,
  game_over: null
};

export function playSfx(name) {
  playGameSfx(name);
  if (typeof soundHooks[name] === "function") {
    soundHooks[name]();
  }
}

export function playHook(name) {
  const aliases = {
    cardSelect: "card_select",
    matchGlow: "rank_match",
    pointsFly: "score_total",
    scoreArrive: "score_arrive",
    noMatch: "no_match",
    timerWarning: "timer_warning",
    gameOver: "game_over"
  };
  playSfx(aliases[name] ?? name);
}

export async function animateValidMove({ handCard, tableCards, tableSlots, scoreEl, points, type, breakdown = [], fever = false, onPointsArrive }) {
  const isDouble = tableCards.length > 1;
  const particleType = fever ? "fever" : type === "suit" ? "suit" : type === "rank" ? "rank" : "math";
  playSfx("card_select");
  handCard?.classList.add("card-selected", "is-selected", "is-vibrating");
  if (handCard) {
    const rect = handCard.getBoundingClientRect();
    spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, isDouble ? 22 : 14, particleType);
  }
  await sleep(170);

  playSfx(isDouble ? "double_match" : type === "suit" ? "suit_match" : type === "rank" ? "rank_match" : "math_combo");
  tableCards.forEach((card) => {
    card.classList.add("card-match-glow", "is-matched", "is-vibrating");
    const rect = card.getBoundingClientRect();
    spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, isDouble ? 24 : 14, isDouble ? "double" : particleType);
  });
  tableSlots.forEach((slot) => slot.classList.add("case-match-glow", "slot-matched"));

  if (type === "add" || type === "subtract") {
    document.body.classList.add("screen-bump");
    drawComboStreak(handCard, tableCards);
  }

  await sleep(260);
  await showScoreBreakdown({ fromElements: tableCards, steps: breakdown });
  await flyPoints({ fromElements: tableCards, toElement: scoreEl, points, type: fever ? "fever" : particleType });

  onPointsArrive?.();
  scoreEl.classList.add("score-bump");
  const scoreRect = scoreEl.getBoundingClientRect();
  spawnSparkBurst(scoreRect.left + scoreRect.width / 2, scoreRect.top + scoreRect.height / 2, fever ? 34 : 24, fever ? "fever" : "impact");
  playSfx("score_arrive");
  await sleep(260);

  handCard?.classList.remove("card-selected", "is-selected", "is-vibrating");
  tableCards.forEach((card) => card.classList.remove("card-match-glow", "is-matched", "is-vibrating"));
  tableSlots.forEach((slot) => slot.classList.remove("case-match-glow", "slot-matched"));
  document.body.classList.remove("screen-bump");
  scoreEl.classList.remove("score-bump");
}

export async function animateStackAdd({ handCard, matchedCards, matchedSlots, matchType, label }) {
  const particleType = matchType === "suit" ? "suit" : matchType === "rank" ? "rank" : "math";
  playSfx("card_select");
  handCard?.classList.add("card-selected", "is-selected", "is-vibrating");
  burstAround(handCard, 14, particleType);
  await sleep(120);

  matchedCards.forEach((card) => card.classList.add("card-match-glow", "is-matched", "is-vibrating"));
  matchedSlots.forEach((slot) => slot.classList.add("case-match-glow", "slot-matched"));
  matchedCards.forEach((card) => burstAround(card, 10, particleType));
  if (matchType === "sequence" || matchType === "add" || matchType === "subtract") drawComboStreak(handCard, matchedCards);
  await popStoredLabel(handCard ?? matchedCards[0], label, particleType);
  await sleep(180);

  handCard?.classList.remove("card-selected", "is-selected", "is-vibrating");
  matchedCards.forEach((card) => card.classList.remove("card-match-glow", "is-matched", "is-vibrating"));
  matchedSlots.forEach((slot) => slot.classList.remove("case-match-glow", "slot-matched"));
}

export async function animateSelectionResolve({
  selectedHandCards,
  baseStackCards,
  resolution,
  fail,
  onEntryResolved,
  presentationEntries = null,
  retainConsumedSources = true,
  fullHand = null,
  fullHandCards = [],
  onFullHandResolved = null
}) {
  const elementByCardId = new Map();
  resolution.activeStack.slice(0, baseStackCards.length).forEach((card, index) => {
    if (card?.id && baseStackCards[index]) elementByCardId.set(card.id, baseStackCards[index]);
  });
  resolution.history.forEach((entry, index) => {
    if (entry.card?.id && selectedHandCards[index]) elementByCardId.set(entry.card.id, selectedHandCards[index]);
  });
  const visualEntries = presentationEntries?.length
    ? presentationEntries
    : resolution.history.map((entry, index) => ({ ...entry, selectedIndexes: [index] }));
  const limit = visualEntries.length;
  const advance = createSequenceAdvanceController();
  let clearSpotlight = () => {};
  showCrunchSkipText();

  try {
    if (!fail && fullHand && selectedHandCards.length === 4) {
      const fullHandElements = selectedHandCards.filter(Boolean);
      fullHandElements.forEach((card) => {
        card.classList.remove("cutin-shared-source-hidden");
        card.classList.add("card-selected", "resolve-selected-card", "resolve-full-hand-card", "is-vibrating");
      });
      const shell = fullHandElements[0]?.closest(".game-shell, .tutorial-page");
      shell?.classList.add("resolve-full-hand");
      clearSpotlight = applyResolveSpotlight(fullHandElements);
      playSfx("score_total");
      fullHandElements.forEach((card) => burstAround(card, 18, "double"));
      await advance.wait(RESOLVE_HIGHLIGHT_DURATION_MS);
      await onFullHandResolved?.({
        sourceCards: fullHandCards.map((card, index) => ({ card, element: selectedHandCards[index] }))
          .filter(({ card, element }) => Boolean(card && element))
      });
      fullHandElements.forEach((card) => {
        card.classList.remove("card-selected", "resolve-selected-card", "resolve-full-hand-card", "is-vibrating");
      });
      shell?.classList.remove("resolve-full-hand");
      clearSpotlight();
      clearSpotlight = () => {};
      await advance.wait(120);
    }

    for (let i = 0; i < limit; i += 1) {
      const entry = visualEntries[i];
      const selectedIndexes = entry.selectedIndexes?.length ? entry.selectedIndexes : [i];
      const selectedCards = selectedIndexes.map((index) => selectedHandCards[index]).filter(Boolean);
      const handCard = elementByCardId.get(entry.card?.id) ?? selectedCards.at(-1);
      const matchedCards = [...new Set((entry.matchedCards ?? [])
        .map((card) => elementByCardId.get(card?.id))
        .filter(Boolean))];
      const emphasizedCards = [...new Set([...selectedCards, ...matchedCards])];
      emphasizedCards.forEach((card) => card.classList.remove("cutin-shared-source-hidden"));
      playSfx("card_resolve");
      const particleType = entry.matchType === "suit" ? "suit" : entry.matchType === "rank" ? "rank" : "math";
      selectedCards.forEach((card) => card.classList.add("card-selected", "resolve-selected-card", "is-vibrating"));
      matchedCards.forEach((card) => card.classList.add("card-match-glow", "resolve-reference-card", "is-vibrating"));
      clearSpotlight = applyResolveSpotlight(emphasizedCards);
      const burstAmount = Math.max(5, Math.floor(32 / Math.max(1, emphasizedCards.length)));
      emphasizedCards.forEach((card) => burstAround(card, burstAmount, particleType));
      if (entry.matchType === "sequence" || entry.matchType === "add" || entry.matchType === "subtract") drawComboStreak(handCard, matchedCards);
      await advance.wait(RESOLVE_HIGHLIGHT_DURATION_MS);
      await onEntryResolved?.(entry, i, {
        sourceCards: [
          ...entry.matchedCards.map((card, index) => ({ card, element: matchedCards[index] })),
          { card: entry.card, element: handCard }
        ].filter(({ element }) => Boolean(element))
      });
      matchedCards.forEach((card) => card.classList.remove("card-match-glow", "resolve-reference-card", "is-vibrating"));
      selectedCards.forEach((card) => card.classList.remove("card-selected", "resolve-selected-card", "is-vibrating"));
      clearSpotlight();
      clearSpotlight = () => {};
      await advance.wait(120);
    }

    if (fail) {
      const failedCard = selectedHandCards[resolution.failedIndex];
      failedCard?.classList.remove("cutin-shared-source-hidden");
      failedCard?.classList.add("resolve-selected-card", "is-invalid");
      clearSpotlight = applyResolveSpotlight([failedCard]);
      burstAround(failedCard, 20, "red");
      await advance.wait(520);
      failedCard?.classList.remove("resolve-selected-card", "is-invalid");
      clearSpotlight();
      clearSpotlight = () => {};
    }
  } finally {
    clearSpotlight();
    selectedHandCards.forEach((card) => card?.classList.remove("resolve-full-hand-card"));
    document.querySelectorAll(".game-shell.resolve-full-hand, .tutorial-page.resolve-full-hand")
      .forEach((shell) => shell.classList.remove("resolve-full-hand"));
    if (!retainConsumedSources) {
      [...selectedHandCards, ...baseStackCards].forEach((card) => card?.classList.remove("cutin-shared-source-hidden"));
    }
    advance.destroy();
    hideCrunchSkipText();
  }
}

function applyResolveSpotlight(cards) {
  const activeCards = cards.filter(Boolean);
  const shell = activeCards
    .map((card) => card.closest(".game-shell, .tutorial-page"))
    .find(Boolean) ?? document.querySelector("#gameShell");
  const slots = activeCards.map((card) => card.closest(".table-card-slot")).filter(Boolean);

  shell?.classList.add("resolve-spotlight");
  slots.forEach((slot) => slot.classList.add("resolve-reference-slot"));

  return () => {
    shell?.classList.remove("resolve-spotlight");
    slots.forEach((slot) => slot.classList.remove("resolve-reference-slot"));
  };
}

export async function animateCrunch({ stackCards, crunchButton, scoreEl, breakdown, points, fever }) {
  crunchButton?.classList.add("crunch-slam");
  stackCards.forEach((card) => card.classList.add("card-match-glow", "is-vibrating"));
  const center = getCombinedRect(stackCards.length ? stackCards : [scoreEl]);
  spawnSparkBurst(center.left + center.width / 2, center.top + center.height / 2, fever ? 44 : 30, fever ? "fever" : "double");
  await sleep(260);
  await showScoreBreakdown({ fromElements: stackCards.length ? stackCards : [scoreEl], steps: breakdown });
  await flyPoints({ fromElements: stackCards.length ? stackCards : [scoreEl], toElement: scoreEl, points, type: fever ? "fever" : "gold" });
  scoreEl.classList.add("score-bump");
  burstAround(scoreEl, fever ? 34 : 24, fever ? "fever" : "impact");
  playSfx("score_arrive");
  await sleep(260);
  crunchButton?.classList.remove("crunch-slam");
  stackCards.forEach((card) => card.classList.remove("card-match-glow", "is-vibrating"));
  scoreEl.classList.remove("score-bump");
}

export async function animateBust({ boardEl, stackCards, handCard, protectedBust = false }) {
  playSfx(protectedBust ? "valid_add" : "bust");
  boardEl?.classList.add(protectedBust ? "target-clear-bump" : "bust-shake");
  handCard?.classList.add("is-invalid");
  stackCards.forEach((card, index) => {
    card.classList.add("stack-scatter");
    card.style.setProperty("--scatter-x", `${(index - stackCards.length / 2) * 28}px`);
    card.style.setProperty("--scatter-r", `${(index % 2 ? 1 : -1) * (18 + index * 3)}deg`);
    burstAround(card, protectedBust ? 8 : 14, protectedBust ? "gold" : "red");
  });
  await sleep(protectedBust ? 520 : 720);
  boardEl?.classList.remove("target-clear-bump", "bust-shake");
  handCard?.classList.remove("is-invalid");
  stackCards.forEach((card) => {
    card.classList.remove("stack-scatter");
    card.style.removeProperty("--scatter-x");
    card.style.removeProperty("--scatter-r");
  });
}

export async function animateInvalidMove({ handCard, boardEl }) {
  playSfx("no_match");
  handCard?.classList.add("is-invalid");
  boardEl?.classList.add("board-shake");
  if (handCard) {
    const rect = handCard.getBoundingClientRect();
    spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 12, "red");
  }
  await sleep(440);
  handCard?.classList.remove("is-invalid");
  boardEl?.classList.remove("board-shake");
}

export async function animateTimeout({ boardEl }) {
  playSfx("no_match");
  boardEl?.classList.add("board-shake");
  await sleep(380);
  boardEl?.classList.remove("board-shake");
}

async function popStoredLabel(sourceEl, label, type = "gold", advance = null) {
  if (!sourceEl) return;
  const rect = sourceEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `stored-pop score-tone-${type}`;
  el.textContent = label;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * .15}px`;
  document.body.appendChild(el);
  spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 8, type);
  await waitForAnimation(advance, 520);
  el.remove();
}

async function flyPoints({ fromElements, toElement, points, type = "gold" }) {
  playSfx("score_total");
  const sourceRect = getCombinedRect(fromElements);
  const targetRect = toElement.getBoundingClientRect();
  const pointEl = document.createElement("div");
  pointEl.className = "flying-points score-fly-text";
  pointEl.textContent = `+${points} PTS`;
  document.body.appendChild(pointEl);

  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;

  pointEl.style.left = `${startX}px`;
  pointEl.style.top = `${startY}px`;
  spawnPointTrail(startX, startY, endX, endY, type);

  const animation = pointEl.animate(
    [
      { transform: "translate(-50%, -50%) scale(.8)", opacity: 0 },
      { transform: "translate(-50%, -92%) scale(1.3)", opacity: 1, offset: 0.24 },
      {
        transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.55)`,
        opacity: 0.25
      }
    ],
    { duration: 720, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "forwards" }
  );

  await Promise.race([animation.finished.catch(() => {}), sleep(820)]);
  pointEl.remove();
}

async function showScoreBreakdown({ fromElements, steps }) {
  if (!steps.length) return;
  const sourceRect = getCombinedRect(fromElements);
  const panel = document.createElement("div");
  panel.className = "score-breakdown";
  panel.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
  panel.style.top = `${sourceRect.top + sourceRect.height * .22}px`;
  document.body.appendChild(panel);

  for (const step of steps) {
    playSfx(step.kind === "total" ? "score_total" : "score_step");
    panel.className = `score-breakdown score-tone-${step.tone}`;
    panel.innerHTML = `<span>${step.label}</span><strong>${step.value}</strong>`;
    panel.classList.remove("score-step-pop", "multiplier-slam", "total-score-burst");
    void panel.offsetWidth;
    panel.classList.add(step.kind === "total" ? "total-score-burst" : step.kind === "multiplier" ? "multiplier-slam" : "score-step-pop");
    await sleep(step.kind === "total" ? 360 : 270);
  }

  panel.remove();
}

export function spawnSparkBurst(x, y, amount = 12, colorMode = "gold") {
  const sparkCount = Math.min(amount, getSparkBudget());
  const palette = {
    gold: ["#fff2a8", "#ffd166", "#ff9f1c"],
    suit: ["#9bd6ff", "#42a1ff", "#ffd166"],
    rank: ["#fff2a8", "#ffd166", "#ff9f1c"],
    math: ["#f0b7ff", "#b66cff", "#ffd166"],
    double: ["#ffffff", "#ffe894", "#ff9f1c"],
    fever: ["#ffffff", "#ffe894", "#ff4f6d", "#42e8ff", "#b66cff"],
    impact: ["#ffffff", "#ffe8a6", "#42e8ff"],
    red: ["#ff8a7a", "#ff4f6d", "#ffb199"]
  }[colorMode] ?? ["#ffd166"];

  for (let i = 0; i < sparkCount; i += 1) {
    const particle = document.createElement("i");
    particle.className = `spark-particle spark-${colorMode}`;
    const angle = Math.random() * Math.PI * 2;
    const distance = 22 + Math.random() * 58;
    const duration = 420 + Math.random() * 420;
    const scale = .7 + Math.random() * 1.4;
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.color = palette[Math.floor(Math.random() * palette.length)];
    particle.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--spark-y", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--spark-scale", `${scale}`);
    particle.style.animationDuration = `${duration}ms`;
    document.body.appendChild(particle);
    window.setTimeout(() => particle.remove(), duration + 60);
  }
}

function spawnPointTrail(startX, startY, endX, endY, type = "gold") {
  const trailCount = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches ? 7 : 9;
  for (let i = 0; i < trailCount; i += 1) {
    const t = i / trailCount;
    const x = startX + (endX - startX) * t + (Math.random() - .5) * 28;
    const y = startY + (endY - startY) * t + (Math.random() - .5) * 28;
    window.setTimeout(() => spawnSparkBurst(x, y, 2, type), i * 38);
  }
}

function getSparkBudget() {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("reduce-motion")) return 4;
  if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches) return 10;
  return 16;
}

function burstAround(element, amount, type) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, amount, type);
}

export async function animateTargetClear(shellEl) {
  shellEl?.classList.add("target-clear-bump");
  const rect = shellEl?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height * .35, 44, "fever");
  await sleep(720);
  shellEl?.classList.remove("target-clear-bump");
}

function drawComboStreak(handCard, tableCards) {
  if (!handCard || tableCards.length < 2) return;

  const handRect = handCard.getBoundingClientRect();
  const startX = handRect.left + handRect.width / 2;
  const startY = handRect.top + handRect.height / 2;

  tableCards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    const endX = rect.left + rect.width / 2;
    const endY = rect.top + rect.height / 2;
    const line = document.createElement("div");
    line.className = "combo-streak";
    const distance = Math.hypot(endX - startX, endY - startY);
    const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
    line.style.left = `${startX}px`;
    line.style.top = `${startY}px`;
    line.style.width = `${distance}px`;
    line.style.setProperty("--line-angle", `${angle}deg`);
    document.body.appendChild(line);
    window.setTimeout(() => line.remove(), 650);
  });
}

function getCombinedRect(elements) {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}
