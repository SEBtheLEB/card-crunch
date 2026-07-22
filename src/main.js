import { createGame } from "./gameState.js?v=181";
import { createUI } from "./ui.js?v=169";
import { calculateCrunchScore, runScoringSelfTests } from "./scoring.js?v=164";
import { adManager } from "./ads.js?v=164";
import { grantShieldToken, hasShieldToken } from "./save.js?v=164";
import { installAudioUnlock, playGameSfx, setAudioSettings } from "./audio.js?v=164";
import { haptic } from "./haptics.js?v=164";
import { bindInstantAction } from "./input.js?v=164";
import { initializePlayGames, showPlayLeaderboard } from "./playGames.js?v=164";
import { installFullscreenControls } from "./fullscreen.js?v=168";
import { bindThemePicker, initializeTheme } from "./themes.js?v=164";
import { initializeCardCollection } from "./cardCollection.js?v=167";
import { initializeCardCollectionUI } from "./cardCollectionUI.js?v=167";
import { bindCardSkinPicker, initializeCardSkin, installRainbowCardTrail } from "./cardSkins.js?v=169";
import { initializeStore } from "./store.js?v=167";
import { initializeTutorial } from "./tutorial.js?v=164";
import { initializeSupabaseAccount } from "./supabaseAccount.js?v=179";
import { initializeMultiplayer } from "./multiplayer.js?v=181";

initializeTheme();
initializeCardCollection();
initializeCardSkin();
const ui = createUI();
const game = createGame(ui);
initializeTutorial({ game });
initializeSupabaseAccount({
  bindAction: bindInstantAction,
  showPage: ui.showMenuPage
});
installAudioUnlock();
initializePlayGames();
installFullscreenControls(bindInstantAction);
bindInstantAction(ui.elements.startButton, () => ui.showMenuPage("pots"));
bindInstantAction(ui.elements.endlessArcadeButton, game.startEndlessArcade);
bindInstantAction(ui.elements.backToMenuButton, () => {
  ui.showMap(false);
  ui.showStart(true);
});
bindInstantAction(ui.elements.exitLevelButton, game.exitRun);
bindInstantAction(ui.elements.potInfoButton, game.openPotInfo);
bindInstantAction(ui.elements.potInfoCloseButton, game.closePotInfo);
ui.elements.potInfoOverlay?.addEventListener("pointerdown", (event) => {
  if (event.target === ui.elements.potInfoOverlay) game.closePotInfo();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && game.state.status === "pausedInfo") game.closePotInfo();
});
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
bindThemePicker(bindInstantAction);
bindCardSkinPicker(bindInstantAction);
initializeCardCollectionUI(bindInstantAction);
initializeStore({ bindAction: bindInstantAction, showMenuPage: ui.showMenuPage });
initializeMultiplayer({ game, bindAction: bindInstantAction });
installRainbowCardTrail();
loadSettings();
game.refreshEconomy();
window.addEventListener("focus", game.refreshEconomy);
window.addEventListener("card-crunch-request-menu-page", (event) => {
  if (event.detail?.pageName) ui.showMenuPage(event.detail.pageName);
});

document.addEventListener(
  "touchmove",
  (event) => {
    // Menus and modals scroll; only the game board locks panning.
    if (event.target.closest?.(".main-menu-screen, .modal-screen, .ad-placeholder-overlay, .pot-info-overlay")) return;
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
  const selector = "button:not(:disabled):not(.card):not(.crunch-skip-text)";
  const activePressTargets = new Set();
  const clearPressedTargets = () => {
    activePressTargets.forEach((target) => target.classList.remove("is-pressing"));
    activePressTargets.clear();
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target.closest(selector);
      if (!target) return;

      clearPressedTargets();
      target.classList.add("is-pressing");
      activePressTargets.add(target);
      if (isPrimaryJuiceButton(target)) {
        sprayTapParticles(event.clientX, event.clientY, getTapTone(target), 4);
      }

      playGameSfx("tap");
      haptic("tap");
    },
    { passive: true }
  );

  document.addEventListener("pointerup", clearPressedTargets, { capture: true, passive: true });
  document.addEventListener("pointercancel", clearPressedTargets, { capture: true, passive: true });
  window.addEventListener("blur", clearPressedTargets);
}

function isPrimaryJuiceButton(target) {
  return target.matches(".play-button, .crunch-button, .bank-button, .primary-button, .map-pot");
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
      "cardCrunchEconomyV1",
      "cardCrunchShieldToken",
      "cardCrunchAdStats",
      "cardCrunchTheme",
      "cardCrunchCardSkin",
      "cardCrunchCardCollectionV1",
      "cardCrunchStoreV1",
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

function sprayTapParticles(x, y, tone = "gold", requestedAmount = null) {
  const colorsByTone = {
    gold: ["#ffe894", "#ffbf3f", "#fff8d0"],
    blue: ["#76c6ff", "#42a1ff", "#dff4ff"],
    red: ["#ff746f", "#ff443d", "#ffd2d0"],
    green: ["#7ff0a2", "#19a65a", "#d7ffe2"]
  };
  const colors = colorsByTone[tone] ?? colorsByTone.gold;
  const isSmallScreen = window.matchMedia?.("(max-width: 640px)").matches;
  const amount = requestedAmount ?? (isSmallScreen ? (tone === "gold" ? 8 : 6) : (tone === "gold" ? 12 : 9));

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
