import { drawCards } from "./deck.js";

export function toggleSelectedIndex(selectedIndexes, handIndex) {
  return selectedIndexes.includes(handIndex)
    ? selectedIndexes.filter((index) => index !== handIndex)
    : [...selectedIndexes, handIndex];
}

export function getSelectedCards(hand, selectedIndexes) {
  return selectedIndexes.map((index) => hand[index]);
}

export function discardSelectedCards(state) {
  const selected = new Set(state.selectedHandIndexes);
  state.hand = state.hand.filter((card, index) => {
    if (selected.has(index)) {
      state.discard.push(card);
      return false;
    }
    return true;
  });
  state.selectedHandIndexes = [];
}

export function refillHand(state, handSize = 4) {
  while (state.hand.length < handSize) {
    state.hand.push(drawCards(state, 1)[0]);
  }
}
