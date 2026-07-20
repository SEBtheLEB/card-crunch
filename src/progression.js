export const LEVEL_TARGETS = [1000000, 1500000, 2500000, 4000000, 6500000, 10000000];

const CHAPTERS = {
  starter: "Starter Tables",
  cardLocks: "Card Locks",
  matchLabs: "Match Labs",
  pressure: "Pressure Rooms",
  jackpots: "Jackpot Rules",
  master: "Master Tables"
};

function definePot({
  id,
  chapter,
  title,
  description,
  detail,
  ruleLabel,
  gameplayModifier,
  icon = "&#9733;",
  accent = "#f4c54f",
  accentRgb = "244, 197, 79",
  difficulty = "Hard",
  isNewRule = true,
  lockedTeaser = null
}) {
  return {
    id,
    chapter,
    title,
    description,
    detail,
    ruleLabel,
    gameplayModifier: { id: `pot-${id}`, ...gameplayModifier },
    icon,
    accent,
    accentRgb,
    difficulty,
    isNewRule,
    lockedTeaser: lockedTeaser ?? `Next: ${title}. Clear Pot ${id - 1} to unlock this rule.`
  };
}

const STARTER_POTS = [
  definePot({
    id: 1,
    chapter: CHAPTERS.starter,
    title: "Classic Crunch",
    description: "Standard rules. The original Card Crunch experience.",
    detail: "Build a streak, crunch matching cards, and bank your run cash before you bust.",
    icon: "&#9824;",
    accent: "#f4c54f",
    accentRgb: "244, 197, 79",
    difficulty: "Starter",
    ruleLabel: "Standard rules",
    isNewRule: false,
    lockedTeaser: "",
    gameplayModifier: { id: "classic" }
  }),
  definePot({
    id: 2,
    chapter: CHAPTERS.starter,
    title: "Suit Surge",
    description: "Suit matches pay double base cash.",
    detail: "Every card resolved by suit is worth twice its normal base points before the other multipliers land.",
    icon: "&#9827;",
    accent: "#46d7ff",
    accentRgb: "70, 215, 255",
    difficulty: "Easy",
    ruleLabel: "Suit cash x2",
    gameplayModifier: { id: "suit-surge", suitMatchMultiplier: 2, scoreLabel: "SUIT SURGE" }
  }),
  definePot({
    id: 3,
    chapter: CHAPTERS.starter,
    title: "Time Crunch",
    description: "Beat the 8-second timer.",
    detail: "You have eight seconds to stage your cards and slam Crunch. Think fast or lose a life.",
    icon: "&#9201;",
    accent: "#ff776d",
    accentRgb: "255, 119, 109",
    difficulty: "Hard",
    ruleLabel: "8 second turns",
    gameplayModifier: { id: "time-crunch", turnSeconds: 8 }
  }),
  definePot({
    id: 4,
    chapter: CHAPTERS.starter,
    title: "Bank Lock",
    description: "The bank opens at a 3-Crunch streak.",
    detail: "Reach a streak of three before the Bank button unlocks. Busting early leaves every unbanked point exposed.",
    icon: "&#128274;",
    accent: "#bd83ff",
    accentRgb: "189, 131, 255",
    difficulty: "Hard",
    ruleLabel: "Bank at streak x3",
    gameplayModifier: { id: "bank-lock", minBankStreak: 3 }
  }),
  definePot({
    id: 5,
    chapter: CHAPTERS.starter,
    title: "Full Hand Fever",
    description: "Crunch 3+ cards for a x2 pot bonus.",
    detail: "Successful three-card and four-card Crunches receive an extra x2 rule multiplier.",
    icon: "4X",
    accent: "#ff9d3f",
    accentRgb: "255, 157, 63",
    difficulty: "Expert",
    ruleLabel: "Big hands x2",
    gameplayModifier: { id: "full-hand-fever", minSelectionForMultiplier: 3, selectionScoreMultiplier: 2, scoreLabel: "HAND FEVER" }
  }),
  definePot({
    id: 6,
    chapter: CHAPTERS.starter,
    title: "Last Stand",
    description: "One life. Every Crunch pays x3.",
    detail: "You enter with one life, but every successful Crunch earns an extra x3 rule multiplier.",
    icon: "&#9829;",
    accent: "#ff4f78",
    accentRgb: "255, 79, 120",
    difficulty: "Brutal",
    ruleLabel: "1 life / cash x3",
    gameplayModifier: { id: "last-stand", maxLives: 1, scoreMultiplier: 3, scoreLabel: "LAST STAND" }
  })
];

const CARD_LOCK_POTS = [
  [7, "Heart Lock", "Only Hearts can be crunched.", "Every selected card must be a Heart. A legal Heart is guaranteed each round.", "Hearts only", { allowedSuits: ["hearts"], scoreMultiplier: 1.5, scoreLabel: "HEART LOCK" }, "&#9829;", "#ff5c78", "255, 92, 120", "Medium"],
  [8, "Diamond Mine", "Only Diamonds can be crunched.", "Every selected card must be a Diamond. Diamond plays receive a richer table payout.", "Diamonds only", { allowedSuits: ["diamonds"], scoreMultiplier: 1.5, scoreLabel: "DIAMOND MINE" }, "&#9830;", "#ff6b55", "255, 107, 85", "Medium"],
  [9, "Club House", "Only Clubs can be crunched.", "Every selected card must be a Club. Build safe chains without touching another suit.", "Clubs only", { allowedSuits: ["clubs"], scoreMultiplier: 1.5, scoreLabel: "CLUB HOUSE" }, "&#9827;", "#62d28d", "98, 210, 141", "Medium"],
  [10, "Spade Parade", "Only Spades can be crunched.", "Every selected card must be a Spade. The table always deals at least one possible route.", "Spades only", { allowedSuits: ["spades"], scoreMultiplier: 1.5, scoreLabel: "SPADE PARADE" }, "&#9824;", "#7ea8ff", "126, 168, 255", "Medium"],
  [11, "Red Alert", "Only red cards can be crunched.", "Hearts and Diamonds are legal. Clubs and Spades bust the Crunch.", "Red cards only", { allowedColors: ["red"], scoreMultiplier: 1.35, scoreLabel: "RED ALERT" }, "R", "#ff596f", "255, 89, 111", "Medium"],
  [12, "Blackout", "Only black cards can be crunched.", "Clubs and Spades are legal. Hearts and Diamonds bust the Crunch.", "Black cards only", { allowedColors: ["black"], scoreMultiplier: 1.35, scoreLabel: "BLACKOUT" }, "B", "#94a9c8", "148, 169, 200", "Medium"],
  [13, "Odd Job", "Only odd values can be crunched.", "Aces count as one. Only A, 3, 5, 7, 9, J, and K may enter the Crunch.", "Odd cards only", { valueParity: "odd", scoreMultiplier: 1.5, scoreLabel: "ODD JOB" }, "1/3", "#f39cff", "243, 156, 255", "Hard"],
  [14, "Even Money", "Only even values can be crunched.", "Only 2, 4, 6, 8, 10, and Q may enter the Crunch.", "Even cards only", { valueParity: "even", scoreMultiplier: 1.5, scoreLabel: "EVEN MONEY" }, "2/4", "#63d7ff", "99, 215, 255", "Hard"],
  [15, "Low Roller", "Only A through 6 can be crunched.", "Keep the values low. Any selected card above six busts the hand.", "Values A-6", { maxCardValue: 6, scoreMultiplier: 1.6, scoreLabel: "LOW ROLLER" }, "A-6", "#7be4b3", "123, 228, 179", "Hard"],
  [16, "Middle Table", "Only values 4 through 10 can be crunched.", "Face cards and the smallest cards are locked out of this table.", "Values 4-10", { minCardValue: 4, maxCardValue: 10, scoreMultiplier: 1.6, scoreLabel: "MIDDLE TABLE" }, "4-10", "#ffd267", "255, 210, 103", "Hard"],
  [17, "High Stakes", "Only 8 through K can be crunched.", "The high half of the deck is live. Low cards cannot be selected safely.", "Values 8-K", { minCardValue: 8, scoreMultiplier: 1.7, scoreLabel: "HIGH STAKES" }, "8-K", "#ff985c", "255, 152, 92", "Expert"],
  [18, "Royal Court", "Only J, Q, and K can be crunched.", "Every selected card must be a face card. Legal royal plays pay a large table bonus.", "Face cards only", { minCardValue: 11, scoreMultiplier: 2.2, scoreLabel: "ROYAL COURT" }, "JQK", "#ffe179", "255, 225, 121", "Expert"]
].map(([id, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty]) => definePot({
  id, chapter: CHAPTERS.cardLocks, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty
}));

const MATCH_LAB_POTS = [
  [19, "Suit School", "Only Suit Matches are valid.", "Math, runs, and number matches do not count here. Connect by suit or bust.", "Suit Match only", { allowedMatchTypes: ["suit"], suitMatchMultiplier: 2, scoreLabel: "SUIT SCHOOL" }, "&#9829;", "#58cfff", "88, 207, 255", "Hard"],
  [20, "Number Lock", "Only Number Matches are valid.", "The selected rank must already be on the active table. Other connections do not count.", "Number Match only", { allowedMatchTypes: ["rank"], rankMatchMultiplier: 2, scoreLabel: "NUMBER LOCK" }, "7=7", "#ffd75e", "255, 215, 94", "Hard"],
  [21, "Sum School", "Only Sum Crunches are valid.", "Your card must equal the sum of two active cards. The opening is always made solvable.", "Sum Crunch only", { allowedMatchTypes: ["add"], mathMatchMultiplier: 2, scoreLabel: "SUM SCHOOL" }, "+", "#bc86ff", "188, 134, 255", "Expert"],
  [22, "Difference Engine", "Only Minus Crunches are valid.", "Your card must equal the difference between two active cards.", "Minus Crunch only", { allowedMatchTypes: ["subtract"], mathMatchMultiplier: 2, scoreLabel: "DIFFERENCE ENGINE" }, "-", "#a577ff", "165, 119, 255", "Expert"],
  [23, "Straight Path", "Only consecutive runs are valid.", "Extend or fill a sequence of at least three values. All other matches bust.", "Sequence only", { allowedMatchTypes: ["sequence"], sequenceMatchMultiplier: 2, scoreLabel: "STRAIGHT PATH" }, "123", "#56e5c2", "86, 229, 194", "Expert"],
  [24, "Math House", "Only Plus or Minus Crunches work.", "Every selected card must solve an addition or subtraction using the active stack.", "Math only", { allowedMatchTypes: ["add", "subtract"], mathMatchMultiplier: 1.5, scoreLabel: "MATH HOUSE" }, "+-", "#d388ff", "211, 136, 255", "Expert"],
  [25, "No Easy Suits", "Suit-only connections are disabled.", "Runs, math, and number matches still work, but a plain suit match now busts.", "No plain Suit Match", { blockedMatchTypes: ["suit"], scoreMultiplier: 1.5, scoreLabel: "NO EASY SUITS" }, "X&#9824;", "#ff8f5e", "255, 143, 94", "Expert"],
  [26, "No Numbers", "Number-only connections are disabled.", "Runs, math, and suit matches work. A plain rank match no longer saves you.", "No plain Number Match", { blockedMatchTypes: ["rank"], scoreMultiplier: 1.5, scoreLabel: "NO NUMBERS" }, "X7", "#ff739c", "255, 115, 156", "Expert"],
  [27, "Solo Crunch", "Only one card may be selected.", "Every Crunch is a one-card decision. Successful plays receive a x2 pot rule bonus.", "1 card maximum", { maxSelection: 1, scoreMultiplier: 2, scoreLabel: "SOLO CRUNCH" }, "1X", "#73e6ff", "115, 230, 255", "Hard"],
  [28, "Duo Table", "Only two cards may be selected.", "Build compact one- or two-card chains. Three-card greed is disabled.", "2 cards maximum", { maxSelection: 2, scoreMultiplier: 1.5, scoreLabel: "DUO TABLE" }, "2X", "#6fc5ff", "111, 197, 255", "Hard"]
].map(([id, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty]) => definePot({
  id, chapter: CHAPTERS.matchLabs, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty
}));

const PRESSURE_POTS = [
  [29, "Eight Count", "Eight-second turns pay x1.25.", "A compact speed table with a little extra cash on every successful Crunch.", "8 seconds / cash x1.25", { turnSeconds: 8, scoreMultiplier: 1.25, scoreLabel: "EIGHT COUNT" }, "8S", "#ffb24f", "255, 178, 79", "Hard"],
  [30, "Six Second Sprint", "Six-second turns pay x2.", "Stage quickly. The hidden grace second still protects a true last-second tap.", "6 seconds / cash x2", { turnSeconds: 6, scoreMultiplier: 2, scoreLabel: "SIX SECOND SPRINT" }, "6S", "#ff765e", "255, 118, 94", "Expert"],
  [31, "Five Second Flash", "Five-second turns pay x3.", "The fastest standard table. One hesitation can cost a life.", "5 seconds / cash x3", { turnSeconds: 5, scoreMultiplier: 3, scoreLabel: "FIVE SECOND FLASH" }, "5S", "#ff4e67", "255, 78, 103", "Brutal"],
  [32, "Two Hearts", "Two lives. Every Crunch pays x1.6.", "You can survive one mistake. A second bust ends the run.", "2 lives / cash x1.6", { maxLives: 2, scoreMultiplier: 1.6, scoreLabel: "TWO HEARTS" }, "2H", "#ff7f8f", "255, 127, 143", "Hard"],
  [33, "One Shot Jackpot", "One life. Every Crunch pays x4.", "There are no second chances, but every legal hand is worth four times as much.", "1 life / cash x4", { maxLives: 1, scoreMultiplier: 4, scoreLabel: "ONE SHOT" }, "1H", "#ff476f", "255, 71, 111", "Brutal"],
  [34, "Deep Pockets", "Start every run at x2 Multi.", "Your run begins hot. Banking safely returns the multiplier to the same x2 starting floor.", "Start Multi x2", { startingRunMultiplier: 2, scoreLabel: "DEEP POCKETS" }, "X2", "#f7d55c", "247, 213, 92", "Medium"],
  [35, "Hot Start", "Start at x2 and build Multi faster.", "Begin at x2 and gain an extra +0.2 Multi after each successful Crunch.", "Hot Multi growth", { startingRunMultiplier: 2, multiplierStepBonus: 0.2, scoreLabel: "HOT START" }, "HOT", "#ff9f43", "255, 159, 67", "Hard"],
  [36, "Multiplier Rush", "Multi grows +0.4 faster, up to x12.", "Push the run instead of banking early. Every success builds the risky payout faster.", "Fast Multi / cap x12", { multiplierStepBonus: 0.4, multiplierMax: 12, scoreLabel: "MULTI RUSH" }, "X12", "#ffcf4b", "255, 207, 75", "Expert"],
  [37, "Cold Vault", "The Bank opens at a 5-Crunch streak.", "Run cash stays exposed until you build a streak of five successful Crunches.", "Bank at streak x5", { minBankStreak: 5, scoreMultiplier: 1.5, scoreLabel: "COLD VAULT" }, "L5", "#8aa8ff", "138, 168, 255", "Expert"],
  [38, "Heavy Deposit", "Bank only when Run Cash reaches 100K.", "The Bank remains locked below 100K, forcing at least one meaningful push.", "Bank minimum 100K", { minimumBankCash: 100000, scoreMultiplier: 1.5, scoreLabel: "HEAVY DEPOSIT" }, "100K", "#7fc5d8", "127, 197, 216", "Expert"]
].map(([id, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty]) => definePot({
  id, chapter: CHAPTERS.pressure, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty
}));

const JACKPOT_POTS = [
  [39, "Suit Jackpot", "Suit Match base cash is tripled.", "Plain suit connections become valuable while stronger matches retain priority.", "Suit cash x3", { suitMatchMultiplier: 3, scoreLabel: "SUIT JACKPOT" }, "&#9827;X3", "#54d7ff", "84, 215, 255", "Hard"],
  [40, "Number Jackpot", "Number Match base cash pays x2.5.", "Matching a rank is the table's premium route.", "Number cash x2.5", { rankMatchMultiplier: 2.5, scoreLabel: "NUMBER JACKPOT" }, "7X", "#ffd65b", "255, 214, 91", "Hard"],
  [41, "Math Jackpot", "Plus and Minus base cash pays x2.5.", "Solve either arithmetic route for the richest base-card payouts.", "Math cash x2.5", { mathMatchMultiplier: 2.5, scoreLabel: "MATH JACKPOT" }, "+-", "#c58cff", "197, 140, 255", "Expert"],
  [42, "Straight Jackpot", "Sequence base cash pays x3.", "Long consecutive runs become the most valuable plays on the table.", "Sequence cash x3", { sequenceMatchMultiplier: 3, scoreLabel: "STRAIGHT JACKPOT" }, "123", "#65e5c6", "101, 229, 198", "Expert"],
  [43, "Pair Pressure", "Crunch 2+ cards for a x2 pot bonus.", "One-card plays remain safe, but any successful chain of two or more doubles its payout.", "2+ card hands x2", { minSelectionForMultiplier: 2, selectionScoreMultiplier: 2, scoreLabel: "PAIR PRESSURE" }, "2+", "#ff9e55", "255, 158, 85", "Hard"],
  [44, "Red Numbers", "Only red Number Matches are valid.", "The card must be red and match a rank already in the active stack.", "Red + Number only", { allowedColors: ["red"], allowedMatchTypes: ["rank"], rankMatchMultiplier: 3, scoreLabel: "RED NUMBERS" }, "R7", "#ff637d", "255, 99, 125", "Brutal"],
  [45, "Black Math", "Only black Plus or Minus cards are valid.", "Every selected Club or Spade must solve a math connection.", "Black + Math only", { allowedColors: ["black"], allowedMatchTypes: ["add", "subtract"], mathMatchMultiplier: 3, scoreLabel: "BLACK MATH" }, "B+-", "#9ea9df", "158, 169, 223", "Brutal"],
  [46, "Heart Run", "Only Heart sequences are valid.", "Every selected Heart must extend or fill a consecutive run.", "Heart + Sequence", { allowedSuits: ["hearts"], allowedMatchTypes: ["sequence"], sequenceMatchMultiplier: 4, scoreLabel: "HEART RUN" }, "&#9829;123", "#ff6586", "255, 101, 134", "Brutal"],
  [47, "Diamond Sums", "Only Diamond Sum Crunches are valid.", "Every selected Diamond must equal the sum of two active values.", "Diamond + Sum", { allowedSuits: ["diamonds"], allowedMatchTypes: ["add"], mathMatchMultiplier: 4, scoreLabel: "DIAMOND SUMS" }, "&#9830;+", "#ff8067", "255, 128, 103", "Brutal"],
  [48, "Club Difference", "Only Club Minus Crunches are valid.", "Every selected Club must equal the difference between two active values.", "Club + Minus", { allowedSuits: ["clubs"], allowedMatchTypes: ["subtract"], mathMatchMultiplier: 4, scoreLabel: "CLUB DIFFERENCE" }, "&#9827;-", "#62d69b", "98, 214, 155", "Brutal"]
].map(([id, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty]) => definePot({
  id, chapter: CHAPTERS.jackpots, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty
}));

const MASTER_POTS = [
  [49, "Spade Numbers", "Only Spade Number Matches are valid.", "Match an existing rank using a Spade. Every legal card pays x3.5 base cash.", "Spade + Number", { allowedSuits: ["spades"], allowedMatchTypes: ["rank"], rankMatchMultiplier: 3.5, scoreLabel: "SPADE NUMBERS" }, "&#9824;7", "#789dff", "120, 157, 255", "Brutal"],
  [50, "Odd Math", "Only odd Plus or Minus cards are valid.", "Every selected odd value must solve a math connection against the active stack.", "Odd + Math", { valueParity: "odd", allowedMatchTypes: ["add", "subtract"], mathMatchMultiplier: 3, scoreLabel: "ODD MATH" }, "1+-", "#e488ff", "228, 136, 255", "Brutal"],
  [51, "Even Suits", "Only even Suit Matches are valid.", "Every selected even card must connect by suit and nothing else.", "Even + Suit", { valueParity: "even", allowedMatchTypes: ["suit"], suitMatchMultiplier: 4, scoreLabel: "EVEN SUITS" }, "2&#9829;", "#63ceff", "99, 206, 255", "Brutal"],
  [52, "Low Straight", "Only A-7 sequence cards are valid.", "Build consecutive runs entirely from the lower half of the deck.", "Low + Sequence", { maxCardValue: 7, allowedMatchTypes: ["sequence"], sequenceMatchMultiplier: 4, scoreLabel: "LOW STRAIGHT" }, "A-7", "#55e1bd", "85, 225, 189", "Brutal"],
  [53, "High Number", "Only 8-K Number Matches are valid.", "Use high cards to match ranks already on the active stack.", "High + Number", { minCardValue: 8, allowedMatchTypes: ["rank"], rankMatchMultiplier: 4, scoreLabel: "HIGH NUMBER" }, "8K", "#ffc65a", "255, 198, 90", "Brutal"],
  [54, "Lightning Suits", "Six seconds. Suit Matches only.", "A legal suit route is guaranteed, but you have six seconds to find and Crunch it.", "6 seconds / Suit only", { turnSeconds: 6, allowedMatchTypes: ["suit"], suitMatchMultiplier: 3, scoreLabel: "LIGHTNING SUITS" }, "6&#9824;", "#48d9ff", "72, 217, 255", "Brutal"],
  [55, "Iron Vault", "One life. Bank opens at streak 5.", "Survive five Crunches before banking. Every success receives a x5 rule payout.", "1 life / bank x5 / cash x5", { maxLives: 1, turnSeconds: 7, minBankStreak: 5, scoreMultiplier: 5, scoreLabel: "IRON VAULT" }, "V5", "#ff745d", "255, 116, 93", "Master"],
  [56, "Master Pot", "One life. Six seconds. No Suit-only plays.", "Only one- or two-card hands are allowed. Build Multi fast, bank at streak five, and avoid plain Suit Matches.", "Final mixed rules", { maxLives: 1, turnSeconds: 6, blockedMatchTypes: ["suit"], maxSelection: 2, minBankStreak: 5, scoreMultiplier: 6, multiplierStepBonus: 0.3, multiplierMax: 15, scoreLabel: "MASTER POT" }, "MAX", "#ffe164", "255, 225, 100", "Master"]
].map(([id, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty]) => definePot({
  id, chapter: CHAPTERS.master, title, description, detail, ruleLabel, gameplayModifier, icon, accent, accentRgb, difficulty
}));

export const POT_DEFINITIONS = [
  ...STARTER_POTS,
  ...CARD_LOCK_POTS,
  ...MATCH_LAB_POTS,
  ...PRESSURE_POTS,
  ...JACKPOT_POTS,
  ...MASTER_POTS
];

export function getTargetForLevel(level) {
  if (level <= LEVEL_TARGETS.length) return LEVEL_TARGETS[level - 1];
  const extraLevel = level - LEVEL_TARGETS.length;
  const chapterBump = Math.floor((extraLevel - 1) / 10) * 5000000;
  return LEVEL_TARGETS[LEVEL_TARGETS.length - 1] + extraLevel * 1500000 + chapterBump;
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
  return POT_DEFINITIONS.map((definition) => ({
    ...definition,
    gameplayModifier: { ...definition.gameplayModifier },
    target: getTargetForLevel(definition.id),
    progress: 0,
    complete: false
  }));
}

export function getPotDefinition(potId) {
  return POT_DEFINITIONS.find((pot) => pot.id === potId) ?? POT_DEFINITIONS[0];
}

export function isPotUnlocked(pots, potId) {
  if (isPotLabEnabled()) return true;
  if (potId <= 1) return true;
  const previousPot = pots.find((pot) => pot.id === potId - 1);
  return Boolean(previousPot?.complete);
}

export function isPotLabEnabled() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("pot-lab") === "1";
  } catch {
    return false;
  }
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
