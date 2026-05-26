import { getSelectionMultiplier } from "./scoring.js";

export function getCrunchPreview(state) {
  const selectedCount = state.selectedHandIndexes.length;
  return {
    canCrunch: selectedCount > 0,
    selectedCount,
    selectionMultiplier: getSelectionMultiplier(selectedCount)
  };
}
