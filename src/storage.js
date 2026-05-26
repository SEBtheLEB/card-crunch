export const STORAGE_KEYS = {
  bestScore: "cardCrunchBestScore"
};

export function loadBestScore() {
  return Number(localStorage.getItem(STORAGE_KEYS.bestScore) ?? 0);
}

export function saveBestScore(score) {
  localStorage.setItem(STORAGE_KEYS.bestScore, String(score));
}
