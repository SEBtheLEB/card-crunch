export const MATCH_TYPES = {
  ADD: "add",
  SUBTRACT: "subtract",
  RANK: "rank",
  SUIT: "suit",
  MISS: "miss"
};

export const SCORE_CONFIG = {
  suit: 100,
  rank: 300,
  math: 500
};

export const SELECTION_MULTIPLIERS = {
  1: 1,
  2: 2,
  3: 4,
  4: 8
};

export const STACK_TYPE_CONFIG = {
  flushCrunch: { minCardsSameSuit: 4, multiplier: 2 },
  pairCrunch: { flatBonus: 1000 },
  tripleRank: { multiplier: 2 },
  chainCrunch: { minMathLinks: 2, multiplier: 3 },
  mathFeast: { minMathCards: 3, multiplier: 2 },
  suitStorm: { minSuitCards: 3, multiplier: 1.5 },
  perfectHand: { minSelectedCards: 4, multiplier: 4 },
  greedCrunch: { minSelectedCards: 3, flatBonus: 1500 }
};

export function evaluateStackAdd(stackCards, selectedCard) {
  const pairs = getStackPairs(stackCards);

  const addPair = pairs.find(({ a, b }) => a.card.value + b.card.value === selectedCard.value);
  if (addPair) {
    return createMatch({
      type: MATCH_TYPES.ADD,
      label: "SUM COMBO",
      basePoints: SCORE_CONFIG.math,
      matchedIndexes: [addPair.a.index, addPair.b.index],
      matchedCards: [addPair.a.card, addPair.b.card],
      equationText: `${addPair.a.card.value} + ${addPair.b.card.value} = ${selectedCard.value}`,
      reasonText: `${cardLabel(addPair.a.card)} plus ${cardLabel(addPair.b.card)} makes ${selectedCard.rank}.`
    });
  }

  const subtractPair = pairs.find(({ a, b }) => Math.abs(a.card.value - b.card.value) === selectedCard.value);
  if (subtractPair) {
    return createMatch({
      type: MATCH_TYPES.SUBTRACT,
      label: "MINUS COMBO",
      basePoints: SCORE_CONFIG.math,
      matchedIndexes: [subtractPair.a.index, subtractPair.b.index],
      matchedCards: [subtractPair.a.card, subtractPair.b.card],
      equationText: `${Math.max(subtractPair.a.card.value, subtractPair.b.card.value)} - ${Math.min(subtractPair.a.card.value, subtractPair.b.card.value)} = ${selectedCard.value}`,
      reasonText: `${cardLabel(subtractPair.a.card)} and ${cardLabel(subtractPair.b.card)} differ by ${selectedCard.rank}.`
    });
  }

  const rankMatches = stackCards
    .map((card, index) => (card.value === selectedCard.value ? index : -1))
    .filter((index) => index >= 0);

  if (rankMatches.length > 0) {
    return createMatch({
      type: MATCH_TYPES.RANK,
      label: "RANK MATCH",
      basePoints: SCORE_CONFIG.rank,
      matchedIndexes: rankMatches,
      matchedCards: rankMatches.map((index) => stackCards[index]),
      equationText: `${selectedCard.rank} = ${selectedCard.rank}`,
      reasonText: `${cardLabel(selectedCard)} matches a table/stack rank.`
    });
  }

  const suitMatches = stackCards
    .map((card, index) => (card.suit === selectedCard.suit ? index : -1))
    .filter((index) => index >= 0);

  if (suitMatches.length > 0) {
    return createMatch({
      type: MATCH_TYPES.SUIT,
      label: "SUIT MATCH",
      basePoints: SCORE_CONFIG.suit,
      matchedIndexes: suitMatches,
      matchedCards: suitMatches.map((index) => stackCards[index]),
      equationText: `${selectedCard.suitSymbol} suit match`,
      reasonText: `${cardLabel(selectedCard)} matches a table/stack suit.`
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
    equationText: match.equationText,
    reasonText: match.reasonText
  };
}

export function calculateCrunchScore({ baseStack, selectedCards, timeLeft, streak }) {
  const resolution = resolveSelectedCrunch(baseStack, selectedCards);
  if (!resolution.success) return { success: false, resolution };

  const storedBase = resolution.history.reduce((sum, entry) => sum + entry.basePoints, 0);
  const handMultiplier = getSelectionMultiplier(selectedCards.length);
  const speedBonus = getSpeedBonus(timeLeft);
  const streakAfterCrunch = streak + 1;
  const streakMultiplier = getStreakMultiplier(streakAfterCrunch);
  const stackTypes = detectStackTypes(resolution.activeStack, resolution.history, selectedCards.length);
  const stackTypeMultiplier = stackTypes.reduce((product, bonus) => product * (bonus.multiplier ?? 1), 1);
  const stackTypeFlat = stackTypes.reduce((sum, bonus) => sum + (bonus.flatBonus ?? 0), 0);
  const total = Math.round(storedBase * handMultiplier * speedBonus.multiplier * streakMultiplier * stackTypeMultiplier + stackTypeFlat);

  return {
    success: true,
    resolution,
    storedBase,
    handMultiplier,
    speedBonus,
    streakAfterCrunch,
    streakMultiplier,
    stackTypes,
    total,
    basePoints: storedBase,
    bonuses: stackTypes,
    multiplier: handMultiplier * speedBonus.multiplier * streakMultiplier * stackTypeMultiplier,
    finalPoints: total,
    explanationSteps: buildExplanationSteps({ resolution, storedBase, handMultiplier, speedBonus, streakMultiplier, stackTypes, total }),
    equationText: resolution.history.map((entry) => entry.equationText).filter(Boolean).join("  |  "),
    crunchTier: selectedCards.length === 4 ? "full" : selectedCards.length >= 3 ? "greedy" : "standard",
    breakdown: buildCrunchBreakdown({
      storedBase,
      handMultiplier,
      speedBonus,
      streakMultiplier,
      stackTypes,
      total
    })
  };
}

export function getSelectionMultiplier(count) {
  return SELECTION_MULTIPLIERS[count] ?? 1;
}

export function getSpeedBonus(timeLeft) {
  if (timeLeft >= 5.5) return { label: "LIGHTNING", multiplier: 3 };
  if (timeLeft >= 4) return { label: "FAST", multiplier: 2 };
  if (timeLeft >= 2.5) return { label: "QUICK", multiplier: 1.5 };
  return { label: null, multiplier: 1 };
}

export function getStreakMultiplier(streak) {
  if (streak >= 15) return 10;
  if (streak >= 10) return 5;
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

export function detectStackTypes(stackCards, history, selectedCount) {
  const bonuses = [];
  const suitCounts = countBy(stackCards, "suit");
  const rankCounts = countBy(stackCards, "value");
  const maxSuit = Math.max(0, ...Object.values(suitCounts));
  const maxRank = Math.max(0, ...Object.values(rankCounts));
  const mathCards = history.filter((entry) => entry.matchType === MATCH_TYPES.ADD || entry.matchType === MATCH_TYPES.SUBTRACT).length;
  const suitCards = history.filter((entry) => entry.matchType === MATCH_TYPES.SUIT).length;

  if (maxSuit >= STACK_TYPE_CONFIG.flushCrunch.minCardsSameSuit) bonuses.push({ label: "FLUSH CRUNCH", value: "x2", multiplier: STACK_TYPE_CONFIG.flushCrunch.multiplier, tone: "suit" });
  if (maxRank >= 2) bonuses.push({ label: "PAIR BONUS", value: "+1000", flatBonus: STACK_TYPE_CONFIG.pairCrunch.flatBonus, tone: "rank" });
  if (maxRank >= 3) bonuses.push({ label: "TRIPLE RANK", value: "x2", multiplier: STACK_TYPE_CONFIG.tripleRank.multiplier, tone: "rank" });
  if (mathCards >= STACK_TYPE_CONFIG.chainCrunch.minMathLinks) bonuses.push({ label: "CHAIN CRUNCH", value: "x3", multiplier: STACK_TYPE_CONFIG.chainCrunch.multiplier, tone: "math" });
  if (mathCards >= STACK_TYPE_CONFIG.mathFeast.minMathCards) bonuses.push({ label: "MATH FEAST", value: "x2", multiplier: STACK_TYPE_CONFIG.mathFeast.multiplier, tone: "math" });
  if (suitCards >= STACK_TYPE_CONFIG.suitStorm.minSuitCards) bonuses.push({ label: "SUIT STORM", value: "x1.5", multiplier: STACK_TYPE_CONFIG.suitStorm.multiplier, tone: "suit" });
  if (selectedCount >= STACK_TYPE_CONFIG.perfectHand.minSelectedCards) bonuses.push({ label: "PERFECT HAND", value: "x4", multiplier: STACK_TYPE_CONFIG.perfectHand.multiplier, tone: "double" });
  if (selectedCount >= STACK_TYPE_CONFIG.greedCrunch.minSelectedCards) bonuses.push({ label: "GREED CRUNCH", value: "+1500", flatBonus: STACK_TYPE_CONFIG.greedCrunch.flatBonus, tone: "fever" });

  return bonuses;
}

export function runScoringSelfTests() {
  const card = (rank, suit, value = rank) => ({ id: `${rank}-${suit}`, rank: String(rank), value, suit, suitSymbol: "", color: "red" });
  const base = [card(3, "diamonds"), card(5, "spades")];
  const success = calculateCrunchScore({ baseStack: base, selectedCards: [card(8, "hearts"), card("K", "spades", 13)], timeLeft: 7, streak: 0 });
  const fail = calculateCrunchScore({ baseStack: base, selectedCards: [card(8, "hearts"), card("Q", "clubs", 12)], timeLeft: 7, streak: 0 });
  const one = calculateCrunchScore({ baseStack: base, selectedCards: [card("K", "diamonds", 13)], timeLeft: 3, streak: 0 });

  const cases = [
    { name: "success sequence", pass: success.success && success.resolution.history.length === 2 },
    { name: "fail sequence", pass: !fail.success && fail.resolution.failedIndex === 1 },
    { name: "one card crunch", pass: one.success && one.handMultiplier === 1 },
    { name: "two card multiplier", pass: success.handMultiplier === 2 },
    { name: "speed bonus", pass: success.speedBonus.multiplier === 3 },
    { name: "structured explanation", pass: success.explanationSteps.length > 0 && Boolean(success.equationText) }
  ];

  return cases.map((test) => ({ ...test, result: test.name.includes("fail") ? fail : success }));
}

function createMatch({ type, label, basePoints, matchedIndexes, matchedCards, equationText, reasonText }) {
  return { valid: true, type, label, basePoints, matchedIndexes, matchedCards, equationText, reasonText };
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

function buildCrunchBreakdown({ storedBase, handMultiplier, speedBonus, streakMultiplier, stackTypes, total }) {
  const steps = [{ label: "STORED", value: `+${storedBase.toLocaleString()}`, tone: "total", kind: "base" }];
  if (handMultiplier > 1) steps.push({ label: "HAND", value: `x${handMultiplier}`, tone: "double", kind: "multiplier" });
  if (speedBonus.multiplier > 1) steps.push({ label: speedBonus.label, value: `x${formatMultiplier(speedBonus.multiplier)}`, tone: "speed", kind: "multiplier" });
  if (streakMultiplier > 1) steps.push({ label: "STREAK", value: `x${streakMultiplier}`, tone: streakMultiplier >= 10 ? "fever" : "streak", kind: "multiplier" });
  stackTypes.forEach((bonus) => steps.push({ label: bonus.label, value: bonus.value, tone: bonus.tone, kind: bonus.multiplier ? "multiplier" : "bonus" }));
  steps.push({ label: "TOTAL", value: `+${total.toLocaleString()}`, tone: "total", kind: "total" });
  return steps;
}

function buildExplanationSteps({ resolution, storedBase, handMultiplier, speedBonus, streakMultiplier, stackTypes, total }) {
  const steps = resolution.history.map((entry, index) => ({
    label: `Card ${index + 1}: ${entry.label}`,
    value: `+${entry.basePoints.toLocaleString()}`,
    detail: entry.reasonText ?? entry.equationText ?? "Valid crunch.",
    tone: entry.matchType
  }));

  steps.push({ label: "Base Crunch", value: `+${storedBase.toLocaleString()}`, detail: "Valid cards banked before multipliers.", tone: "total" });
  if (handMultiplier > 1) steps.push({ label: "Hand Multiplier", value: `x${handMultiplier}`, detail: "More selected cards means bigger risk and bigger reward.", tone: "double" });
  if (speedBonus.multiplier > 1) steps.push({ label: speedBonus.label, value: `x${formatMultiplier(speedBonus.multiplier)}`, detail: "Fast Crunch speed bonus.", tone: "speed" });
  if (streakMultiplier > 1) steps.push({ label: "Streak Multiplier", value: `x${streakMultiplier}`, detail: "Consecutive successful Crunches increase payout.", tone: "streak" });
  stackTypes.forEach((bonus) => steps.push({ label: bonus.label, value: bonus.value, detail: "Stack bonus earned from the final resolved stack.", tone: bonus.tone }));
  steps.push({ label: "Final Score", value: `+${total.toLocaleString()}`, detail: "Total points earned by this Crunch.", tone: "total" });
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

function cardLabel(card) {
  return `${card.rank}${card.suitSymbol}`;
}
