export const LEVEL_TARGETS = [1000000, 1500000, 2500000, 4000000, 6500000, 10000000];

export const POT_DEFINITIONS = [
  {
    id: 1,
    title: "Classic Crunch",
    description: "Standard rules. The original Card Crunch experience.",
    detail: "Build a streak, crunch matching cards, and bank your run cash before you bust.",
    icon: "&#9824;",
    accent: "#f4c54f",
    accentRgb: "244, 197, 79",
    difficulty: "Starter",
    ruleLabel: "Standard rules",
    isNewRule: false,
    gameplayModifier: { id: "classic" }
  },
  {
    id: 2,
    title: "Suit Surge",
    description: "Suit matches pay double base cash.",
    detail: "Every card resolved by suit is worth twice its normal base points before the other multipliers land.",
    icon: "&#9827;",
    accent: "#46d7ff",
    accentRgb: "70, 215, 255",
    difficulty: "Easy",
    ruleLabel: "Suit cash x2",
    isNewRule: true,
    gameplayModifier: { id: "suit-surge", suitMatchMultiplier: 2, scoreLabel: "SUIT SURGE" }
  },
  {
    id: 3,
    title: "Time Crunch",
    description: "Beat the 8-second timer.",
    detail: "You have eight seconds to stage your cards and slam Crunch. Think fast or lose a life.",
    icon: "&#9201;",
    accent: "#ff776d",
    accentRgb: "255, 119, 109",
    difficulty: "Hard",
    ruleLabel: "8 second turns",
    isNewRule: true,
    gameplayModifier: { id: "time-crunch", turnSeconds: 8 }
  },
  {
    id: 4,
    title: "Bank Lock",
    description: "The bank opens at a 3-Crunch streak.",
    lockedTeaser: "A new banking restriction is waiting inside.",
    detail: "Reach a streak of three before the Bank button unlocks. Busting early leaves every unbanked point exposed.",
    icon: "&#128274;",
    accent: "#bd83ff",
    accentRgb: "189, 131, 255",
    difficulty: "Hard",
    ruleLabel: "Bank at streak x3",
    isNewRule: true,
    gameplayModifier: { id: "bank-lock", minBankStreak: 3 }
  },
  {
    id: 5,
    title: "Full Hand Fever",
    description: "Crunch 3+ cards for a x2 pot bonus.",
    lockedTeaser: "Big hands trigger something hotter.",
    detail: "Successful three-card and four-card Crunches receive an extra x2 rule multiplier.",
    icon: "4X",
    accent: "#ff9d3f",
    accentRgb: "255, 157, 63",
    difficulty: "Expert",
    ruleLabel: "Big hands x2",
    isNewRule: true,
    gameplayModifier: { id: "full-hand-fever", minSelectionForMultiplier: 3, selectionScoreMultiplier: 2, scoreLabel: "HAND FEVER" }
  },
  {
    id: 6,
    title: "Last Stand",
    description: "One life. Every Crunch pays x3.",
    lockedTeaser: "The richest pot leaves no room for mistakes.",
    detail: "You enter with one life, but every successful Crunch earns an extra x3 rule multiplier.",
    icon: "&#9829;",
    accent: "#ff4f78",
    accentRgb: "255, 79, 120",
    difficulty: "Brutal",
    ruleLabel: "1 life / cash x3",
    isNewRule: true,
    gameplayModifier: { id: "last-stand", maxLives: 1, scoreMultiplier: 3, scoreLabel: "LAST STAND" }
  }
];

export function getTargetForLevel(level) {
  if (level <= LEVEL_TARGETS.length) return LEVEL_TARGETS[level - 1];
  const extraLevel = level - LEVEL_TARGETS.length;
  return LEVEL_TARGETS[LEVEL_TARGETS.length - 1] + extraLevel * 90000;
}

export function getLevelProgress(score, level) {
  const target = getTargetForLevel(level);
  return {
    target,
    progress: Math.min(1, score / target),
    remaining: Math.max(0, target - score)
  };
}

export function createDefaultPots() {
  return POT_DEFINITIONS.map((definition, index) => ({
    ...definition,
    gameplayModifier: { ...definition.gameplayModifier },
    target: LEVEL_TARGETS[index],
    progress: 0,
    complete: false
  }));
}

export function getPotDefinition(potId) {
  return POT_DEFINITIONS.find((pot) => pot.id === potId) ?? POT_DEFINITIONS[0];
}

export function isPotUnlocked(pots, potId) {
  if (potId <= 1) return true;
  const previousPot = pots.find((pot) => pot.id === potId - 1);
  return Boolean(previousPot?.complete);
}

export function getPotCheckpoint(pot) {
  if (!pot?.target) return 0;
  const interval = pot.target / 5;
  return Math.min(pot.target, Math.floor((pot.progress ?? 0) / interval) * interval);
}

export function getNextPotCheckpoint(pot) {
  if (!pot?.target) return 0;
  const interval = pot.target / 5;
  return Math.min(pot.target, (Math.floor((pot.progress ?? 0) / interval) + 1) * interval);
}
