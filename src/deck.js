export const CARD_COLORS = [
  { id: "red", label: "Red", accent: "#e34b3f" },
  { id: "blue", label: "Blue", accent: "#3f8cff" },
  { id: "green", label: "Green", accent: "#36a85f" },
  { id: "yellow", label: "Yellow", accent: "#f2c94c" },
  { id: "purple", label: "Purple", accent: "#9b62ff" }
];

export const BASIC_SYMBOLS = [
  { id: "flame", label: "Flame" },
  { id: "drop", label: "Drop" },
  { id: "leaf", label: "Leaf" },
  { id: "star", label: "Star" },
  { id: "moon", label: "Moon" }
];

export const FUSIONS = [
  { id: "steam", label: "Steam", ingredients: ["flame", "drop"] },
  { id: "bloom", label: "Bloom", ingredients: ["drop", "leaf"] },
  { id: "ash", label: "Ash", ingredients: ["flame", "leaf"] },
  { id: "eclipse", label: "Eclipse", ingredients: ["star", "moon"] },
  { id: "nova", label: "Nova", ingredients: ["flame", "star"] },
  { id: "tide", label: "Tide", ingredients: ["drop", "moon"] },
  { id: "fruit", label: "Fruit", ingredients: ["leaf", "star"] },
  { id: "lantern", label: "Lantern", ingredients: ["moon", "flame"] },
  { id: "prism", label: "Prism", ingredients: ["drop", "star"] },
  { id: "root", label: "Root", ingredients: ["leaf", "moon"] }
];

export function createDeck() {
  const basicCards = CARD_COLORS.flatMap((color) =>
    BASIC_SYMBOLS.map((symbol) => createBasicCard(color, symbol))
  );
  const fusionCards = FUSIONS.map((fusion) => createFusionCard(fusion));
  return [...basicCards, ...fusionCards];
}

export function createBasicCard(color, symbol) {
  return {
    id: `${color.id}-${symbol.id}-${crypto.randomUUID()}`,
    type: "basic",
    name: `${color.label} ${symbol.label}`,
    color: color.id,
    colorLabel: color.label,
    accent: color.accent,
    symbol: symbol.id,
    symbolLabel: symbol.label
  };
}

export function createFusionCard(fusion) {
  return {
    id: `${fusion.id}-${crypto.randomUUID()}`,
    type: "fusion",
    name: fusion.label,
    color: "fusion",
    colorLabel: "Fusion",
    accent: "#ffd166",
    symbol: fusion.id,
    symbolLabel: fusion.label,
    ingredients: [...fusion.ingredients]
  };
}

export function shuffle(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function drawCard(state) {
  ensureDeck(state);
  return state.deck.pop();
}

export function drawCards(state, count) {
  return Array.from({ length: count }, () => drawCard(state));
}

export function drawTableCards(state, count) {
  return Array.from({ length: count }, () => drawBasicCardFromDeck(state));
}

function drawBasicCardFromDeck(state) {
  ensureDeck(state);
  let index = state.deck.findIndex((card) => card.type === "basic");
  if (index < 0) {
    state.deck = shuffle([...state.deck, ...state.discard]);
    state.discard = [];
    index = state.deck.findIndex((card) => card.type === "basic");
  }
  if (index < 0) {
    state.deck = shuffle(createDeck());
    index = state.deck.findIndex((card) => card.type === "basic");
  }
  return state.deck.splice(index, 1)[0];
}

function ensureDeck(state) {
  if (state.deck.length === 0) {
    state.deck = shuffle(state.discard);
    state.discard = [];
  }

  if (state.deck.length === 0) {
    state.deck = shuffle(createDeck());
  }
}
