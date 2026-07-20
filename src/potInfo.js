import { formatCompactNumber } from "./format.js?v=161";

const SUIT_SYMBOLS = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660"
};

const CRUNCH_GUIDE = [
  {
    id: "suit",
    title: "Suit Match",
    points: "+100 base",
    copy: "Match the suit of any active card.",
    types: ["suit"],
    cards: [["5", "hearts"], ["K", "hearts"]],
    joins: ["="]
  },
  {
    id: "rank",
    title: "Number Match",
    points: "+300 base",
    copy: "Match the number or face of an active card.",
    types: ["rank"],
    cards: [["7", "spades"], ["7", "hearts"]],
    joins: ["="]
  },
  {
    id: "add",
    title: "Sum Crunch",
    points: "+500 base",
    copy: "Play the sum of any two active cards.",
    types: ["add"],
    cards: [["3", "diamonds"], ["5", "spades"], ["8", "hearts"]],
    joins: ["+", "="]
  },
  {
    id: "subtract",
    title: "Minus Crunch",
    points: "+500 base",
    copy: "Play the positive difference between two active cards.",
    types: ["subtract"],
    cards: [["10", "diamonds"], ["7", "spades"], ["3", "hearts"]],
    joins: ["-", "="]
  },
  {
    id: "sequence",
    title: "Sequence Crunch",
    points: "+700 base",
    copy: "Complete or extend three or more consecutive values.",
    types: ["sequence"],
    cards: [["A", "hearts"], ["2", "clubs"], ["3", "diamonds"]],
    joins: ["\u203a", "\u203a"]
  },
  {
    id: "multi",
    title: "Triple / Quad Match",
    points: "Tier multiplier",
    copy: "More matching suits or numbers make the same Crunch much stronger.",
    types: ["rank", "suit"],
    cards: [["5", "hearts"], ["5", "clubs"], ["5", "diamonds"]],
    joins: ["=", "="]
  },
  {
    id: "full-hand",
    title: "Full Hand",
    points: "Hand x8 + Perfect x3",
    copy: "Resolve all four selected cards successfully for the biggest hand bonus.",
    types: [],
    requiresFour: true,
    cards: [["3", "hearts"], ["6", "clubs"], ["9", "diamonds"], ["Q", "spades"]],
    joins: ["+", "+", "+"]
  }
];

export function getPotRuleFacts(modifier = {}) {
  const facts = [];
  if (Number.isFinite(modifier.turnSeconds)) facts.push(`${modifier.turnSeconds}s turns`);
  if (modifier.allowedSuits?.length) facts.push(`${modifier.allowedSuits.map(capitalizeRule).join(" / ")} only`);
  if (modifier.allowedColors?.length) facts.push(`${modifier.allowedColors.map(capitalizeRule).join(" / ")} cards`);
  if (modifier.valueParity) facts.push(`${capitalizeRule(modifier.valueParity)} values`);
  if (Number.isFinite(modifier.minCardValue) || Number.isFinite(modifier.maxCardValue)) {
    const low = Number.isFinite(modifier.minCardValue) ? formatRank(modifier.minCardValue) : "A";
    const high = Number.isFinite(modifier.maxCardValue) ? formatRank(modifier.maxCardValue) : "K";
    facts.push(`Values ${low}-${high}`);
  }
  if (modifier.allowedMatchTypes?.length) facts.push(`${modifier.allowedMatchTypes.map(formatMatchRule).join(" / ")} only`);
  if (modifier.blockedMatchTypes?.length) facts.push(`No ${modifier.blockedMatchTypes.map(formatMatchRule).join(" / ")}`);
  if (Number.isFinite(modifier.minSelection)) facts.push(`Select at least ${modifier.minSelection}`);
  if (Number.isFinite(modifier.maxSelection)) facts.push(`Max ${modifier.maxSelection} cards`);
  if (Number.isFinite(modifier.maxLives)) facts.push(`${modifier.maxLives} ${modifier.maxLives === 1 ? "life" : "lives"}`);
  if (Number.isFinite(modifier.minBankStreak)) facts.push(`Bank at streak ${modifier.minBankStreak}`);
  if (Number.isFinite(modifier.minimumBankCash)) facts.push(`Bank at $${formatCompactNumber(modifier.minimumBankCash)}`);
  if (Number.isFinite(modifier.startingRunMultiplier)) facts.push(`Start Multi x${modifier.startingRunMultiplier}`);
  addMultiplierFact(facts, modifier.scoreMultiplier, "All cash");
  addMultiplierFact(facts, modifier.suitMatchMultiplier, "Suit cash");
  addMultiplierFact(facts, modifier.rankMatchMultiplier, "Number cash");
  addMultiplierFact(facts, modifier.mathMatchMultiplier, "Math cash");
  addMultiplierFact(facts, modifier.sequenceMatchMultiplier, "Sequence cash");
  if (Number.isFinite(modifier.selectionScoreMultiplier)) {
    facts.push(`${modifier.minSelectionForMultiplier ?? 1}+ cards x${modifier.selectionScoreMultiplier}`);
  }
  return facts.length > 0 ? facts : ["Standard scoring", "3 lives", "Bank anytime"];
}

export function renderPotInfo(elements, pot) {
  if (!pot) return;
  const modifier = pot.gameplayModifier ?? {};
  elements.overlay.style.setProperty("--pot-info-accent", pot.accent ?? "#f4c54f");
  elements.overlay.style.setProperty("--pot-info-accent-rgb", pot.accentRgb ?? "244, 197, 79");
  elements.kicker.textContent = `Pot ${pot.id} \u00b7 ${pot.difficulty ?? "Challenge"}`;
  elements.title.textContent = pot.title ?? `Pot ${pot.id}`;
  elements.modifierIcon.innerHTML = pot.icon ?? String(pot.id);
  elements.modifierName.textContent = pot.ruleLabel ?? "Standard Rules";
  elements.modifierCopy.textContent = pot.detail ?? pot.description ?? "All standard Crunches are active.";

  elements.facts.replaceChildren(...getPotRuleFacts(modifier).map(createFactChip));
  elements.list.replaceChildren(...CRUNCH_GUIDE.map((guide) => createCrunchGuideRow(guide, modifier)));
}

function createFactChip(copy) {
  const chip = document.createElement("span");
  chip.textContent = copy;
  return chip;
}

function createCrunchGuideRow(guide, modifier) {
  const available = isGuideAvailable(guide, modifier);
  const row = document.createElement("article");
  row.className = `pot-info-crunch-row${available ? "" : " is-disabled-here"}`;
  row.dataset.crunchType = guide.id;

  const visual = document.createElement("div");
  visual.className = "pot-info-card-equation";
  visual.setAttribute("aria-hidden", "true");
  guide.cards.forEach(([rank, suit], index) => {
    visual.appendChild(createDefaultCardSprite(rank, suit, index === guide.cards.length - 1));
    if (guide.joins[index]) {
      const join = document.createElement("b");
      join.textContent = guide.joins[index];
      visual.appendChild(join);
    }
  });

  const copy = document.createElement("div");
  copy.className = "pot-info-crunch-copy";
  const heading = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = guide.title;
  const points = document.createElement("strong");
  points.textContent = guide.points;
  heading.append(title, points);
  const description = document.createElement("p");
  description.textContent = guide.copy;
  copy.append(heading, description);

  if (!available) {
    const locked = document.createElement("small");
    locked.className = "pot-info-unavailable";
    locked.textContent = "Disabled by this Pot's rule";
    copy.appendChild(locked);
  }

  row.append(visual, copy);
  return row;
}

function createDefaultCardSprite(rank, suit, isAnswer) {
  const symbol = SUIT_SYMBOLS[suit] ?? "?";
  const red = suit === "hearts" || suit === "diamonds";
  const card = document.createElement("span");
  card.className = `pot-info-card-sprite ${red ? "is-red" : "is-black"}${isAnswer ? " is-answer" : ""}`;
  card.innerHTML = `
    <span class="pot-info-card-corner"><b>${rank}</b><i>${symbol}</i></span>
    <strong>${rank}</strong>
    <i>${symbol}</i>
  `;
  return card;
}

function isGuideAvailable(guide, modifier) {
  if (guide.requiresFour && Number.isFinite(modifier.maxSelection) && modifier.maxSelection < 4) return false;
  if (guide.types.length === 0) return true;
  const allowed = modifier.allowedMatchTypes;
  const blocked = modifier.blockedMatchTypes ?? [];
  return guide.types.some((type) => (!allowed?.length || allowed.includes(type)) && !blocked.includes(type));
}

function addMultiplierFact(facts, value, label) {
  if (Number.isFinite(value) && Number(value) !== 1) facts.push(`${label} x${value}`);
}

function formatMatchRule(type) {
  const labels = { suit: "Suit", rank: "Number", add: "Sum", subtract: "Minus", sequence: "Sequence" };
  return labels[type] ?? capitalizeRule(type);
}

function capitalizeRule(value) {
  const text = String(value ?? "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function formatRank(value) {
  const labels = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  return labels[value] ?? value;
}
