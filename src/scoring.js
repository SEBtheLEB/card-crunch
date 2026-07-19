export const MATCH_TYPES = {
  ADD: "add",
  SUBTRACT: "subtract",
  RANK: "rank",
  SUIT: "suit",
  MISS: "miss"
};

import { formatCompactNumber } from "./format.js";

export const SCORE_CONFIG = {
  suit: 100,
  rank: 300,
  math: 500
};

export const MATCH_TIER_MULTIPLIERS = {
  2: 1,
  3: 6,
  4: 12,
  5: 20,
  6: 30
};

export const SELECTION_MULTIPLIERS = {
  1: 1,
  2: 2,
  3: 4,
  4: 8
};

export const STACK_TYPE_CONFIG = {
  flushCrunch: { minCardsSameSuit: 4, multiplier: 2 },
  tripleRank: { multiplier: 2 },
  chainCrunch: { minMathLinks: 2, multiplier: 3 },
  mathFeast: { minMathCards: 3, multiplier: 2 },
  suitStorm: { minSuitCards: 3, multiplier: 1.5 },
  perfectHand: { minSelectedCards: 4, multiplier: 3 },
  greedCrunch: { minSelectedCards: 3, flatBonus: 500 }
};

export function evaluateStackAdd(stackCards, selectedCard) {
  const pairs = getStackPairs(stackCards);

  const addPair = pairs.find(({ a, b }) => a.card.value + b.card.value === selectedCard.value);
  if (addPair) {
    return createMatch({
      type: MATCH_TYPES.ADD,
      label: "SUM CRUNCH",
      basePoints: SCORE_CONFIG.math,
      matchedIndexes: [addPair.a.index, addPair.b.index],
      matchedCards: [addPair.a.card, addPair.b.card],
      equation: {
        left: addPair.a.card.value,
        operator: "+",
        right: addPair.b.card.value,
        result: selectedCard.value
      },
      cutinLabel: "SUM CRUNCH"
    });
  }

  const subtractPair = pairs.find(({ a, b }) => Math.abs(a.card.value - b.card.value) === selectedCard.value);
  if (subtractPair) {
    const left = Math.max(subtractPair.a.card.value, subtractPair.b.card.value);
    const right = Math.min(subtractPair.a.card.value, subtractPair.b.card.value);
    return createMatch({
      type: MATCH_TYPES.SUBTRACT,
      label: "MINUS CRUNCH",
      basePoints: SCORE_CONFIG.math,
      matchedIndexes: [subtractPair.a.index, subtractPair.b.index],
      matchedCards: [subtractPair.a.card, subtractPair.b.card],
      equation: {
        left,
        operator: "-",
        right,
        result: selectedCard.value
      },
      cutinLabel: "MINUS CRUNCH"
    });
  }

  const rankMatches = stackCards
    .map((card, index) => (card.value === selectedCard.value ? index : -1))
    .filter((index) => index >= 0);

  if (rankMatches.length > 0) {
    const label = getNumberMatchLabel(rankMatches.length + 1);
    const rankSuitMatches = rankMatches.filter((index) => stackCards[index].suit === selectedCard.suit);
    return createMatch({
      type: MATCH_TYPES.RANK,
      label,
      basePoints: SCORE_CONFIG.rank,
      matchedIndexes: rankMatches,
      matchedCards: rankMatches.map((index) => stackCards[index]),
      equation: {
        left: selectedCard.rank,
        operator: "=",
        right: selectedCard.rank,
        result: selectedCard.rank
      },
      cutinLabel: label,
      compoundMatch: rankSuitMatches.length > 0
        ? {
            type: "rank-suit",
            label: "NUMBER + SUIT",
            multiplier: 2,
            matchedIndexes: rankSuitMatches
          }
        : null
    });
  }

  const suitMatches = stackCards
    .map((card, index) => (card.suit === selectedCard.suit ? index : -1))
    .filter((index) => index >= 0);

  if (suitMatches.length > 0) {
    const label = getSuitMatchLabel(suitMatches.length + 1);
    return createMatch({
      type: MATCH_TYPES.SUIT,
      label,
      basePoints: SCORE_CONFIG.suit,
      matchedIndexes: suitMatches,
      matchedCards: suitMatches.map((index) => stackCards[index]),
      equation: {
        left: selectedCard.suitSymbol,
        operator: "=",
        right: selectedCard.suitSymbol,
        result: selectedCard.suitSymbol
      },
      cutinLabel: label
    });
  }

  return {
    valid: false,
    type: MATCH_TYPES.MISS,
    label: "BUST",
    basePoints: 0,
    matchedIndexes: [],
    matchedCards: []
  };
}

export function resolveSelectedCrunch(baseStack, selectedCards) {
  const activeStack = [...baseStack];
  const history = [];

  for (let i = 0; i < selectedCards.length; i += 1) {
    const card = selectedCards[i];
    const match = evaluateStackAdd(activeStack, card);
    if (!match.valid) {
      return {
        success: false,
        failedIndex: i,
        failedCard: card,
        activeStack,
        history,
        match
      };
    }

    const entry = createStackEntry(card, match);
    history.push(entry);
    activeStack.push(card);
  }

  return {
    success: true,
    activeStack,
    history,
    failedIndex: -1,
    failedCard: null
  };
}

export function createStackEntry(card, match) {
  return {
    card,
    matchType: match.type,
    basePoints: match.basePoints,
    matchedCards: match.matchedCards,
    matchedIndexes: match.matchedIndexes,
    label: match.label,
    equation: match.equation,
    cutinLabel: match.cutinLabel,
    compoundMatch: match.compoundMatch ?? null
  };
}

export function calculateCrunchScore({
  baseStack,
  selectedCards,
  timeLeft,
  streak,
  runMultiplier = 1,
  gameplayModifier = null,
  resolutionOverride = null,
  selectionMultiplierOverride = null,
  selectionLabel = "HAND",
  enableFullHand = true
}) {
  const resolution = resolutionOverride ?? resolveSelectedCrunch(baseStack, selectedCards);
  if (!resolution.success) return { success: false, resolution };

  const presentationEntries = buildCrunchPresentationEntries(resolution.history);
  const displayPoints = presentationEntries.map((entry) => getRuleAdjustedDisplayPoints(entry, gameplayModifier));
  const awardedPoints = presentationEntries.map((entry, index) => (
    displayPoints[index]
      * getEntryMatchTierMultiplier(entry)
      * getCompoundMatchMultiplier(entry)
      * getEntryPowerMultiplier(entry)
  ));
  const storedBase = awardedPoints.reduce((sum, points) => sum + points, 0);
  const handMultiplier = Number.isFinite(selectionMultiplierOverride)
    ? Math.max(1, selectionMultiplierOverride)
    : getSelectionMultiplier(selectedCards.length);
  const speedBonus = getSpeedBonus(timeLeft);
  const streakAfterCrunch = streak + 1;
  const streakMultiplier = getStreakMultiplier(streakAfterCrunch);
  const stackTypes = detectStackTypes(resolution.activeStack, resolution.history, selectedCards.length, { enableFullHand });
  const stackTypeMultiplier = stackTypes.reduce((product, bonus) => product * (bonus.multiplier ?? 1), 1);
  const stackTypeFlat = stackTypes.reduce((sum, bonus) => sum + (bonus.flatBonus ?? 0), 0);
  const potRuleMultiplier = getPotRuleMultiplier(gameplayModifier, selectedCards.length);
  const total = Math.round((storedBase * handMultiplier * speedBonus.multiplier * streakMultiplier * stackTypeMultiplier * potRuleMultiplier + stackTypeFlat) * runMultiplier);
  const breakdown = buildCrunchBreakdown({
    storedBase,
    handMultiplier,
    speedBonus,
    streakMultiplier,
    stackTypes,
    potRuleMultiplier,
    potRuleLabel: gameplayModifier?.scoreLabel,
    runMultiplier,
    selectionLabel,
    total
  });
  const isFullHand = enableFullHand && selectedCards.length === 4;
  const fullHandSteps = isFullHand
    ? breakdown.filter((step) => step.label === selectionLabel || step.label === "PERFECT HAND")
    : [];
  const perfectHandMultiplier = isFullHand
    ? stackTypes.find((bonus) => bonus.label === "PERFECT HAND")?.multiplier ?? 1
    : 1;
  const fullHandMultiplier = isFullHand
    ? handMultiplier * perfectHandMultiplier
    : 1;
  const fullScoreMultiplier = handMultiplier
    * speedBonus.multiplier
    * streakMultiplier
    * stackTypeMultiplier
    * potRuleMultiplier
    * runMultiplier;
  const entryScoreMultiplier = fullScoreMultiplier / fullHandMultiplier;
  const entryAwardTotal = isFullHand
    ? Math.min(total, Math.max(0, Math.round(storedBase * entryScoreMultiplier + stackTypeFlat * runMultiplier)))
    : total;
  const fullHandBankPoints = Math.max(0, total - entryAwardTotal);
  const entryAwards = allocateCutsceneAwards({
    awardedPoints,
    total: entryAwardTotal,
    multiplier: entryScoreMultiplier
  });
  const fullHandLabels = new Set(fullHandSteps.map((step) => step.label));
  const inlineMultipliers = breakdown.filter((step) => step.kind === "multiplier" && !fullHandLabels.has(step.label));
  const inlineFlatBonuses = breakdown.filter((step) => step.kind === "bonus");

  return {
    success: true,
    resolution,
    storedBase,
    handMultiplier,
    speedBonus,
    streakAfterCrunch,
    streakMultiplier,
    stackTypes,
    potRuleMultiplier,
    total,
    cutscene: {
      entries: presentationEntries.map((entry, index) => ({
        card: entry.card,
        matchType: entry.matchType,
        points: awardedPoints[index],
        displayPoints: displayPoints[index],
        bankPoints: entryAwards[index],
        matchedCards: entry.matchedCards,
        matchedIndexes: entry.matchedIndexes,
        selectedIndexes: entry.selectedIndexes,
        equation: entry.equation,
        label: entry.cutinLabel ?? entry.label,
        isDouble: entry.matchedCards.length > 1 && (entry.matchType === MATCH_TYPES.RANK || entry.matchType === MATCH_TYPES.SUIT),
        multiplier: entry.matchedCards.length > 1 && (entry.matchType === MATCH_TYPES.RANK || entry.matchType === MATCH_TYPES.SUIT) ? 2 : 1,
        matchCount: entry.matchCount,
        powerType: entry.powerType ?? null,
        powerMultiplier: entry.powerMultiplier ?? 1,
        resolvedCard: entry.resolvedCard ?? null,
        resolvedLabel: entry.resolvedLabel ?? null,
        inlineBonuses: [
          ...createMatchTierBonus(entry),
          ...createCompoundMatchBonus(entry),
          ...createPowerCardBonus(entry),
          ...inlineMultipliers,
          ...(index === presentationEntries.length - 1 ? inlineFlatBonuses : [])
        ]
      })),
      total,
      selectedCount: selectedCards.length,
      tier: isFullHand || selectedCards.length >= 6 ? "full" : selectedCards.length >= 3 ? "big" : "normal",
      fullHand: isFullHand
        ? {
            label: "FULL HAND!",
            subtitle: "ALL 4 CARDS LOCKED",
            bonuses: fullHandSteps,
            bankPoints: fullHandBankPoints
          }
        : null
    },
    breakdown
  };
}

function allocateCutsceneAwards({ awardedPoints, total, multiplier }) {
  let assigned = 0;
  return awardedPoints.map((points, index) => {
    if (index === awardedPoints.length - 1) return Math.max(0, total - assigned);
    const award = Math.min(Math.max(0, total - assigned), Math.max(0, Math.round(points * multiplier)));
    assigned += award;
    return award;
  });
}

function getRuleAdjustedDisplayPoints(entry, gameplayModifier) {
  const suitMultiplier = entry.matchType === MATCH_TYPES.SUIT
    ? Number(gameplayModifier?.suitMatchMultiplier ?? 1)
    : 1;
  return Math.round(entry.basePoints * Math.max(1, suitMultiplier));
}

function getMatchTierMultiplier(matchCount = 2) {
  if (matchCount <= 2) return MATCH_TIER_MULTIPLIERS[2];
  if (MATCH_TIER_MULTIPLIERS[matchCount]) return MATCH_TIER_MULTIPLIERS[matchCount];
  return MATCH_TIER_MULTIPLIERS[6] + (matchCount - 6) * 12;
}

function getEntryMatchTierMultiplier(entry) {
  if (entry.powerType === "wild") return 1;
  if (entry.matchType !== MATCH_TYPES.RANK && entry.matchType !== MATCH_TYPES.SUIT) return 1;
  return getMatchTierMultiplier(entry.matchCount);
}

function getCompoundMatchMultiplier(entry) {
  if (entry.powerType === "wild") return 1;
  if (entry.matchType !== MATCH_TYPES.RANK || entry.matchCount !== 2) return 1;
  return entry.compoundMatch?.type === "rank-suit"
    ? Math.max(1, Number(entry.compoundMatch.multiplier) || 1)
    : 1;
}

function getEntryPowerMultiplier(entry) {
  return Math.max(1, Number(entry.powerMultiplier) || 1);
}

function createPowerCardBonus(entry) {
  const multiplier = getEntryPowerMultiplier(entry);
  if (multiplier <= 1) return [];
  return [{
    label: entry.powerLabel ?? "POWER CARD",
    value: `x${formatMultiplier(multiplier)}`,
    tone: "power",
    kind: "entry-multiplier",
    multiplier
  }];
}

function createCompoundMatchBonus(entry) {
  const multiplier = getCompoundMatchMultiplier(entry);
  if (multiplier <= 1) return [];
  return [{
    label: entry.compoundMatch.label,
    value: `x${multiplier}`,
    tone: "double",
    kind: "entry-multiplier",
    multiplier
  }];
}

function createMatchTierBonus(entry) {
  if (entry.matchType !== MATCH_TYPES.RANK && entry.matchType !== MATCH_TYPES.SUIT) return [];
  const multiplier = getEntryMatchTierMultiplier(entry);
  if (multiplier <= 1) return [];
  return [{
    label: entry.cutinLabel ?? entry.label,
    value: `x${multiplier}`,
    tone: entry.matchType,
    kind: "entry-multiplier",
    multiplier
  }];
}

function buildCrunchPresentationEntries(history) {
  const groups = new Map();

  history.forEach((entry, index) => {
    const key = getGrowingMatchKey(entry);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });

  return history.flatMap((entry, index) => {
    const key = getGrowingMatchKey(entry);
    const memberIndexes = key ? groups.get(key) : [index];
    if (memberIndexes.length > 1 && index !== memberIndexes.at(-1)) return [];

    const finalEntry = memberIndexes.length > 1 ? history[memberIndexes.at(-1)] : entry;
    const matchedCards = uniqueCards(finalEntry.matchedCards);
    return [{
      ...finalEntry,
      matchedCards,
      selectedIndexes: [...memberIndexes],
      matchCount: uniqueCards([...matchedCards, finalEntry.card]).length
    }];
  });
}

function getGrowingMatchKey(entry) {
  if (entry.powerType) return null;
  if (entry.matchType === MATCH_TYPES.SUIT) return `suit:${entry.card.suit}`;
  if (entry.matchType === MATCH_TYPES.RANK) return `rank:${entry.card.value}`;
  return null;
}

function uniqueCards(cards) {
  return [...new Set(cards.filter(Boolean))];
}

function getPotRuleMultiplier(gameplayModifier, selectedCount) {
  let multiplier = Math.max(1, Number(gameplayModifier?.scoreMultiplier ?? 1));
  const minimumSelection = Number(gameplayModifier?.minSelectionForMultiplier ?? Infinity);
  if (selectedCount >= minimumSelection) {
    multiplier *= Math.max(1, Number(gameplayModifier?.selectionScoreMultiplier ?? 1));
  }
  return multiplier;
}

export function getSelectionMultiplier(count) {
  return SELECTION_MULTIPLIERS[count] ?? 1;
}

export function getSpeedBonus(timeLeft) {
  if (timeLeft >= 8) return { label: "LIGHTNING", multiplier: 3 };
  if (timeLeft >= 6) return { label: "FAST", multiplier: 2 };
  if (timeLeft >= 4) return { label: "QUICK", multiplier: 1.5 };
  return { label: null, multiplier: 1 };
}

export function getStreakMultiplier(streak) {
  if (streak >= 15) return 10;
  if (streak >= 10) return 5;
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

export function detectStackTypes(stackCards, history, selectedCount, { enableFullHand = true } = {}) {
  const bonuses = [];
  const suitCounts = countBy(stackCards, "suit");
  const rankCounts = countBy(stackCards, "value");
  const maxSuit = Math.max(0, ...Object.values(suitCounts));
  const maxRank = Math.max(0, ...Object.values(rankCounts));
  const normalHistory = history.filter((entry) => !entry.powerType);
  const mathCards = normalHistory.filter((entry) => entry.matchType === MATCH_TYPES.ADD || entry.matchType === MATCH_TYPES.SUBTRACT).length;
  const suitCards = normalHistory.filter((entry) => entry.matchType === MATCH_TYPES.SUIT).length;
  const strongestRankMatch = Math.max(0, ...history
    .filter((entry) => entry.matchType === MATCH_TYPES.RANK)
    .map((entry) => entry.matchedCards.length + 1));

  if (maxSuit >= STACK_TYPE_CONFIG.flushCrunch.minCardsSameSuit) bonuses.push({ label: "FLUSH CRUNCH", value: "x2", multiplier: STACK_TYPE_CONFIG.flushCrunch.multiplier, tone: "suit" });
  if (maxRank >= 3 && strongestRankMatch < 3) bonuses.push({ label: "TRIPLE RANK", value: "x2", multiplier: STACK_TYPE_CONFIG.tripleRank.multiplier, tone: "rank" });
  if (mathCards >= STACK_TYPE_CONFIG.chainCrunch.minMathLinks) bonuses.push({ label: "CHAIN CRUNCH", value: "x3", multiplier: STACK_TYPE_CONFIG.chainCrunch.multiplier, tone: "math" });
  if (mathCards >= STACK_TYPE_CONFIG.mathFeast.minMathCards) bonuses.push({ label: "MATH FEAST", value: "x2", multiplier: STACK_TYPE_CONFIG.mathFeast.multiplier, tone: "math" });
  if (suitCards >= STACK_TYPE_CONFIG.suitStorm.minSuitCards) bonuses.push({ label: "SUIT STORM", value: "x1.5", multiplier: STACK_TYPE_CONFIG.suitStorm.multiplier, tone: "suit" });
  if (enableFullHand && selectedCount === STACK_TYPE_CONFIG.perfectHand.minSelectedCards) bonuses.push({ label: "PERFECT HAND", value: `x${STACK_TYPE_CONFIG.perfectHand.multiplier}`, multiplier: STACK_TYPE_CONFIG.perfectHand.multiplier, tone: "double" });
  if (selectedCount >= STACK_TYPE_CONFIG.greedCrunch.minSelectedCards) bonuses.push({ label: "GREED CRUNCH", value: "+500", flatBonus: STACK_TYPE_CONFIG.greedCrunch.flatBonus, tone: "fever" });

  return bonuses;
}

export function runScoringSelfTests() {
  const card = (rank, suit, value = rank) => ({ id: `${rank}-${suit}`, rank: String(rank), value, suit, suitSymbol: "", color: "red" });
  const base = [card(3, "diamonds"), card(5, "spades")];
  const success = calculateCrunchScore({ baseStack: base, selectedCards: [card(8, "hearts"), card("K", "spades", 13)], timeLeft: 7, streak: 0 });
  const fail = calculateCrunchScore({ baseStack: base, selectedCards: [card(8, "hearts"), card("Q", "clubs", 12)], timeLeft: 7, streak: 0 });
  const one = calculateCrunchScore({ baseStack: base, selectedCards: [card("K", "diamonds", 13)], timeLeft: 3, streak: 0 });
  const suitSurge = calculateCrunchScore({
    baseStack: base,
    selectedCards: [card("K", "diamonds", 13)],
    timeLeft: 3,
    streak: 0,
    gameplayModifier: { suitMatchMultiplier: 2 }
  });
  const fullHandFever = calculateCrunchScore({
    baseStack: base,
    selectedCards: [card(8, "hearts"), card("K", "spades", 13), card(2, "clubs")],
    timeLeft: 3,
    streak: 0,
    gameplayModifier: { minSelectionForMultiplier: 3, selectionScoreMultiplier: 2, scoreLabel: "HAND FEVER" }
  });
  const tripleRank = calculateCrunchScore({
    baseStack: [card(5, "hearts"), card(5, "spades")],
    selectedCards: [card(5, "clubs")],
    timeLeft: 3,
    streak: 0
  });
  const tripleSuit = calculateCrunchScore({
    baseStack: [card(5, "hearts"), card(9, "spades")],
    selectedCards: [card(6, "hearts"), card(10, "hearts")],
    timeLeft: 3,
    streak: 0
  });
  const plainNumberMatch = calculateCrunchScore({
    baseStack: [card(7, "clubs"), card(2, "diamonds")],
    selectedCards: [card(7, "hearts")],
    timeLeft: 3,
    streak: 0
  });
  const numberAndSuitMatch = calculateCrunchScore({
    baseStack: [card(7, "hearts"), card(2, "clubs")],
    selectedCards: [card(7, "hearts")],
    timeLeft: 3,
    streak: 0
  });
  const perfectHand = calculateCrunchScore({
    baseStack: base,
    selectedCards: [card(8, "hearts"), card("K", "clubs", 13), card(2, "clubs"), card(10, "diamonds")],
    timeLeft: 3,
    streak: 0
  });

  const cases = [
    { name: "success sequence", pass: success.success && success.resolution.history.length === 2 },
    { name: "fail sequence", pass: !fail.success && fail.resolution.failedIndex === 1 },
    { name: "one card crunch", pass: one.success && one.handMultiplier === 1 },
    { name: "two card multiplier", pass: success.handMultiplier === 2 },
    { name: "speed bonus", pass: success.speedBonus.multiplier === 2 },
    { name: "math base ignores match tiers", pass: success.cutscene.entries[0].points === SCORE_CONFIG.math },
    { name: "suit surge modifier", pass: suitSurge.success && suitSurge.storedBase === 200 },
    {
      name: "plain number match has no duplicate pair bonus",
      pass: plainNumberMatch.success
        && plainNumberMatch.storedBase === SCORE_CONFIG.rank
        && plainNumberMatch.total === SCORE_CONFIG.rank
        && !plainNumberMatch.stackTypes.some((bonus) => bonus.label === "PAIR BONUS")
        && !plainNumberMatch.cutscene.entries[0].inlineBonuses.some((bonus) => bonus.label === "NUMBER + SUIT")
    },
    {
      name: "same number and suit earns one compound bonus",
      pass: numberAndSuitMatch.success
        && numberAndSuitMatch.storedBase === SCORE_CONFIG.rank * 2
        && numberAndSuitMatch.total === SCORE_CONFIG.rank * 2
        && numberAndSuitMatch.cutscene.entries[0].inlineBonuses.some((bonus) => bonus.label === "NUMBER + SUIT" && bonus.value === "x2")
    },
    { name: "full hand fever modifier", pass: fullHandFever.success && fullHandFever.potRuleMultiplier === 2 },
    { name: "cutscene awards equal total", pass: success.cutscene.entries.reduce((sum, entry) => sum + entry.bankPoints, 0) === success.total },
    { name: "full cutscene awards equal total", pass: fullHandFever.cutscene.entries.reduce((sum, entry) => sum + entry.bankPoints, 0) === fullHandFever.total },
    { name: "cutscene bonuses are inline", pass: success.cutscene.entries.every((entry) => Array.isArray(entry.inlineBonuses)) },
    {
      name: "triple rank reacts inline",
      pass: tripleRank.cutscene.entries[0].matchCount === 3
        && tripleRank.cutscene.entries[0].inlineBonuses.some((bonus) => bonus.label === "TRIPLE MATCH" && bonus.value === "x6")
        && tripleRank.cutscene.entries[0].bankPoints === tripleRank.total
    },
    {
      name: "growing suit match consolidates",
      pass: tripleSuit.success
        && tripleSuit.cutscene.entries.length === 1
        && tripleSuit.cutscene.entries[0].selectedIndexes.length === 2
        && tripleSuit.cutscene.entries[0].label === "TRIPLE SUIT MATCH"
        && tripleSuit.cutscene.entries[0].displayPoints === SCORE_CONFIG.suit
        && tripleSuit.cutscene.entries[0].points === SCORE_CONFIG.suit * MATCH_TIER_MULTIPLIERS[3]
    },
    {
      name: "full hand celebration owns bonuses",
      pass: perfectHand.success
        && perfectHand.cutscene.fullHand?.bonuses.some((bonus) => bonus.label === "HAND" && bonus.value === "x8")
        && perfectHand.cutscene.fullHand?.bonuses.some((bonus) => bonus.label === "PERFECT HAND" && bonus.value === "x3")
        && perfectHand.cutscene.fullHand.bankPoints > 0
        && perfectHand.cutscene.entries.every((entry) => entry.inlineBonuses.every((bonus) => bonus.label !== "HAND" && bonus.label !== "PERFECT HAND"))
        && perfectHand.cutscene.entries.reduce((sum, entry) => sum + entry.bankPoints, perfectHand.cutscene.fullHand.bankPoints) === perfectHand.total
    }
  ];

  return cases.map((test) => ({ ...test, result: test.name.includes("fail") ? fail : success }));
}

function createMatch({ type, label, basePoints, matchedIndexes, matchedCards, equation, cutinLabel, compoundMatch = null }) {
  return { valid: true, type, label, basePoints, matchedIndexes, matchedCards, equation, cutinLabel, compoundMatch };
}

function getNumberMatchLabel(matchCount) {
  if (matchCount <= 2) return "NUMBER MATCH";
  return `${getMatchCountName(matchCount)} MATCH`;
}

function getSuitMatchLabel(matchCount) {
  if (matchCount <= 2) return "SUIT MATCH";
  return `${getMatchCountName(matchCount)} SUIT MATCH`;
}

function getMatchCountName(count) {
  if (count === 3) return "TRIPLE";
  if (count === 4) return "QUAD";
  if (count === 5) return "FIVE-WAY";
  return `${count}X`;
}

function getStackPairs(cards) {
  const pairs = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      pairs.push({ a: { card: cards[i], index: i }, b: { card: cards[j], index: j } });
    }
  }
  return pairs;
}

function buildCrunchBreakdown({ storedBase, handMultiplier, speedBonus, streakMultiplier, stackTypes, potRuleMultiplier = 1, potRuleLabel = "POT RULE", runMultiplier = 1, selectionLabel = "HAND", total }) {
  const steps = [{ label: "STORED", value: `+${formatCompactNumber(storedBase)}`, tone: "total", kind: "base" }];
  if (handMultiplier > 1) steps.push({ label: selectionLabel, value: `x${formatMultiplier(handMultiplier)}`, tone: "double", kind: "multiplier", multiplier: handMultiplier });
  if (speedBonus.multiplier > 1) steps.push({ label: speedBonus.label, value: `x${formatMultiplier(speedBonus.multiplier)}`, tone: "speed", kind: "multiplier", multiplier: speedBonus.multiplier });
  if (streakMultiplier > 1) steps.push({ label: "STREAK", value: `x${streakMultiplier}`, tone: streakMultiplier >= 10 ? "fever" : "streak", kind: "multiplier", multiplier: streakMultiplier });
  stackTypes.forEach((bonus) => steps.push({
    label: bonus.label,
    value: bonus.value,
    tone: bonus.tone,
    kind: bonus.multiplier ? "multiplier" : "bonus",
    multiplier: bonus.multiplier,
    flatBonus: bonus.flatBonus
  }));
  if (potRuleMultiplier > 1) steps.push({ label: potRuleLabel, value: `x${formatMultiplier(potRuleMultiplier)}`, tone: "pot", kind: "multiplier", multiplier: potRuleMultiplier });
  if (runMultiplier > 1) steps.push({ label: "RUN MULTI", value: `x${formatMultiplier(runMultiplier)}`, tone: "run", kind: "multiplier", multiplier: runMultiplier });
  steps.push({ label: "TOTAL", value: `+${formatCompactNumber(total)}`, tone: "total", kind: "total" });
  return steps;
}

function countBy(cards, key) {
  return cards.reduce((counts, card) => {
    counts[card[key]] = (counts[card[key]] ?? 0) + 1;
    return counts;
  }, {});
}

function formatMultiplier(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, "");
}
