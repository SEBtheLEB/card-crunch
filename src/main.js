import { createGame } from "./gameState.js";
import { createUI } from "./ui.js";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js";
import { preventMobileBrowserGestures } from "./mobileInput.js";
import { registerServiceWorker } from "./pwa.js";

const ui = createUI();
const game = createGame(ui);

ui.elements.startButton.addEventListener("click", game.start);
ui.elements.restartButton.addEventListener("click", game.start);
ui.elements.rulesButton.addEventListener("click", () => {
  ui.elements.rulesPanel.hidden = !ui.elements.rulesPanel.hidden;
});

preventMobileBrowserGestures();
registerServiceWorker();

window.CardCrunch = {
  game,
  calculateCrunchScore,
  runScoringSelfTests
};

console.table(runScoringSelfTests());
