import { formatCompactNumber } from "./format.js?v=164";
import {
  CARD_CRUNCH_STL_GAME_ID,
  getSTLPlatformDiagnostics,
  isAllowedCardCrunchCallback,
  readSTLPlatformConfig,
  shouldShowSTLDiagnostics,
  validateSTLPlatformConfig
} from "./stlPlatformConfig.js?v=190";
import { createCardCrunchSTLClient, getOrCreateDeviceId, STLClientError } from "./stlPlatformClient.js?v=190";
import {
  applyCloudSaveSnapshot,
  createCardCrunchSaveUpload,
  createLocalSaveSnapshot,
  detectSaveConflict,
  noteCloudUploadResult,
  readCloudMeta
} from "./stlCloudSave.js?v=189";

const PROFILE_KEY = "cardCrunchStlProfileV1";
const ACHIEVEMENT_DEDUPE_KEY = "cardCrunchStlAchievementReportsV1";
const SYNC_STATUS_KEY = "cardCrunchStlSyncStatusV1";
const HEARTBEAT_INTERVAL_MS = 30_000;
const SAVE_UPLOAD_DEBOUNCE_MS = 1400;

let integration = null;

export function initializeSTLPlatformAccount({ bindAction, showPage, game } = {}) {
  const elements = getElements();
  const config = readSTLPlatformConfig();
  renderDiagnostics(elements, getSTLPlatformDiagnostics(config));

  const api = {
    signIn: () => integration?.signIn(),
    signOut: () => integration?.signOut(),
    syncNow: () => integration?.syncCloudSave("manual"),
    getProfile: () => integration?.profile ?? null,
    getStatus: () => integration?.status ?? readStatus()
  };

  try {
    validateSTLPlatformConfig(config);
    integration = new STLPlatformIntegration({ config, game, elements, showPage });
    globalThis.cardCrunchSTL = api;
    bindAction?.(elements.google, () => integration.signIn());
    bindAction?.(elements.signOut, () => integration.signOut());
    bindAction?.(elements.sync, () => integration.syncCloudSave("manual"));
    void integration.boot();
  } catch (error) {
    setStatus(elements, toUserMessage(error), "bad");
    setBusy(elements, true);
    persistProfile(null);
    globalThis.cardCrunchSTL = api;
    if (isDevHost()) console.error("[Card Crunch STL]", error);
  }

  return api;
}

export function getSTLPlatform() {
  return integration;
}

export function notifySTLProgress(eventName, payload = {}) {
  integration?.handleGameEvent(eventName, payload);
}

class STLPlatformIntegration {
  constructor({ config, game, elements, showPage }) {
    this.config = config;
    this.client = createCardCrunchSTLClient(config);
    this.game = game;
    this.elements = elements;
    this.showPage = showPage;
    this.installDeviceId = null;
    this.deviceId = null;
    this.profile = readProfile();
    this.status = readStatus();
    this.playSession = null;
    this.heartbeatTimer = null;
    this.syncTimer = null;
    this.syncInFlight = false;
    this.achievementReports = readAchievementReports();
  }

  async boot() {
    setBusy(this.elements, true);
    renderProfile(this.elements, null);
    try {
      this.installDeviceId = await getOrCreateDeviceId();
      const session = await this.client.restoreSession();
      if (!session) {
        this.profile = null;
        persistProfile(null);
        renderProfile(this.elements, null);
        this.setStatus("Play as a guest, or continue with Google to save your progress.", "");
        setBusy(this.elements, false);
        return;
      }
      await this.afterSessionRestored(session);
    } catch (error) {
      this.setStatus(toUserMessage(error), "bad");
      this.profile = null;
      persistProfile(null);
      renderProfile(this.elements, null);
    } finally {
      setBusy(this.elements, false);
    }
  }

  async signIn() {
    setBusy(this.elements, true);
    this.setStatus("Opening secure Google sign-in…");
    try {
      const { authorizationUrl } = await this.client.beginSignIn();
      await openSystemBrowser(authorizationUrl);
    } catch (error) {
      this.setStatus(toUserMessage(error), "bad");
      setBusy(this.elements, false);
    }
  }

  async completeSignIn(callbackUrl) {
    setBusy(this.elements, true);
    try {
      const session = await this.client.completeSignIn(callbackUrl, {
        device: {
          deviceId: this.installDeviceId || await getOrCreateDeviceId(),
          friendlyName: getDeviceName()
        }
      });
      await this.afterSessionRestored(session);
      this.showPage?.("account");
    } catch (error) {
      this.setStatus(toUserMessage(error), "bad");
    } finally {
      setBusy(this.elements, false);
      await closeSystemBrowser();
    }
  }

  async afterSessionRestored(session) {
    this.deviceId = session.deviceId;
    await this.registerDevice();
    await this.refreshPlayer();
    await this.client.flushOfflineQueue().catch(() => null);
    await this.syncCloudSave("sign-in");
    this.setStatus(
      this.status.syncState === "synced"
        ? "Progress synced."
        : `Signed in. Progress sync is ${this.status.syncState}.`,
      "good"
    );
  }

  async signOut() {
    setBusy(this.elements, true);
    let remoteError = null;
    try {
      await this.endPlaySession("quit");
      try {
        await this.client.signOut();
      } catch (error) {
        remoteError = error;
      }
      this.profile = null;
      this.deviceId = null;
      persistProfile(null);
      this.setStatus(
        remoteError
          ? "Signed out on this device. We couldn’t confirm sign-out on other devices."
          : "Signed out on this device.",
        remoteError ? "bad" : ""
      );
      renderProfile(this.elements, null);
    } finally {
      setBusy(this.elements, false);
    }
  }

  async registerDevice() {
    await this.client.registerDevice({
      deviceId: this.deviceId,
      friendlyName: getDeviceName(),
      platform: getPlatformKind(),
      operatingSystem: navigator.userAgent.slice(0, 180),
      appVersion: getBuildVersion(),
      gameId: this.config.gameId
    }, { idempotencyKey: stableIdempotency("device", this.deviceId) }).catch((error) => {
      if (error?.code !== "OFFLINE_QUEUED") throw error;
    });
  }

  async refreshPlayer() {
    const player = await this.client.getCurrentPlayer();
    this.profile = {
      id: player.userId,
      displayName: player.displayName || "Card Crunch Player",
      username: player.username || "",
      avatarUrl: player.avatarUrl || ""
    };
    persistProfile(this.profile);
    renderProfile(this.elements, this.profile);
  }

  startPlaySession(mode = "pot") {
    if (this.playSession || !this.profile) return;
    const startedAt = new Date().toISOString();
    const offlineSessionId = `cc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.client.startPlaySession({
      gameId: this.config.gameId,
      deviceId: this.deviceId,
      platform: getPlatformKind(),
      gameBuild: getBuildVersion(),
      startedAt,
      offlineSessionId
    }, { idempotencyKey: stableIdempotency("play-start", offlineSessionId), queueWhenOffline: true })
      .then((session) => {
        this.playSession = { id: session.playSessionId, sequence: 0, mode, startedAt };
        this.installHeartbeat();
      })
      .catch((error) => this.noteSoftFailure(error));
  }

  installHeartbeat() {
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  async heartbeat() {
    if (!this.playSession) return;
    this.playSession.sequence += 1;
    await this.client.sendPlaySessionHeartbeat(this.playSession.id, {
      sequence: this.playSession.sequence,
      occurredAt: new Date().toISOString(),
      paused: document.hidden
    }, { idempotencyKey: stableIdempotency("heartbeat", this.playSession.id, this.playSession.sequence), queueWhenOffline: true })
      .catch((error) => this.noteSoftFailure(error));
  }

  async endPlaySession(reason = "normal") {
    window.clearInterval(this.heartbeatTimer);
    if (!this.playSession) return;
    const session = this.playSession;
    this.playSession = null;
    session.sequence += 1;
    await this.client.endPlaySession(session.id, {
      sequence: session.sequence,
      endedAt: new Date().toISOString(),
      reason
    }, { idempotencyKey: stableIdempotency("play-end", session.id), queueWhenOffline: true })
      .catch((error) => this.noteSoftFailure(error));
  }

  scheduleCloudSave(reason = "progress") {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.syncCloudSave(reason), SAVE_UPLOAD_DEBOUNCE_MS);
  }

  async syncCloudSave(reason = "progress") {
    if (this.syncInFlight || !this.profile) return;
    this.syncInFlight = true;
    try {
      const upload = await createCardCrunchSaveUpload({
        state: this.game?.state,
        gameId: this.config.gameId,
        deviceId: this.deviceId || await getOrCreateDeviceId(),
        gameBuild: getBuildVersion()
      });
      const result = await this.client.uploadCloudSave(upload, {
        idempotencyKey: stableIdempotency("save", upload.checksum),
        queueWhenOffline: true
      });
      noteCloudUploadResult(result);
      this.status = { syncState: "synced", lastSyncAt: new Date().toISOString(), reason, queued: await this.client.queueSize(), conflict: null };
      writeStatus(this.status);
      setSyncText(this.elements, this.status);
    } catch (error) {
      const conflict = error?.code === "SAVE_CONFLICT" || error?.code === "CONFLICT";
      this.status = {
        syncState: conflict ? "conflict" : error?.code === "OFFLINE_QUEUED" ? "queued" : "failed",
        lastSyncAt: readStatus().lastSyncAt || "",
        reason,
        queued: await this.client.queueSize().catch(() => 0),
        conflict: conflict ? detectSaveConflict({ localSnapshot: createLocalSaveSnapshot(this.game?.state), remoteVersion: error.details?.remoteVersion }) : null,
        message: toUserMessage(error)
      };
      writeStatus(this.status);
      setSyncText(this.elements, this.status);
    } finally {
      this.syncInFlight = false;
    }
  }

  handleGameEvent(eventName, payload = {}) {
    if (eventName === "run-start") this.startPlaySession(payload.mode);
    if (eventName === "run-end" || eventName === "run-exit") void this.endPlaySession(eventName === "run-exit" ? "quit" : "normal");
    if (["bank", "pot-clear", "run-end", "crunch"].includes(eventName)) this.scheduleCloudSave(eventName);
    this.reportAchievements(eventName, payload);
  }

  reportAchievements(eventName, payload) {
    const candidates = achievementsForEvent(eventName, payload, this.game?.state);
    for (const achievementKey of candidates) {
      const idempotencyKey = stableIdempotency("achievement", achievementKey);
      if (this.achievementReports.has(achievementKey)) continue;
      this.achievementReports.add(achievementKey);
      writeAchievementReports(this.achievementReports);
      this.client.unlockAchievement({
        gameId: this.config.gameId,
        achievementKey,
        occurredAt: new Date().toISOString(),
        evidence: sanitizeEvidence(payload)
      }, { idempotencyKey, queueWhenOffline: true }).catch((error) => this.noteSoftFailure(error));
    }

    const crunches = Number(localStorage.getItem("cardCrunchTotalCrunches")) || 0;
    if (crunches > 0) {
      this.client.updateAchievementProgress({
        gameId: this.config.gameId,
        achievementKey: "TOTAL_CRUNCHES_1000",
        progressValue: Math.min(1000, crunches),
        occurredAt: new Date().toISOString(),
        evidence: { source: "local-counter" }
      }, { idempotencyKey: stableIdempotency("achievement-progress", "TOTAL_CRUNCHES_1000", crunches), queueWhenOffline: true }).catch((error) => this.noteSoftFailure(error));
    }
  }

  noteSoftFailure(error) {
    if (isDevHost()) console.warn("[Card Crunch STL]", error);
  }

  setStatus(message, tone = "") {
    setStatus(this.elements, message, tone);
  }
}

export function installSTLCallbackListener() {
  const appPlugin = globalThis.Capacitor?.Plugins?.App;
  if (appPlugin?.addListener) {
    appPlugin.addListener("appUrlOpen", ({ url }) => {
      if (isAllowedCardCrunchCallback(url)) {
        void integration?.completeSignIn(url);
      }
    });
  }
}

function achievementsForEvent(eventName, payload, state = {}) {
  const achievements = [];
  if (eventName === "crunch") achievements.push("FIRST_CRUNCH");
  if (eventName === "bank") achievements.push("FIRST_BANK");
  if (eventName === "pot-clear") achievements.push("FIRST_POT_CLEAR");
  if (eventName === "crunch" && Number(payload.selectedCount) >= 4) achievements.push("FULL_HAND_CRUNCH");
  if (eventName === "crunch" && Number(state.streak) >= 5) achievements.push("STREAK_5");
  if (eventName === "crunch" && Number(state.score) >= 1_000_000) achievements.push("MILLION_RUN_CASH");
  return achievements;
}

function sanitizeEvidence(payload = {}) {
  return {
    selectedCount: Math.max(0, Number(payload.selectedCount) || 0),
    amount: Math.max(0, Number(payload.amount) || 0),
    mode: String(payload.mode || "").slice(0, 32)
  };
}

function getElements() {
  return {
    signedOut: document.querySelector("#cardCrunchAccountSignedOut"),
    signedIn: document.querySelector("#cardCrunchAccountSignedIn"),
    google: document.querySelector("#cardCrunchGoogleSignInButton"),
    signOut: document.querySelector("#cardCrunchSignOutButton"),
    sync: document.querySelector("#cardCrunchSyncButton"),
    status: document.querySelector("#cardCrunchAccountStatus"),
    avatar: document.querySelector("#cardCrunchAccountAvatar"),
    initials: document.querySelector("#cardCrunchAccountInitials"),
    name: document.querySelector("#cardCrunchAccountName"),
    email: document.querySelector("#cardCrunchAccountEmail"),
    diagnostics: document.querySelector("#authDiagnostics"),
    syncState: document.querySelector("#cardCrunchSyncState")
  };
}

function renderProfile(elements, profile) {
  const signedIn = Boolean(profile);
  elements.signedOut?.toggleAttribute("hidden", signedIn);
  elements.signedIn?.toggleAttribute("hidden", !signedIn);
  if (!signedIn) return;
  const displayName = profile.displayName || "Card Crunch Player";
  if (elements.name) elements.name.textContent = displayName;
  if (elements.email) elements.email.textContent = "Connected";
  if (elements.initials) elements.initials.textContent = initials(displayName);
  if (elements.avatar) {
    elements.avatar.hidden = !profile.avatarUrl;
    if (profile.avatarUrl) elements.avatar.src = profile.avatarUrl;
    else elements.avatar.removeAttribute("src");
  }
  setSyncText(elements, readStatus());
}

function renderDiagnostics(elements, diagnostics) {
  if (!elements.diagnostics || !shouldShowSTLDiagnostics()) return;
  elements.diagnostics.hidden = false;
  const values = {
    authDiagnosticOrigin: diagnostics.origin,
    authDiagnosticCallback: diagnostics.redirectUri,
    authDiagnosticProjectRef: diagnostics.clientId,
    authDiagnosticVariables: Object.entries(diagnostics.variables).map(([name, present]) => `${name}: ${present ? "present" : "missing"}`).join(" | ")
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = value;
  }
}

function setStatus(elements, message, tone = "") {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function setSyncText(elements, status) {
  if (!elements.syncState) return;
  const queued = status.queued ? ` • ${status.queued} queued` : "";
  const labels = {
    synced: "Progress synced",
    queued: "Progress will sync when you’re back online",
    conflict: "Choose which saved progress to keep",
    failed: "Progress sync needs another try"
  };
  elements.syncState.textContent = `${labels[status.syncState] || "Progress not synced"}${queued}`;
}

function setBusy(elements, busy) {
  [elements.google, elements.signOut, elements.sync].forEach((button) => {
    if (button) button.disabled = Boolean(busy);
  });
  const googleLabel = elements.google?.querySelector("span");
  if (googleLabel) {
    googleLabel.textContent = busy
      ? "Signing you in…"
      : elements.google.dataset.idleLabel || "Continue with Google";
  }
}

function persistProfile(profile) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {}
  globalThis.dispatchEvent?.(new CustomEvent("card-crunch-auth-change", { detail: { profile } }));
}

function readProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; }
}

function readStatus() {
  try { return JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || "null") || { syncState: "not synced" }; } catch { return { syncState: "not synced" }; }
}

function writeStatus(status) {
  try { localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status)); } catch {}
}

function readAchievementReports() {
  try { return new Set(JSON.parse(localStorage.getItem(ACHIEVEMENT_DEDUPE_KEY) || "[]")); } catch { return new Set(); }
}

function writeAchievementReports(reports) {
  try { localStorage.setItem(ACHIEVEMENT_DEDUPE_KEY, JSON.stringify([...reports])); } catch {}
}

function stableIdempotency(...parts) {
  return `cc:${parts.map((part) => String(part).replace(/[^a-z0-9_.:-]/gi, "_")).join(":")}`;
}

async function openSystemBrowser(url) {
  const browser = globalThis.Capacitor?.Plugins?.Browser;
  if (browser?.open) return browser.open({ url, presentationStyle: "popover" });
  window.location.assign(url);
}

async function closeSystemBrowser() {
  try { await globalThis.Capacitor?.Plugins?.Browser?.close?.(); } catch {}
}

function getPlatformKind() {
  if (globalThis.Capacitor?.getPlatform?.() === "android") return "android";
  if (globalThis.Capacitor?.getPlatform?.() === "ios") return "ios";
  return "web";
}

function getDeviceName() {
  return navigator.userAgentData?.platform || navigator.platform || "Card Crunch Device";
}

function getBuildVersion() {
  return document.querySelector('script[type="module"][src*="main.js"]')?.src?.match(/v=(\d+)/)?.[1] || "web-dev";
}

function toUserMessage(error) {
  if (error instanceof STLClientError) {
    if (error.code === "OFFLINE_QUEUED") return "You’re offline. Your progress will sync when you reconnect.";
    if (error.code === "SESSION_MISSING") return "Continue with Google to save and sync your progress.";
  }
  const message = String(error?.message || "");
  if (/cancel|denied|access_denied/i.test(message)) return "Sign-in was cancelled. Nothing was changed.";
  if (/already|conflict|linked to another/i.test(message)) return "This sign-in is already connected to another account.";
  if (/network|fetch|offline|connect|unavailable|timeout/i.test(message)) {
    return "We couldn’t connect right now. Check your connection and try again.";
  }
  return "We couldn’t sign you in. Please try again.";
}

function initials(value) {
  return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CC";
}

function isDevHost() {
  return ["localhost", "127.0.0.1", "[::1]"].includes(String(location.hostname).toLowerCase());
}

window.addEventListener("online", () => void integration?.client.flushOfflineQueue().then(() => integration?.syncCloudSave("online")));

export const CARD_CRUNCH_STL_MAPPING = Object.freeze({
  gameId: CARD_CRUNCH_STL_GAME_ID,
  saveSlot: "card-crunch-primary",
  achievements: [
    "FIRST_CRUNCH",
    "FIRST_BANK",
    "FIRST_POT_CLEAR",
    "FULL_HAND_CRUNCH",
    "STREAK_5",
    "MILLION_RUN_CASH",
    "TOTAL_CRUNCHES_1000"
  ],
  playtime: "run start, 30s heartbeat, run end"
});
