import { createCardElement } from "./ui.js?v=189";
import { formatCompactNumber } from "./format.js?v=164";
import { isPotUnlocked } from "./progression.js?v=164";
import {
  getCardCollectionSnapshot,
  getCollectionProgress,
  subscribeToCardCollection
} from "./cardCollection.js?v=167";
import { CARD_SKINS } from "./cardSkins.js?v=169";
import { playGameSfx } from "./audio.js?v=164";
import { haptic } from "./haptics.js?v=164";

const TOP_LEVEL_TABS = ["shop", "themes", "modes", "events", "account"];
const PLAY_CHILD_PAGES = new Set(["modes", "pots", "pot-prep"]);
const PROFILE_CHILD_PAGES = new Set(["account", "settings", "leaderboard"]);
const DOCK_CARDS = Object.freeze([
  { id: "dock-9h", rank: "9", value: 9, suit: "hearts", suitSymbol: "\u2665", color: "red" },
  { id: "dock-as", rank: "A", value: 1, suit: "spades", suitSymbol: "\u2660", color: "black" },
  { id: "dock-4d", rank: "4", value: 4, suit: "diamonds", suitSymbol: "\u2666", color: "red" }
]);

export function initializeAppShell({ ui, game, bindAction }) {
  const root = ui.elements.startScreen;
  const refs = collectShellElements(root);
  const originalShowMenuPage = ui.showMenuPage.bind(ui);
  const state = {
    activePage: "modes",
    activeTopLevel: "modes",
    selectedPot: null,
    pots: game.state.pots,
    handlers: null,
    journeyHasCentered: false,
    tabScroll: new Map(),
    sheetReturnFocus: null
  };

  ui.showMenuPage = showPage;
  ui.renderMap = renderJourney;

  bindDock();
  bindSheet();
  bindPreparation();
  bindSwipeNavigation();
  bindJourneyUtilities();
  bindShellAction(refs.potsModeButton, () => showPage("pots"));
  bindShellAction(refs.playHubTutorialButton, () => document.querySelector("#tutorialStartButton")?.click());

  renderDockCards();
  refreshPlayHub();
  refreshProfileShell();
  subscribeToCardCollection(() => {
    renderDockCards();
    refreshPreparationDeck();
  });
  window.addEventListener("card-crunch-card-skin-change", renderDockCards);
  window.addEventListener("card-crunch-economy-change", refreshProfileShell);

  function showPage(requestedPage = "modes") {
    const pageName = requestedPage === "home" ? "modes" : requestedPage;
    const previousPage = state.activePage;
    const previousTop = state.activeTopLevel;
    const nextTop = getTopLevelPage(pageName);

    rememberScroll(previousPage);
    closePotSheet({ immediate: true, restoreFocus: false });
    originalShowMenuPage(pageName);
    state.activePage = pageName;
    state.activeTopLevel = nextTop;
    root.dataset.shellPage = pageName;
    root.dataset.shellTab = nextTop;
    root.classList.add("has-app-shell");
    updateDock(nextTop);
    restoreScroll(pageName);

    if (pageName === "modes") refreshPlayHub();
    if (pageName === "pots") {
      renderJourney(state.pots, state.handlers);
      queueCurrentPotCenter();
    }
    if (pageName === "account") refreshProfileShell();
    if (previousTop !== nextTop) animateTabEntry(nextTop);
  }

  function renderJourney(pots = game.state.pots, handlers = state.handlers) {
    state.pots = pots;
    state.handlers = handlers;
    const currentPot = getCurrentPot(pots);
    refs.levelMap.replaceChildren();
    refs.levelMap.dataset.currentPot = String(currentPot?.id ?? 1);

    let activeChapter = "";
    let chapterSection = null;
    pots.forEach((pot, index) => {
      if (pot.chapter !== activeChapter) {
        activeChapter = pot.chapter;
        chapterSection = document.createElement("section");
        chapterSection.className = "journey-chapter";
        chapterSection.dataset.chapter = pot.chapter;
        chapterSection.innerHTML = `
          <header><small>Table ${refs.levelMap.querySelectorAll(".journey-chapter").length + 1}</small><strong>${pot.chapter}</strong></header>
          <div class="journey-chapter-path"></div>
        `;
        refs.levelMap.appendChild(chapterSection);
      }
      const path = chapterSection.querySelector(".journey-chapter-path");
      path.appendChild(createJourneyNode(pot, index, pots, currentPot, bindShellAction, () => openPotSheet(pot)));
    });

    refs.currentPotButton.hidden = !currentPot;
    refreshPlayHub();
  }

  function openPotSheet(pot) {
    if (!pot || !isPotUnlocked(state.pots, pot.id)) return;
    state.selectedPot = pot;
    state.sheetReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const progress = getPotProgress(pot);
    refs.sheet.style.setProperty("--pot-accent", pot.accent);
    refs.sheet.style.setProperty("--pot-accent-rgb", pot.accentRgb);
    refs.sheetKicker.textContent = `Pot ${pot.id} \u2022 ${pot.complete ? "Cleared" : pot.progress > 0 ? "In Progress" : "Ready"}`;
    refs.sheetTitle.textContent = pot.title;
    refs.sheetModifierIcon.innerHTML = pot.icon;
    refs.sheetModifierName.textContent = pot.ruleLabel;
    refs.sheetModifierCopy.textContent = pot.detail;
    refs.sheetTarget.textContent = formatCompactNumber(pot.target);
    refs.sheetBest.textContent = formatCompactNumber(Math.max(pot.progress ?? 0, game.state.bestScore ?? 0));
    refs.sheetCoinReward.textContent = formatCompactNumber(Math.max(100, Math.round(pot.target / 10000)));
    refs.sheetPlayButton.textContent = `${pot.complete ? "Replay" : pot.progress > 0 ? "Continue" : "Play"} Pot ${pot.id}`;
    refs.sheetRender.innerHTML = createPotRenderMarkup(pot, progress, { large: true });
    refs.sheet.hidden = false;
    refs.sheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      refs.sheet.classList.add("is-visible");
      refs.sheetClose.focus({ preventScroll: true });
    });
  }

  function closePotSheet({ immediate = false, restoreFocus = true } = {}) {
    if (refs.sheet.hidden) return;
    refs.sheet.classList.remove("is-visible");
    refs.sheet.setAttribute("aria-hidden", "true");
    const finish = () => {
      refs.sheet.hidden = true;
      if (restoreFocus) state.sheetReturnFocus?.focus?.({ preventScroll: true });
      state.sheetReturnFocus = null;
    };
    if (immediate) finish();
    else window.setTimeout(finish, 220);
  }

  function openPreparation() {
    const pot = state.selectedPot;
    if (!pot) return;
    closePotSheet({ immediate: true, restoreFocus: false });
    refs.prepTitle.textContent = `Pot ${pot.id} \u2014 ${pot.title}`;
    refs.prepChapter.textContent = pot.chapter;
    refs.prepModifierIcon.innerHTML = pot.icon;
    refs.prepModifierName.textContent = pot.ruleLabel;
    refs.prepModifierCopy.textContent = pot.detail;
    refs.prepTarget.textContent = formatCompactNumber(pot.target);
    refs.prepBest.textContent = formatCompactNumber(Math.max(pot.progress ?? 0, game.state.bestScore ?? 0));
    refs.prepPlayButton.textContent = `${pot.complete ? "Replay" : "Play"} Pot ${pot.id}`;
    refs.prepPlayButton.style.setProperty("--pot-accent", pot.accent);
    refreshPreparationDeck();
    showPage("pot-prep");
  }

  function launchPreparedPot() {
    if (!state.selectedPot) return;
    game.enterLevel(state.selectedPot.id);
  }

  function refreshPlayHub() {
    const pot = getCurrentPot(game.state.pots);
    if (!pot) return;
    const progress = getPotProgress(pot);
    const chapterIndex = [...new Set(game.state.pots.map((item) => item.chapter))].indexOf(pot.chapter) + 1;
    refs.hubChapter.textContent = `Table ${chapterIndex} \u2022 ${pot.chapter}`;
    refs.hubPotNumber.textContent = String(pot.id);
    refs.hubPotTitle.textContent = `Pot ${pot.id} \u2014 ${pot.title}`;
    refs.hubModifier.textContent = pot.ruleLabel;
    refs.hubProgressLabel.textContent = `${Math.round(progress * 100)}%`;
    refs.hubBestScore.textContent = `Best ${formatCompactNumber(Math.max(pot.progress ?? 0, game.state.bestScore ?? 0))}`;
    refs.hubProgressFill.style.width = `${progress * 100}%`;
    refs.hubPotFill.style.height = `${Math.max(10, progress * 100)}%`;
    refs.hubContinueLabel.textContent = `${pot.progress > 0 ? "Continue" : "Start"} Pot ${pot.id}`;
  }

  function refreshPreparationDeck() {
    const collection = getCardCollectionSnapshot();
    const skinId = collection.fullDeckSkin;
    const skin = CARD_SKINS[skinId] ?? CARD_SKINS.classic;
    const progress = skinId === "custom"
      ? { owned: Object.keys(collection.equippedByCard).length, total: 52 }
      : getCollectionProgress(skinId);
    refs.prepDeckName.textContent = skinId === "custom" ? "Custom Mix" : skin.name;
    refs.prepDeckProgress.textContent = `${progress.owned} / ${progress.total}`;
    renderCardFan(refs.prepDeckPreview, DOCK_CARDS, "prep-preview-card");
  }

  function renderDockCards() {
    renderCardFan(refs.dockCardFan, DOCK_CARDS, "dock-play-card");
  }

  function bindDock() {
    refs.dockTabs.forEach((button) => {
      bindShellAction(button, () => {
        const target = button.dataset.appTabTarget;
        if (state.activeTopLevel === target) {
          scrollActivePageToTop();
          if (target === "modes" && state.activePage !== "modes") showPage("modes");
          return;
        }
        showPage(target);
        playGameSfx("card_select");
        haptic("tap");
      });
    });
    root.querySelectorAll("[data-app-tab-target]:not(.dock-tab)").forEach((button) => {
      bindShellAction(button, () => showPage(button.dataset.appTabTarget));
    });
  }

  function bindSheet() {
    bindShellAction(refs.sheetBackdrop, () => closePotSheet());
    bindShellAction(refs.sheetClose, () => closePotSheet());
    bindShellAction(refs.sheetPlayButton, openPreparation);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !refs.sheet.hidden) closePotSheet();
    });
  }

  function bindPreparation() {
    bindShellAction(refs.prepPlayButton, launchPreparedPot);
    refs.prepBoosters.forEach((button) => {
      bindShellAction(button, () => {
        const selected = button.getAttribute("aria-pressed") === "true";
        button.setAttribute("aria-pressed", String(!selected));
      });
    });
  }

  function bindJourneyUtilities() {
    bindShellAction(refs.currentPotButton, () => scrollToCurrentPot(true));
    let scrollFrame = null;
    refs.journeyScroller.addEventListener("scroll", () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        updateJourneyChapterLabel();
      });
    }, { passive: true });
  }

  function bindSwipeNavigation() {
    let start = null;
    refs.pages.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || isSwipeExcluded(event.target)) return;
      start = { x: event.clientX, y: event.clientY, time: performance.now() };
    }, { passive: true });
    refs.pages.addEventListener("pointerup", (event) => {
      if (!start || !TOP_LEVEL_TABS.includes(state.activeTopLevel)) {
        start = null;
        return;
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const elapsed = performance.now() - start.time;
      start = null;
      if (elapsed > 650 || Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.45) return;
      const currentIndex = TOP_LEVEL_TABS.indexOf(state.activeTopLevel);
      const nextIndex = Math.max(0, Math.min(TOP_LEVEL_TABS.length - 1, currentIndex + (dx < 0 ? 1 : -1)));
      if (nextIndex !== currentIndex) showPage(TOP_LEVEL_TABS[nextIndex]);
    }, { passive: true });
  }

  function queueCurrentPotCenter() {
    if (state.journeyHasCentered) return;
    state.journeyHasCentered = true;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCurrentPot(false)));
  }

  function scrollToCurrentPot(smooth = true) {
    const current = refs.levelMap.querySelector(".journey-pot-node.is-current");
    if (!current) return;
    const target = current.offsetTop - refs.journeyScroller.clientHeight * .38;
    refs.journeyScroller.scrollTo({
      top: Math.max(0, target),
      behavior: smooth && !document.documentElement.classList.contains("reduce-motion") ? "smooth" : "auto"
    });
  }

  function updateJourneyChapterLabel() {
    const sections = [...refs.levelMap.querySelectorAll(".journey-chapter")];
    const scrollerTop = refs.journeyScroller.getBoundingClientRect().top + 76;
    const active = sections.findLast?.((section) => section.getBoundingClientRect().top <= scrollerTop)
      ?? sections.find((section) => section.getBoundingClientRect().bottom > scrollerTop)
      ?? sections[0];
    if (active) {
      const index = sections.indexOf(active) + 1;
      refs.journeyChapter.textContent = `Table ${index} \u2022 ${active.dataset.chapter}`;
    }
  }

  function updateDock(activeTop) {
    refs.dockTabs.forEach((button) => {
      const active = button.dataset.appTabTarget === activeTop;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function animateTabEntry(activeTop) {
    const page = root.querySelector(`.menu-page.is-active`);
    if (!page) return;
    page.classList.remove("shell-page-enter");
    requestAnimationFrame(() => page.classList.add("shell-page-enter"));
    window.setTimeout(() => page.classList.remove("shell-page-enter"), 280);
  }

  function rememberScroll(pageName) {
    const page = root.querySelector(`.menu-page[data-page="${pageName}"]`);
    if (!page) return;
    const scroller = getPageScroller(page);
    state.tabScroll.set(pageName, scroller.scrollTop);
  }

  function restoreScroll(pageName) {
    const page = root.querySelector(`.menu-page[data-page="${pageName}"]`);
    if (!page) return;
    const scroller = getPageScroller(page);
    const saved = state.tabScroll.get(pageName) ?? 0;
    requestAnimationFrame(() => { scroller.scrollTop = saved; });
  }

  function scrollActivePageToTop() {
    const page = root.querySelector(".menu-page.is-active");
    if (!page) return;
    getPageScroller(page).scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshProfileShell() {
    const page = root.querySelector('[data-page="account"]');
    if (!page) return;
    const bestScore = formatCompactNumber(game.state.bestScore ?? 0);
    const bestStreak = formatCompactNumber(Math.max(game.state.bestRunStreak ?? 0, Number(localStorage.getItem("cardCrunchBestStreak")) || 0));
    const completed = game.state.pots.filter((pot) => pot.complete).length;
    page.style.setProperty("--profile-best-score", `"${bestScore}"`);
    page.dataset.profileBestScore = bestScore;
    page.dataset.profileBestStreak = bestStreak;
    page.dataset.profilePots = String(completed);
  }

  showPage("modes");
  return { showPage, renderJourney, refreshPlayHub };
}

function collectShellElements(root) {
  return {
    pages: root.querySelector(".menu-pages"),
    dockTabs: [...root.querySelectorAll(".dock-tab")],
    dockCardFan: root.querySelector("#dockPlayCardFan"),
    potsModeButton: root.querySelector("#potsModeButton"),
    playHubTutorialButton: root.querySelector("#playHubTutorialButton"),
    hubChapter: root.querySelector("#playHubChapter"),
    hubPotNumber: root.querySelector("#playHubPotNumber"),
    hubPotTitle: root.querySelector("#playHubPotTitle"),
    hubModifier: root.querySelector("#playHubModifier"),
    hubProgressLabel: root.querySelector("#playHubProgressLabel"),
    hubBestScore: root.querySelector("#playHubBestScore"),
    hubProgressFill: root.querySelector("#playHubProgressFill"),
    hubPotFill: root.querySelector("#playHubPotFill"),
    hubContinueLabel: root.querySelector("#playHubContinueLabel"),
    levelMap: root.querySelector("#levelMap"),
    journeyScroller: root.querySelector("#journeyScrollRegion"),
    journeyChapter: root.querySelector("#journeyChapterName"),
    currentPotButton: root.querySelector("#returnCurrentPotButton"),
    sheet: root.querySelector("#potJourneySheet"),
    sheetBackdrop: root.querySelector("#potSheetBackdrop"),
    sheetClose: root.querySelector("#potSheetClose"),
    sheetKicker: root.querySelector("#potSheetKicker"),
    sheetTitle: root.querySelector("#potSheetTitle"),
    sheetRender: root.querySelector("#potSheetRender"),
    sheetModifierIcon: root.querySelector("#potSheetModifierIcon"),
    sheetModifierName: root.querySelector("#potSheetModifierName"),
    sheetModifierCopy: root.querySelector("#potSheetModifierCopy"),
    sheetTarget: root.querySelector("#potSheetTarget"),
    sheetBest: root.querySelector("#potSheetBest"),
    sheetCoinReward: root.querySelector("#potSheetCoinReward"),
    sheetPlayButton: root.querySelector("#potSheetPlayButton"),
    prepTitle: root.querySelector("#prepPotTitle"),
    prepChapter: root.querySelector("#prepPotChapter"),
    prepDeckPreview: root.querySelector("#prepDeckPreview"),
    prepDeckName: root.querySelector("#prepDeckName"),
    prepDeckProgress: root.querySelector("#prepDeckProgress"),
    prepModifierIcon: root.querySelector("#prepModifierIcon"),
    prepModifierName: root.querySelector("#prepModifierName"),
    prepModifierCopy: root.querySelector("#prepModifierCopy"),
    prepTarget: root.querySelector("#prepTargetValue"),
    prepBest: root.querySelector("#prepBestValue"),
    prepBoosters: [...root.querySelectorAll(".prep-boosters button")],
    prepPlayButton: root.querySelector("#prepPlayButton")
  };
}

function createJourneyNode(pot, index, pots, currentPot, bindAction, onOpen) {
  const button = document.createElement("button");
  const unlocked = isPotUnlocked(pots, pot.id);
  const progress = getPotProgress(pot);
  const perfected = pot.complete && (pot.progress ?? 0) >= pot.target * 1.2;
  const current = pot.id === currentPot?.id;
  const state = !unlocked ? "locked" : perfected ? "perfected" : pot.complete ? "completed" : current ? "current" : pot.progress > 0 ? "in-progress" : "available";
  const lanePattern = ["center", "right", "center", "left"];
  const lane = lanePattern[index % lanePattern.length];
  button.type = "button";
  button.className = `journey-pot-node is-${state} lane-${lane}`;
  button.dataset.potId = String(pot.id);
  button.dataset.state = state;
  button.style.setProperty("--pot-accent", pot.accent);
  button.style.setProperty("--pot-accent-rgb", pot.accentRgb);
  button.disabled = !unlocked;
  button.setAttribute("aria-label", `Pot ${pot.id}, ${pot.title}. ${state}. ${pot.description}`);
  button.innerHTML = `
    <span class="journey-route-link" aria-hidden="true"></span>
    ${current ? '<em class="journey-you-are-here">You are here</em>' : ""}
    ${createPotRenderMarkup(pot, progress)}
    <span class="journey-pot-copy">
      <strong>${pot.id}</strong>
      <small>${pot.title}</small>
      ${!unlocked ? `<em>Clear Pot ${pot.id - 1}</em>` : `<em>${pot.complete ? "Cleared" : `${Math.round(progress * 100)}% full`}</em>`}
    </span>
  `;
  if (unlocked) bindAction(button, onOpen);
  return button;
}

function createPotRenderMarkup(pot, progress, { large = false } = {}) {
  const stateClass = pot.complete ? "is-filled" : progress > 0 ? "is-progressed" : "";
  return `
    <span class="pixel-pot-render ${stateClass}${large ? " is-large" : ""}" style="--fill:${Math.max(5, progress * 100)}%;--pot-accent:${pot.accent};--pot-accent-rgb:${pot.accentRgb}">
      <i class="pixel-pot-lid"></i>
      <i class="pixel-pot-rim"></i>
      <i class="pixel-pot-body"></i>
      <i class="pixel-pot-fill"></i>
      <i class="pixel-pot-card card-one"></i>
      <i class="pixel-pot-card card-two"></i>
      <i class="pixel-pot-card card-three"></i>
      ${pot.complete ? '<b class="pixel-pot-check">&#10003;</b>' : ""}
    </span>
  `;
}

function renderCardFan(stage, cards, cardClass) {
  if (!stage) return;
  const nodes = cards.map((card, index) => {
    const element = createCardElement(card);
    element.classList.add(cardClass);
    element.style.setProperty("--fan-index", String(index));
    element.setAttribute("aria-hidden", "true");
    element.tabIndex = -1;
    return element;
  });
  stage.replaceChildren(...nodes);
}

function getCurrentPot(pots = []) {
  return pots.find((pot) => isPotUnlocked(pots, pot.id) && !pot.complete)
    ?? [...pots].reverse().find((pot) => isPotUnlocked(pots, pot.id))
    ?? pots[0];
}

function getPotProgress(pot) {
  return pot?.target > 0 ? Math.min(1, Math.max(0, Number(pot.progress) || 0) / pot.target) : 0;
}

function getTopLevelPage(pageName) {
  if (PLAY_CHILD_PAGES.has(pageName)) return "modes";
  if (PROFILE_CHILD_PAGES.has(pageName)) return "account";
  return TOP_LEVEL_TABS.includes(pageName) ? pageName : "modes";
}

function getPageScroller(page) {
  return page.querySelector(".store-scroll, .pot-scroll-region, .prep-scroll") ?? page;
}

function isSwipeExcluded(target) {
  return Boolean(target.closest("button, a, input, label, select, textarea, .store-tabs, .collection-deck-list, .card-collection-layout, .pot-scroll-region"));
}

function bindShellAction(element, action) {
  if (!element || typeof action !== "function") return;
  element.addEventListener("click", (event) => {
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    action(event);
  });
}
