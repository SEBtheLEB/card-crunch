import { formatCompactNumber } from "./format.js?v=152";
import { playCrunchShardImpact, playGameSfx } from "./audio.js?v=152";
import { getCardSkinAssetUrl, getCardSkinClass, getCardSkinStyle } from "./cardSkins.js?v=152";
import { getPowerCardDetails } from "./arcadeMode.js?v=152";
import { createScoreSurgePlan } from "./scoreSurge.js?v=152";

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
  sharedCardDuration: 680,
  sharedCardStagger: 58,
  interactiveCrunchHits: 3,
  finalCrackHold: 390,
  fadeOutDuration: 160
};
const CARD_SHARD_CONFIG = {
  columns: 4,
  rows: 4
};
const SHARD_PHYSICS_CONFIG = {
  explosionMinSpeed: 250,
  explosionMaxSpeed: 510,
  explosionLift: 72,
  scatterDrag: .957,
  angularDrag: .948,
  wallBounce: .42,
  wallFriction: .78,
  settleAfter: 260,
  forceSettleAfter: 620,
  hoverBeforeVacuum: 90,
  vacuumStagger: 660,
  vacuumRampDuration: 1120,
  vacuumBaseForce: 430,
  vacuumRampForce: 2250,
  vacuumSpring: 1.2,
  vacuumMaxSpeed: 1380,
  intakeRadius: 24,
  maxDuration: 4300,
  impactCrumbs: 7
};
const CRUNCH_DEBRIS_CONFIG = {
  maxParticles: 320,
  devicePixelRatioCap: 1.35,
  particlesPerHit: [0, 12, 20, 40],
  gravity: 1480,
  maxLifetime: 2200
};
const CRUNCH_CARD_SHAKE_CONFIG = {
  maxXByHit: [0, 3.6, 4.8, 6],
  maxYByHit: [0, 2.4, 3.4, 4.5],
  maxRotationByHit: [0, 1.6, 2.3, 3]
};
const MAJOR_SCORE_RAMP_CONFIG = {
  minimumMilestone: 100000,
  moveDuration: 360,
  countDuration: 1680,
  peakDuration: 620,
  returnDuration: 420,
  tickCount: 8,
  maxParticles: 150,
  devicePixelRatioCap: 1.25
};
const tapBounceTimers = new WeakMap();
const preparedShardSets = new WeakMap();
const crunchDebrisEmitters = new WeakMap();
const activeBankFeeds = new WeakMap();
let bankImpactEmitter = null;
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

export function createCrunchBankCounter({
  panelEl = null,
  labelEl = null,
  valueEl = null,
  startingValue = 0,
  coinRewards = null
} = {}) {
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
  const counterState = { value: 0 };
  const pendingBankEffects = new Set();
  let rewardedCashThrough = Math.max(0, Number(startingValue) || 0);
  let surgePeakQueue = Promise.resolve();
  let milestoneBeatQueue = Promise.resolve();

  const trackBankEffect = (effect) => {
    pendingBankEffects.add(effect);
    effect.then(
      () => pendingBankEffects.delete(effect),
      () => pendingBankEffects.delete(effect)
    );
    return effect;
  };

  const settleBankEffects = async () => {
    if (!pendingBankEffects.size) return;
    await Promise.allSettled([...pendingBankEffects]);
  };

  const awardCoinsThrough = (nextCashValue, bankRect) => {
    const targetCash = Math.max(rewardedCashThrough, Math.floor(Number(nextCashValue) || 0));
    const milestone = Math.max(1, Math.floor(Number(coinRewards?.cashMilestone) || 0));
    const coinsPerMilestone = Math.max(0, Math.floor(Number(coinRewards?.coinsPerMilestone) || 0));
    if (!coinRewards?.award || coinsPerMilestone <= 0 || targetCash <= rewardedCashThrough) {
      rewardedCashThrough = targetCash;
      return null;
    }

    const crossed = Math.max(
      0,
      Math.floor(targetCash / milestone) - Math.floor(rewardedCashThrough / milestone)
    );
    rewardedCashThrough = targetCash;
    if (crossed <= 0) return null;

    return {
      coins: crossed * coinsPerMilestone,
      milestones: crossed,
      award: coinRewards.award,
      getBalance: coinRewards.getBalance
    };
  };

  const queueMilestoneBeat = (effect) => {
    const queued = milestoneBeatQueue.then(effect);
    milestoneBeatQueue = queued.catch(() => {});
    return queued;
  };

  const queueSurgePeak = (surge) => {
    const queued = surgePeakQueue.then(() => surge.finish());
    surgePeakQueue = queued.catch(() => {});
    return queued;
  };

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

  const rollingDisplay = createRollingBankDisplay(counterValueEl);
  let value = 0;

  return {
    element,
    get value() {
      return value;
    },
    async add(amount, sourceEl, advance = null, cardElements = []) {
      amount = Math.max(0, Math.round(Number(amount) || 0));
      const previous = value;
      value += amount;
      const surge = createCrunchScoreSurge({
        bankEl: element,
        valueEl: counterValueEl,
        amount,
        cashBefore: startingValue + previous,
        onCashProgress: awardCoinsThrough,
        queueMilestoneBeat
      });
      if (cardElements.length) {
        playGameSfx("score_step");
        const feedDuration = getCardFeedDuration(cardElements.length);
        let creditedAmount = 0;
        const bankEffect = trackBankEffect(feedCutinCardsToBank(cardElements, element, ({ arrived, total }) => {
          const nextCreditedAmount = arrived >= total
            ? amount
            : Math.round(amount * arrived / Math.max(1, total));
          counterState.value += nextCreditedAmount - creditedAmount;
          creditedAmount = nextCreditedAmount;
          rollingDisplay.setTarget(counterState.value);
          surge.update(creditedAmount);
        }).then(async () => {
          if (creditedAmount < amount) {
            counterState.value += amount - creditedAmount;
            creditedAmount = amount;
            rollingDisplay.setTarget(counterState.value);
            surge.update(creditedAmount);
          }
          await rollingDisplay.settle(520);
          element.classList.add("bank-bump");
          await sleep(180);
          element.classList.remove("bank-bump");
          await queueSurgePeak(surge);
        }));

        // A tap may advance the explanation, but the detached shard feed keeps
        // its original timing, sounds, and counter roll until every piece lands.
        if (advance) await advance.wait(feedDuration);
        else await bankEffect;
        return;
      } else {
        await settleBankEffects();
        await flyValueToBank(sourceEl, element, amount, advance);
        await countBankTo(counterValueEl, previous, value, advance);
        counterState.value = value;
        surge.update(amount);
        await queueSurgePeak(surge);
      }
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async setValue(nextValue, sourceEl, flyLabel = nextValue, advance = null) {
      await settleBankEffects();
      await flyValueToBank(sourceEl, element, flyLabel, advance);
      const previous = value;
      value = nextValue;
      await countBankTo(counterValueEl, previous, value, advance);
      counterState.value = value;
      const surge = createCrunchScoreSurge({
        bankEl: element,
        valueEl: counterValueEl,
        amount: Math.max(0, value - previous),
        cashBefore: startingValue + previous,
        onCashProgress: awardCoinsThrough,
        queueMilestoneBeat
      });
      surge.update(Math.max(0, value - previous));
      await queueSurgePeak(surge);
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async rampTo(nextValue, advance = null) {
      await settleBankEffects();
      const previous = value;
      value = nextValue;
      await countBankTo(counterValueEl, previous, value, advance);
      counterState.value = value;
      const surge = createCrunchScoreSurge({
        bankEl: element,
        valueEl: counterValueEl,
        amount: Math.max(0, value - previous),
        cashBefore: startingValue + previous,
        onCashProgress: awardCoinsThrough,
        queueMilestoneBeat
      });
      surge.update(Math.max(0, value - previous));
      await queueSurgePeak(surge);
      element.classList.add("bank-bump");
      await waitMaybe(advance, 180);
      element.classList.remove("bank-bump");
    },
    async finishToScore(scoreEl, advance = null) {
      await settleBankEffects();
      rollingDisplay.flush(value);
      finished = true;
      const finalScore = startingValue + value;
      const finalCoinReward = awardCoinsThrough(finalScore, element.getBoundingClientRect());
      if (finalCoinReward) {
        await queueMilestoneBeat(() => playCrunchCoinReward(element, finalCoinReward));
      }
      element.classList.add("bank-final-flash");
      await waitMaybe(advance, 260);
      if (useHudPanel) {
        const cloneLabelEl = element.querySelector(".hud-label");
        if (cloneLabelEl) cloneLabelEl.innerHTML = originalLabel;
        element.setAttribute("aria-label", "Score");
        await countBankTo(counterValueEl, value, startingValue + value, advance);
        counterState.value = startingValue + value;
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
      rollingDisplay.destroy();
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

  element.classList.remove(
    "is-crunch-bank",
    "is-hud-bank-floating",
    "bank-final-flash",
    "bank-bump",
    "score-bump",
    "is-major-score-ramp",
    "is-major-score-ramp-active",
    "is-major-score-ramp-tick",
    "is-major-score-ramp-peak",
    "is-major-score-ramp-returning"
  );
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

  const hasSharedHandoff = sourceCards.some(({ element }) => element?.isConnected);
  const overlay = createOverlay(tier, { deferFocus: hasSharedHandoff });
  if (hasSharedHandoff) {
    overlay.classList.add("is-shared-handoff");
  }
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);
  let cleanupSharedHandoff = () => {};

  try {
    cleanupSharedHandoff = await playEntryCutin(overlay, entry, tier, advance, sourceCards, bank?.element ?? null);
    if (bank) {
      const cards = getActiveCutinCards(overlay);
      await bank.add(entry.bankPoints ?? entry.points, overlay.querySelector(".cutin-points"), advance, cards);
    }
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    cleanupSharedHandoff();
    advance.destroy();
    overlay.remove();
  }
}

export async function playCrunchTotalExplanation({ total, scoreEl, tier = "normal", bank = null }) {
  if (bank) {
    if (bank.value !== total) await bank.rampTo(total);
    await bank.finishToScore(scoreEl);
    playGameSfx("score_arrive");
    return;
  }

  const overlay = createOverlay(tier);
  const advance = createAdvanceController(overlay);
  document.body.appendChild(overlay);
  try {
    await playFinalTotal(overlay, total, scoreEl, tier, advance);
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    advance.destroy();
    overlay.remove();
  }
}

export async function playFullHandPrelude({ cards = [], fullHand = null, sourceCards = [], bank = null } = {}) {
  if (cards.length < 4 || !fullHand) return;

  const hasSharedHandoff = sourceCards.some(({ element }) => element?.isConnected);
  const overlay = createOverlay("full", { deferFocus: hasSharedHandoff });
  overlay.classList.add("is-full-hand-prelude");
  if (hasSharedHandoff) overlay.classList.add("is-shared-handoff");
  const advance = createAdvanceController(overlay);
  overlay.innerHTML = `
    <div class="cutin-stage cutin-full-hand-stage">
      <div class="cutin-full-hand-kicker">MAXIMUM COMBO</div>
      <div class="cutin-full-hand-row">
        ${cards.map((card, index) => createCutinCardMarkup(card, `full-hand-card full-hand-card-${index + 1}`)).join("")}
      </div>
      <div class="cutin-full-hand-title">${fullHand.label}</div>
      <div class="cutin-full-hand-subtitle">${fullHand.subtitle}</div>
      <div class="cutin-full-hand-bonuses">
        ${(fullHand.bonuses ?? []).map((bonus) => `
          <span><em>${bonus.label}</em><strong>${bonus.value}</strong></span>
        `).join("")}
      </div>
      <div class="cutin-points cutin-full-hand-points">+${formatCompactNumber(fullHand.bankPoints ?? 0)}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  let cleanupSharedHandoff = () => {};

  try {
    cleanupSharedHandoff = await transitionSourceCardsIntoCutin(overlay, sourceCards, advance);
    const stage = overlay.querySelector(".cutin-full-hand-stage");
    const crunchPrompt = createInteractiveCrunchPrompt(overlay);
    playGameSfx("score_total");
    stage?.classList.add("is-full-hand-ready");
    await playInteractiveCardCrunch(overlay, advance, crunchPrompt, bank?.element ?? null, { fullHand: true });
    if (bank) {
      const activeCards = getActiveCutinCards(overlay);
      await bank.add(fullHand.bankPoints ?? 0, overlay.querySelector(".cutin-full-hand-points"), advance, activeCards);
    }
    overlay.classList.add("is-leaving");
    await waitMaybe(advance, CUTSCENE_CONFIG.fadeOutDuration);
  } finally {
    cleanupSharedHandoff();
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
  const cleanupSharedHandoff = await transitionSourceCardsIntoCutin(overlay, sourceCards, advance);
  playGameSfx(getEntrySound(entry));
  await playInlineCrunchBonuses(overlay, entry, advance, bankEl);
  await playInteractiveCardCrunch(overlay, advance, crunchPrompt, bankEl);
  return cleanupSharedHandoff;
}

async function playInlineCrunchBonuses(overlay, entry, advance, bankEl = null) {
  const bonuses = entry.inlineBonuses ?? [];
  const bankPoints = entry.bankPoints ?? entry.points;
  if (!bonuses.length && bankPoints === entry.points) return;

  const stage = overlay.querySelector(".cutin-stage");
  const points = overlay.querySelector(".cutin-points");
  const reaction = overlay.querySelector(".cutin-inline-bonuses");
  if (!stage || !points || !reaction) return;

  const isMultiMatch = (entry.matchType === "rank" || entry.matchType === "suit")
    && (entry.matchCount ?? 0) >= 3;
  let runningPoints = entry.displayPoints ?? entry.points;

  for (let index = 0; index < bonuses.length; index += 1) {
    const bonus = bonuses[index];
    const bonusEl = document.createElement("span");
    const tone = bonus.tone ?? "total";
    bonusEl.className = `cutin-inline-bonus cutin-bonus-${tone}`;
    bonusEl.innerHTML = `<em>${bonus.label}</em><strong>${bonus.value}</strong>`;
    reaction.appendChild(bonusEl);

    runningPoints = applyInlineBonus(runningPoints, bonus);
    if (index === bonuses.length - 1) runningPoints = bankPoints;
    points.textContent = `+${formatCompactNumber(runningPoints)}`;
    points.classList.remove("is-multiplied");
    void points.offsetWidth;
    points.classList.add("is-multiplied");

    stage.classList.remove("is-bonus-reacting", "is-multi-match-reacting");
    void stage.offsetWidth;
    stage.classList.add("is-bonus-reacting");
    if (isMultiMatch || bonus.kind === "entry-multiplier") stage.classList.add("is-multi-match-reacting");
    stage.dataset.bonusTone = tone;
    pulseModifierBank(bankEl);
    spawnModifierBurst(overlay, bonusEl, tone);
    playGameSfx(getModifierSound(bonus, isMultiMatch));
    await advance.wait(index === 0 ? 440 : 360);
  }

  if (runningPoints !== bankPoints) {
    points.textContent = `+${formatCompactNumber(bankPoints)}`;
    points.classList.remove("is-multiplied");
    void points.offsetWidth;
    points.classList.add("is-multiplied");
  }

  stage.classList.add("is-award-ready");
  if (!bonuses.length) playGameSfx("score_total");
  await advance.wait(bonuses.length ? 240 : 380);
  stage.classList.remove("is-bonus-reacting", "is-multi-match-reacting");
  delete stage.dataset.bonusTone;
}

function applyInlineBonus(points, bonus) {
  if (Number.isFinite(bonus.multiplier) && bonus.multiplier > 1) {
    return Math.round(points * bonus.multiplier);
  }
  if (Number.isFinite(bonus.flatBonus) && bonus.flatBonus > 0) {
    return Math.round(points + bonus.flatBonus);
  }
  return points;
}

function getModifierSound(bonus, isMultiMatch) {
  if (bonus.kind === "entry-multiplier" || isMultiMatch) return "double_match";
  if (bonus.tone === "math") return "math_combo";
  return "score_step";
}

function pulseModifierBank(bankEl) {
  if (!bankEl?.isConnected) return;
  bankEl.classList.remove("bank-modifier-pulse");
  void bankEl.offsetWidth;
  bankEl.classList.add("bank-modifier-pulse");
  window.setTimeout(() => bankEl.classList.remove("bank-modifier-pulse"), 280);
}

function spawnModifierBurst(overlay, sourceEl, tone) {
  if (!overlay?.isConnected || !sourceEl?.isConnected) return;
  const rect = sourceEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const amount = document.documentElement.classList.contains("reduce-motion") ? 4 : 10;

  for (let index = 0; index < amount; index += 1) {
    const angle = (Math.PI * 2 * index) / amount + Math.random() * .28;
    const distance = 22 + Math.random() * 34;
    const spark = document.createElement("i");
    spark.className = `cutin-modifier-spark cutin-spark-${tone}`;
    spark.style.left = `${centerX}px`;
    spark.style.top = `${centerY}px`;
    spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--spark-delay", `${index * 8}ms`);
    overlay.appendChild(spark);
    window.setTimeout(() => spark.remove(), 620);
  }
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

async function playInteractiveCardCrunch(overlay, advance, prompt, bankEl = null, { fullHand = false } = {}) {
  const stage = overlay.querySelector(".cutin-stage");
  const cards = getActiveCutinCards(overlay);
  if (!stage || !cards.length || isCrunchSkipRequested()) return;

  const reactingCards = getDisplayedCrunchCards(overlay);

  const shardGrid = getShardGrid(cards.length);
  cards.forEach((card) => createCardFractureMap(card, shardGrid));
  const prepared = bankEl ? prepareCutinCardShards(cards, bankEl, shardGrid) : null;

  for (let hit = 1; hit <= CUTSCENE_CONFIG.interactiveCrunchHits; hit += 1) {
    await advance.waitForTap(0);
    if (isCrunchSkipRequested()) return;

    assignCrunchShakeVectors(reactingCards, hit);
    stage.dataset.crunchHit = String(hit);
    overlay.dataset.crunchHit = String(hit);
    cards.forEach((card) => {
      card.dataset.crunchDamage = String(hit);
    });
    if (prepared) showPreparedCardAssembly(prepared, hit);
    if (prepared && hit === CUTSCENE_CONFIG.interactiveCrunchHits) {
      startPreparedShardPhysics(prepared);
    }
    if (fullHand) {
      stage.classList.remove("is-full-hand-reacting");
      void stage.offsetWidth;
      stage.classList.add("is-full-hand-reacting");
      overlay.classList.remove("is-full-hand-impact");
      void overlay.offsetWidth;
      overlay.classList.add("is-full-hand-impact");
    }
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

function getDisplayedCrunchCards(overlay) {
  const cards = [
    ...overlay.querySelectorAll(".cutin-live-card"),
    ...overlay.querySelectorAll(".cutin-card:not(.cutin-layout-proxy)")
  ];
  return [...new Set(cards)].filter((card) => card?.isConnected);
}

function assignCrunchShakeVectors(cards, hit) {
  const hitIndex = Math.max(1, Math.min(CUTSCENE_CONFIG.interactiveCrunchHits, hit));
  const maxX = CRUNCH_CARD_SHAKE_CONFIG.maxXByHit[hitIndex];
  const maxY = CRUNCH_CARD_SHAKE_CONFIG.maxYByHit[hitIndex];
  const maxRotation = CRUNCH_CARD_SHAKE_CONFIG.maxRotationByHit[hitIndex];
  const signedMagnitude = (minimum, maximum) => {
    const direction = Math.random() < .5 ? -1 : 1;
    return direction * (minimum + Math.random() * Math.max(0, maximum - minimum));
  };
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

  cards.forEach((card, index) => {
    const xA = signedMagnitude(maxX * .48, maxX);
    const yA = signedMagnitude(maxY * .3, maxY);
    const rotationA = signedMagnitude(maxRotation * .38, maxRotation);
    const xB = clamp(-xA * (.62 + Math.random() * .22) + signedMagnitude(0, maxX * .22), maxX);
    const yB = clamp(-yA * (.48 + Math.random() * .28) + signedMagnitude(0, maxY * .22), maxY);
    const rotationB = clamp(-rotationA * (.58 + Math.random() * .24), maxRotation);
    const xC = clamp(signedMagnitude(maxX * .12, maxX * .42), maxX);
    const yC = clamp(signedMagnitude(maxY * .08, maxY * .36), maxY);
    const rotationC = clamp(signedMagnitude(maxRotation * .08, maxRotation * .32), maxRotation);

    card.style.setProperty("--crunch-shake-x-a", `${xA.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-y-a", `${yA.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-r-a", `${rotationA.toFixed(2)}deg`);
    card.style.setProperty("--crunch-shake-x-b", `${xB.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-y-b", `${yB.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-r-b", `${rotationB.toFixed(2)}deg`);
    card.style.setProperty("--crunch-shake-x-c", `${xC.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-y-c", `${yC.toFixed(2)}px`);
    card.style.setProperty("--crunch-shake-r-c", `${rotationC.toFixed(2)}deg`);
    card.style.setProperty("--crunch-shake-delay", `${Math.min(24, index * 6)}ms`);
    card.classList.add("is-crunch-shaking");
  });
}

function spawnCrunchDamageBurst(overlay, cards, hit) {
  const emitter = ensureCrunchDebrisEmitter(overlay);
  const activeCards = cards.filter((card) => card?.isConnected);
  if (!emitter || !activeCards.length) return;

  const reduceMotion = document.documentElement.classList.contains("reduce-motion")
    || document.body.classList.contains("reduce-motion");
  const fullHandBurst = overlay.classList.contains("cutscene-full") || overlay.classList.contains("is-full-hand-prelude");
  const baseDesiredPerCard = reduceMotion
    ? Math.min(5, CRUNCH_DEBRIS_CONFIG.particlesPerHit[hit] ?? 5)
    : CRUNCH_DEBRIS_CONFIG.particlesPerHit[hit] ?? 12;
  const desiredPerCard = fullHandBurst && !reduceMotion
    ? Math.round(baseDesiredPerCard * 1.75)
    : baseDesiredPerCard;
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
        color: index % (fullHandBurst ? 3 : 7) === 0 ? "#ffc83d" : palette[index % palette.length],
        edge: index % (fullHandBurst ? 3 : 7) === 0 ? "#8c4c05" : palette[2],
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
  if (particle.kind === "coin") {
    const size = Math.max(5, Math.round(particle.size));
    context.globalAlpha = opacity;
    context.fillStyle = particle.edge;
    context.fillRect(x + 1, y - 1, size - 2, size + 2);
    context.fillRect(x - 1, y + 1, size + 2, size - 2);
    context.fillStyle = particle.color;
    context.fillRect(x, y + 1, size, size - 2);
    context.fillRect(x + 1, y, size - 2, size);
    context.fillStyle = "#fff4b5";
    context.fillRect(x + 2, y + 1, Math.max(1, Math.floor(size / 3)), 2);
    context.fillStyle = "#c87908";
    context.fillRect(x + size - 3, y + 3, 2, Math.max(2, size - 5));
    context.globalAlpha = 1;
    return;
  }
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
    <div class="cutin-stage cutin-math-stage cutin-tone-${entry.matchType} ${tier === "full" ? "cutin-full" : ""}">
      <div class="cutin-card-stage cutin-math-card-stage">
        <div class="cutin-expression-row">
          ${createCutinCardMarkup(matched[0], "source source-1")}
          <div class="cutin-operator cutin-inline-operator">${operator}</div>
          ${createCutinCardMarkup(matched[1], "source source-2")}
        </div>
        <div class="cutin-answer-wrap">
          ${createCutinCardMarkup(entry.card, "answer")}
        </div>
      </div>
      <div class="cutin-result-stack">
        <div class="cutin-equation">${equation}</div>
        <div class="cutin-label">${entry.label}</div>
        <div class="cutin-inline-bonuses" aria-live="polite"></div>
        <div class="cutin-points">+${formatCompactNumber(entry.displayPoints ?? entry.points)}</div>
      </div>
    </div>
  `;
}

function createMatchCutinMarkup({ entry, matched, operator, equation, tier }) {
  return `
    <div class="cutin-stage cutin-match-stage cutin-tone-${entry.matchType} ${tier === "full" ? "cutin-full" : ""}">
      <div class="cutin-card-stage cutin-match-card-stage">
        <div class="cutin-match-row">
          ${matched.map((card, index) => createCutinCardMarkup(card, `source source-${index + 1}`)).join("")}
          ${createCutinCardMarkup(entry.card, "answer")}
        </div>
      </div>
      <div class="cutin-result-stack">
        <div class="cutin-operator">${operator}</div>
        <div class="cutin-equation">${equation}</div>
        <div class="cutin-label">${entry.label}</div>
        <div class="cutin-inline-bonuses" aria-live="polite"></div>
        <div class="cutin-points">+${formatCompactNumber(entry.displayPoints ?? entry.points)}</div>
      </div>
    </div>
  `;
}

async function playMiniEntry(overlay, entry, advance) {
  overlay.innerHTML = `
    <div class="cutin-mini">
      ${createCutinCardMarkup(entry.card, "answer mini-card")}
      <div>
        <strong>${entry.label}</strong>
        <span>+${formatCompactNumber(entry.displayPoints ?? entry.points)}</span>
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

function createOverlay(tier, { deferFocus = false } = {}) {
  const overlay = document.createElement("section");
  overlay.className = `crunch-cutscene-overlay cutscene-${tier}`;
  overlay.setAttribute("aria-live", "assertive");
  overlay.setAttribute("aria-label", "Crunch explanation. Tap to advance.");
  if (!deferFocus) document.body.classList.add("is-crunch-focus-active");
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
  const skinClass = getCardSkinClass(card);
  const skinStyle = getCardSkinStyle(card);
  const skinAssetUrl = getCardSkinAssetUrl(card);
  const power = getPowerCardDetails(card);
  const powerClass = card.powerType ? `power-card power-card-${card.powerType}` : "";
  const content = power && card.powerType !== "charged"
    ? `
      <span class="power-card-kicker">POWER</span>
      <span class="power-card-core">${power.icon}</span>
      <strong class="power-card-name">${power.shortName}</strong>
      <small class="power-card-tooltip">${power.tooltip}</small>
    `
    : `
      <span class="cutin-corner">${card.rank}${card.suitSymbol}</span>
      <strong>${card.rank}</strong>
      <span class="cutin-suit">${card.suitSymbol}</span>
      ${power ? `<span class="power-card-kicker">CHARGED</span><small class="power-card-tooltip">SCORE x2</small>` : ""}
    `;
  return `
    <div class="cutin-card card-${card.color} card-${card.suit} ${skinClass} ${powerClass} ${extraClass}" data-cutin-card-id="${card.id}" data-card-rank="${card.rank}" data-card-suit="${card.suit}"${card.powerType ? ` data-power-type="${card.powerType}"` : ""} data-equipped-skin="${skinClass.replace("card-skin-", "")}"${skinStyle ? ` style="${skinStyle}"` : ""}>
      ${skinAssetUrl ? `<img class="card-skin-art" src="${skinAssetUrl}" alt="" decoding="async" draggable="false">` : ""}
      ${content}
    </div>
  `;
}

async function transitionSourceCardsIntoCutin(overlay, sourceCards, advance) {
  const sources = sourceCards
    .filter(({ card, element }) => card?.id && element?.isConnected)
    .map(({ card, element }) => ({ card, element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
  if (!sources.length || isCrunchSkipRequested()) {
    activateSharedHandoff(overlay);
    return () => {};
  }

  const targets = [...overlay.querySelectorAll(".cutin-card[data-cutin-card-id]")];
  const transfers = [];

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
    flight.classList.remove("is-vibrating", "is-hand-selected", "is-staged-card");
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
    const initialTransform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
    const initialFilter = "brightness(1.14) drop-shadow(0 0 24px rgba(255, 207, 72, .82))";

    flight.style.transform = initialTransform;
    flight.style.filter = initialFilter;
    overlay.appendChild(flight);
    transfers.push({
      target,
      flight,
      element,
      delay,
      duration,
      frames: [
        {
          transform: initialTransform,
          filter: initialFilter,
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
      ]
    });
  });

  if (!transfers.length) {
    activateSharedHandoff(overlay);
    return () => {};
  }

  // Paint the flight cards directly over their live sources before hiding
  // anything. This removes the one-frame hole that looked like a blink.
  await waitForPaint();
  activateSharedHandoff(overlay);
  const animations = transfers.map(({ target, flight, element, delay, duration, frames }) => {
    element.classList.add("cutin-shared-source-hidden");
    const animation = flight.animate([
      ...frames
    ], {
      duration,
      delay,
      easing: "cubic-bezier(.18, .82, .2, 1)",
      fill: "both"
    });
    return { animation, target, flight };
  });

  await advance.wait(CUTSCENE_CONFIG.sharedCardDuration + Math.max(0, animations.length - 1) * CUTSCENE_CONFIG.sharedCardStagger);
  animations.forEach(({ animation, target, flight }) => {
    try {
      animation.finish();
    } catch {}
    flight.style.transform = "translate3d(0, 0, 0) scale(1)";
    flight.style.filter = "brightness(1.06) drop-shadow(0 0 14px rgba(255, 207, 72, .5))";
    animation.cancel();
    flight.classList.remove("card-selected", "card-match-glow", "resolve-reference-card", "resolve-selected-card");
    flight.classList.add("cutin-live-card");
    target.classList.add("cutin-layout-proxy");
  });

  return () => {
    animations.forEach(({ animation, target, flight }) => {
      animation.cancel();
      discardPreparedCardShards(flight);
      target.remove();
      flight.remove();
    });
  };
}

function activateSharedHandoff(overlay) {
  overlay.classList.add("is-handoff-ready");
  document.body.classList.add("is-crunch-focus-active");
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
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
  const shardStates = [];
  const seams = [];
  const fragment = document.createDocumentFragment();
  const random = createSeededRandom(measurements.reduce((seed, { card, rect }, index) => (
    seed
      ^ Math.round(rect.left * 31 + rect.top * 17 + rect.width * 13)
      ^ hashString(`${card.textContent}:${index}`)
  ), 0x9e3779b9));

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
        const cardCenterX = rect.left + rect.width / 2;
        const cardCenterY = rect.top + rect.height / 2;
        const radialAngle = Math.atan2(pieceY - cardCenterY, pieceX - cardCenterX);
        const launchAngle = radialAngle + (random() - .5) * .62;
        const launchSpeed = SHARD_PHYSICS_CONFIG.explosionMinSpeed
          + random() * (SHARD_PHYSICS_CONFIG.explosionMaxSpeed - SHARD_PHYSICS_CONFIG.explosionMinSpeed);

        shard.classList.add("cutin-card-shard");
        shard.setAttribute("aria-hidden", "true");
        shard.style.removeProperty("filter");
        shard.style.removeProperty("transform");
        shard.style.left = `${rect.left}px`;
        shard.style.top = `${rect.top}px`;
        shard.style.width = `${rect.width}px`;
        shard.style.height = `${rect.height}px`;
        shard.style.clipPath = createPixelShardClip(column, row, shardIndex, grid.columns, grid.rows);
        shard.style.setProperty("--shard-origin", `${(column + .5) * cellWidth}% ${(row + .5) * cellHeight}%`);
        shardStates.push({
          node: shard,
          originX: pieceX,
          originY: pieceY,
          width: rect.width / grid.columns,
          height: rect.height / grid.rows,
          x: 0,
          y: 0,
          vx: Math.cos(launchAngle) * launchSpeed,
          vy: Math.sin(launchAngle) * launchSpeed - SHARD_PHYSICS_CONFIG.explosionLift * (.7 + random() * .6),
          rotation: 0,
          angularVelocity: (random() - .5) * 430,
          hoverPhase: random() * Math.PI * 2,
          vacuumDelay: 0,
          vacuumDistance: 1,
          arrived: false
        });
        nodes.push(shard);
        shards.push(shard);
        fragment.appendChild(shard);
      }
    }
  });

  document.body.appendChild(fragment);
  const prepared = {
    bankEl,
    cards: measurements.map(({ card }) => card),
    nodes,
    shards,
    shardStates,
    seams,
    grid,
    targetX,
    targetY,
    totalDuration: getCardFeedDuration(measurements.length),
    active: false,
    physicsStarted: false,
    vacuumRequested: false,
    physicsFrameId: 0,
    resolvePhysics: null,
    onImpact: null,
    arrivedCount: 0
  };
  prepared.cards.forEach((card) => preparedShardSets.set(card, prepared));
  return prepared;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
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
    shard.classList.toggle("is-shattered-piece", hit >= CUTSCENE_CONFIG.interactiveCrunchHits);
    shard.dataset.crunchDamage = String(hit);
  });
  if (hit >= CUTSCENE_CONFIG.interactiveCrunchHits) {
    clearPreparedDamageArtifacts(prepared);
    return;
  }
  prepared.seams.forEach((seam) => {
    seam.classList.toggle("is-growing", hit >= 2);
  });
}

/* The third hit starts a radial scatter. Banking later switches the same
   fragments into a progressively stronger force field aimed at the intake. */
async function feedCutinCardsToBank(cardElements, bankEl, onImpact = null) {
  const cards = cardElements.filter((card) => card?.isConnected);
  if (!cards.length || !bankEl?.isConnected) return;

  const prepared = prepareCutinCardShards(cards, bankEl);
  if (!prepared) return;
  prepared.active = true;
  prepared.onImpact = onImpact;
  clearPreparedDamageArtifacts(prepared);
  prepared.cards.forEach((card) => card.classList.add("is-shattering", "is-consumed-after-shatter"));
  prepared.shards.forEach((shard) => {
    shard.classList.remove("is-precut-piece", "is-precut-light", "is-precut-heavy");
    shard.removeAttribute("data-crunch-damage");
    shard.classList.add("is-physics-active");
  });
  beginBankFeed(prepared);
  startPreparedShardPhysics(prepared);
  requestPreparedShardVacuum(prepared);
  await prepared.physicsPromise;
  discardPreparedShardSet(prepared);
}

function startPreparedShardPhysics(prepared) {
  if (!prepared || prepared.physicsStarted || prepared.disposed) return prepared?.physicsPromise;
  prepared.active = true;
  prepared.physicsStarted = true;
  prepared.physicsStartedAt = performance.now();
  prepared.lastPhysicsFrame = prepared.physicsStartedAt;
  prepared.viewportWidth = Math.max(1, window.innerWidth);
  prepared.viewportHeight = Math.max(1, window.innerHeight);
  prepared.shards.forEach((shard) => {
    shard.classList.remove("is-precut-piece", "is-precut-light", "is-precut-heavy");
    shard.classList.add("is-physics-active", "is-shattered-piece");
    shard.removeAttribute("data-crunch-damage");
    shard.style.opacity = "1";
    shard.style.transform = "translate3d(0, 0, 0) rotate(0deg) scale(1)";
  });
  clearPreparedDamageArtifacts(prepared);

  prepared.physicsPromise = new Promise((resolve) => {
    prepared.resolvePhysics = resolve;
  });
  prepared.physicsFrameId = window.requestAnimationFrame((now) => stepPreparedShardPhysics(prepared, now));
  return prepared.physicsPromise;
}

function requestPreparedShardVacuum(prepared) {
  if (!prepared || prepared.vacuumRequested || prepared.disposed) return;
  prepared.vacuumRequested = true;
  prepared.vacuumRequestedAt = performance.now();
  prepared.vacuumStartAt = Math.max(
    prepared.physicsStartedAt + SHARD_PHYSICS_CONFIG.forceSettleAfter,
    prepared.vacuumRequestedAt + SHARD_PHYSICS_CONFIG.hoverBeforeVacuum
  );

  const byDistance = [...prepared.shardStates]
    .sort((a, b) => getShardDistanceToBank(a, prepared) - getShardDistanceToBank(b, prepared));
  byDistance.forEach((state, index) => {
    state.vacuumDelay = byDistance.length <= 1
      ? 0
      : index / (byDistance.length - 1) * SHARD_PHYSICS_CONFIG.vacuumStagger;
    state.vacuumDistance = Math.max(1, getShardDistanceToBank(state, prepared));
  });
}

function stepPreparedShardPhysics(prepared, now) {
  if (prepared.disposed) return finishPreparedShardPhysics(prepared);
  const deltaSeconds = Math.min(.034, Math.max(.001, (now - prepared.lastPhysicsFrame) / 1000));
  prepared.lastPhysicsFrame = now;
  const elapsed = now - prepared.physicsStartedAt;
  const vacuumElapsed = prepared.vacuumRequested ? now - prepared.vacuumStartAt : -1;
  const vacuumRamp = Math.max(0, Math.min(1, vacuumElapsed / SHARD_PHYSICS_CONFIG.vacuumRampDuration));
  let remaining = 0;

  if (vacuumElapsed >= 0 && !prepared.vacuumSoundStarted) {
    prepared.vacuumSoundStarted = true;
    playGameSfx("crunch_vacuum");
  }

  for (const state of prepared.shardStates) {
    if (state.arrived) continue;
    remaining += 1;
    const vacuumActive = vacuumElapsed >= state.vacuumDelay;
    if (vacuumActive) updateVacuumShard(state, prepared, deltaSeconds, vacuumRamp);
    else updateScatteredShard(state, prepared, deltaSeconds, elapsed, now);

    const centerX = state.originX + state.x;
    const centerY = state.originY + state.y;
    const distance = Math.hypot(prepared.targetX - centerX, prepared.targetY - centerY);
    if (vacuumActive && (distance <= SHARD_PHYSICS_CONFIG.intakeRadius
      || (centerY <= prepared.targetY + 3 && Math.abs(centerX - prepared.targetX) < 42))) {
      registerShardBankImpact(prepared, state, distance);
      remaining -= 1;
      continue;
    }

    if (elapsed >= SHARD_PHYSICS_CONFIG.maxDuration) {
      registerShardBankImpact(prepared, state, 0);
      remaining -= 1;
      continue;
    }
    renderPhysicsShard(state, prepared, vacuumActive, distance);
  }

  if (remaining > 0) {
    prepared.physicsFrameId = window.requestAnimationFrame((nextNow) => stepPreparedShardPhysics(prepared, nextNow));
  } else {
    finishPreparedShardPhysics(prepared);
  }
}

function updateScatteredShard(state, prepared, deltaSeconds, elapsed, now) {
  const drag = Math.pow(SHARD_PHYSICS_CONFIG.scatterDrag, deltaSeconds * 60);
  const angularDrag = Math.pow(SHARD_PHYSICS_CONFIG.angularDrag, deltaSeconds * 60);
  state.vx *= drag;
  state.vy *= drag;
  state.angularVelocity *= angularDrag;
  state.x += state.vx * deltaSeconds;
  state.y += state.vy * deltaSeconds;
  state.rotation += state.angularVelocity * deltaSeconds;
  resolveShardWallCollisions(state, prepared);

  const speed = Math.hypot(state.vx, state.vy);
  if (!state.settled && elapsed >= SHARD_PHYSICS_CONFIG.settleAfter
    && (speed < 34 || elapsed >= SHARD_PHYSICS_CONFIG.forceSettleAfter)) {
    state.settled = true;
    state.restX = state.x;
    state.restY = state.y;
    state.restRotation = state.rotation;
    state.vx = 0;
    state.vy = 0;
    state.angularVelocity = 0;
  }
  if (state.settled) {
    const hoverTime = now / 1000 + state.hoverPhase;
    state.x = state.restX + Math.sin(hoverTime * 2.1) * 1.7;
    state.y = state.restY + Math.cos(hoverTime * 1.75) * 1.3;
    state.rotation = state.restRotation + Math.sin(hoverTime * 1.4) * .8;
  }
}

function resolveShardWallCollisions(state, prepared) {
  const halfWidth = Math.max(3, state.width * .46);
  const halfHeight = Math.max(3, state.height * .46);
  const minX = halfWidth;
  const maxX = prepared.viewportWidth - halfWidth;
  const minY = Math.min(prepared.viewportHeight - halfHeight, prepared.targetY + halfHeight + 8);
  const maxY = prepared.viewportHeight - halfHeight - 4;
  let centerX = state.originX + state.x;
  let centerY = state.originY + state.y;

  if (centerX < minX || centerX > maxX) {
    centerX = Math.max(minX, Math.min(maxX, centerX));
    state.x = centerX - state.originX;
    state.vx = -state.vx * SHARD_PHYSICS_CONFIG.wallBounce;
    state.vy *= SHARD_PHYSICS_CONFIG.wallFriction;
    state.angularVelocity *= -.58;
  }
  if (centerY < minY || centerY > maxY) {
    centerY = Math.max(minY, Math.min(maxY, centerY));
    state.y = centerY - state.originY;
    state.vy = -state.vy * SHARD_PHYSICS_CONFIG.wallBounce;
    state.vx *= SHARD_PHYSICS_CONFIG.wallFriction;
    state.angularVelocity *= -.58;
  }
}

function updateVacuumShard(state, prepared, deltaSeconds, vacuumRamp) {
  if (state.settled) {
    state.settled = false;
    state.vx = 0;
    state.vy = -8;
  }
  const centerX = state.originX + state.x;
  const centerY = state.originY + state.y;
  const dx = prepared.targetX - centerX;
  const dy = prepared.targetY - centerY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const force = SHARD_PHYSICS_CONFIG.vacuumBaseForce
    + SHARD_PHYSICS_CONFIG.vacuumRampForce * vacuumRamp * vacuumRamp
    + Math.min(1050, distance * SHARD_PHYSICS_CONFIG.vacuumSpring);
  const funnelStrength = 1.4 + vacuumRamp * 5.2;
  state.vx += (dx / distance * force + dx * funnelStrength) * deltaSeconds;
  state.vy += (dy / distance * force) * deltaSeconds;
  const drag = Math.pow(.988 - vacuumRamp * .006, deltaSeconds * 60);
  state.vx *= drag;
  state.vy *= drag;
  const speed = Math.hypot(state.vx, state.vy);
  if (speed > SHARD_PHYSICS_CONFIG.vacuumMaxSpeed) {
    const scale = SHARD_PHYSICS_CONFIG.vacuumMaxSpeed / speed;
    state.vx *= scale;
    state.vy *= scale;
  }
  state.x += state.vx * deltaSeconds;
  state.y += state.vy * deltaSeconds;
  state.angularVelocity += (dx >= 0 ? 1 : -1) * 75 * deltaSeconds;
  state.angularVelocity *= Math.pow(.985, deltaSeconds * 60);
  state.rotation += state.angularVelocity * deltaSeconds;
}

function renderPhysicsShard(state, prepared, vacuumActive, distance) {
  const intakeScale = vacuumActive
    ? Math.max(.07, Math.min(1, distance / state.vacuumDistance))
    : 1;
  state.node.style.opacity = vacuumActive ? String(Math.max(.18, Math.min(1, intakeScale * 1.4))) : "1";
  state.node.style.transform = `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0) rotate(${state.rotation.toFixed(2)}deg) scale(${intakeScale.toFixed(3)})`;
}

function getShardDistanceToBank(state, prepared) {
  return Math.hypot(
    prepared.targetX - (state.originX + state.x),
    prepared.targetY - (state.originY + state.y)
  );
}

function registerShardBankImpact(prepared, state, distance) {
  if (state.arrived) return;
  state.arrived = true;
  state.node.style.opacity = "0";
  state.node.style.visibility = "hidden";
  prepared.arrivedCount += 1;
  const total = prepared.shardStates.length;
  const progress = prepared.arrivedCount / Math.max(1, total);
  const speed = Math.hypot(state.vx, state.vy);
  const strength = Math.max(.55, Math.min(1.7, speed / 720 + (distance < 10 ? .25 : 0)));
  playCrunchShardImpact({ progress, strength });
  pulseBankOnShardImpact(prepared.bankEl, prepared.arrivedCount, total, strength);
  spawnBankImpactCrumbs(prepared.targetX, prepared.targetY, strength);
  prepared.onImpact?.({ arrived: prepared.arrivedCount, total, progress, strength });
}

function pulseBankOnShardImpact(bankEl, arrived, total, strength) {
  if (!bankEl?.isConnected) return;
  const cadence = total >= 30 ? 4 : total >= 16 ? 3 : 2;
  if (arrived !== 1 && arrived !== total && arrived % cadence !== 0) return;
  const intensity = Math.max(.7, Math.min(1.7, Number(strength) || 1));
  bankEl.animate?.([
    { filter: "brightness(1) saturate(1)" },
    {
      filter: `brightness(${(1.2 + intensity * .2).toFixed(2)}) saturate(${(1.08 + intensity * .14).toFixed(2)}) drop-shadow(0 0 ${(8 + intensity * 7).toFixed(1)}px rgba(255, 207, 73, .82))`,
      offset: .34
    },
    { filter: "brightness(1.06) saturate(1.04)" }
  ], {
    duration: arrived === total ? 210 : 125,
    easing: "steps(4, end)"
  });
}

function finishPreparedShardPhysics(prepared) {
  if (prepared.physicsFinished) return;
  prepared.physicsFinished = true;
  if (prepared.physicsFrameId) window.cancelAnimationFrame(prepared.physicsFrameId);
  prepared.physicsFrameId = 0;
  prepared.resolvePhysics?.();
  prepared.resolvePhysics = null;
}

function clearPreparedDamageArtifacts(prepared) {
  prepared.seams.forEach((seam) => seam.remove());
  prepared.seams.length = 0;
  prepared.cards.forEach((card) => {
    card.removeAttribute("data-crunch-damage");
    card.querySelectorAll(".cutin-fracture-map").forEach((layer) => layer.remove());
    const overlay = card.closest(".crunch-cutscene-overlay");
    overlay?.removeAttribute("data-crunch-hit");
    overlay?.querySelector(".cutin-stage")?.removeAttribute("data-crunch-hit");
  });
}

function discardPreparedCardShards(card) {
  const prepared = preparedShardSets.get(card);
  if (prepared?.active) return;
  if (prepared) discardPreparedShardSet(prepared);
}

function discardPreparedShardSet(prepared) {
  if (prepared.disposed) return;
  prepared.disposed = true;
  if (prepared.physicsFrameId) window.cancelAnimationFrame(prepared.physicsFrameId);
  prepared.physicsFrameId = 0;
  prepared.resolvePhysics?.();
  prepared.resolvePhysics = null;
  prepared.nodes.forEach((node) => node.remove());
  prepared.cards.forEach((card) => {
    preparedShardSets.delete(card);
    card.classList.remove("is-shattering", "is-precut-source");
    if (!prepared.active) card.classList.remove("is-consumed-after-shatter");
  });
  endBankFeed(prepared);
}

function beginBankFeed(prepared) {
  const bankEl = prepared?.bankEl;
  if (!bankEl || prepared.bankFeedActive) return;
  prepared.bankFeedActive = true;
  activeBankFeeds.set(bankEl, (activeBankFeeds.get(bankEl) ?? 0) + 1);
  bankEl.classList.add("bank-feeding");
}

function endBankFeed(prepared) {
  const bankEl = prepared?.bankEl;
  if (!bankEl || !prepared.bankFeedActive) return;
  prepared.bankFeedActive = false;
  const remaining = Math.max(0, (activeBankFeeds.get(bankEl) ?? 1) - 1);
  if (remaining > 0) activeBankFeeds.set(bankEl, remaining);
  else {
    activeBankFeeds.delete(bankEl);
    bankEl.classList.remove("bank-feeding");
  }
}

function spawnBankImpactCrumbs(x, y, strength = 1) {
  const emitter = ensureBankImpactEmitter();
  if (!emitter) return;
  const amount = Math.max(3, Math.round(SHARD_PHYSICS_CONFIG.impactCrumbs * Math.min(1.45, strength)));
  for (let index = 0; index < amount; index += 1) {
    const direction = index % 2 === 0 ? -1 : 1;
    const speed = 48 + Math.random() * 135;
    emitter.particles.push({
      x: x + (Math.random() - .5) * 22,
      y: y + 1,
      vx: direction * speed * (.35 + Math.random() * .65),
      vy: 55 + Math.random() * 175,
      gravity: 580 + Math.random() * 280,
      drag: .976 + Math.random() * .012,
      size: 2 + Math.floor(Math.random() * 4),
      length: 3 + Math.floor(Math.random() * 6),
      vertical: Math.random() > .5,
      color: index % 3 === 0 ? "#fff0a0" : "#f2ad24",
      edge: "#75420a",
      age: 0,
      delay: 0,
      maxAge: 520 + Math.random() * 260
    });
  }
  startBankImpactEmitter(emitter);
}

function ensureBankImpactEmitter() {
  if (bankImpactEmitter?.canvas?.isConnected) return bankImpactEmitter;
  const canvas = document.createElement("canvas");
  canvas.className = "cutin-bank-impact-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return null;
  bankImpactEmitter = {
    canvas,
    context,
    particles: [],
    running: false,
    lastFrame: 0,
    width: 0,
    height: 0,
    dpr: 1
  };
  document.body.appendChild(canvas);
  syncBankImpactCanvas(bankImpactEmitter);
  return bankImpactEmitter;
}

function syncBankImpactCanvas(emitter) {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
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

function startBankImpactEmitter(emitter) {
  if (emitter.running) return;
  emitter.running = true;
  emitter.lastFrame = performance.now();
  const drawFrame = (now) => {
    if (!emitter.canvas.isConnected) {
      emitter.running = false;
      emitter.particles.length = 0;
      return;
    }
    syncBankImpactCanvas(emitter);
    const deltaSeconds = Math.min(.034, Math.max(.001, (now - emitter.lastFrame) / 1000));
    emitter.lastFrame = now;
    const { context, width, height, particles } = emitter;
    context.clearRect(0, 0, width, height);
    let writeIndex = 0;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.age += deltaSeconds * 1000;
      particle.vy += particle.gravity * deltaSeconds;
      particle.vx *= Math.pow(particle.drag, deltaSeconds * 60);
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      if (particle.age >= particle.maxAge || particle.y > height + 18) continue;
      const opacity = Math.max(0, Math.min(1, (particle.maxAge - particle.age) / 180));
      drawPixelCrumb(context, particle, opacity);
      particles[writeIndex] = particle;
      writeIndex += 1;
    }
    particles.length = writeIndex;
    if (particles.length) window.requestAnimationFrame(drawFrame);
    else {
      emitter.running = false;
      context.clearRect(0, 0, width, height);
    }
  };
  window.requestAnimationFrame(drawFrame);
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

function getCardFeedDuration(cardCount) {
  return Math.min(
    SHARD_PHYSICS_CONFIG.maxDuration,
    SHARD_PHYSICS_CONFIG.forceSettleAfter + SHARD_PHYSICS_CONFIG.vacuumStagger + 980 + cardCount * 55
  );
}

function createCrunchScoreSurge({
  bankEl,
  valueEl,
  amount,
  cashBefore,
  onCashProgress,
  queueMilestoneBeat = (effect) => effect()
}) {
  const plan = createScoreSurgePlan(amount);
  let credited = 0;
  let milestoneIndex = 0;
  let finished = false;
  const milestoneEffects = [];
  let stage = null;

  const ensureStage = () => {
    if (stage) return stage;
    stage = createScoreSurgeStage(bankEl, valueEl, {
      ...plan,
      tier: Math.max(1, plan.tier),
      name: plan.name || "Coin Milestone"
    });
    return stage;
  };

  if (plan.tier > 0 && bankEl) {
    bankEl.classList.add("is-entry-score-surge");
    bankEl.dataset.scoreSurgeTier = "1";
  }

  return {
    update(nextCredited) {
      credited = Math.max(credited, Math.min(plan.score, Math.round(Number(nextCredited) || 0)));
      while (milestoneIndex < plan.milestones.length && credited >= plan.milestones[milestoneIndex]) {
        const milestone = plan.milestones[milestoneIndex];
        const milestoneTier = createScoreSurgePlan(milestone).tier;
        if (bankEl) bankEl.dataset.scoreSurgeTier = String(milestoneTier);
        const activeStage = ensureStage();
        milestoneEffects.push(queueMilestoneBeat(
          () => playScoreSurgeMilestone(bankEl, valueEl, milestone, milestoneTier, plan.tier, activeStage)
        ));
        milestoneIndex += 1;
      }
      const coinReward = onCashProgress?.(
        cashBefore + credited,
        bankEl?.getBoundingClientRect?.() ?? null
      );
      if (coinReward) {
        const activeStage = ensureStage();
        milestoneEffects.push(queueMilestoneBeat(
          () => playCrunchCoinReward(bankEl, coinReward, activeStage)
        ));
      }
    },
    async finish() {
      if (finished) return;
      finished = true;
      this.update(plan.score);
      await Promise.allSettled(milestoneEffects);
      if (stage) {
        if (bankEl) bankEl.dataset.scoreSurgeTier = String(plan.tier);
        await playCrunchScoreSurgePeak(bankEl, valueEl, plan, stage);
      }
      bankEl?.classList.remove("is-entry-score-surge");
      if (bankEl) delete bankEl.dataset.scoreSurgeTier;
    }
  };
}

function createScoreSurgeStage(bankEl, valueEl, plan) {
  if (!bankEl?.isConnected) return null;
  const labelEl = bankEl.querySelector(".hud-label");
  const originalLabel = labelEl?.innerHTML ?? "Crunch Bank";
  const backdrop = document.createElement("div");
  backdrop.className = "entry-score-surge-backdrop";
  backdrop.dataset.tier = String(plan.tier);
  backdrop.innerHTML = `
    <div class="entry-score-surge-callout">
      <strong>0</strong>
      <span>${plan.name}</span>
    </div>
    <div class="entry-score-surge-skip">Tap to skip surge</div>
  `;
  document.body.appendChild(backdrop);
  document.body.classList.add("is-entry-score-surge-active");
  bankEl.classList.add("is-entry-score-surge", "is-entry-score-surge-peak");
  bankEl.dataset.scoreSurgeTier = String(plan.tier);
  if (labelEl) labelEl.textContent = plan.name;

  let skipped = false;
  let closed = false;
  const waiters = new Set();
  const requestSkip = () => {
    if (skipped) return;
    skipped = true;
    backdrop.classList.add("is-skipping");
    waiters.forEach((finish) => finish());
    waiters.clear();
  };
  const onPointerUp = (event) => {
    if (event.target?.closest?.(".crunch-collectible-coin")) return;
    event.preventDefault();
    event.stopPropagation();
    requestSkip();
  };
  const onSkipAll = () => requestSkip();
  backdrop.addEventListener("pointerup", onPointerUp);
  window.addEventListener(CRUNCH_SKIP_EVENT, onSkipAll);

  const entered = nextPaint().then(async () => {
    if (closed) return;
    backdrop.classList.add("is-active");
    bankEl.classList.add("is-entry-score-surge-centered");
    await sleep(440);
  });

  return {
    backdrop,
    entered,
    get skipped() {
      return skipped || isCrunchSkipRequested();
    },
    requestSkip,
    setCallout(value, label = plan.name) {
      const valueNode = backdrop.querySelector(".entry-score-surge-callout strong");
      const labelNode = backdrop.querySelector(".entry-score-surge-callout span");
      if (valueNode) valueNode.textContent = String(value);
      if (labelNode) labelNode.textContent = label;
    },
    wait(ms) {
      if (skipped || isCrunchSkipRequested()) return Promise.resolve();
      return new Promise((resolve) => {
        let complete = false;
        let timeoutId = 0;
        const finish = () => {
          if (complete) return;
          complete = true;
          window.clearTimeout(timeoutId);
          waiters.delete(finish);
          resolve();
        };
        timeoutId = window.setTimeout(finish, ms);
        waiters.add(finish);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      backdrop.classList.add("is-leaving");
      bankEl.classList.remove("is-entry-score-surge-centered");
      await sleep(skipped ? 90 : 380);
      if (labelEl) labelEl.innerHTML = originalLabel;
      bankEl.classList.remove("is-entry-score-surge-peak", "is-entry-score-surge-centered");
      document.body.classList.remove("is-entry-score-surge-active");
      backdrop.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener(CRUNCH_SKIP_EVENT, onSkipAll);
      backdrop.remove();
      waiters.forEach((finish) => finish());
      waiters.clear();
    }
  };
}

async function playScoreSurgeMilestone(bankEl, valueEl, milestone, tier, paceTier = tier, stage = null) {
  if (!bankEl?.isConnected) return;
  await stage?.entered;
  if (stage?.skipped) return;
  const bankRect = bankEl.getBoundingClientRect();
  const duration = Math.max(440, 700 - paceTier * 35);
  playGameSfx("score_ramp_tick");
  stage?.setCallout(formatRollingBankNumber(milestone), `Milestone ${formatCompactNumber(milestone)}`);

  const marker = document.createElement("strong");
  marker.className = "entry-score-surge-milestone";
  marker.dataset.tier = String(tier);
  marker.innerHTML = `<span>MILESTONE</span>${formatRollingBankNumber(milestone)}`;
  marker.style.left = `${bankRect.left + bankRect.width / 2}px`;
  marker.style.top = `${bankRect.bottom + 12}px`;
  document.body.appendChild(marker);
  const markerAnimation = marker.animate?.([
    { opacity: 0, transform: "translate3d(-50%, 10px, 0) scale(.62)" },
    { opacity: 1, transform: "translate3d(-50%, -2px, 0) scale(1.18)", offset: .28 },
    { opacity: 1, transform: "translate3d(-50%, -2px, 0) scale(1)", offset: .76 },
    { opacity: 0, transform: "translate3d(-50%, -18px, 0) scale(.96)" }
  ], { duration, easing: "steps(7, end)" });
  const centeredTransform = bankEl.classList.contains("is-entry-score-surge-centered")
    ? "translate3d(-50%, -50%, 0)"
    : "translate3d(-50%, 0, 0)";
  const bankAnimation = bankEl.animate?.([
    { transform: `${centeredTransform} scale(1)`, filter: "brightness(1)" },
    {
      transform: `${centeredTransform} scale(${1.055 + tier * .014})`,
      filter: `brightness(${1.28 + tier * .1}) drop-shadow(0 0 ${10 + tier * 4}px rgba(255, 205, 65, .78))`,
      offset: .25
    },
    {
      transform: `${centeredTransform} scale(1.025)`,
      filter: "brightness(1.22) drop-shadow(0 0 16px rgba(255, 205, 65, .62))",
      offset: .72
    },
    { transform: `${centeredTransform} scale(1)`, filter: "brightness(1)" }
  ], { duration, easing: "cubic-bezier(.16, 1, .3, 1)" });
  const valueAnimation = valueEl?.animate?.([
    { scale: "1" },
    { scale: String(1.12 + tier * .024), offset: .3 },
    { scale: String(1.06 + tier * .01), offset: .72 },
    { scale: "1" }
  ], { duration, easing: "steps(6, end)" });

  await (stage?.wait(Math.round(duration * .3)) ?? sleep(Math.round(duration * .3)));
  spawnScoreMilestoneCoinSpill(bankEl.getBoundingClientRect(), tier);
  await (stage?.wait(Math.round(duration * .7)) ?? sleep(Math.round(duration * .7)));
  [bankAnimation, valueAnimation, markerAnimation].forEach((animation) => {
    try { animation?.finish?.(); } catch {}
  });
  marker.remove();
}

async function playCrunchScoreSurgePeak(bankEl, valueEl, plan, stage) {
  if (!bankEl?.isConnected || !stage) return;
  const tier = Math.max(1, plan.tier);
  try {
    await stage.entered;
    stage.setCallout(`+${formatRollingBankNumber(plan.score)}`, plan.name || "Coin Milestone");
    playGameSfx(tier >= 4 ? "score_ramp_peak" : "score_total");
    await stage.wait(1250 + tier * 130);
    valueEl?.animate?.([
      { scale: "1", filter: "brightness(1)" },
      { scale: String(1.12 + tier * .025), filter: "brightness(1.8)" },
      { scale: "1", filter: "brightness(1)" }
    ], { duration: 240, easing: "steps(5, end)" });
  } finally {
    await stage.close();
  }
}

function spawnCrunchCoinReward(bankRect, reward) {
  const coins = Math.max(0, Math.floor(Number(reward?.coins) || 0));
  const milestones = Math.max(1, Math.floor(Number(reward?.milestones) || 1));
  if (!bankRect || coins <= 0) return null;
  const originX = bankRect.left + bankRect.width / 2;
  const originY = bankRect.bottom - 8;
  const visibleCoins = Math.min(6, Math.max(2, Math.ceil(coins / 2), milestones * 2));
  const layer = document.createElement("div");
  layer.className = "crunch-coin-collection";
  layer.setAttribute("aria-label", `Collect ${coins} milestone coins`);
  document.body.appendChild(layer);

  const toast = document.createElement("div");
  toast.className = "crunch-coin-reward-toast is-collecting";
  toast.style.left = `${originX}px`;
  toast.style.top = `${Math.min(window.innerHeight - 132, bankRect.bottom + 18)}px`;
  toast.innerHTML = `<strong>+${formatCompactNumber(coins)} COINS</strong><span>TAP COINS TO COLLECT</span>`;
  document.body.appendChild(toast);
  let remaining = visibleCoins;
  let awarded = 0;
  let balance = Number(reward?.getBalance?.()) || 0;
  let resolved = false;
  let resolveDone = () => {};
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const coinNodes = [];

  const finish = () => {
    if (resolved || remaining > 0) return;
    resolved = true;
    toast.classList.remove("is-collecting");
    toast.classList.add("is-collected");
    toast.innerHTML = `<strong>+${formatCompactNumber(awarded)} COINS</strong><span>POUCH ${formatCompactNumber(balance)}</span>`;
    resolveDone();
  };

  const collectCoin = (coinNode, portion) => {
    if (!coinNode || coinNode.dataset.collected === "true") return;
    coinNode.dataset.collected = "true";
    coinNode.disabled = true;
    const rect = coinNode.getBoundingClientRect();
    balance = Number(reward?.award?.(portion)) || Number(reward?.getBalance?.()) || balance;
    awarded += portion;
    remaining -= 1;
    playGameSfx("coin_collect");
    spawnCollectibleCoinBreak(rect, portion);
    coinNode.classList.add("is-collected");
    toast.querySelector("strong").textContent = `+${formatCompactNumber(awarded)} / ${formatCompactNumber(coins)} COINS`;
    window.setTimeout(() => coinNode.remove(), 260);
    finish();
  };

  let undistributed = coins;
  for (let index = 0; index < visibleCoins; index += 1) {
    const slotsLeft = visibleCoins - index;
    const portion = index === visibleCoins - 1 ? undistributed : Math.max(1, Math.floor(undistributed / slotsLeft));
    undistributed -= portion;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const spread = Math.min(124, window.innerWidth * .28);
    const targetX = Math.max(38, Math.min(window.innerWidth - 38, originX + (column - 1) * spread));
    const targetY = Math.max(
      bankRect.bottom + 58,
      Math.min(window.innerHeight - 96, bankRect.bottom + 86 + row * 74)
    );
    const coinNode = document.createElement("button");
    coinNode.type = "button";
    coinNode.className = "crunch-collectible-coin";
    coinNode.style.left = `${targetX}px`;
    coinNode.style.top = `${targetY}px`;
    coinNode.style.setProperty("--coin-from-x", `${originX - targetX}px`);
    coinNode.style.setProperty("--coin-from-y", `${originY - targetY}px`);
    coinNode.style.setProperty("--coin-delay", `${index * 55}ms`);
    coinNode.setAttribute("aria-label", `Collect ${portion} coins`);
    coinNode.innerHTML = `<i aria-hidden="true"></i><small>+${portion}</small>`;
    coinNode.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      collectCoin(coinNode, portion);
    });
    layer.appendChild(coinNode);
    coinNodes.push({ node: coinNode, portion });
  }

  spawnScoreMilestoneCoinSpill(bankRect, Math.min(6, milestones + 2));
  return {
    done,
    get complete() {
      return resolved;
    },
    async collectAll() {
      for (const { node, portion } of coinNodes) {
        if (node.dataset.collected === "true") continue;
        collectCoin(node, portion);
        await sleep(48);
      }
      finish();
    },
    async cleanup() {
      if (!resolved) await this.collectAll();
      await sleep(620);
      layer.remove();
      toast.remove();
    }
  };
}

async function playCrunchCoinReward(bankEl, reward, stage = null) {
  if (!bankEl?.isConnected || !reward?.coins) return;
  await stage?.entered;
  if (stage?.skipped) {
    reward.award?.(reward.coins);
    return;
  }
  playGameSfx("coin_milestone");
  const rect = bankEl.getBoundingClientRect();
  stage?.setCallout(`+${formatRollingBankNumber(reward.coins)}`, "Coin Burst");
  const collection = spawnCrunchCoinReward(rect, reward);
  if (!collection) return;
  const centeredTransform = bankEl.classList.contains("is-entry-score-surge-centered")
    ? "translate3d(-50%, -50%, 0)"
    : "translate3d(-50%, 0, 0)";
  const animation = bankEl.animate?.([
    { transform: `${centeredTransform} scale(1)`, filter: "brightness(1)" },
    { transform: `${centeredTransform} scale(1.12)`, filter: "brightness(1.9)", offset: .24 },
    { transform: `${centeredTransform} scale(1.045)`, filter: "brightness(1.4)", offset: .74 },
    { transform: `${centeredTransform} scale(1)`, filter: "brightness(1)" }
  ], { duration: 980, easing: "cubic-bezier(.16, 1, .3, 1)" });
  try {
    await Promise.race([
      collection.done,
      stage?.wait(6000) ?? sleep(6000)
    ]);
    if (!collection.complete) await collection.collectAll();
    await (stage?.wait(900) ?? sleep(900));
  } finally {
    try { animation?.finish?.(); } catch {}
    await collection.cleanup();
  }
}

function spawnCollectibleCoinBreak(rect, portion = 1) {
  const emitter = ensureBankImpactEmitter();
  if (!emitter || !rect) return;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const amount = Math.min(22, 10 + Math.max(0, portion - 1));
  for (let index = 0; index < amount; index += 1) {
    const angle = index / amount * Math.PI * 2 + Math.random() * .32;
    const speed = 115 + Math.random() * 290;
    emitter.particles.push({
      kind: "coin",
      x: centerX + (Math.random() - .5) * 8,
      y: centerY + (Math.random() - .5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 55,
      gravity: 780 + Math.random() * 260,
      drag: .98,
      size: 3 + Math.floor(Math.random() * 5),
      length: 0,
      vertical: false,
      color: index % 3 === 0 ? "#fff2a0" : "#ffc53d",
      edge: "#6d3d05",
      age: 0,
      delay: 0,
      maxAge: 720 + Math.random() * 360
    });
  }
  startBankImpactEmitter(emitter);
}

function spawnScoreMilestoneCoinSpill(bankRect, tier = 1) {
  if (!bankRect) return;
  const emitter = ensureBankImpactEmitter();
  if (!emitter) return;
  const originX = bankRect.left + bankRect.width / 2;
  const originY = bankRect.bottom - 8;
  const amount = Math.min(28, 8 + tier * 3);
  for (let index = 0; index < amount; index += 1) {
    const direction = index % 2 === 0 ? -1 : 1;
    emitter.particles.push({
      kind: "coin",
      x: originX + (Math.random() - .5) * Math.min(160, bankRect.width * .72),
      y: originY + Math.random() * 6,
      vx: direction * (45 + Math.random() * 190),
      vy: 45 + Math.random() * 170,
      gravity: 690 + Math.random() * 240,
      drag: .982,
      size: 5 + Math.floor(Math.random() * 4),
      length: 0,
      vertical: false,
      color: index % 3 === 0 ? "#fff3a8" : "#ffc53d",
      edge: "#6d3d05",
      age: 0,
      delay: Math.random() * 75,
      maxAge: 760 + Math.random() * 360
    });
  }
  startBankImpactEmitter(emitter);
}

function getCrossedScoreMilestone(from, to) {
  const start = Math.max(0, Number(from) || 0);
  const end = Math.max(0, Number(to) || 0);
  if (end < MAJOR_SCORE_RAMP_CONFIG.minimumMilestone || end <= start) return null;

  const startMagnitude = Math.floor(Math.log10(Math.max(1, start)));
  const endMagnitude = Math.floor(Math.log10(Math.max(1, end)));
  if (endMagnitude <= startMagnitude) return null;

  const milestone = 10 ** endMagnitude;
  return milestone >= MAJOR_SCORE_RAMP_CONFIG.minimumMilestone ? milestone : null;
}

async function playMajorScoreRamp({ bankEl, valueEl, labelEl, from, to, milestone }) {
  if (!bankEl || !valueEl) return;

  const originalLabel = labelEl?.innerHTML ?? "Score";
  const backdrop = document.createElement("div");
  backdrop.className = "major-score-ramp-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.innerHTML = `
    <div class="major-score-ramp-callout">
      <span>${formatCompactNumber(milestone)}</span>
      <strong>Score Break!</strong>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.classList.add("is-major-score-ramp-active");
  bankEl.classList.add("is-major-score-ramp");
  playGameSfx("score_total");

  try {
    await nextPaint();
    backdrop.classList.add("is-active");
    bankEl.classList.add("is-major-score-ramp-active");
    await sleep(MAJOR_SCORE_RAMP_CONFIG.moveDuration);

    if (labelEl) labelEl.textContent = "Score Surge";
    valueEl.textContent = formatCompactNumber(from);
    const particleRun = playMajorScoreRampParticles(backdrop, bankEl, MAJOR_SCORE_RAMP_CONFIG.countDuration + MAJOR_SCORE_RAMP_CONFIG.peakDuration);
    await countMajorScoreRamp(valueEl, bankEl, from, to, MAJOR_SCORE_RAMP_CONFIG.countDuration);

    bankEl.classList.add("is-major-score-ramp-peak");
    backdrop.classList.add("is-peak");
    playGameSfx("score_ramp_peak");
    await sleep(MAJOR_SCORE_RAMP_CONFIG.peakDuration);

    if (labelEl) labelEl.innerHTML = originalLabel;
    bankEl.classList.remove("is-major-score-ramp-active", "is-major-score-ramp-tick", "is-major-score-ramp-peak");
    bankEl.classList.add("is-major-score-ramp-returning");
    backdrop.classList.add("is-leaving");
    await sleep(MAJOR_SCORE_RAMP_CONFIG.returnDuration);
    await particleRun;
  } finally {
    valueEl.textContent = formatCompactNumber(to);
    if (labelEl) labelEl.innerHTML = originalLabel;
    bankEl.classList.remove(
      "is-major-score-ramp",
      "is-major-score-ramp-active",
      "is-major-score-ramp-peak",
      "is-major-score-ramp-returning"
    );
    document.body.classList.remove("is-major-score-ramp-active");
    backdrop.remove();
  }
}

function countMajorScoreRamp(valueEl, bankEl, from, to, duration) {
  const startedAt = performance.now();
  let lastTick = -1;
  let lastRendered = "";

  return new Promise((resolve) => {
    const tick = (now) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = progress < .7
        ? .72 * Math.pow(progress / .7, 1.72)
        : .72 + .28 * (1 - Math.pow(1 - (progress - .7) / .3, 3));
      const value = Math.round(from + (to - from) * eased);
      const rendered = formatCompactNumber(value);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        valueEl.textContent = rendered;
      }

      const scoreTick = Math.min(
        MAJOR_SCORE_RAMP_CONFIG.tickCount - 1,
        Math.floor(progress * MAJOR_SCORE_RAMP_CONFIG.tickCount)
      );
      if (scoreTick > lastTick) {
        lastTick = scoreTick;
        playGameSfx("score_ramp_tick");
        valueEl.animate?.([
          { scale: "1", filter: "brightness(1)" },
          { scale: "1.18", filter: "brightness(1.8) drop-shadow(0 0 15px #ffc53d)" },
          { scale: "1", filter: "brightness(1)" }
        ], { duration: 190, easing: "steps(4, end)" });
        bankEl.classList.toggle("is-major-score-ramp-tick", scoreTick % 2 === 0);
      }

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        valueEl.textContent = formatCompactNumber(to);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function playMajorScoreRampParticles(backdrop, bankEl, duration) {
  const canvas = document.createElement("canvas");
  canvas.className = "major-score-ramp-particles";
  backdrop.appendChild(canvas);
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) {
    canvas.remove();
    return Promise.resolve();
  }

  const dpr = Math.min(window.devicePixelRatio || 1, MAJOR_SCORE_RAMP_CONFIG.devicePixelRatioCap);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;

  const bankRect = bankEl.getBoundingClientRect();
  const originX = bankRect.left + bankRect.width / 2;
  const originY = bankRect.top + bankRect.height / 2;
  let seed = (Math.round(originX * 37) ^ Math.round(originY * 71) ^ Math.round(duration)) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const particles = Array.from({ length: MAJOR_SCORE_RAMP_CONFIG.maxParticles }, (_, index) => {
    const angle = random() * Math.PI * 2;
    const speed = 80 + random() * 360;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 85,
      size: 2 + Math.floor(random() * 5),
      delay: (index % 18) * 54 + random() * 180,
      life: 620 + random() * 850,
      color: index % 5 === 0 ? "#fff8bd" : index % 3 === 0 ? "#ff8a2a" : "#ffc53d"
    };
  });
  const startedAt = performance.now();
  let previousAt = startedAt;

  return new Promise((resolve) => {
    const draw = (now) => {
      const elapsed = now - startedAt;
      const delta = Math.min(34, now - previousAt) / 1000;
      previousAt = now;
      context.clearRect(0, 0, width, height);

      particles.forEach((particle) => {
        const age = elapsed - particle.delay;
        if (age < 0 || age > particle.life) return;
        particle.vy += 165 * delta;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vx *= .988;
        particle.vy *= .992;
        const alpha = Math.max(0, 1 - age / particle.life);
        context.globalAlpha = alpha;
        context.fillStyle = particle.color;
        context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size + (particle.vy < 0 ? 3 : 0));
      });
      context.globalAlpha = 1;

      if (elapsed < duration) requestAnimationFrame(draw);
      else {
        canvas.remove();
        resolve();
      }
    };
    requestAnimationFrame(draw);
  });
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
      valueEl.textContent = formatRollingBankNumber(to);
      resolve();
    };
    if (advance) advance.wait(duration).then(done);
    const tick = (now) => {
      if (finished) return;
      const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      const rendered = formatRollingBankNumber(value);
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

function createRollingBankDisplay(valueEl) {
  let displayed = 0;
  let target = 0;
  let frameId = 0;
  let lastFrame = 0;
  const settleWaiters = new Set();

  const render = (value) => {
    if (!valueEl) return;
    valueEl.textContent = formatRollingBankNumber(value);
    valueEl.classList.add("is-bank-number-rolling");
  };

  const resolveSettled = () => {
    valueEl?.classList.remove("is-bank-number-rolling");
    settleWaiters.forEach((resolve) => resolve());
    settleWaiters.clear();
  };

  const tick = (now) => {
    frameId = 0;
    const deltaMs = lastFrame ? Math.min(34, now - lastFrame) : 16;
    lastFrame = now;
    const difference = target - displayed;
    if (Math.abs(difference) <= 1) {
      displayed = target;
      render(displayed);
      resolveSettled();
      return;
    }

    const responsiveness = Math.min(.34, .14 + deltaMs / 150);
    const minimumStep = Math.abs(difference) > 100000 ? 97 : 7;
    const step = Math.sign(difference) * Math.max(minimumStep, Math.ceil(Math.abs(difference) * responsiveness));
    displayed += Math.abs(step) > Math.abs(difference) ? difference : step;
    render(displayed);
    frameId = window.requestAnimationFrame(tick);
  };

  const start = () => {
    if (!frameId && displayed !== target) frameId = window.requestAnimationFrame(tick);
  };

  return {
    setTarget(nextValue) {
      target = Math.max(0, Math.round(Number(nextValue) || 0));
      start();
    },
    settle(maxWait = 520) {
      if (displayed === target) return Promise.resolve();
      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          settleWaiters.delete(finish);
          resolve();
        };
        settleWaiters.add(finish);
        window.setTimeout(finish, maxWait);
        start();
      });
    },
    flush(nextValue = target) {
      target = Math.max(0, Math.round(Number(nextValue) || 0));
      displayed = target;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      render(displayed);
      resolveSettled();
    },
    destroy() {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      resolveSettled();
    }
  };
}

function formatRollingBankNumber(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("en-US");
}

function waitMaybe(advance, ms) {
  return advance ? advance.wait(ms) : sleep(ms);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
