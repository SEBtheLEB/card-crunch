// Keep covered screens out of keyboard/screen-reader navigation. Observe only
// screen containers, never the moving cards or particles inside them.
export function initializeScreenAccessibility() {
  const game = document.querySelector("#gameShell");
  const menu = document.querySelector("#startScreen");
  const screens = [...document.querySelectorAll("body > .modal-screen, #launchAuthGate, #potInfoOverlay, #potJourneySheet, #storePurchaseOverlay, #packOpeningOverlay, #storeCollectionPanel, #matchmakingScreen, #multiplayerResultScreen")];
  const hiddenDriven = new Set(["storePurchaseOverlay", "packOpeningOverlay", "storeCollectionPanel"]);
  const coveredBranches = new Map();
  let front = null;
  let returnFocus = null;
  const visible = (screen) => !screen.hidden && screen.getAttribute("aria-hidden") !== "true"
    && (screen.classList.contains("is-visible") || hiddenDriven.has(screen.id));
  const sync = () => {
    coveredBranches.forEach((wasInert, element) => { element.inert = wasInert; });
    coveredBranches.clear();
    const shown = screens.filter(visible);
    const top = shown.sort((a, b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex)).at(-1) ?? null;
    screens.forEach((screen) => { screen.inert = Boolean(!visible(screen) || (top && screen !== top && !screen.contains(top))); });
    if (game) game.inert = Boolean(top);
    // A child sheet can cover the menu while remaining interactive itself.
    if (menu && top && menu.contains(top) && top !== menu) {
      let branch = top;
      while (branch && branch !== menu) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch) continue;
          coveredBranches.set(sibling, sibling.inert);
          sibling.inert = true;
        }
        branch = branch.parentElement;
      }
    }
    if (front !== top) {
      const previous = front;
      front = top;
      if (top && top !== menu) {
        if (!previous || previous === menu) returnFocus = document.activeElement;
        if (!top.contains(document.activeElement)) {
          top.querySelector("button:not(:disabled), [tabindex='0'], a[href]")?.focus({ preventScroll: true });
        }
      } else if (previous && previous !== menu) {
        if (returnFocus?.isConnected && !returnFocus.closest("[inert], [hidden], [aria-hidden='true']")) returnFocus.focus({ preventScroll: true });
        else if (top === menu) menu.querySelector(".menu-page.is-active button:not(:disabled)")?.focus({ preventScroll: true });
        returnFocus = null;
      }
    }
  };
  const observer = new MutationObserver(sync);
  screens.forEach((screen) => observer.observe(screen, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !front || front === menu) return;
    const items = [...front.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex='0']")]
      .filter((element) => !element.closest("[inert], [hidden]") && element.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !front.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !front.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  sync();
}
