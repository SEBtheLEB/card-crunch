import { createDeck } from "./deck.js?v=164";
import { formatCompactNumber } from "./format.js?v=164";
import { haptic } from "./haptics.js?v=164";
import { createCardElement } from "./ui.js?v=169";
import { applyPreviewCardSkinPresentation } from "./cardSkins.js?v=169";
import { animateCardDealIn } from "./cardGestures.js?v=173";
import { createCardCrunchInteraction } from "./crunchCutscene.js?v=173";

const SESSION_STORAGE_KEY = "cardCrunchMatchmakingSessionV1";
const DEFAULT_API_ORIGIN = "https://card-crunch.vercel.app";
const POLL_MS = 800;
const WAITING_SKINS = ["classic", "dark", "pink", "gold", "rainbow", "pink_arcade"];

export function initializeMultiplayer({ game, bindAction }) {
  const controller = new MultiplayerController({ game });
  bindAction(controller.elements.onlineButton, () => controller.search());
  bindAction(controller.elements.cancelButton, () => controller.cancelSearch());
  bindAction(controller.elements.rematchButton, () => controller.rematch());
  bindAction(controller.elements.homeButton, () => controller.returnHome());
  controller.elements.waitingCardStage?.addEventListener("pointerdown", () => controller.hitWaitingCard());
  window.addEventListener("pagehide", () => controller.leaveSilently());
  window.addEventListener("beforeunload", () => controller.leaveSilently());
  return controller;
}

class MultiplayerController {
  constructor({ game }) {
    this.game = game;
    this.elements = {
      onlineButton: document.querySelector("#onlineDuelButton"),
      screen: document.querySelector("#matchmakingScreen"),
      status: document.querySelector("#matchmakingStatus"),
      elapsed: document.querySelector("#matchmakingElapsed"),
      cancelButton: document.querySelector("#matchmakingCancelButton"),
      waitingCardStage: document.querySelector("#matchmakingCardStage"),
      vacuumTarget: document.querySelector("#matchmakingVacuumTarget"),
      waitingHint: document.querySelector("#matchmakingCardHint"),
      versus: document.querySelector("#matchmakingVersus"),
      youName: document.querySelector("#matchmakingYouName"),
      opponentName: document.querySelector("#matchmakingOpponentName"),
      countdown: document.querySelector("#matchmakingCountdown"),
      resultScreen: document.querySelector("#multiplayerResultScreen"),
      resultKicker: document.querySelector("#multiplayerResultKicker"),
      resultTitle: document.querySelector("#multiplayerResultTitle"),
      yourScore: document.querySelector("#multiplayerYourScore"),
      opponentScore: document.querySelector("#multiplayerOpponentScore"),
      resultOpponentName: document.querySelector("#multiplayerResultOpponentName"),
      rematchButton: document.querySelector("#multiplayerRematchButton"),
      homeButton: document.querySelector("#multiplayerHomeButton")
    };
    this.session = readJson(SESSION_STORAGE_KEY, null);
    this.generation = 0;
    this.searchStartedAt = 0;
    this.pollTimer = 0;
    this.elapsedTimer = 0;
    this.clockFrame = 0;
    this.waitingCard = null;
    this.waitingCardHits = 0;
    this.waitingCardLocked = false;
    this.waitingCrunch = null;
    this.match = null;
    this.activeMatchId = "";
    this.serverOffsetMs = 0;
    this.resultPending = null;
    this.scoreRequest = Promise.resolve();
  }

  async search() {
    if (!this.elements.screen || this.elements.screen.classList.contains("is-visible")) return;
    const generation = ++this.generation;
    this.match = null;
    this.activeMatchId = "";
    this.resultPending = null;
    this.searchStartedAt = Date.now();
    this.showWaitingScreen();
    this.dealWaitingCard();
    this.updateElapsed(generation);

    try {
      const response = await this.requestWithSession("join", this.playerIdentity());
      if (generation !== this.generation) return;
      await this.handleServerResponse(response, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.showSearchError(error.message || "Online play could not connect.");
    }
  }

  async cancelSearch() {
    if (!this.elements.screen?.classList.contains("is-visible")) return;
    const generation = ++this.generation;
    this.clearTimers();
    this.elements.cancelButton.disabled = true;
    await this.send("leave").catch(() => {});
    if (generation !== this.generation) return;
    this.hideWaitingScreen();
    if (this.game.state?.gameMode === "onlineDuel") this.game.returnFromMultiplayer?.();
    this.elements.cancelButton.disabled = false;
  }

  async rematch() {
    this.elements.resultScreen?.classList.remove("is-visible");
    this.elements.resultScreen?.setAttribute("aria-hidden", "true");
    await this.search();
  }

  returnHome() {
    ++this.generation;
    this.clearTimers();
    this.elements.resultScreen?.classList.remove("is-visible");
    this.elements.resultScreen?.setAttribute("aria-hidden", "true");
    this.game.returnFromMultiplayer?.();
  }

  leaveSilently() {
    if (!this.session) return;
    const endpoint = getMatchmakingEndpoint();
    const body = JSON.stringify({ action: "leave", ...this.session });
    try { navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" })); } catch {}
  }

  showWaitingScreen() {
    this.elements.screen.classList.add("is-visible");
    this.elements.screen.setAttribute("aria-hidden", "false");
    this.elements.screen.classList.remove("match-found", "match-error");
    this.elements.versus.hidden = true;
    this.elements.waitingCardStage.hidden = false;
    this.elements.status.textContent = "Searching for an opponent";
    this.elements.waitingHint.textContent = "Tap the card three times while you wait";
    this.elements.cancelButton.textContent = "Cancel Search";
    this.elements.cancelButton.disabled = false;
  }

  hideWaitingScreen() {
    this.elements.screen.classList.remove("is-visible", "match-found", "match-error");
    this.elements.screen.setAttribute("aria-hidden", "true");
    this.cleanupWaitingCard();
    this.elements.waitingCardStage.replaceChildren();
    this.waitingCard = null;
  }

  showSearchError(message) {
    this.clearTimers();
    this.elements.screen.classList.add("match-error");
    this.elements.status.textContent = message;
    this.elements.elapsed.textContent = "Please try again in a moment.";
    this.elements.waitingHint.textContent = "Your game and collection are safe.";
    this.elements.cancelButton.textContent = "Back Home";
  }

  updateElapsed(generation) {
    if (generation !== this.generation || !this.elements.screen.classList.contains("is-visible")) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - this.searchStartedAt) / 1000));
    this.elements.elapsed.textContent = `${elapsed}s in queue`;
    this.elapsedTimer = window.setTimeout(() => this.updateElapsed(generation), 1000);
  }

  dealWaitingCard() {
    if (!this.elements.waitingCardStage || !this.elements.screen.classList.contains("is-visible")) return;
    this.cleanupWaitingCard();
    this.waitingCardHits = 0;
    this.waitingCardLocked = false;
    const deck = createDeck();
    const card = deck[Math.floor(Math.random() * deck.length)];
    const skinId = nextWaitingSkin(this.waitingCard?.dataset.previewSkin);
    const element = createCardElement(card, { isButton: false });
    element.classList.add("matchmaking-card", "card-deal-pending");
    element.dataset.previewSkin = skinId;
    applyPreviewCardSkinPresentation(element, card, skinId);
    element.setAttribute("aria-hidden", "true");
    this.elements.waitingCardStage.replaceChildren(element);
    this.waitingCard = element;
    animateCardDealIn(element, 0, { zone: "table", fromSide: "left" });
  }

  prepareWaitingCrunch(element = this.waitingCard) {
    if (!element?.isConnected || element !== this.waitingCard) return null;
    this.waitingCrunch = createCardCrunchInteraction({
      stage: this.elements.waitingCardStage,
      cards: [element],
      targetEl: this.elements.vacuumTarget,
      onComplete: () => {
        if (this.elements.screen.classList.contains("is-visible") && this.elements.versus.hidden) this.dealWaitingCard();
      }
    });
    return this.waitingCrunch;
  }

  hitWaitingCard() {
    if (!this.waitingCard || this.waitingCardLocked || this.elements.versus.hidden === false) return;
    if (!this.waitingCrunch) this.prepareWaitingCrunch();
    if (!this.waitingCrunch) return;
    const result = this.waitingCrunch.hit();
    this.waitingCardHits = result.hit;
    this.waitingCardLocked = result.complete;
    this.elements.waitingHint.textContent = result.complete
      ? "CRUNCHED! Dealing another card..."
      : `Crunch again ${result.hit}/3`;
    haptic(result.complete ? "crunch" : "tap");
  }

  cleanupWaitingCard() {
    this.waitingCrunch?.destroy?.();
    this.waitingCrunch = null;
    this.waitingCardLocked = false;
  }

  async handleServerResponse(response, generation) {
    if (generation !== this.generation) return;
    this.updateClockOffset(response.serverNow);
    if (response.session) {
      this.session = response.session;
      writeJson(SESSION_STORAGE_KEY, this.session);
    }
    if (response.state === "waiting") {
      this.schedulePoll(generation);
      return;
    }
    if (response.match) await this.handleMatch(response.match, generation);
  }

  async handleMatch(match, generation) {
    this.match = match;
    if (match.status === "complete") {
      this.resultPending = match;
      const ready = this.game.finishMultiplayerMatch?.(match);
      if (ready !== false) this.showResult(match);
      return;
    }

    if (this.activeMatchId !== match.id) {
      this.activeMatchId = match.id;
      window.clearTimeout(this.elapsedTimer);
      this.elements.screen.classList.add("match-found");
      this.elements.versus.hidden = false;
      this.elements.waitingCardStage.hidden = true;
      this.elements.status.textContent = "Opponent found!";
      this.elements.youName.textContent = match.you.displayName;
      this.elements.opponentName.textContent = match.opponent.displayName;
      playGameSfx("target_clear");
      haptic("score");
      this.game.startMultiplayerMatch?.({
        match,
        serverOffsetMs: this.serverOffsetMs,
        onScorePreview: (score) => this.reportScore(score),
        onScoreChange: (score) => this.reportScore(score),
        onForfeit: () => this.forfeit(),
        onResultReady: () => this.showResult(this.resultPending || this.match)
      });
      this.startMatchClock(generation);
    } else {
      this.game.updateMultiplayerOpponent?.(match.opponent);
    }
    this.schedulePoll(generation);
  }

  schedulePoll(generation) {
    window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(async () => {
      if (generation !== this.generation) return;
      try {
        const response = await this.send("poll", this.playerIdentity());
        if (generation !== this.generation) return;
        await this.handleServerResponse(response, generation);
      } catch (error) {
        if (generation !== this.generation) return;
        this.elements.status.textContent = "Reconnecting...";
        this.schedulePoll(generation);
      }
    }, POLL_MS);
  }

  startMatchClock(generation) {
    const tick = () => {
      if (generation !== this.generation || !this.match) return;
      const serverNow = Date.now() + this.serverOffsetMs;
      const untilStart = this.match.startsAt - serverNow;
      if (untilStart > 0) {
        const count = Math.max(1, Math.ceil(untilStart / 1000));
        this.elements.countdown.textContent = String(count);
        this.game.updateMultiplayerClock?.(60);
      } else {
        if (this.elements.screen.classList.contains("is-visible")) {
          this.elements.countdown.textContent = "GO!";
          window.setTimeout(() => this.hideWaitingScreen(), 220);
        }
        const remaining = Math.max(0, (this.match.endsAt - serverNow) / 1000);
        this.game.updateMultiplayerClock?.(remaining);
        if (remaining <= 0) {
          this.game.finishMultiplayerMatch?.(this.match);
          void this.reportScore(this.game.state.score, { immediate: true });
          return;
        }
      }
      this.clockFrame = window.requestAnimationFrame(tick);
    };
    this.clockFrame = window.requestAnimationFrame(tick);
  }

  reportScore(score, { immediate = false } = {}) {
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    this.scoreRequest = this.scoreRequest
      .catch(() => {})
      .then(() => this.send("score", { score: safeScore }))
      .then((response) => {
        if (response?.match) {
          this.match = response.match;
          this.game.updateMultiplayerOpponent?.(response.match.opponent);
          if (response.match.status === "complete") {
            this.resultPending = response.match;
            const ready = this.game.finishMultiplayerMatch?.(response.match);
            if (ready !== false) this.showResult(response.match);
          }
        }
      });
    if (immediate) return this.scoreRequest;
    return undefined;
  }

  async forfeit() {
    ++this.generation;
    this.clearTimers();
    const response = await this.send("leave").catch(() => null);
    if (response?.match) this.showResult(response.match);
    else this.returnHome();
  }

  showResult(match) {
    if (!match || this.elements.resultScreen.classList.contains("is-visible")) return;
    this.clearTimers();
    this.hideWaitingScreen();
    const won = match.winner === "you";
    const draw = match.winner === "draw";
    this.elements.resultKicker.textContent = draw ? "Dead Heat" : won ? "Winner" : "Match Complete";
    this.elements.resultTitle.textContent = draw ? "DRAW!" : won ? "YOU WIN!" : "RIVAL WINS";
    this.elements.resultTitle.dataset.result = draw ? "draw" : won ? "win" : "loss";
    this.elements.yourScore.textContent = formatCompactNumber(match.you.score);
    this.elements.opponentScore.textContent = formatCompactNumber(match.opponent.score);
    this.elements.resultOpponentName.textContent = match.opponent.displayName;
    this.elements.resultScreen.classList.add("is-visible");
    this.elements.resultScreen.setAttribute("aria-hidden", "false");
    playGameSfx(won ? "level_clear" : draw ? "score_arrive" : "game_over");
    haptic(won ? "score" : "tap");
  }

  updateClockOffset(serverNow) {
    if (!Number.isFinite(Number(serverNow))) return;
    this.serverOffsetMs = Number(serverNow) - Date.now();
  }

  playerIdentity() {
    const account = readJson("stl_account_session_v1", null);
    const user = account?.user || {};
    const displayName = user.displayName || user.display_name || user.email?.split("@")[0] || getGuestName();
    return {
      displayName,
      skinId: document.documentElement.dataset.cardSkin || "classic"
    };
  }

  async requestWithSession(action, extra = {}) {
    try {
      return await this.send(action, extra);
    } catch (error) {
      if (error.code !== "session_expired" && error.code !== "session_missing") throw error;
      this.session = null;
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return this.send(action, extra);
    }
  }

  async send(action, extra = {}) {
    const response = await fetch(getMatchmakingEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action, ...(this.session || {}), ...extra })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || "Online play could not connect.");
      error.code = payload.code || "network_error";
      throw error;
    }
    return payload;
  }

  clearTimers() {
    window.clearTimeout(this.pollTimer);
    window.clearTimeout(this.elapsedTimer);
    window.cancelAnimationFrame(this.clockFrame);
    this.pollTimer = 0;
    this.elapsedTimer = 0;
    this.clockFrame = 0;
  }
}

function getMatchmakingEndpoint() {
  const isNative = globalThis.Capacitor?.isNativePlatform?.() || location.protocol === "capacitor:";
  if (isNative) return `${DEFAULT_API_ORIGIN}/api/matchmaking`;
  if (location.protocol === "http:" || location.protocol === "https:") return new URL("/api/matchmaking", location.href).href;
  return `${DEFAULT_API_ORIGIN}/api/matchmaking`;
}

function getGuestName() {
  let name = localStorage.getItem("cardCrunchGuestName");
  if (name) return name;
  name = `Player ${Math.floor(1000 + Math.random() * 9000)}`;
  localStorage.setItem("cardCrunchGuestName", name);
  return name;
}

function nextWaitingSkin(previous = "") {
  const choices = WAITING_SKINS.filter((skin) => skin !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
