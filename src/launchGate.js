import { renderHeroLogoCards } from "./ui.js?v=196";
import { playGameSfx } from "./audio.js?v=164";
import { haptic } from "./haptics.js?v=164";

const GUEST_SESSION_KEY = "cardCrunchGuestSessionV2";
const LEGACY_GUEST_SESSION_KEY = "cardCrunchGuestSessionV1";

export function initializeLaunchGate({ bindAction } = {}) {
  const gate = document.querySelector("#launchAuthGate");
  const guestButton = document.querySelector("#launchGuestButton");
  const cardFan = document.querySelector("#launchAuthCardFan");
  if (!gate) return null;
  let dismissed = false;

  renderHeroLogoCards(cardFan);

  const enterGame = ({ guest = false } = {}) => {
    if (dismissed) return;
    dismissed = true;
    if (guest) writeGuestSession(true);
    gate.classList.add("is-leaving");
    gate.setAttribute("aria-hidden", "true");
    playGameSfx("card_select");
    haptic("tap");
    window.setTimeout(() => {
      gate.hidden = true;
      gate.classList.remove("is-visible", "is-leaving");
      document.documentElement.classList.remove("launch-auth-active");
    }, prefersReducedMotion() ? 0 : 260);
  };

  bindAction?.(guestButton, () => enterGame({ guest: true }));

  const syncProfile = (profile) => {
    if (profile) {
      writeGuestSession(false);
      enterGame();
      return;
    }
    if (readGuestSession()) enterGame({ guest: false });
  };

  window.addEventListener("card-crunch-auth-change", (event) => syncProfile(event.detail?.profile ?? null));
  window.addEventListener("card-crunch-auth-ready", (event) => syncProfile(event.detail?.profile ?? null));

  document.documentElement.classList.add("launch-auth-active");
  gate.hidden = false;
  gate.classList.add("is-visible");
  if (readGuestSession()) enterGame({ guest: false });

  return Object.freeze({ enterGame });
}

function readGuestSession() {
  try {
    if (localStorage.getItem(GUEST_SESSION_KEY) === "1") return true;
    if (sessionStorage.getItem(LEGACY_GUEST_SESSION_KEY) !== "1") return false;
    localStorage.setItem(GUEST_SESSION_KEY, "1");
    sessionStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

function writeGuestSession(enabled) {
  try {
    if (enabled) localStorage.setItem(GUEST_SESSION_KEY, "1");
    else localStorage.removeItem(GUEST_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
  } catch {}
}

function prefersReducedMotion() {
  return document.documentElement.classList.contains("reduce-motion")
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
