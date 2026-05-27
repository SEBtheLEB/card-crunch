import { createGame } from "./gameState.js?v=39";
import { createUI } from "./ui.js?v=39";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=39";

const ui = createUI();
const game = createGame(ui);

ui.elements.startButton.addEventListener("click", game.showMap);
ui.elements.backToMenuButton.addEventListener("click", () => {
  ui.showMap(false);
  ui.showStart(true);
});
ui.elements.exitLevelButton.addEventListener("click", game.returnToMap);
ui.elements.restartButton.addEventListener("click", () => game.start());

document.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

window.CardCrunch = {
  game,
  calculateCrunchScore,
  runScoringSelfTests
};

console.table(runScoringSelfTests());
