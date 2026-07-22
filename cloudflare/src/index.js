import {
  buildMatchView,
  clampScore,
  createMatchRecord,
  publicPlayer,
  sanitizeId,
  sanitizeName,
  sanitizeSkin,
  settleMatch
} from "./protocol.js";
import { createSignedSession, verifySignedSession } from "./session.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: "card-crunch-realtime", serverNow: Date.now() }, 200, cors);
      }
      if (url.pathname === "/session" && request.method === "POST") {
        const session = await createSignedSession(env.SESSION_SECRET);
        return json({ ok: true, session, serverNow: Date.now() }, 200, cors);
      }
      if (url.pathname === "/matchmaking") {
        if (!isWebSocketUpgrade(request)) return json({ ok: false, code: "websocket_required" }, 426, cors);
        const valid = await verifySignedSession(
          env.SESSION_SECRET,
          url.searchParams.get("playerId"),
          url.searchParams.get("sessionToken")
        );
        if (!valid) return json({ ok: false, code: "session_expired" }, 401, cors);
        const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global-v1"));
        return stub.fetch(request);
      }
      if (url.pathname.startsWith("/match/")) {
        if (!isWebSocketUpgrade(request)) return json({ ok: false, code: "websocket_required" }, 426, cors);
        const matchId = sanitizeId(url.pathname.slice("/match/".length));
        if (!matchId) return json({ ok: false, code: "invalid_match" }, 400, cors);
        const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(matchId));
        return stub.fetch(request);
      }
      return json({ ok: false, code: "not_found" }, 404, cors);
    } catch (error) {
      console.error("[card-crunch-realtime]", error);
      return json({ ok: false, code: "server_error", message: "Realtime service is temporarily unavailable." }, 500, cors);
    }
  }
};

export class Matchmaker {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (!isWebSocketUpgrade(request)) return new Response("WebSocket required", { status: 426 });
    const url = new URL(request.url);
    const player = publicPlayer({
      id: url.searchParams.get("playerId"),
      displayName: url.searchParams.get("displayName"),
      skinId: url.searchParams.get("skinId")
    });
    if (!player.id) return new Response("Invalid player", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment = { ...player, status: "waiting", joinedAt: Date.now() };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, ["waiting"]);
    sendSocket(server, { type: "waiting", state: "waiting", serverNow: Date.now() });
    await this.tryCreateMatch(server, attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async tryCreateMatch(currentSocket, currentPlayer) {
    const opponentSocket = this.ctx.getWebSockets("waiting").find((socket) => {
      if (socket === currentSocket || socket.readyState !== WebSocket.OPEN) return false;
      const candidate = socket.deserializeAttachment();
      return candidate?.status === "waiting" && candidate.id !== currentPlayer.id;
    });
    if (!opponentSocket) return;

    const opponent = opponentSocket.deserializeAttachment();
    const matchId = crypto.randomUUID();
    const tokenA = createRoomToken();
    const tokenB = createRoomToken();
    const now = Date.now();
    const record = createMatchRecord({ id: matchId, playerA: opponent, playerB: currentPlayer, now });

    currentSocket.serializeAttachment({ ...currentPlayer, status: "matching" });
    opponentSocket.serializeAttachment({ ...opponent, status: "matching" });
    const room = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(matchId));
    const setupResponse = await room.fetch("https://match.internal/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match: record, tokens: { [opponent.id]: tokenA, [currentPlayer.id]: tokenB } })
    });
    if (!setupResponse.ok) throw new Error("Unable to initialize match room");

    sendSocket(opponentSocket, {
      type: "matched",
      serverNow: now,
      room: { matchId, roomToken: tokenA },
      match: buildMatchView(record, opponent.id, now)
    });
    sendSocket(currentSocket, {
      type: "matched",
      serverNow: now,
      room: { matchId, roomToken: tokenB },
      match: buildMatchView(record, currentPlayer.id, now)
    });
  }

  webSocketMessage(socket, message) {
    const payload = parseMessage(message);
    if (payload?.type === "ping") sendSocket(socket, { type: "pong", serverNow: Date.now() });
    if (payload?.type === "leave") socket.close(1000, "cancelled");
  }
}

export class MatchRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/setup" && request.method === "POST") return this.setup(request);
    if (!isWebSocketUpgrade(request)) return new Response("WebSocket required", { status: 426 });
    return this.connect(request);
  }

  async setup(request) {
    const existing = await this.ctx.storage.get("match");
    if (existing) return json({ ok: true, existing: true });
    const payload = await request.json();
    if (!payload?.match?.id || !payload?.tokens) return json({ ok: false }, 400);
    await this.ctx.storage.put({ match: payload.match, tokens: payload.tokens });
    await this.ctx.storage.setAlarm(payload.match.endsAt);
    return json({ ok: true });
  }

  async connect(request) {
    const url = new URL(request.url);
    const playerId = sanitizeId(url.searchParams.get("playerId"));
    const roomToken = String(url.searchParams.get("roomToken") || "");
    const [match, tokens] = await Promise.all([
      this.ctx.storage.get("match"),
      this.ctx.storage.get("tokens")
    ]);
    if (!match || !playerId || tokens?.[playerId] !== roomToken) {
      return new Response("Invalid room session", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ playerId });
    this.ctx.acceptWebSocket(server, [playerId]);
    sendSocket(server, {
      type: "snapshot",
      state: match.status === "complete" ? "complete" : "matched",
      serverNow: Date.now(),
      match: buildMatchView(match, playerId)
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    const payload = parseMessage(message);
    const playerId = socket.deserializeAttachment()?.playerId;
    if (!payload || !playerId) return;
    if (payload.type === "ping") {
      sendSocket(socket, { type: "pong", serverNow: Date.now() });
      return;
    }

    const match = await this.ctx.storage.get("match");
    if (!match) return;
    const now = Date.now();
    if (payload.type === "sync") {
      const view = buildMatchView(match, playerId, now);
      if (view) {
        sendSocket(socket, {
          type: view.status === "complete" ? "complete" : "snapshot",
          state: view.status === "complete" ? "complete" : "matched",
          serverNow: now,
          match: view
        });
      }
      return;
    }
    settleMatch(match, now);
    if (payload.type === "score" && match.status !== "complete" && now <= match.endsAt + 8_000) {
      const score = clampScore(payload.score);
      if (match.playerA.id === playerId) {
        match.scoreA = Math.max(match.scoreA, score);
        match.lastScoreAtA = now;
      } else if (match.playerB.id === playerId) {
        match.scoreB = Math.max(match.scoreB, score);
        match.lastScoreAtB = now;
      }
    } else if (payload.type === "leave" && match.status !== "complete") {
      match.status = "complete";
      match.completedAt = now;
      match.forfeitBy = playerId;
      match.winnerId = match.playerA.id === playerId ? match.playerB.id : match.playerA.id;
    }
    settleMatch(match, now);
    await this.ctx.storage.put("match", match);
    this.broadcast(match, now);
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.playerId) return;
    // Mobile clients are allowed to reconnect; explicit leave is the only forfeit signal.
  }

  async alarm() {
    const match = await this.ctx.storage.get("match");
    if (!match) return;
    settleMatch(match, Date.now());
    await this.ctx.storage.put("match", match);
    this.broadcast(match, Date.now());
  }

  broadcast(match, now = Date.now()) {
    for (const socket of this.ctx.getWebSockets()) {
      const playerId = socket.deserializeAttachment()?.playerId;
      const view = playerId ? buildMatchView(match, playerId, now) : null;
      if (!view) continue;
      sendSocket(socket, {
        type: view.status === "complete" ? "complete" : "snapshot",
        state: view.status === "complete" ? "complete" : "matched",
        serverNow: now,
        match: view
      });
    }
  }
}

function isWebSocketUpgrade(request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function createRoomToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function parseMessage(message) {
  try {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sendSocket(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify(payload)); } catch {}
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin || allowed.has(origin) || local) {
    return {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin"
    };
  }
  return {};
}
