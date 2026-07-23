import { createDeck } from "./deck.js?v=164";
import { formatCompactNumber } from "./format.js?v=164";
import { haptic } from "./haptics.js?v=164";
import { playGameSfx } from "./audio.js?v=164";
import { createCardElement } from "./ui.js?v=169";
import { applyPreviewCardSkinPresentation } from "./cardSkins.js?v=169";
import { animateCardDealIn } from "./cardGestures.js?v=175";
import { createCardCrunchInteraction } from "./crunchCutscene.js?v=188";
import { CardCrunchRealtimeTransport } from "./realtimeMultiplayer.js?v=177";
import { createBotDuelMatch, settleBotDuelMatch } from "./multiplayerBot.js?v=187";

const SESSION_STORAGE_KEY = "cardCrunchMatchmakingSessionV1";
const BOT_RATING_STORAGE_KEY = "cardCrunchBotDuelRatingV1";
const DEFAULT_API_ORIGIN = "https://card-crunch.vercel.app";
const POLL_MS = 800;
const WAITING_SKINS = ["classic", "dark", "pink", "gold", "rainbow", "pink_arcade"];

export function initializeMultiplayer({ game, bindAction }) {
  const controller = new MultiplayerController({ game });
  bindAction(controller.elements.onlineButton, () => controller.search());
  bindAction(controller.elements.botButton, () => controller.startBotMatch());
  bindAction(controller.elements.cancelButton, () => controller.cancelSearch());
  bindAction(controller.elements.rematchButton, () => controller.rematch());
  bindAction(controller.elements.homeButton, () => controller.returnHome());
  controller.elements.screen?.addEventListener("pointerdown", (event) => {
    if (event.target?.closest?.("button")) return;
    controller.hitWaitingCard();
  });
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
      botButton: document.querySelector("#matchmakingBotButton"),
      cancelButton: document.querySelector("#matchmakingCancelButton"),
      waitingCardStage: document.querySelector("#matchmakingCardStage"),
      vacuumTarget: document.querySelector("#matchmakingVacuumTarget"),
      versus: document.querySelector("#matchmakingVersus"),
      youName: document.querySelector("#matchmakingYouName"),
      opponentName: document.querySelector("#matchmakingOpponentName"),
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
    this.botBrain = null;
    this.botRating = readBotRating();
    this.transportMode = "";
    this.realtime = new CardCrunchRealtimeTransport({
      onMessage: (payload) => this.handleRealtimeMessage(payload),
      onConnectionState: (status) => this.handleRealtimeConnectionState(status)
    });
  }

  async search() {
    if (!this.elements.screen || this.elements.screen.classList.contains("is-visible")) return;
    const generation = ++this.generation;
    this.match = null;
    this.activeMatchId = "";
    this.resultPending = null;
    this.transportMode = "";
    this.botBrain = null;
    this.searchStartedAt = Date.now();
    this.showWaitingScreen();
    this.dealWaitingCard();
    this.updateElapsed(generation);

    if (this.realtime.configured) {
      try {
        this.transportMode = "realtime";
        await this.realtime.start(this.playerIdentity());
        if (generation !== this.generation) this.realtime.close();
        return;
      } catch (error) {
        this.realtime.close();
        this.transportMode = "";
        if (generation !== this.generation) return;
        this.elements.status.textContent = "Connecting through backup network...";
      }
    }

    try {
      this.transportMode = "http";
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
    this.botBrain = null;
    this.elements.cancelButton.disabled = true;
    if (this.transportMode === "realtime") this.realtime.leave();
    else await this.send("leave").catch(() => {});
    if (generation !== this.generation) return;
    this.hideWaitingScreen();
    if (this.game.state?.gameMode === "onlineDuel") this.game.returnFromMultiplayer?.();
    this.elements.cancelButton.disabled = false;
  }

  startBotMatch() {
    if (!this.elements.screen?.classList.contains("is-visible") || this.elements.botButton?.disabled) return;
    const generation = ++this.generation;
    this.clearTimers();
    this.elements.botButton.disabled = true;
    this.elements.cancelButton.disabled = true;
    this.elements.status.textContent = "House Bot ready!";
    this.elements.elapsed.textContent = "Starting an instant 60-second duel";

    if (this.transportMode === "realtime") {
      this.realtime.leave();
      this.realtime.close();
    } else if (this.transportMode === "http") {
      void this.send("leave").catch(() => {});
    }

    const identity = this.playerIdentity();
    const localBot = createBotDuelMatch({
      player: identity,
      rating: this.botRating,
      seed: `${identity.displayName}-${Date.now()}-${Math.random()}`
    });
    this.transportMode = "bot";
    this.botBrain = localBot.brain;
    void this.handleMatch(localBot.match, generation);
  }

  async rematch() {
    this.elements.resultScreen?.classList.remove("is-visible");
    this.elements.resultScreen?.setAttribute("aria-hidden", "true");
    await this.search();
  }

  returnHome() {
    ++this.generation;
    this.clearTimers();
    this.realtime.close();
    this.botBrain = null;
    this.elements.resultScreen?.classList.remove("is-visible");
    this.elements.resultScreen?.setAttribute("aria-hidden", "true");
    this.game.returnFromMultiplayer?.();
  }

  leaveSilently() {
    if (this.transportMode === "bot") return;
    if (this.transportMode === "realtime") {
      this.realtime.leave();
      return;
    }
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
    this.elements.botButton.disabled = false;
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

  async handleRealtimeMessage(payload) {
    const generation = this.generation;
    if (!payload || this.transportMode !== "realtime") return;
    this.updateClockOffset(payload.serverNow);
    if (payload.type === "waiting") return;
    if (payload.match) await this.handleMatch(payload.match, generation);
  }

  handleRealtimeConnectionState(status) {
    if (this.transportMode !== "realtime") return;
    if (status === "reconnecting") this.elements.status.textContent = "Reconnecting...";
    if (status === "failed") this.elements.status.textContent = "Connection lost. Return home and try again.";
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
      this.hideWaitingScreen();
      this.startMatchClock(generation);
    } else {
      this.game.updateMultiplayerOpponent?.(match.opponent);
    }
    if (this.transportMode === "http") this.schedulePoll(generation);
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
        this.game.updateMultiplayerClock?.(60);
      } else {
        const remaining = Math.max(0, (this.match.endsAt - serverNow) / 1000);
        if (this.transportMode === "bot") this.updateBotProgress(serverNow);
        this.game.updateMultiplayerClock?.(remaining);
        if (remaining <= 0) {
          if (this.transportMode === "bot") {
            this.finishBotMatch();
            return;
          }
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
    if (this.transportMode === "bot") {
      if (this.match) this.match.you = { ...this.match.you, score: safeScore };
      return immediate ? Promise.resolve() : undefined;
    }
    if (this.transportMode === "realtime") {
      this.realtime.sendScore(safeScore);
      return immediate ? Promise.resolve() : undefined;
    }
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
    if (this.transportMode === "bot") {
      this.botBrain = null;
      this.returnHome();
      return;
    }
    if (this.transportMode === "realtime") {
      this.realtime.leave();
      this.returnHome();
      return;
    }
    const response = await this.send("leave").catch(() => null);
    if (response?.match) this.showResult(response.match);
    else this.returnHome();
  }

  showResult(match) {
    if (!match || this.elements.resultScreen.classList.contains("is-visible")) return;
    this.clearTimers();
    this.realtime.close();
    this.hideWaitingScreen();
    const won = match.winner === "you";
    const draw = match.winner === "draw";
    if (match.isBotMatch) {
      this.botRating = updateBotRating(this.botRating, won, draw);
      this.botBrain = null;
    }
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

  updateBotProgress(serverNow) {
    if (!this.botBrain || !this.match) return;
    const elapsed = Math.max(0, serverNow - this.match.startsAt);
    const snapshot = this.botBrain.advance(elapsed, this.game.state?.score || 0);
    if (!snapshot.changed) return;
    this.match.opponent = { ...this.match.opponent, score: snapshot.score };
    this.game.updateMultiplayerOpponent?.(this.match.opponent);
  }

  finishBotMatch() {
    if (!this.match || this.match.status === "complete") return;
    const finalBot = this.botBrain?.advance(this.match.endsAt - this.match.startsAt, this.game.state?.score || 0);
    const completeMatch = settleBotDuelMatch(
      this.match,
      this.game.state?.score || this.match.you?.score || 0,
      finalBot?.score || this.match.opponent?.score || 0
    );
    this.match = completeMatch;
    this.resultPending = completeMatch;
    this.game.updateMultiplayerOpponent?.(completeMatch.opponent);
    const ready = this.game.finishMultiplayerMatch?.(completeMatch);
    if (ready !== false) this.showResult(completeMatch);
  }

  playerIdentity() {
    const profile = globalThis.cardCrunchAuth?.user
      ? publicAuthProfile(globalThis.cardCrunchAuth.user)
      : readJson("cardCrunchAuthenticatedProfileV1", null) || {};
    const displayName = profile.displayName || profile.email?.split("@")[0] || getGuestName();
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

function publicAuthProfile(user) {
  const metadata = user?.user_metadata || {};
  return {
    displayName: metadata.full_name || metadata.name || "",
    email: user?.email || ""
  };
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

function readBotRating() {
  try {
    return Math.min(1.22, Math.max(.82, Number(localStorage.getItem(BOT_RATING_STORAGE_KEY)) || 1));
  } catch {
    return 1;
  }
}

function updateBotRating(current, won, draw) {
  const next = Math.min(1.22, Math.max(.82, current + (draw ? .005 : won ? .03 : -.018)));
  try { localStorage.setItem(BOT_RATING_STORAGE_KEY, next.toFixed(3)); } catch {}
  return next;
}
