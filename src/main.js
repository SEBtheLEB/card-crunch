import { createGame } from "./gameState.js?v=75";
import { createUI } from "./ui.js?v=75";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=75";
import { adManager } from "./ads.js?v=75";
import { grantShieldToken, hasShieldToken } from "./save.js?v=75";
import { installAudioUnlock, playGameSfx, setAudioSettings } from "./audio.js?v=75";
import { haptic } from "./haptics.js?v=75";
import { bindInstantAction } from "./input.js?v=75";
import { initializePlayGames, showPlayLeaderboard } from "./playGames.js?v=75";

const ui = createUI();
const game = createGame(ui);
installAudioUnlock();
initializePlayGames();
bindInstantAction(ui.elements.startButton, () => ui.showMenuPage("pots"));
bindInstantAction(ui.elements.backToMenuButton, () => {
  ui.showMap(false);
  ui.showStart(true);
});
bindInstantAction(ui.elements.exitLevelButton, game.exitAndSave);
bindInstantAction(ui.elements.restartButton, game.playAgain);
bindInstantAction(ui.elements.returnToPotsButton, game.returnToMap);
bindInstantAction(ui.elements.reviveAdButton, game.onReviveAd);
bindInstantAction(ui.elements.recoverAdButton, game.onRecoverAd);
bindInstantAction(ui.elements.hintAdButton, game.onHintAd);
bindInstantAction(ui.elements.playLeaderboardButton, async () => {
  const opened = await showPlayLeaderboard();
  if (!opened) ui.elements.playLeaderboardStatus.textContent = "Google Play Games connects in the Android release build.";
});
let shieldRewardPending = false;
bindInstantAction(ui.elements.shieldAdButton, async () => {
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
      target.classList.add("is-pressing");
      sprayTapParticles(event.clientX, event.clientY, getTapTone(target));

      if (!target.classList.contains("card")) playGameSfx("tap");
      haptic("tap");
    },
    { passive: true }
  );

  const releasePress = (event) => event.target.closest?.(".is-pressing")?.classList.remove("is-pressing");
  document.addEventListener("pointerup", releasePress, { capture: true, passive: true });
  document.addEventListener("pointercancel", releasePress, { capture: true, passive: true });

  document.addEventListener("animationend", (event) => {
    if (event.animationName === "tapPop" || event.animationName === "cardTapPop") {
      event.target.classList.remove("tap-pop");
    }
  });
}

function bindMenuNavigation() {
  document.querySelectorAll("[data-menu-page]").forEach((button) => {
    bindInstantAction(button, () => ui.showMenuPage(button.dataset.menuPage));
  });

  bindInstantAction(ui.elements.hamburgerButton, () => ui.showMenuPage("settings"));
  bindInstantAction(ui.elements.resetSaveButton, () => {
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
  setAudioSettings(settings);

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
  setAudioSettings(settings);
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
