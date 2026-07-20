import { RANKS, SUITS, drawCard } from "./deck.js?v=163";
import { MATCH_TYPES, SCORE_CONFIG, createStackEntry, evaluateStackAdd } from "./scoring.js?v=163";

export const ARCADE_MODE = "endlessArcade";

export const ARCADE_CONFIG = Object.freeze({
  turnSeconds: 10,
  maxLives: 3,
  powerCardChance: 0.07,
  timeCardSeconds: 2.5,
  maxTimeSeconds: 13,
  wildPoints: 80,
  chargedMultiplier: 2
});

export const POWER_CARD_TYPES = Object.freeze({
  CHARGED: "charged",
  WILD: "wild",
  ECHO: "echo",
  TIME: "time"
});

export const POWER_CARD_DETAILS = Object.freeze({
  [POWER_CARD_TYPES.CHARGED]: {
    name: "Charged Card",
    shortName: "CHARGED",
    icon: "ZAP",
    tooltip: "Valid play - scores x2"
  },
  [POWER_CARD_TYPES.WILD]: {
    name: "Wild Card",
    shortName: "WILD",
    icon: "W",
    tooltip: "Becomes any valid match"
  },
  [POWER_CARD_TYPES.ECHO]: {
    name: "Echo Card",
    shortName: "ECHO",
    icon: "E",
    tooltip: "Copies your last normal card"
  },
  [POWER_CARD_TYPES.TIME]: {
    name: "Time Card",
    shortName: "TIME",
    icon: "+",
    tooltip: `Play now - adds ${ARCADE_CONFIG.timeCardSeconds}s`
  }
});

const POWER_WEIGHTS = Object.freeze([
  [POWER_CARD_TYPES.CHARGED, 36],
  [POWER_CARD_TYPES.WILD, 25],
  [POWER_CARD_TYPES.ECHO, 21],
  [POWER_CARD_TYPES.TIME, 18]
]);

const MATCH_PRIORITY = Object.freeze({
  [MATCH_TYPES.SEQUENCE]: 5,
  [MATCH_TYPES.ADD]: 4,
  [MATCH_TYPES.SUBTRACT]: 4,
  [MATCH_TYPES.RANK]: 3,
  [MATCH_TYPES.SUIT]: 2,
  [MATCH_TYPES.MISS]: 0
});

export function isArcadeMode(state) {
  return state?.gameMode === ARCADE_MODE;
}

export function isPowerCard(card) {
  return Boolean(card?.powerType);
}

export function getPowerCardDetails(cardOrType) {
  const type = typeof cardOrType === "string" ? cardOrType : cardOrType?.powerType;
  return POWER_CARD_DETAILS[type] ?? null;
}

export function drawArcadeCard(state, {
  random = Math.random,
  forcePowerType = null,
  fromRight = true
} = {}) {
  const shouldCreatePower = Boolean(forcePowerType) || random() < ARCADE_CONFIG.powerCardChance;
  if (!shouldCreatePower) return markDealDirection(drawCard(state), fromRight);

  const powerType = forcePowerType ?? pickWeightedPowerType(random);
  if (powerType === POWER_CARD_TYPES.CHARGED) {
    return createChargedCard(drawCard(state), { fromRight });
  }
  return createSpecialPowerCard(powerType, { fromRight });
}

export function createChargedCard(baseCard, { fromRight = false } = {}) {
  const details = POWER_CARD_DETAILS[POWER_CARD_TYPES.CHARGED];
  return {
    ...baseCard,
    id: `power-charged-${createId()}`,
    powerType: POWER_CARD_TYPES.CHARGED,
    powerName: details.name,
    powerTooltip: details.tooltip,
    dealFromRight: fromRight
  };
}

export function createSpecialPowerCard(powerType, { fromRight = false } = {}) {
  const details = POWER_CARD_DETAILS[powerType];
  if (!details || powerType === POWER_CARD_TYPES.CHARGED) {
    throw new Error(`Unknown special power card: ${powerType}`);
  }
  return {
    id: `power-${powerType}-${createId()}`,
    rank: details.icon,
    value: 0,
    suit: "power",
    suitSymbol: details.icon,
    color: "power",
    powerType,
    powerName: details.name,
    powerTooltip: details.tooltip,
    dealFromRight: fromRight
  };
}

export function resolveArcadeCrunch(baseStack, playedCards) {
  const activeStack = [...baseStack];
  const history = [];
  let lastNormalCard = null;

  for (let index = 0; index < playedCards.length; index += 1) {
    const card = playedCards[index];
    const result = resolveArcadeCard(activeStack, card, lastNormalCard);
    if (!result.valid) {
      return {
        success: false,
        failedIndex: index,
        failedCard: card,
        activeStack,
        history,
        match: result.match,
        lastNormalCard
      };
    }

    history.push(result.entry);
    if (Number.isInteger(result.replaceIndex)) activeStack.splice(result.replaceIndex, 1, result.stackCard);
    else activeStack.push(result.stackCard);
    if (!isPowerCard(card)) lastNormalCard = card;
  }

  return {
    success: true,
    activeStack,
    history,
    failedIndex: -1,
    failedCard: null,
    lastNormalCard
  };
}

export function getArcadeStackMultiplier(count) {
  const normalized = Math.max(0, Math.floor(Number(count) || 0));
  if (normalized <= 1) return 1;
  if (normalized === 2) return 1.5;
  if (normalized === 3) return 2;
  if (normalized === 4) return 3;
  if (normalized === 5) return 4.5;
  if (normalized === 6) return 6;
  if (normalized === 7) return 8;
  if (normalized === 8) return 10;
  return Math.min(20, 10 + (normalized - 8) * 2);
}

function resolveArcadeCard(activeStack, card, lastNormalCard) {
  if (!card) return invalidPowerMatch();
  if (!isPowerCard(card)) {
    const match = evaluateStackAdd(activeStack, card);
    return match.valid
      ? { valid: true, match, entry: createStackEntry(card, match), stackCard: card }
      : { valid: false, match };
  }

  if (card.powerType === POWER_CARD_TYPES.TIME) return invalidPowerMatch("TIME CARD MUST BE PLAYED DIRECTLY");
  if (card.powerType === POWER_CARD_TYPES.CHARGED) return resolveChargedCard(activeStack, card);
  if (card.powerType === POWER_CARD_TYPES.WILD) return resolveWildCard(activeStack, card);
  if (card.powerType === POWER_CARD_TYPES.ECHO) return resolveEchoCard(activeStack, card, lastNormalCard);
  return invalidPowerMatch();
}

function resolveChargedCard(activeStack, card) {
  const exactIndex = activeStack.findIndex((stackCard) => stackCard.value === card.value && stackCard.suit === card.suit);
  const match = exactIndex >= 0
    ? {
        valid: true,
        type: MATCH_TYPES.RANK,
        label: "CHARGED MATCH",
        basePoints: SCORE_CONFIG.rank,
        matchedIndexes: [exactIndex],
        matchedCards: [activeStack[exactIndex]],
        equation: { left: card.rank, operator: "=", right: card.rank, result: card.rank },
        cutinLabel: "CHARGED REPLACE",
        compoundMatch: null
      }
    : evaluateStackAdd(activeStack, card);
  if (!match.valid) return { valid: false, match };

  const entry = createStackEntry(card, match);
  entry.powerType = POWER_CARD_TYPES.CHARGED;
  entry.powerMultiplier = ARCADE_CONFIG.chargedMultiplier;
  entry.powerLabel = "CHARGED x2";
  entry.cutinLabel = exactIndex >= 0 ? "CHARGED REPLACE" : "CHARGED MATCH";
  return {
    valid: true,
    match,
    entry,
    stackCard: { ...card },
    replaceIndex: exactIndex >= 0 ? exactIndex : null
  };
}

function resolveWildCard(activeStack, card) {
  const candidate = getBestWildCandidate(activeStack, card.id);
  if (!candidate) return invalidPowerMatch("WILD FOUND NO MATCH");
  const match = evaluateStackAdd(activeStack, candidate);
  const entry = createStackEntry(card, {
    ...match,
    label: "WILD MATCH",
    cutinLabel: "WILD MATCH",
    basePoints: ARCADE_CONFIG.wildPoints
  });
  entry.powerType = POWER_CARD_TYPES.WILD;
  entry.resolvedCard = candidate;
  entry.resolvedLabel = `${candidate.rank} ${candidate.suit}`;
  return { valid: true, match, entry, stackCard: candidate };
}

function resolveEchoCard(activeStack, card, lastNormalCard) {
  if (!lastNormalCard) return invalidPowerMatch("ECHO NEEDS A NORMAL CARD FIRST");
  const echoedCard = { ...lastNormalCard, id: card.id, dealFromRight: false };
  const match = evaluateStackAdd(activeStack, echoedCard);
  if (!match.valid) return { valid: false, match };
  const entry = createStackEntry(card, {
    ...match,
    label: `ECHO ${lastNormalCard.rank}`,
    cutinLabel: "ECHO CARD"
  });
  entry.powerType = POWER_CARD_TYPES.ECHO;
  entry.resolvedCard = echoedCard;
  entry.resolvedLabel = `${lastNormalCard.rank} ${lastNormalCard.suit}`;
  return { valid: true, match, entry, stackCard: echoedCard };
}

function getBestWildCandidate(activeStack, id) {
  const candidates = SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id,
    rank: rank.label,
    value: rank.value,
    suit: suit.id,
    suitSymbol: suit.symbol,
    color: suit.color,
    resolvedFromPower: POWER_CARD_TYPES.WILD
  })));

  return candidates
    .map((candidate) => ({ candidate, match: evaluateStackAdd(activeStack, candidate) }))
    .filter(({ match }) => match.valid)
    .sort((a, b) => {
      const priority = MATCH_PRIORITY[b.match.type] - MATCH_PRIORITY[a.match.type];
      if (priority) return priority;
      if (a.candidate.value !== b.candidate.value) return a.candidate.value - b.candidate.value;
      return a.candidate.suit.localeCompare(b.candidate.suit);
    })[0]?.candidate ?? null;
}

function invalidPowerMatch(label = "BUST") {
  return {
    valid: false,
    match: {
      valid: false,
      type: MATCH_TYPES.MISS,
      label,
      basePoints: 0,
      matchedIndexes: [],
      matchedCards: []
    }
  };
}

function pickWeightedPowerType(random) {
  const total = POWER_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [type, weight] of POWER_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return POWER_WEIGHTS.at(-1)[0];
}

function markDealDirection(card, fromRight) {
  card.dealFromRight = fromRight;
  return card;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function runArcadeModeSelfTests() {
  const card = (rank, suit, value = Number(rank)) => ({
    id: `${rank}-${suit}-${createId()}`,
    rank: String(rank),
    value,
    suit,
    suitSymbol: suit === "hearts" ? "H" : suit === "diamonds" ? "D" : suit === "clubs" ? "C" : "S",
    color: suit === "hearts" || suit === "diamonds" ? "red" : "black"
  });
  const base = [card(3, "diamonds"), card(5, "spades")];
  const normal = resolveArcadeCrunch(base, [card(8, "hearts"), card("K", "spades", 13)]);
  const bad = resolveArcadeCrunch(base, [card(8, "hearts"), card("Q", "clubs", 12)]);
  const chargedBase = card(7, "hearts");
  const charged = resolveArcadeCrunch([chargedBase, card(2, "clubs")], [createChargedCard({ ...chargedBase, id: "fresh-seven" })]);
  const wild = resolveArcadeCrunch(base, [createSpecialPowerCard(POWER_CARD_TYPES.WILD)]);
  const echoedSource = card(8, "hearts");
  const echo = resolveArcadeCrunch(base, [echoedSource, createSpecialPowerCard(POWER_CARD_TYPES.ECHO)]);

  return [
    { name: "normal arcade sequence grows its active stack", pass: normal.success && normal.history.length === 2 },
    { name: "one bad card busts the complete arcade play", pass: !bad.success && bad.failedIndex === 1 },
    { name: "charged duplicate replaces and doubles", pass: charged.success && charged.activeStack.length === 2 && charged.history[0].powerMultiplier === 2 },
    { name: "wild resolves as a lower-value valid card", pass: wild.success && wild.history[0].basePoints === ARCADE_CONFIG.wildPoints },
    { name: "echo copies the last normal card in sequence", pass: echo.success && echo.history[1].resolvedCard.value === echoedSource.value },
    { name: "time card remains an immediate-use power", pass: createSpecialPowerCard(POWER_CARD_TYPES.TIME).powerType === POWER_CARD_TYPES.TIME },
    { name: "long arcade stacks keep scaling", pass: getArcadeStackMultiplier(10) > getArcadeStackMultiplier(4) }
  ];
}
