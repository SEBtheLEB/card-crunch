export const SUITS = [
  { id: "diamonds", symbol: "♦", color: "red" },
  { id: "hearts", symbol: "♥", color: "red" },
  { id: "spades", symbol: "♠", color: "black" },
  { id: "clubs", symbol: "♣", color: "black" }
];

export const RANKS = [
  { label: "A", value: 1 },
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "5", value: 5 },
  { label: "6", value: 6 },
  { label: "7", value: 7 },
  { label: "8", value: 8 },
  { label: "9", value: 9 },
  { label: "10", value: 10 },
  { label: "J", value: 11 },
  { label: "Q", value: 12 },
  { label: "K", value: 13 }
];

export function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank.label}-${suit.id}-${crypto.randomUUID()}`,
      rank: rank.label,
      value: rank.value,
      suit: suit.id,
      suitSymbol: suit.symbol,
      color: suit.color
    }))
  );
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
  if (state.deck.length === 0) {
    state.deck = shuffle(state.discard);
    state.discard = [];
  }

  if (state.deck.length === 0) {
    state.deck = shuffle(createDeck());
  }

  return state.deck.pop();
}

export function drawCards(state, count) {
  return Array.from({ length: count }, () => drawCard(state));
}
