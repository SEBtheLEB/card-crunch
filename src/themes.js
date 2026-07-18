const THEME_STORAGE_KEY = "cardCrunchTheme";

export const THEMES = Object.freeze({
  "midnight-gold": {
    name: "Midnight Gold",
    themeColor: "#05060f"
  },
  "gold-table": {
    name: "Gold Table",
    themeColor: "#123820"
  },
  "knight-deck": {
    name: "Knight Deck",
    themeColor: "#111a2c"
  }
});

export function initializeTheme() {
  return applyTheme(readSavedTheme(), { persist: false });
}

export function applyTheme(themeId, { persist = true } = {}) {
  const resolvedId = THEMES[themeId] ? themeId : "midnight-gold";
  document.documentElement.dataset.theme = resolvedId;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[resolvedId].themeColor);
  updateThemePicker(resolvedId);

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, resolvedId);
    } catch {
      // Theme changes still work when storage is unavailable.
    }
  }

  window.dispatchEvent(new CustomEvent("card-crunch-theme-change", { detail: { themeId: resolvedId } }));
  return resolvedId;
}

export function bindThemePicker(bindAction) {
  document.querySelectorAll("[data-theme-id]").forEach((button) => {
    bindAction(button, () => applyTheme(button.dataset.themeId));
  });
  updateThemePicker(document.documentElement.dataset.theme || "midnight-gold");
}

function updateThemePicker(themeId) {
  document.querySelectorAll("[data-theme-id]").forEach((button) => {
    const selected = button.dataset.themeId === themeId;
    button.classList.toggle("is-theme-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector("em");
    if (stateLabel) stateLabel.textContent = selected ? "Selected" : "Try Theme";
  });

  const status = document.querySelector("#themeStatus");
  if (status) status.textContent = `${THEMES[themeId]?.name ?? THEMES["midnight-gold"].name} equipped.`;
}

function readSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "midnight-gold";
  } catch {
    return "midnight-gold";
  }
}
