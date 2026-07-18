let controls = [];
let changing = false;
let firstGestureArmed = false;

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

  // WebViews may allow this immediately. Standard browsers reject it until
  // user activation, so retain a one-shot first-gesture fallback.
  const entered = await enterFullscreen();
  if (entered) return;
  armFirstGestureFullscreen();
}

function armFirstGestureFullscreen() {
  if (firstGestureArmed) return;
  firstGestureArmed = true;

  const onFirstGesture = async (event) => {
    if (event.target?.closest?.("[data-fullscreen-toggle]")) {
      disarm();
      return;
    }
    disarm();
    await enterFullscreen();
  };
  const disarm = () => {
    firstGestureArmed = false;
    document.removeEventListener("pointerup", onFirstGesture, true);
    document.removeEventListener("keydown", onFirstGesture, true);
  };

  document.addEventListener("pointerup", onFirstGesture, { capture: true, once: true, passive: true });
  document.addEventListener("keydown", onFirstGesture, { capture: true, once: true });
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
