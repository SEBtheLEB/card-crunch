import { createGame } from "./gameState.js?v=46";
import { createUI } from "./ui.js?v=46";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=46";

const ui = createUI();
const game = createGame(ui);

ui.elements.startButton.addEventListener("click", game.startEndless);
ui.elements.backToMenuButton?.addEventListener("click", () => {
  ui.showMap(false);
  ui.showStart(true);
});
ui.elements.exitLevelButton.addEventListener("click", game.returnToMap);
ui.elements.restartButton.addEventListener("click", game.startEndless);
game.showMap();

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
  const selector = "button:not(:disabled), .card:not(:disabled)";

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
      sprayTapParticles(event.clientX, event.clientY, getTapTone(target));

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

function getTapTone(target) {
  if (target.classList.contains("crunch-button") || target.classList.contains("primary-button")) return "gold";
  if (target.classList.contains("map-pot")) return "blue";
  if (target.classList.contains("exit-level-button")) return "red";
  if (target.classList.contains("card-red")) return "red";
  if (target.classList.contains("card-clubs")) return "green";
  return "gold";
}

function sprayTapParticles(x, y, tone = "gold") {
  const colorsByTone = {
    gold: ["#ffe894", "#ffbf3f", "#fff8d0"],
    blue: ["#76c6ff", "#42a1ff", "#dff4ff"],
    red: ["#ff746f", "#ff443d", "#ffd2d0"],
    green: ["#7ff0a2", "#19a65a", "#d7ffe2"]
  };
  const colors = colorsByTone[tone] ?? colorsByTone.gold;
  const amount = tone === "gold" ? 18 : 13;

  for (let i = 0; i < amount; i += 1) {
    const particle = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const distance = 18 + Math.random() * 52;
    particle.className = "tap-spray-particle";
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.color = colors[i % colors.length];
    particle.style.setProperty("--spray-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--spray-y", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--spray-rotate", `${Math.random() * 240 - 120}deg`);
    particle.style.setProperty("--spray-scale", `${.55 + Math.random() * .95}`);
    document.body.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  }
}
