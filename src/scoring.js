export const MATCH_TYPES = {
  FUSION: "fusion",
  SYMBOL: "symbol",
  COLOR: "color",
  MISS: "miss"
};

export const SCORE_CONFIG = {
  color: 100,
  symbol: 300,
  fusion: 700
};

export const SELECTION_MULTIPLIERS = {
  1: 1,
  2: 2,
  3: 4,
  4: 8
};

export const STACK_TYPE_CONFIG = {
  colorFlood: { minSameColor: 4, multiplier: 2 },
  symbolChain: { minSameSymbol: 3, multiplier: 2 },
  fusionFeast: { minFusionCards: 2, multiplier: 3 },
  rainbowCrunch: { requiredColors: ["red", "blue", "green", "yellow", "purple"], multiplier: 5 },
  eclipseCrunch: { requiredSymbols: ["star", "moon", "eclipse"], multiplier: 4 },
  perfectHand: { minSelectedCards: 4, multiplier: 2 },
  greedCrunch: { minSelectedCards: 3, multiplier: 1.5 }
};

export function evaluateStackAdd(stackCards, selectedCard) {
  if (selectedCard.type === "fusion") {
    const ingredientMatches = findIngredientMatches(stackCards, selectedCard.ingredients ?? []);
    if (ingredientMatches.length === (selectedCard.ingredients ?? []).length) {
      return createMatch({
        type: MATCH_TYPES.FUSION,
        label: `${selectedCard.symbolLabel.toUpperCase()} FUSION`,
        basePoints: SCORE_CONFIG.fusion,
        matchedIndexes: ingredientMatches.map((match) => match.index),
        matchedCards: ingredientMatches.map((match) => match.card)
      });
    }
  }

  const symbolMatches = stackCards
    .map((card, index) => (card.symbol === selectedCard.symbol ? index : -1))
    .filter((index) => index >= 0);

  if (symbolMatches.length > 0) {
    return createMatch({
      type: MATCH_TYPES.SYMBOL,
      label: "SYMBOL MATCH",
      basePoints: SCORE_CONFIG.symbol,
      matchedIndexes: symbolMatches,
      matchedCards: symbolMatches.map((index) => stackCards[index])
    });
  }

  if (selectedCard.type === "basic") {
    const colorMatches = stackCards
      .map((card, index) => (card.type === "basic" && card.color === selectedCard.color ? index : -1))
      .filter((index) => index >= 0);

    if (colorMatches.length > 0) {
      return createMatch({
        type: MATCH_TYPES.COLOR,
        label: "COLOR MATCH",
        basePoints: SCORE_CONFIG.color,
        matchedIndexes: colorMatches,
        matchedCards: colorMatches.map((index) => stackCards[index])
      });
    }
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
    label: match.label
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

export function detectStackTypes(stackCards, history, selectedCount) {
  const bonuses = [];
  const colorCounts = countBy(stackCards.filter((card) => card.type === "basic"), "color");
  const symbolCounts = countBy(stackCards, "symbol");
  const maxColor = Math.max(0, ...Object.values(colorCounts));
  const maxSymbol = Math.max(0, ...Object.values(symbolCounts));
  const fusionCards = history.filter((entry) => entry.matchType === MATCH_TYPES.FUSION).length;
  const colorsInStack = new Set(stackCards.filter((card) => card.type === "basic").map((card) => card.color));
  const symbolsInStack = new Set(stackCards.map((card) => card.symbol));

  if (maxColor >= STACK_TYPE_CONFIG.colorFlood.minSameColor) bonuses.push({ label: "COLOR FLOOD", value: "x2", multiplier: STACK_TYPE_CONFIG.colorFlood.multiplier, tone: "color" });
  if (maxSymbol >= STACK_TYPE_CONFIG.symbolChain.minSameSymbol) bonuses.push({ label: "SYMBOL CHAIN", value: "x2", multiplier: STACK_TYPE_CONFIG.symbolChain.multiplier, tone: "symbol" });
  if (fusionCards >= STACK_TYPE_CONFIG.fusionFeast.minFusionCards) bonuses.push({ label: "FUSION FEAST", value: "x3", multiplier: STACK_TYPE_CONFIG.fusionFeast.multiplier, tone: "fusion" });
  if (STACK_TYPE_CONFIG.rainbowCrunch.requiredColors.every((color) => colorsInStack.has(color))) bonuses.push({ label: "RAINBOW CRUNCH", value: "x5", multiplier: STACK_TYPE_CONFIG.rainbowCrunch.multiplier, tone: "rainbow" });
  if (STACK_TYPE_CONFIG.eclipseCrunch.requiredSymbols.every((symbol) => symbolsInStack.has(symbol))) bonuses.push({ label: "ECLIPSE CRUNCH", value: "x4", multiplier: STACK_TYPE_CONFIG.eclipseCrunch.multiplier, tone: "fusion" });
  if (selectedCount >= STACK_TYPE_CONFIG.perfectHand.minSelectedCards) bonuses.push({ label: "PERFECT HAND", value: "x2", multiplier: STACK_TYPE_CONFIG.perfectHand.multiplier, tone: "double" });
  if (selectedCount >= STACK_TYPE_CONFIG.greedCrunch.minSelectedCards) bonuses.push({ label: "GREED CRUNCH", value: "x1.5", multiplier: STACK_TYPE_CONFIG.greedCrunch.multiplier, tone: "fever" });

  return bonuses;
}

export function runScoringSelfTests() {
  const basic = (color, symbol) => ({
    id: `${color}-${symbol}`,
    type: "basic",
    name: `${color} ${symbol}`,
    color,
    colorLabel: color,
    symbol,
    symbolLabel: symbol
  });
  const fusion = (symbol, ingredients) => ({
    id: symbol,
    type: "fusion",
    name: symbol,
    color: "fusion",
    colorLabel: "Fusion",
    symbol,
    symbolLabel: symbol,
    ingredients
  });

  const base = [basic("red", "flame"), basic("blue", "drop")];
  const colorMatch = calculateCrunchScore({ baseStack: base, selectedCards: [basic("red", "moon")], timeLeft: 5, streak: 0 });
  const symbolMatch = calculateCrunchScore({ baseStack: base, selectedCards: [basic("green", "flame")], timeLeft: 5, streak: 0 });
  const fusionMatch = calculateCrunchScore({ baseStack: base, selectedCards: [fusion("steam", ["flame", "drop"])], timeLeft: 5, streak: 0 });
  const fail = calculateCrunchScore({ baseStack: base, selectedCards: [basic("purple", "leaf")], timeLeft: 5, streak: 0 });
  const multi = calculateCrunchScore({ baseStack: base, selectedCards: [fusion("steam", ["flame", "drop"]), basic("yellow", "steam")], timeLeft: 7, streak: 0 });
  const four = calculateCrunchScore({
    baseStack: [basic("red", "flame"), basic("red", "drop")],
    selectedCards: [basic("red", "moon"), basic("red", "star"), basic("blue", "star"), fusion("steam", ["flame", "drop"])],
    timeLeft: 9,
    streak: 5
  });

  const cases = [
    { name: "basic color match", pass: colorMatch.success && colorMatch.resolution.history[0].matchType === MATCH_TYPES.COLOR && colorMatch.storedBase === 100 },
    { name: "basic symbol match", pass: symbolMatch.success && symbolMatch.resolution.history[0].matchType === MATCH_TYPES.SYMBOL && symbolMatch.storedBase === 300 },
    { name: "fusion match", pass: fusionMatch.success && fusionMatch.resolution.history[0].matchType === MATCH_TYPES.FUSION && fusionMatch.storedBase === 700 },
    { name: "failed crunch", pass: !fail.success && fail.resolution.failedIndex === 0 },
    { name: "multi-card updated stack", pass: multi.success && multi.resolution.history.length === 2 && multi.handMultiplier === 2 },
    { name: "perfect hand bonus", pass: four.success && four.stackTypes.some((bonus) => bonus.label === "PERFECT HAND") },
    { name: "speed bonus", pass: four.speedBonus.multiplier === 3 },
    { name: "streak bonus", pass: four.streakMultiplier === 3 }
  ];

  return cases.map((test) => ({ ...test, result: test.name.includes("failed") ? fail : test.name.includes("fusion") ? fusionMatch : multi }));
}

function createMatch({ type, label, basePoints, matchedIndexes, matchedCards }) {
  return { valid: true, type, label, basePoints, matchedIndexes, matchedCards };
}

function findIngredientMatches(stackCards, ingredients) {
  const usedIndexes = new Set();
  return ingredients
    .map((ingredient) => {
      const index = stackCards.findIndex((card, cardIndex) => !usedIndexes.has(cardIndex) && card.symbol === ingredient);
      if (index < 0) return null;
      usedIndexes.add(index);
      return { index, card: stackCards[index] };
    })
    .filter(Boolean);
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

function countBy(cards, key) {
  return cards.reduce((counts, card) => {
    counts[card[key]] = (counts[card[key]] ?? 0) + 1;
    return counts;
  }, {});
}

function formatMultiplier(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, "");
}
