let controls = [];
let changing = false;

export function installFullscreenControls(bindAction) {
  controls = [...document.querySelectorAll("[data-fullscreen-toggle]")];
  controls.forEach((button) => bindAction(button, toggleFullscreen));

  ["fullscreenchange", "webkitfullscreenchange"].forEach((eventName) => {
    document.addEventListener(eventName, updateFullscreenControls);
  });

  updateFullscreenControls();
  attemptAutomaticFullscreen();
}

export async function toggleFullscreen() {
  if (changing) return;
  changing = true;
  try {
    if (getFullscreenElement()) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  } finally {
    changing = false;
    updateFullscreenControls();
  }
}

async function attemptAutomaticFullscreen() {
  if (getFullscreenElement()) return;

  // Installed PWAs and native WebViews already have an app-like launch
  // context. Normal browser tabs keep their first tap for the control the
  // player actually touched; fullscreen remains available through the button.
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone === true
    || globalThis.Capacitor?.isNativePlatform?.() === true;
  if (standalone) await enterFullscreen();
}

async function enterFullscreen() {
  if (getFullscreenElement()) {
    updateFullscreenControls();
    return true;
  }

  const root = document.documentElement;
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (!request) return false;

  try {
    await Promise.resolve(request.call(root));
    const orientationLock = screen.orientation?.lock?.("portrait");
    orientationLock?.catch?.(() => {});
    updateFullscreenControls();
    return Boolean(getFullscreenElement());
  } catch {
    return false;
  }
}

async function exitFullscreen() {
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  if (!exit || !getFullscreenElement()) return false;
  try {
    await Promise.resolve(exit.call(document));
    screen.orientation?.unlock?.();
    return true;
  } catch {
    return false;
  }
}

function getFullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function updateFullscreenControls() {
  const active = Boolean(getFullscreenElement());
  controls.forEach((button) => {
    button.classList.toggle("is-fullscreen", active);
    button.setAttribute("aria-label", active ? "Exit full screen" : "Enter full screen");
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? "Exit full screen" : "Enter full screen";
    const icon = button.querySelector(".fullscreen-icon");
    if (icon) icon.textContent = active ? "\u2921" : "\u26F6";
  });
}
