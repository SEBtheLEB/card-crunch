import { createGame } from "./gameState.js?v=43";
import { createUI } from "./ui.js?v=43";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=43";

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

installReactivePressFeedback();

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

function installReactivePressFeedback() {
  const selector = ".card:not(:disabled), .crunch-button:not(:disabled), .primary-button:not(:disabled), .map-pot:not(:disabled), .exit-level-button:not(:disabled)";

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target.closest(selector);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      target.style.setProperty("--tap-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--tap-y", `${event.clientY - rect.top}px`);
      target.classList.remove("tap-pop");
      void target.offsetWidth;
      target.classList.add("tap-pop");

      if (target.classList.contains("crunch-button") || target.classList.contains("primary-button")) {
        navigator.vibrate?.(12);
      } else if (target.classList.contains("card")) {
        navigator.vibrate?.(6);
      }
    },
    { passive: true }
  );

  document.addEventListener("animationend", (event) => {
    if (event.animationName === "tapPop" || event.animationName === "cardTapPop") {
      event.target.classList.remove("tap-pop");
    }
  });
}
