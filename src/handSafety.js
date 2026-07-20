import { createDeck, drawCards, shuffle } from "./deck.js?v=159";
import { evaluateStackAdd } from "./scoring.js?v=159";

export function hasPlayableCard(stack, hand, gameplayModifier = null) {
  return hand.some((card) => card && evaluateStackAdd(stack, card, gameplayModifier).valid);
}

export function ensurePlayableHand(state, {
  allowedIndexes = null,
  replaceOccupied = true,
  gameplayModifier = state.activePot?.gameplayModifier ?? null
} = {}) {
  if (hasPlayableCard(state.stack, state.hand, gameplayModifier)) return false;

  const replacement = takePlayableCard(state, gameplayModifier);
  if (!replacement) return false;

  const replaceIndex = findWeakestSlot(state, { allowedIndexes, replaceOccupied, gameplayModifier });
  if (replaceIndex < 0) {
    state.deck.push(replacement);
    return false;
  }

  if (state.hand[replaceIndex]) state.discard.push(state.hand[replaceIndex]);
  state.hand[replaceIndex] = replacement;
  return true;
}

/* Restrictive Pots can occasionally produce a table for which no card in a
   complete deck satisfies the rule (for example, Sum-only with a total over
   King). Re-deal the unseen table before the turn starts, then use a bounded
   exhaustive fallback so a challenge never becomes a forced bust. */
export function ensurePlayableRound(state, {
  allowedIndexes = null,
  replaceOccupied = true,
  gameplayModifier = state.activePot?.gameplayModifier ?? null,
  maxTableDeals = 18
} = {}) {
  if (makeHandPlayable(state, { allowedIndexes, replaceOccupied, gameplayModifier })) return true;

  for (let attempt = 0; attempt < maxTableDeals; attempt += 1) {
    state.discard.push(...state.stack.filter(Boolean));
    state.stack = drawCards(state, state.baseStackCount ?? 2);
    if (makeHandPlayable(state, { allowedIndexes, replaceOccupied, gameplayModifier })) return true;
  }

  return installGuaranteedOpening(state, { allowedIndexes, replaceOccupied, gameplayModifier });
}

function makeHandPlayable(state, options) {
  if (hasPlayableCard(state.stack, state.hand, options.gameplayModifier)) return true;
  ensurePlayableHand(state, options);
  return hasPlayableCard(state.stack, state.hand, options.gameplayModifier);
}

function takePlayableCard(state, gameplayModifier) {
  const fromCurrentDeck = takePlayableFromDeck(state, gameplayModifier);
  if (fromCurrentDeck) return fromCurrentDeck;

  if (state.discard.length > 0) {
    state.deck = shuffle([...state.deck, ...state.discard]);
    state.discard = [];
    const fromRecycle = takePlayableFromDeck(state, gameplayModifier);
    if (fromRecycle) return fromRecycle;
  }

  state.deck = shuffle(createDeck());
  return takePlayableFromDeck(state, gameplayModifier);
}

function takePlayableFromDeck(state, gameplayModifier) {
  const index = state.deck.findIndex((card) => evaluateStackAdd(state.stack, card, gameplayModifier).valid);
  if (index < 0) return null;
  return state.deck.splice(index, 1)[0];
}

function findWeakestSlot(state, { allowedIndexes, replaceOccupied, gameplayModifier }) {
  const usableIndexes = Array.isArray(allowedIndexes)
    ? allowedIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < state.hand.length)
    : null;

  const emptyIndex = usableIndexes
    ? usableIndexes.find((index) => !state.hand[index])
    : state.hand.findIndex((card) => !card);
  if (emptyIndex >= 0) return emptyIndex;

  if (usableIndexes?.length) {
    const invalidAllowedIndex = usableIndexes.find((index) => !evaluateStackAdd(state.stack, state.hand[index], gameplayModifier).valid);
    return invalidAllowedIndex >= 0 ? invalidAllowedIndex : usableIndexes[0];
  }

  if (!replaceOccupied) return -1;

  const invalidIndex = state.hand.findIndex((card) => !evaluateStackAdd(state.stack, card, gameplayModifier).valid);
  return invalidIndex >= 0 ? invalidIndex : 0;
}

function installGuaranteedOpening(state, { allowedIndexes, replaceOccupied, gameplayModifier }) {
  const pool = createDeck();
  let opening = null;

  for (let first = 0; first < pool.length - 1 && !opening; first += 1) {
    for (let second = first + 1; second < pool.length && !opening; second += 1) {
      const stack = [pool[first], pool[second]];
      const candidate = pool.find((card, index) => index !== first && index !== second && evaluateStackAdd(stack, card, gameplayModifier).valid);
      if (candidate) opening = { stack, candidate };
    }
  }

  if (!opening) return false;
  const replaceIndex = findWeakestSlot(state, { allowedIndexes, replaceOccupied, gameplayModifier });
  if (replaceIndex < 0) return false;

  state.stack = opening.stack;
  if (state.hand[replaceIndex]) state.discard.push(state.hand[replaceIndex]);
  state.hand[replaceIndex] = opening.candidate;
  const usedIds = new Set([...state.stack, ...state.hand].filter(Boolean).map((card) => card.id));
  state.deck = shuffle(pool.filter((card) => !usedIds.has(card.id)));
  state.discard = [];
  return true;
}
