import { createCardElement } from "./ui.js?v=196";
import { formatCompactNumber } from "./format.js?v=164";
import { isPotUnlocked } from "./progression.js?v=196";
import {
  getCardCollectionSnapshot,
  getCollectionProgress,
  subscribeToCardCollection
} from "./cardCollection.js?v=167";
import { CARD_SKINS } from "./cardSkins.js?v=169";
import { playGameSfx } from "./audio.js?v=164";
import { haptic } from "./haptics.js?v=164";
import { boosterInventory } from "./boosters.js?v=201";
import { liveEvents } from "./liveEvents.js?v=201";
import { calculateRunCoinReward } from "./economy.js?v=166";
import { animateEntrance, prefersReducedMotion } from "./motion.js";

const TOP_LEVEL_TABS = ["shop", "themes", "modes", "events", "account"];
const PLAY_CHILD_PAGES = new Set(["modes", "pots", "pot-prep"]);
const PROFILE_CHILD_PAGES = new Set(["account", "settings", "leaderboard"]);
const BUILD_CONFIG = globalThis.__CARD_CRUNCH_BUILD_CONFIG__ ?? {};
const RELEASE_POTS_ONLY = BUILD_CONFIG.potsOnly === true;
const PLAY_LANDING_PAGE = RELEASE_POTS_ONLY ? "pots" : "modes";
const DOCK_CARDS = Object.freeze([
  { id: "dock-9h", rank: "9", value: 9, suit: "hearts", suitSymbol: "\u2665", color: "red" },
  { id: "dock-as", rank: "A", value: 1, suit: "spades", suitSymbol: "\u2660", color: "black" },
  { id: "dock-4d", rank: "4", value: 4, suit: "diamonds", suitSymbol: "\u2666", color: "red" }
]);

export function initializeAppShell({ ui, game, bindAction }) {
  const root = ui.elements.startScreen;
  const refs = collectShellElements(root);
  const originalShowMenuPage = ui.showMenuPage.bind(ui);
  root.classList.toggle("release-pots-only", RELEASE_POTS_ONLY);
  root.dataset.buildFlavor = RELEASE_POTS_ONLY ? "release" : "development";
  const state = {
    activePage: PLAY_LANDING_PAGE,
    activeTopLevel: "modes",
    selectedPot: null,
    pots: game.state.pots,
    handlers: null,
    journeyHasCentered: false,
    tabScroll: new Map(),
    sheetReturnFocus: null,
    selectedBoosters: new Set()
  };
  let sheetCloseTimer = null;
  let sheetFrame = null;
  let pageAnimation = null;

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
  boosterInventory.subscribe(() => {
    renderPreparationBoosters();
    renderEvents();
  });
  liveEvents.subscribe(() => {
    renderEvents();
    refreshPlayHubEvent();
    game.refreshEconomy();
  });

  function showPage(requestedPage = "modes") {
    const requestedLanding = requestedPage === "home" ? PLAY_LANDING_PAGE : requestedPage;
    const pageName = RELEASE_POTS_ONLY && (requestedLanding === "modes" || requestedLanding === "pot-prep")
      ? "pots"
      : requestedLanding;
    const previousPage = state.activePage;
    const previousTop = state.activeTopLevel;
    const nextTop = getTopLevelPage(pageName);
    const nextPage = [...refs.pages.querySelectorAll(".menu-page")].find((page) => page.dataset.page === pageName);
    if (!nextPage) return;
    pageAnimation?.cancel();

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
    if (pageName === "events") renderEvents();
    if (previousPage !== pageName) {
      const direction = previousTop === nextTop ? (pageName === "pots" || pageName === "pot-prep" ? 1 : -1)
        : Math.sign(TOP_LEVEL_TABS.indexOf(nextTop) - TOP_LEVEL_TABS.indexOf(previousTop));
      pageAnimation = animateEntrance(nextPage, { direction });
      if (!document.documentElement.classList.contains("launch-auth-active")) {
        const heading = nextPage.querySelector("h2, .journey-page-header strong, .prep-page-header strong");
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    }
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
    window.clearTimeout(sheetCloseTimer);
    if (sheetFrame) cancelAnimationFrame(sheetFrame);
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
    refs.sheetTargetLabel.textContent = RELEASE_POTS_ONLY ? "Still Needed" : "Fill Target";
    refs.sheetProgressLabel.textContent = RELEASE_POTS_ONLY ? "In This Pot" : "Best Score";
    refs.sheetTarget.textContent = formatCompactNumber(
      RELEASE_POTS_ONLY ? Math.max(0, pot.target - (pot.progress ?? 0)) : pot.target
    );
    refs.sheetBest.textContent = formatCompactNumber(
      RELEASE_POTS_ONLY ? pot.progress ?? 0 : Math.max(pot.progress ?? 0, game.state.bestScore ?? 0)
    );
    refs.sheetCoinReward.textContent = formatCompactNumber(calculateRunCoinReward({ potCleared: true }).clearBonus);
    refs.sheetPlayButton.textContent = `${pot.complete ? "Replay" : pot.progress > 0 ? "Continue" : "Play"} Pot ${pot.id}`;
    refs.sheetRender.innerHTML = createPotRenderMarkup(pot, progress, { large: true });
    refs.sheet.hidden = false;
    refs.sheet.setAttribute("aria-hidden", "false");
    sheetFrame = requestAnimationFrame(() => {
      sheetFrame = null;
      refs.sheet.classList.add("is-visible");
      refs.sheetClose.focus({ preventScroll: true });
    });
  }

  function closePotSheet({ immediate = false, restoreFocus = true } = {}) {
    window.clearTimeout(sheetCloseTimer);
    if (sheetFrame) cancelAnimationFrame(sheetFrame);
    sheetFrame = null;
    if (refs.sheet.hidden) return;
    refs.sheet.classList.remove("is-visible");
    refs.sheet.setAttribute("aria-hidden", "true");
    const finish = () => {
      refs.sheet.hidden = true;
      if (restoreFocus) state.sheetReturnFocus?.focus?.({ preventScroll: true });
      state.sheetReturnFocus = null;
    };
    if (immediate || prefersReducedMotion()) finish();
    else sheetCloseTimer = window.setTimeout(finish, 220);
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
    state.selectedBoosters.clear();
    renderPreparationBoosters();
    refreshPreparationDeck();
    showPage("pot-prep");
  }

  function launchPreparedPot() {
    if (!state.selectedPot) return;
    const boosters = [...state.selectedBoosters];
    if (boosters.length > 0 && !boosterInventory.consume(boosters)) {
      renderPreparationBoosters();
      refs.prepBoosterNote.textContent = "A selected booster is no longer available.";
      return;
    }
    game.enterLevel(state.selectedPot.id, { boosters });
  }

  function launchReleasePot() {
    if (!state.selectedPot) return;
    const potId = state.selectedPot.id;
    closePotSheet({ immediate: true, restoreFocus: false });
    state.selectedBoosters.clear();
    game.enterLevel(potId, { boosters: [] });
  }

  function refreshPlayHub() {
    const pot = getCurrentPot(game.state.pots);
    if (!pot) return;
    const progress = getPotProgress(pot);
    refs.hubChapter.textContent = `Pot ${pot.id}`;
    refs.hubPotNumber.textContent = String(pot.id);
    refs.hubPotTitle.textContent = pot.title;
    refs.hubModifier.textContent = pot.ruleLabel;
    refs.hubModifier.hidden = !pot.ruleLabel || /^standard rules$/i.test(pot.ruleLabel);
    refs.hubProgressLabel.textContent = `${Math.round(progress * 100)}%`;
    refs.hubBestScore.textContent = `${formatCompactNumber(pot.progress ?? 0)} / ${formatCompactNumber(pot.target)}`;
    refs.hubProgressFill.style.width = `${progress * 100}%`;
    refs.hubPotFill.style.height = `${Math.max(10, progress * 100)}%`;
    applySpriteCell(refs.hubPotSprite, getPotSpriteCell(pot, { current: true }));
    refs.hubContinueLabel.textContent = pot.progress > 0 ? "Continue" : "Play";
    refreshPlayHubEvent();
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
    bindShellAction(refs.sheetPlayButton, RELEASE_POTS_ONLY ? launchReleasePot : openPreparation);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !refs.sheet.hidden) closePotSheet();
    });
  }

  function bindPreparation() {
    bindShellAction(refs.prepPlayButton, launchPreparedPot);
    refs.prepBoosters.forEach((button) => {
      bindShellAction(button, () => {
        const id = button.dataset.boosterId;
        const inventory = boosterInventory.getSnapshot().inventory[id] ?? 0;
        if (inventory <= 0) {
          if (!boosterInventory.purchase(id)) {
            refs.prepBoosterNote.textContent = "Not enough coins for that booster.";
            haptic("error");
            return;
          }
          refs.prepBoosterNote.textContent = `${button.querySelector("strong")?.textContent ?? "Booster"} added to inventory.`;
          playGameSfx("score_arrive");
          game.refreshEconomy();
        }
        if (state.selectedBoosters.has(id)) state.selectedBoosters.delete(id);
        else state.selectedBoosters.add(id);
        renderPreparationBoosters();
      });
    });
  }

  function renderPreparationBoosters() {
    const snapshot = boosterInventory.getSnapshot();
    refs.prepBoosters.forEach((button) => {
      const id = button.dataset.boosterId;
      const definition = snapshot.definitions[id];
      const count = snapshot.inventory[id] ?? 0;
      const selected = state.selectedBoosters.has(id) && count > 0;
      if (count <= 0) state.selectedBoosters.delete(id);
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-empty", count <= 0);
      const inventoryLabel = button.querySelector("em");
      if (inventoryLabel) inventoryLabel.textContent = count > 0 ? `Owned ${count}` : `${definition.coinPrice} coins`;
    });
    const selectedCount = state.selectedBoosters.size;
    refs.prepBoosterNote.textContent = selectedCount
      ? `${selectedCount} booster${selectedCount === 1 ? "" : "s"} armed for this run.`
      : "Selected boosters are consumed when the run begins.";
  }

  function refreshPlayHubEvent() {
    const daily = liveEvents.getSnapshot().daily;
    if (!daily) return;
    refs.playHubEventTitle.textContent = daily.description;
    refs.playHubEventReward.textContent = daily.claimed
      ? "Claimed"
      : `+${formatCompactNumber(daily.reward.coins ?? 0)} coins`;
  }

  function renderEvents() {
    const snapshot = liveEvents.getSnapshot();
    refs.eventsResetBadge.textContent = `Resets ${formatRemaining(snapshot.daily.expiresAt - Date.now())}`;
    refs.eventsFeatureList.replaceChildren();
    snapshot.challenges.forEach((challenge) => {
      const article = document.createElement("article");
      const complete = challenge.progress >= challenge.target;
      article.className = `event-feature-card event-${challenge.cadence}-card${complete ? " is-complete" : ""}${challenge.claimed ? " is-claimed" : ""}`;
      const rewardParts = [`${formatCompactNumber(challenge.reward.coins ?? 0)} coins`];
      if (challenge.reward.booster) rewardParts.push("+ Booster");
      article.innerHTML = `
        <span class="event-card-icon" aria-hidden="true"><i class="shell-ui-sprite ${getEventSpriteClass(challenge)}"></i></span>
        <div><small>${getCadenceLabel(challenge.cadence)}</small><h3>${challenge.title}</h3><p>${challenge.description}</p></div>
        <span class="event-card-progress"><i><b style="width:${Math.min(100, challenge.progress / challenge.target * 100)}%"></b></i><em>${formatCompactNumber(challenge.progress)} / ${formatCompactNumber(challenge.target)}</em></span>
        <strong class="event-reward">${rewardParts.join(" ")}</strong>
      `;
      if (challenge.claimed) {
        const status = document.createElement("span");
        status.className = "event-status-chip";
        status.textContent = "Claimed";
        article.appendChild(status);
      } else {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = complete ? "Claim" : "Play";
        action.className = complete ? "event-claim-button" : "";
        bindShellAction(action, () => {
          if (!complete) {
            showPage("modes");
            return;
          }
          const reward = liveEvents.claim(challenge.id);
          if (!reward) return;
          playGameSfx("score_arrive");
          haptic("success");
          game.refreshEconomy();
          renderEvents();
        });
        article.appendChild(action);
      }
      refs.eventsFeatureList.appendChild(article);
    });
    refs.seasonLabel.textContent = `Season ${snapshot.season.id}`;
    refs.seasonLevel.textContent = `Level ${snapshot.season.level}`;
    refs.seasonProgressText.textContent = `${snapshot.season.xp} / ${snapshot.season.target}`;
    refs.seasonProgressFill.style.width = `${snapshot.season.xp / snapshot.season.target * 100}%`;
    refs.seasonRewardText.textContent = `Next level awards ${snapshot.season.nextRewardCoins} coins. Every fifth level adds a Crunch Bonus booster.`;
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
    refs.pages.addEventListener("pointercancel", () => { start = null; }, { passive: true });
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
      behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto"
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
    getPageScroller(page).scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
    root.querySelector("#profileShellBest").textContent = bestScore;
    root.querySelector("#profileShellStreak").textContent = bestStreak;
    root.querySelector("#profileShellPots").textContent = String(completed);
  }

  showPage(PLAY_LANDING_PAGE);
  return { showPage, renderJourney, refreshPlayHub, renderEvents };
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
    hubPotSprite: root.querySelector("#playHubPotSprite"),
    hubContinueLabel: root.querySelector("#playHubContinueLabel"),
    playHubEventTitle: root.querySelector("#playHubEventTitle"),
    playHubEventReward: root.querySelector("#playHubEventReward"),
    eventsResetBadge: root.querySelector("#eventsResetBadge"),
    eventsFeatureList: root.querySelector("#eventsFeatureList"),
    seasonLabel: root.querySelector("#seasonLabel"),
    seasonLevel: root.querySelector("#seasonLevel"),
    seasonProgressText: root.querySelector("#seasonProgressText"),
    seasonProgressFill: root.querySelector("#seasonProgressFill"),
    seasonRewardText: root.querySelector("#seasonRewardText"),
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
    sheetTargetLabel: root.querySelector("#potSheetTargetLabel"),
    sheetProgressLabel: root.querySelector("#potSheetProgressLabel"),
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
    prepBoosterNote: root.querySelector("#prepBoosterNote"),
    prepPlayButton: root.querySelector("#prepPlayButton")
  };
}

function getCadenceLabel(cadence) {
  if (cadence === "daily") return "Daily Challenge";
  if (cadence === "weekly") return "Weekly Run";
  return "Limited Event";
}

function formatRemaining(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
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
    ${createPotRenderMarkup(pot, progress, { spriteState: state })}
    <span class="journey-pot-copy">
      <strong>${pot.id}</strong>
      <small>${pot.title}</small>
      ${!unlocked ? `<em>Clear Pot ${pot.id - 1}</em>` : `<em>${pot.complete ? "Cleared" : `${Math.round(progress * 100)}% full`}</em>`}
    </span>
  `;
  if (unlocked) bindAction(button, onOpen);
  return button;
}

function createPotRenderMarkup(pot, progress, { large = false, spriteState = "" } = {}) {
  const stateClass = pot.complete ? "is-filled" : progress > 0 ? "is-progressed" : "";
  const sprite = getPotSpriteCell(pot, { spriteState });
  return `
    <span class="pixel-pot-render ${stateClass}${large ? " is-large" : ""}" style="--fill:${Math.max(5, progress * 100)}%;--pot-accent:${pot.accent};--pot-accent-rgb:${pot.accentRgb}">
      <i class="pot-ui-sprite" style="${getSpriteStyle(sprite)}"></i>
      ${pot.complete ? '<b class="pixel-pot-check">&#10003;</b>' : ""}
    </span>
  `;
}

function getPotSpriteCell(pot, { current = false, spriteState = "" } = {}) {
  if (!pot) return [0, 0];
  if (spriteState === "locked") return [1, 0];
  if (pot.complete) return [3, 0];
  const modifier = pot.gameplayModifier ?? {};
  const allowedSuits = modifier.allowedSuits ?? [];
  if (allowedSuits.includes("hearts")) return [0, 1];
  if (allowedSuits.includes("diamonds")) return [1, 1];
  if (allowedSuits.includes("clubs")) return [2, 1];
  if (allowedSuits.includes("spades")) return [3, 1];
  if (modifier.turnSeconds) return [0, 2];
  if (modifier.allowedMatchTypes?.some((type) => type === "add" || type === "subtract")) return [1, 2];
  if (modifier.allowedMatchTypes?.includes("sequence") || /straight|sequence|run/i.test(pot.title)) return [2, 2];
  if (modifier.minBankStreak || modifier.minimumBankCash || /bank|vault/i.test(pot.title)) return [3, 2];
  if (/jackpot/i.test(pot.title) || pot.chapter === "Jackpot Rules") return [0, 3];
  if (pot.id >= 55 || pot.chapter === "Master Tables") return [1, 3];
  if ((pot.progress ?? 0) > 0 || current) return [2, 0];
  return [0, 0];
}

function getEventSpriteClass(challenge) {
  if (challenge?.cadence === "daily") return "sprite-daily-calendar";
  if (challenge?.cadence === "weekly") return "sprite-season-crown";
  return "sprite-events-trophy";
}

function getSpriteStyle([column, row]) {
  return `--sprite-x:${column * 100 / 3}%;--sprite-y:${row * 100 / 3}%`;
}

function applySpriteCell(element, cell) {
  if (!element) return;
  const [column, row] = cell;
  element.style.setProperty("--sprite-x", `${column * 100 / 3}%`);
  element.style.setProperty("--sprite-y", `${row * 100 / 3}%`);
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
