import { createGame } from "./gameState.js?v=73";
import { createUI } from "./ui.js?v=73";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=73";
import { adManager } from "./ads.js?v=73";
import { grantShieldToken, hasShieldToken } from "./save.js?v=73";

const ui = createUI();
const game = createGame(ui);
bindInstantButton(ui.elements.startButton, () => ui.showMenuPage("pots"));
bindInstantButton(ui.elements.backToMenuButton, () => {
  ui.showMap(false);
  ui.showStart(true);
});
bindInstantButton(ui.elements.exitLevelButton, game.exitAndSave);
bindInstantButton(ui.elements.restartButton, game.playAgain);
bindInstantButton(ui.elements.returnToPotsButton, game.returnToMap);
bindInstantButton(ui.elements.reviveAdButton, game.onReviveAd);
bindInstantButton(ui.elements.recoverAdButton, game.onRecoverAd);
bindInstantButton(ui.elements.hintAdButton, game.onHintAd);
let shieldRewardPending = false;
bindInstantButton(ui.elements.shieldAdButton, async () => {
  if (shieldRewardPending) return;
  if (hasShieldToken()) return;
  shieldRewardPending = true;
  const earned = await adManager.showRewardedAd("shield");
  shieldRewardPending = false;
  if (earned) {
    grantShieldToken();
    ui.renderMenuStats(game.state);
  }
});
game.showMap();
bindMenuNavigation();
loadSettings();

document.addEventListener(
  "touchmove",
  (event) => {
    // Menus and modals scroll; only the game board locks panning.
    if (event.target.closest?.(".main-menu-screen, .modal-screen, .ad-placeholder-overlay")) return;
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
      if (!target || target.classList.contains("crunch-skip-text")) return;

      const rect = target.getBoundingClientRect();
      target.style.setProperty("--tap-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--tap-y", `${event.clientY - rect.top}px`);
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

/* Single click listener: with touch-action: manipulation there is no
   mobile click delay, and no pointerup/click double-fire to dedupe. */
function bindInstantButton(button, action) {
  if (!button || typeof action !== "function") return;
  button.addEventListener("click", (event) => {
    if (button.disabled) return;
    event.preventDefault();
    action(event);
  });
}

function bindMenuNavigation() {
  document.querySelectorAll("[data-menu-page]").forEach((button) => {
    bindInstantButton(button, () => ui.showMenuPage(button.dataset.menuPage));
  });

  bindInstantButton(ui.elements.hamburgerButton, () => ui.showMenuPage("settings"));
  bindInstantButton(ui.elements.resetSaveButton, () => {
    const confirmed = window.confirm("Reset Card Crunch save data? This clears pots, best score, coins, and saved runs.");
    if (!confirmed) return;
    [
      "cardCrunchBestScore",
      "cardCrunchLevelPots",
      "cardCrunchRunSave",
      "cardCrunchCoins",
      "cardCrunchTotalCrunches"
    ].forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  });
}

function loadSettings() {
  const settings = JSON.parse(localStorage.getItem("cardCrunchSettings") ?? "{}");
  ui.elements.soundToggle.checked = settings.sound !== false;
  ui.elements.musicToggle.checked = settings.music !== false;
  ui.elements.motionToggle.checked = Boolean(settings.reduceMotion);
  document.documentElement.classList.toggle("reduce-motion", Boolean(settings.reduceMotion));

  [ui.elements.soundToggle, ui.elements.musicToggle, ui.elements.motionToggle].forEach((input) => {
    input?.addEventListener("change", saveSettings);
  });
}

function saveSettings() {
  const settings = {
    sound: ui.elements.soundToggle.checked,
    music: ui.elements.musicToggle.checked,
    reduceMotion: ui.elements.motionToggle.checked
  };
  localStorage.setItem("cardCrunchSettings", JSON.stringify(settings));
  document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
}

function getTapTone(target) {
  if (target.classList.contains("crunch-button") || target.classList.contains("primary-button")) return "gold";
  if (target.classList.contains("bank-button")) return "green";
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
  const isSmallScreen = window.matchMedia?.("(max-width: 640px)").matches;
  const amount = isSmallScreen ? (tone === "gold" ? 8 : 6) : (tone === "gold" ? 12 : 9);

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
