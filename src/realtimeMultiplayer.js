const REALTIME_SESSION_KEY = "cardCrunchRealtimeSessionV1";
const OPEN_TIMEOUT_MS = 7_000;
const HEARTBEAT_MS = 12_000;
const MAX_ROOM_RECONNECTS = 5;

export function getConfiguredRealtimeOrigin() {
  const configured = document.querySelector('meta[name="card-crunch-realtime-origin"]')?.content?.trim();
  return configured ? configured.replace(/\/$/, "") : "";
}

export class CardCrunchRealtimeTransport {
  constructor({ origin = getConfiguredRealtimeOrigin(), onMessage, onConnectionState } = {}) {
    this.origin = origin;
    this.onMessage = onMessage;
    this.onConnectionState = onConnectionState;
    this.session = readJson(REALTIME_SESSION_KEY, null);
    this.player = null;
    this.socket = null;
    this.socketRole = "";
    this.room = null;
    this.heartbeat = 0;
    this.generation = 0;
    this.reconnectAttempts = 0;
    this.closedIntentionally = false;
  }

  get configured() {
    return /^https:\/\//.test(this.origin);
  }

  get active() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async start(player) {
    if (!this.configured) throw new Error("Realtime endpoint is not configured.");
    this.close({ notifyServer: false });
    const generation = ++this.generation;
    this.closedIntentionally = false;
    this.player = { ...player };
    await this.ensureSession();
    if (generation !== this.generation) return;
    await this.openLobby(generation);
  }

  sendScore(score) {
    if (this.socketRole !== "room") return false;
    return this.send({ type: "score", score: Math.max(0, Math.floor(Number(score) || 0)) });
  }

  leave() {
    this.close({ notifyServer: true });
  }

  close({ notifyServer = false } = {}) {
    this.closedIntentionally = true;
    ++this.generation;
    window.clearInterval(this.heartbeat);
    this.heartbeat = 0;
    if (notifyServer) this.send({ type: "leave" });
    try { this.socket?.close(1000, notifyServer ? "left" : "reset"); } catch {}
    this.socket = null;
    this.socketRole = "";
    this.room = null;
    this.reconnectAttempts = 0;
  }

  async ensureSession() {
    if (this.session?.playerId && this.session?.sessionToken && Number(this.session.expiresAt) > Date.now() + 60_000) return;
    const response = await fetch(`${this.origin}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.session) throw new Error(payload.message || "Realtime session could not be created.");
    this.session = payload.session;
    writeJson(REALTIME_SESSION_KEY, this.session);
  }

  async openLobby(generation) {
    const query = new URLSearchParams({
      playerId: this.session.playerId,
      sessionToken: this.session.sessionToken,
      displayName: this.player?.displayName || "Player",
      skinId: this.player?.skinId || "classic"
    });
    const socket = await openWebSocket(`${toWebSocketOrigin(this.origin)}/matchmaking?${query}`, OPEN_TIMEOUT_MS);
    if (generation !== this.generation) {
      socket.close(1000, "superseded");
      return;
    }
    this.attachSocket(socket, "lobby", generation);
    this.onConnectionState?.("connected");
  }

  async openRoom(generation, room, initialMessage) {
    this.room = room;
    const query = new URLSearchParams({
      playerId: this.session.playerId,
      roomToken: room.roomToken
    });
    const socket = await openWebSocket(
      `${toWebSocketOrigin(this.origin)}/match/${encodeURIComponent(room.matchId)}?${query}`,
      OPEN_TIMEOUT_MS
    );
    if (generation !== this.generation) {
      socket.close(1000, "superseded");
      return;
    }
    try { this.socket?.close(1000, "room-ready"); } catch {}
    this.attachSocket(socket, "room", generation);
    this.send({ type: "sync" });
    this.reconnectAttempts = 0;
    this.onMessage?.(initialMessage);
    this.onConnectionState?.("connected");
  }

  attachSocket(socket, role, generation) {
    this.socket = socket;
    this.socketRole = role;
    this.closedIntentionally = false;
    socket.addEventListener("message", (event) => this.handleMessage(event, generation, role));
    socket.addEventListener("close", () => this.handleClose(generation, role));
    socket.addEventListener("error", () => this.onConnectionState?.("reconnecting"));
    window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => this.send({ type: "ping", clientNow: Date.now() }), HEARTBEAT_MS);
  }

  async handleMessage(event, generation, role) {
    if (generation !== this.generation) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === "pong") return;
    if (role === "lobby" && payload.type === "matched" && payload.room) {
      try {
        await this.openRoom(generation, payload.room, payload);
      } catch (error) {
        this.onConnectionState?.("reconnecting");
        await this.reconnectRoom(generation, payload);
      }
      return;
    }
    this.onMessage?.(payload);
  }

  handleClose(generation, role) {
    if (generation !== this.generation || this.closedIntentionally) return;
    if (this.socketRole !== role) return;
    window.clearInterval(this.heartbeat);
    this.heartbeat = 0;
    this.onConnectionState?.("reconnecting");
    if (role === "room" && this.room) void this.reconnectRoom(generation);
  }

  async reconnectRoom(generation, initialMessage = null) {
    if (generation !== this.generation || this.closedIntentionally || !this.room) return;
    if (this.reconnectAttempts >= MAX_ROOM_RECONNECTS) {
      this.onConnectionState?.("failed");
      return;
    }
    this.reconnectAttempts += 1;
    await sleep(Math.min(3_000, 350 * (2 ** (this.reconnectAttempts - 1))));
    if (generation !== this.generation || this.closedIntentionally) return;
    try {
      await this.openRoom(generation, this.room, initialMessage || { type: "reconnected" });
    } catch {
      await this.reconnectRoom(generation, initialMessage);
    }
  }

  send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}

function openWebSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = window.setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error("Realtime connection timed out."));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      window.clearTimeout(timeout);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Realtime connection could not be opened."));
    }, { once: true });
  });
}

function toWebSocketOrigin(origin) {
  return origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
