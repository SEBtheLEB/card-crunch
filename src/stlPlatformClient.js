import {
  callbackMatchesRedirect,
  getRuntimeRedirectUri,
  readSTLPlatformConfig,
  validateSTLPlatformConfig
} from "./stlPlatformConfig.js?v=190";

const AUTH_TRANSACTION_KEY = "cardCrunchStlAuthTransactionV1";
const SESSION_KEY = "cardCrunchStlSessionV1";
const QUEUE_KEY = "cardCrunchStlOfflineQueueV1";
const DEVICE_KEY = "cardCrunchStlDeviceIdV1";
const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export class STLClientError extends Error {
  constructor(message, code = "STL_CLIENT_ERROR", details = {}) {
    super(message);
    this.name = "STLClientError";
    this.code = code;
    this.details = details;
  }
}

export function createCardCrunchSTLClient(config = readSTLPlatformConfig()) {
  const validated = validateSTLPlatformConfig(config);
  return new CardCrunchSTLClient(validated);
}

export class CardCrunchSTLClient {
  constructor(config) {
    this.config = config;
    this.redirectUri = getRuntimeRedirectUri(config);
    const persistence = createProtectedSessionPersistence();
    this.sessionStore = persistence.sessionStore;
    this.transactionStore = persistence.transactionStore;
    this.queueStore = createJsonStore(localStorage, QUEUE_KEY, []);
    this.refreshInFlight = null;
  }

  get storageSecurity() {
    return this.sessionStore.security;
  }

  async beginSignIn({ scopes = defaultScopes() } = {}) {
    const verifier = createVerifier();
    const challenge = await sha256Base64Url(verifier);
    const state = randomBase64Url(32);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000).toISOString();
    await this.transactionStore.save({ state, codeVerifier: verifier, redirectUri: this.redirectUri, createdAt: createdAt.toISOString(), expiresAt });

    const url = new URL("/oauth/authorize", this.config.baseUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("scope", [...new Set(scopes)].join(" "));
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  async completeSignIn(callbackUrl, { device } = {}) {
    let callback;
    try {
      callback = new URL(callbackUrl);
    } catch {
      throw new STLClientError("The STL sign-in callback is invalid.", "INVALID_REQUEST");
    }
    if (!callbackMatchesRedirect(callbackUrl, this.redirectUri)) {
      throw new STLClientError("The callback does not belong to Card Crunch.", "INVALID_REDIRECT_URI");
    }
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    if (callback.searchParams.get("error")) {
      await this.transactionStore.clear();
      throw new STLClientError("STL sign-in was cancelled.", "AUTHORIZATION_DENIED");
    }
    if (!code || !state) throw new STLClientError("The sign-in callback is missing code or state.", "INVALID_REQUEST");
    const transaction = await this.transactionStore.load();
    if (!transaction || transaction.state !== state) throw new STLClientError("The sign-in state is invalid or already used.", "INVALID_STATE");
    if (Date.parse(transaction.expiresAt) <= Date.now()) {
      await this.transactionStore.clear();
      throw new STLClientError("The sign-in state expired.", "INVALID_STATE");
    }
    await this.transactionStore.clear();

    const session = await this.request("/auth/token", {
      method: "POST",
      authenticated: false,
      body: {
        grantType: "authorization_code",
        clientId: this.config.clientId,
        redirectUri: transaction.redirectUri,
        code,
        codeVerifier: transaction.codeVerifier,
        ...(device ? { device } : {})
      }
    });
    validateSession(session);
    await this.sessionStore.save(session);
    return session;
  }

  async restoreSession() {
    const session = await this.sessionStore.load();
    if (!session) return null;
    try {
      validateSession(session);
    } catch {
      await this.sessionStore.clear();
      return null;
    }
    if (Date.parse(session.expiresAt) > Date.now() + 60_000) return session;
    if (!session.refreshToken || (session.refreshExpiresAt && Date.parse(session.refreshExpiresAt) <= Date.now())) {
      await this.sessionStore.clear();
      return null;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshSession(session.refreshToken)
        .finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }

  async refreshSession(refreshToken) {
    try {
      const session = await this.request("/auth/refresh", {
        method: "POST",
        authenticated: false,
        body: { grantType: "refresh_token", clientId: this.config.clientId, refreshToken }
      });
      validateSession(session);
      await this.sessionStore.save(session);
      return session;
    } catch (error) {
      if (isPermanentRefreshFailure(error)) {
        try { await this.sessionStore.clear(); } catch {}
      }
      throw error;
    }
  }

  async signOut() {
    try {
      if (await this.sessionStore.load()) await this.request("/auth/sign-out", { method: "POST" });
    } finally {
      await Promise.all([
        this.sessionStore.clear(),
        this.transactionStore.clear()
      ]);
    }
  }

  async getCurrentPlayer() {
    return this.request("/auth/player", { method: "GET" });
  }

  async registerDevice(input, options = {}) {
    return this.mutate("/devices", input, { ...options, method: "POST" });
  }

  async startPlaySession(input, options = {}) {
    return this.mutate("/playtime/sessions", input, { ...options, method: "POST" });
  }

  async sendPlaySessionHeartbeat(playSessionId, input, options = {}) {
    return this.mutate(`/playtime/sessions/${encodeURIComponent(playSessionId)}/heartbeats`, input, { ...options, method: "POST" });
  }

  async endPlaySession(playSessionId, input, options = {}) {
    return this.mutate(`/playtime/sessions/${encodeURIComponent(playSessionId)}/end`, input, { ...options, method: "POST" });
  }

  async unlockAchievement(input, options = {}) {
    return this.mutate(`/achievements/${encodeURIComponent(input.achievementKey)}/unlock`, input, { ...options, method: "POST" });
  }

  async updateAchievementProgress(input, options = {}) {
    return this.mutate(`/achievements/${encodeURIComponent(input.achievementKey)}/progress`, input, { ...options, method: "PUT" });
  }

  async uploadCloudSave(input, options = {}) {
    const bytes = await toBytes(input.data);
    const checksum = input.checksum || await sha256Hex(bytes);
    const ticket = await this.request("/saves/uploads", {
      method: "POST",
      body: {
        gameId: input.gameId,
        slotId: input.slotId,
        slotKey: input.slotKey,
        displayName: input.displayName,
        expectedRevision: input.expectedRevision,
        parentVersionId: input.parentVersionId,
        deviceId: input.deviceId,
        gameBuild: input.gameBuild,
        saveFormatVersion: input.saveFormatVersion,
        checksum,
        fileSize: bytes.byteLength,
        compression: input.compression || "none",
        clientCreatedAt: input.clientCreatedAt,
        progressSummary: input.progressSummary,
        playSeconds: input.playSeconds
      },
      idempotencyKey: options.idempotencyKey
    });
    if (!ticket?.transfer?.url || !ticket?.slotId || !ticket?.uploadId) throw new STLClientError("STL save upload ticket was incomplete.", "BAD_SAVE_TICKET");
    const transfer = await fetch(ticket.transfer.url, {
      method: ticket.transfer.method || "PUT",
      headers: ticket.transfer.headers || {},
      body: bytes
    });
    if (!transfer.ok) throw new STLClientError("STL private save transfer failed.", "SAVE_TRANSFER_FAILED", { status: transfer.status });
    return this.request(`/saves/${encodeURIComponent(ticket.slotId)}/versions`, {
      method: "POST",
      body: { ...input, uploadId: ticket.uploadId, checksum, fileSize: bytes.byteLength, compression: input.compression || "none" },
      idempotencyKey: options.idempotencyKey
    });
  }

  async listSaveVersions(slotId, options = {}) {
    const suffix = slotId ? `/${encodeURIComponent(slotId)}/versions` : "/versions";
    return this.request(`/saves${suffix}`, { method: "GET", timeoutMs: options.timeoutMs });
  }

  async mutate(path, body, { queueWhenOffline = true, idempotencyKey = crypto.randomUUID(), method = "POST" } = {}) {
    if (!navigator.onLine && queueWhenOffline) {
      const session = await this.restoreSession();
      if (!session) throw new STLClientError("Sign in to STL Platform first.", "SESSION_MISSING");
      await this.enqueue({
        path,
        method,
        body: bindAuthenticatedDevice(body, session.deviceId),
        idempotencyKey,
        userId: session.userId,
        clientId: this.config.clientId,
        createdAt: new Date().toISOString()
      });
      throw new STLClientError("Queued while STL Platform is offline.", "OFFLINE_QUEUED");
    }
    return this.request(path, { method, body, idempotencyKey });
  }

  async flushOfflineQueue() {
    if (!navigator.onLine) return { completed: 0, remaining: await this.queueSize() };
    const session = await this.restoreSession();
    if (!session) return { completed: 0, remaining: await this.queueSize() };
    const queue = await this.queueStore.load();
    const remaining = [];
    let completed = 0;
    for (const item of queue) {
      if (!isUuid(item?.userId) || item.clientId !== this.config.clientId) continue;
      if (item.userId !== session.userId) {
        remaining.push(item);
        continue;
      }
      try {
        await this.request(item.path, { method: item.method, body: item.body, idempotencyKey: item.idempotencyKey });
        completed += 1;
      } catch (error) {
        remaining.push(item);
      }
    }
    await this.queueStore.save(remaining);
    return { completed, remaining: remaining.length };
  }

  async queueSize() {
    return (await this.queueStore.load()).length;
  }

  async enqueue(item) {
    const queue = await this.queueStore.load();
    if (!queue.some((entry) => entry.userId === item.userId
      && entry.clientId === item.clientId
      && entry.idempotencyKey === item.idempotencyKey)) {
      queue.push(item);
    }
    await this.queueStore.save(queue.slice(-100));
  }

  async request(path, { method = "GET", body, authenticated = true, idempotencyKey, timeoutMs = 12_000 } = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    let requestBody = body;
    const headers = {
      accept: "application/json",
      "x-stl-client-id": this.config.clientId
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    if (authenticated) {
      const session = await this.restoreSession();
      if (!session) throw new STLClientError("Sign in to STL Platform first.", "SESSION_MISSING");
      headers.authorization = `${session.tokenType || "Bearer"} ${session.accessToken}`;
      requestBody = bindAuthenticatedDevice(requestBody, session.deviceId);
    }
    try {
      const response = await fetch(new URL(`/api/v1${path}`, this.config.baseUrl), {
        method,
        headers,
        signal: controller.signal,
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : undefined;
      if (!response.ok) {
        const code = data?.error?.code || data?.code || `HTTP_${response.status}`;
        throw new STLClientError(data?.error?.message || data?.message || "STL Platform request failed.", code, { status: response.status });
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new STLClientError("STL Platform request timed out.", "TIMEOUT");
      if (error instanceof STLClientError) throw error;
      throw new STLClientError("STL Platform is unavailable.", "NETWORK_ERROR");
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export async function getOrCreateDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (isUuid(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export function defaultScopes() {
  return ["openid", "profile", "games:read", "devices:manage", "saves:read", "saves:write", "achievements:read", "achievements:write", "playtime:write"];
}

export function bindAuthenticatedDevice(value, deviceId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "deviceId")) {
    return value;
  }
  return { ...value, deviceId };
}

export async function sha256Hex(bytesOrString) {
  const bytes = typeof bytesOrString === "string" ? new TextEncoder().encode(bytesOrString) : bytesOrString;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function createVerifier() {
  return randomBase64Url(64);
}

function randomBase64Url(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = "";
  for (const byte of bytes) output += BASE64URL_CHARS[byte & 63];
  return output;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new TextEncoder().encode(String(value ?? ""));
}

function createJsonStore(storage, key, fallback = null) {
  return {
    async load() {
      try {
        const raw = storage?.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    async save(value) {
      storage?.setItem(key, JSON.stringify(value));
    },
    async clear() {
      storage?.removeItem(key);
    }
  };
}

function createProtectedSessionPersistence() {
  clearUnsafeBrowserSessionCopies();
  const isNative = globalThis.Capacitor?.isNativePlatform?.() === true
    || ["android", "ios"].includes(globalThis.Capacitor?.getPlatform?.());
  if (isNative) {
    const bridge = globalThis.__CARD_CRUNCH_CAPACITOR_SECURE_STORAGE__;
    const secureStorage = bridge?.storage;
    if (!secureStorage?.get || !secureStorage?.set || !secureStorage?.remove) {
      const unavailable = createUnavailableSecureStore();
      return { sessionStore: unavailable, transactionStore: unavailable };
    }
    const createNativeStore = (key) => createCapacitorSecureStore({
      key,
      secureStorage,
      keychainAccess: bridge.whenUnlockedThisDeviceOnly
    });
    return {
      sessionStore: createNativeStore(SESSION_KEY),
      transactionStore: createNativeStore(AUTH_TRANSACTION_KEY)
    };
  }

  let memorySession = null;
  return {
    sessionStore: {
      security: "memory-only",
      async load() { return memorySession; },
      async save(session) {
        memorySession = { ...session, refreshToken: undefined, refreshExpiresAt: undefined };
      },
      async clear() { memorySession = null; }
    },
    transactionStore: createJsonStore(sessionStorage, AUTH_TRANSACTION_KEY)
  };
}

function createCapacitorSecureStore({ key, secureStorage, keychainAccess }) {
  let initialization;
  const initialize = () => {
    initialization ||= Promise.all([
      secureStorage.setSynchronize?.(false),
      secureStorage.setDefaultKeychainAccess?.(keychainAccess)
    ]);
    return initialization;
  };
  return {
    security: "os-protected",
    async load() {
      await initialize();
      try {
        return await secureStorage.get(key, false, false);
      } catch (error) {
        if (error?.code !== "invalidData") throw error;
        await secureStorage.remove(key, false);
        return null;
      }
    },
    async save(value) {
      await initialize();
      await secureStorage.set(key, value, false, false, keychainAccess);
    },
    async clear() {
      await initialize();
      await secureStorage.remove(key, false);
    }
  };
}

function createUnavailableSecureStore() {
  const unavailable = () => {
    throw new STLClientError(
      "Secure STL Account storage is unavailable in this installed build.",
      "SECURE_STORAGE_UNAVAILABLE"
    );
  };
  return {
    security: "unavailable",
    load: unavailable,
    save: unavailable,
    clear: unavailable
  };
}

function clearUnsafeBrowserSessionCopies() {
  for (const key of [
    SESSION_KEY,
    `cap_sec_${SESSION_KEY}`,
    `capacitor-storage_${SESSION_KEY}`
  ]) {
    try { localStorage.removeItem(key); } catch {}
  }
}

function isPermanentRefreshFailure(error) {
  const status = Number(error?.details?.status);
  if ([400, 401, 403].includes(status)) return true;
  return /(?:INVALID|EXPIRED|REVOKED|REUSED|SESSION_MISSING)/i.test(String(error?.code || ""));
}

function validateSession(session) {
  if (!session
    || typeof session !== "object"
    || !isUuid(session.userId)
    || !isUuid(session.sessionId)
    || !isUuid(session.deviceId)
    || session.tokenType !== "Bearer"
    || typeof session.accessToken !== "string"
    || session.accessToken.length < 16
    || !Array.isArray(session.scopes)
    || !Number.isFinite(Date.parse(session.expiresAt))) {
    throw new STLClientError("STL Platform returned an invalid session.", "INVALID_SESSION");
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
