import { createGame } from "./gameState.js";
import { createUI } from "./ui.js";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js";

const ui = createUI();
const game = createGame(ui);

ui.elements.startButton.addEventListener("click", game.start);
ui.elements.restartButton.addEventListener("click", game.start);

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
