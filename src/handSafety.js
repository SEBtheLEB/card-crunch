import { createDeck, shuffle } from "./deck.js";
import { evaluateStackAdd } from "./scoring.js";

export function hasPlayableCard(stack, hand) {
  return hand.some((card) => card && evaluateStackAdd(stack, card).valid);
}

export function ensurePlayableHand(state) {
  if (hasPlayableCard(state.stack, state.hand)) return false;

  const replacement = takePlayableCard(state);
  if (!replacement) return false;

  const replaceIndex = findWeakestSlot(state);
  if (state.hand[replaceIndex]) state.discard.push(state.hand[replaceIndex]);
  state.hand[replaceIndex] = replacement;
  return true;
}

function takePlayableCard(state) {
  const fromCurrentDeck = takePlayableFromDeck(state);
  if (fromCurrentDeck) return fromCurrentDeck;

  if (state.discard.length > 0) {
    state.deck = shuffle([...state.deck, ...state.discard]);
    state.discard = [];
    const fromRecycle = takePlayableFromDeck(state);
    if (fromRecycle) return fromRecycle;
  }

  state.deck = shuffle(createDeck());
  return takePlayableFromDeck(state);
}

function takePlayableFromDeck(state) {
  const index = state.deck.findIndex((card) => evaluateStackAdd(state.stack, card).valid);
  if (index < 0) return null;
  return state.deck.splice(index, 1)[0];
}

function findWeakestSlot(state) {
  const emptyIndex = state.hand.findIndex((card) => !card);
  if (emptyIndex >= 0) return emptyIndex;

  const invalidIndex = state.hand.findIndex((card) => !evaluateStackAdd(state.stack, card).valid);
  return invalidIndex >= 0 ? invalidIndex : 0;
}
