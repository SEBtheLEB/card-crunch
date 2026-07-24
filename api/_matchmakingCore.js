import { createHash, randomBytes, randomUUID } from "node:crypto";

export const MATCH_DURATION_MS = 60_000;
export const MATCH_COUNTDOWN_MS = 4_500;
export const WAITING_TTL_MS = 18_000;
export const PLAYER_TTL_SECONDS = 180;
export const MATCH_TTL_SECONDS = 300;

const QUEUE_KEY = "card-crunch:matchmaking:queue";
const PLAYER_PREFIX = "card-crunch:matchmaking:player:";
const MATCH_PREFIX = "card-crunch:matchmaking:match:";

export class MatchmakingError extends Error {
  constructor(message, statusCode = 400, code = "matchmaking_error") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function handleMatchmakingAction(store, action, payload = {}, now = Date.now()) {
  if (!store) throw new MatchmakingError("Matchmaking storage is unavailable.", 503, "storage_unavailable");
  const safeAction = String(action || "").toLowerCase();

  if (safeAction === "join") return joinQueue(store, payload, now);

  const player = await authenticatePlayer(store, payload);
  if (safeAction === "poll") return pollPlayer(store, player, payload, now);
  if (safeAction === "score") return updateScore(store, player, payload, now);
  if (safeAction === "leave") return leaveMatch(store, player, now);
  throw new MatchmakingError("Unknown matchmaking action.", 404, "unknown_action");
}

async function joinQueue(store, payload, now) {
  let player = null;
  let session = null;
  if (payload.playerId || payload.sessionToken) {
    player = await authenticatePlayer(store, payload);
  } else {
    session = createPlayerSession();
    player = {
      id: session.playerId,
      secretHash: hashSecret(session.sessionToken),
      displayName: sanitizeName(payload.displayName),
      skinId: sanitizeSkin(payload.skinId),
      status: "idle",
      matchId: "",
      lastSeenAt: now,
      createdAt: now
    };
  }

  return store.withLock("card-crunch:matchmaking:join-lock", async () => {
    const latestPlayer = await store.getJson(playerKey(player.id));
    if (latestPlayer?.secretHash === player.secretHash) player = latestPlayer;
    player.displayName = sanitizeName(payload.displayName || player.displayName);
    player.skinId = sanitizeSkin(payload.skinId || player.skinId);
    player.lastSeenAt = now;

    if (player.matchId) {
      const existingMatch = await store.getJson(matchKey(player.matchId));
      if (existingMatch && !isMatchFinished(existingMatch, now)) {
        await savePlayer(store, player);
        return buildResponse(player, existingMatch, now, session);
      }
      player.matchId = "";
      player.status = "idle";
    }

    await removeStaleWaiters(store, now);
    const waitingIds = await store.zrangeByScore(QUEUE_KEY, 0, now, 24);
    let opponent = null;
    for (const waitingId of waitingIds) {
      if (waitingId === player.id) continue;
      const candidate = await store.getJson(playerKey(waitingId));
      if (!candidate || candidate.matchId || now - Number(candidate.lastSeenAt || 0) > WAITING_TTL_MS) {
        await store.zrem(QUEUE_KEY, waitingId);
        continue;
      }
      opponent = candidate;
      break;
    }

    if (!opponent) {
      player.status = "waiting";
      player.queueJoinedAt ||= now;
      await savePlayer(store, player);
      await store.zadd(QUEUE_KEY, player.queueJoinedAt, player.id);
      return {
        ok: true,
        state: "waiting",
        serverNow: now,
        session,
        queue: { joinedAt: Number(player.queueJoinedAt || now) }
      };
    }

    const match = createMatch(opponent, player, now);
    player.status = "matched";
    player.matchId = match.id;
    player.queueJoinedAt = 0;
    opponent.status = "matched";
    opponent.matchId = match.id;
    opponent.queueJoinedAt = 0;
    opponent.lastSeenAt = now;
    await Promise.all([
      store.zrem(QUEUE_KEY, player.id),
      store.zrem(QUEUE_KEY, opponent.id),
      savePlayer(store, player),
      savePlayer(store, opponent),
      store.setJson(matchKey(match.id), match, MATCH_TTL_SECONDS)
    ]);
    return buildResponse(player, match, now, session);
  });
}

async function pollPlayer(store, player, payload, now) {
  player.lastSeenAt = now;
  if (payload.displayName) player.displayName = sanitizeName(payload.displayName);
  if (payload.skinId) player.skinId = sanitizeSkin(payload.skinId);

  if (!player.matchId) {
    await savePlayer(store, player);
    return joinQueue(store, { ...payload, playerId: player.id, sessionToken: payload.sessionToken }, now);
  }

  return store.withLock(`card-crunch:matchmaking:match-lock:${player.matchId}`, async () => {
    const match = await store.getJson(matchKey(player.matchId));
    if (!match) {
      player.matchId = "";
      player.status = "idle";
      await savePlayer(store, player);
      return { ok: true, state: "expired", serverNow: now };
    }
    settleMatch(match, now);
    await Promise.all([
      savePlayer(store, player),
      store.setJson(matchKey(match.id), match, MATCH_TTL_SECONDS)
    ]);
    return buildResponse(player, match, now);
  });
}

async function updateScore(store, player, payload, now) {
  if (!player.matchId) throw new MatchmakingError("No active match.", 409, "no_match");
  const requestedScore = Math.max(0, Math.min(999_999_999_999, Math.floor(Number(payload.score) || 0)));

  return store.withLock(`card-crunch:matchmaking:match-lock:${player.matchId}`, async () => {
    const match = await store.getJson(matchKey(player.matchId));
    if (!match) throw new MatchmakingError("This match has expired.", 410, "match_expired");
    settleMatch(match, now);
    const slot = getPlayerSlot(match, player.id);
    if (!slot) throw new MatchmakingError("Player is not part of this match.", 403, "not_in_match");
    if (match.status !== "complete" && now <= match.endsAt + 8_000) {
      const scoreKey = slot === "a" ? "scoreA" : "scoreB";
      match[scoreKey] = Math.max(Number(match[scoreKey]) || 0, requestedScore);
      match[slot === "a" ? "lastScoreAtA" : "lastScoreAtB"] = now;
    }
    settleMatch(match, now);
    player.lastSeenAt = now;
    await Promise.all([
      savePlayer(store, player),
      store.setJson(matchKey(match.id), match, MATCH_TTL_SECONDS)
    ]);
    return buildResponse(player, match, now);
  });
}

async function leaveMatch(store, player, now) {
  return store.withLock(`card-crunch:matchmaking:leave-lock:${player.id}`, async () => {
    await store.zrem(QUEUE_KEY, player.id);
    let response = { ok: true, state: "left", serverNow: now };
    if (player.matchId) {
      const match = await store.getJson(matchKey(player.matchId));
      if (match && match.status !== "complete") {
        match.status = "complete";
        match.completedAt = now;
        match.forfeitBy = player.id;
        match.winnerId = match.playerA.id === player.id ? match.playerB.id : match.playerA.id;
        await store.setJson(matchKey(match.id), match, MATCH_TTL_SECONDS);
        response = buildResponse(player, match, now);
      }
    }
    player.status = "idle";
    player.matchId = "";
    player.queueJoinedAt = 0;
    player.lastSeenAt = now;
    await savePlayer(store, player);
    return response;
  });
}

async function authenticatePlayer(store, payload) {
  const playerId = sanitizeId(payload.playerId);
  const sessionToken = String(payload.sessionToken || "");
  if (!playerId || sessionToken.length < 24) {
    throw new MatchmakingError("Matchmaking session is missing.", 401, "session_missing");
  }
  const player = await store.getJson(playerKey(playerId));
  if (!player || player.secretHash !== hashSecret(sessionToken)) {
    throw new MatchmakingError("Matchmaking session expired.", 401, "session_expired");
  }
  return player;
}

function createMatch(playerA, playerB, now) {
  const startsAt = now + MATCH_COUNTDOWN_MS;
  return {
    id: randomUUID(),
    status: "countdown",
    createdAt: now,
    startsAt,
    endsAt: startsAt + MATCH_DURATION_MS,
    completedAt: 0,
    winnerId: "",
    forfeitBy: "",
    playerA: publicPlayer(playerA),
    playerB: publicPlayer(playerB),
    scoreA: 0,
    scoreB: 0,
    lastScoreAtA: 0,
    lastScoreAtB: 0
  };
}

function settleMatch(match, now) {
  if (match.status === "complete") return match;
  if (now >= match.endsAt) {
    match.status = "complete";
    match.completedAt = now;
    const scoreA = Number(match.scoreA) || 0;
    const scoreB = Number(match.scoreB) || 0;
    match.winnerId = scoreA === scoreB ? "draw" : scoreA > scoreB ? match.playerA.id : match.playerB.id;
  } else if (now >= match.startsAt) {
    match.status = "active";
  } else {
    match.status = "countdown";
  }
  return match;
}

function buildResponse(player, match, now, session = null) {
  settleMatch(match, now);
  const slot = getPlayerSlot(match, player.id);
  const you = slot === "a" ? match.playerA : match.playerB;
  const opponent = slot === "a" ? match.playerB : match.playerA;
  const yourScore = Number(slot === "a" ? match.scoreA : match.scoreB) || 0;
  const opponentScore = Number(slot === "a" ? match.scoreB : match.scoreA) || 0;
  const winner = match.status !== "complete"
    ? "pending"
    : match.winnerId === "draw"
      ? "draw"
      : match.winnerId === player.id ? "you" : "opponent";
  return {
    ok: true,
    state: match.status === "complete" ? "complete" : "matched",
    serverNow: now,
    session,
    match: {
      id: match.id,
      status: match.status,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
      durationMs: MATCH_DURATION_MS,
      you: { ...you, score: yourScore },
      opponent: { ...opponent, score: opponentScore },
      winner,
      forfeitBy: match.forfeitBy || ""
    }
  };
}

async function removeStaleWaiters(store, now) {
  const staleIds = await store.zrangeByScore(QUEUE_KEY, 0, now - WAITING_TTL_MS, 64);
  if (!staleIds.length) return;
  await Promise.all(staleIds.map(async (id) => {
    const player = await store.getJson(playerKey(id));
    if (!player || player.matchId || now - Number(player.lastSeenAt || 0) > WAITING_TTL_MS) {
      await store.zrem(QUEUE_KEY, id);
    }
  }));
}

function createPlayerSession() {
  return {
    playerId: randomUUID(),
    sessionToken: randomBytes(32).toString("base64url")
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    displayName: sanitizeName(player.displayName),
    skinId: sanitizeSkin(player.skinId)
  };
}

function getPlayerSlot(match, playerId) {
  if (match.playerA?.id === playerId) return "a";
  if (match.playerB?.id === playerId) return "b";
  return "";
}

function isMatchFinished(match, now) {
  settleMatch(match, now);
  return match.status === "complete";
}

function hashSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

function sanitizeName(value) {
  const name = String(value || "Player").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 18);
  return name || "Player";
}

function sanitizeSkin(value) {
  return String(value || "classic").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "classic";
}

function sanitizeId(value) {
  const id = String(value || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64);
  return id.length >= 16 ? id : "";
}

function playerKey(id) {
  return `${PLAYER_PREFIX}${id}`;
}

function matchKey(id) {
  return `${MATCH_PREFIX}${id}`;
}

async function savePlayer(store, player) {
  await store.setJson(playerKey(player.id), player, PLAYER_TTL_SECONDS);
}

export class MemoryMatchmakingStore {
  constructor() {
    this.values = new Map();
    this.sortedSets = new Map();
    this.lockTail = Promise.resolve();
  }

  async withLock(_key, operation) {
    const previous = this.lockTail;
    let release;
    this.lockTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async getJson(key) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  async setJson(key, value, ttlSeconds = 0) {
    this.values.set(key, {
      value: structuredClone(value),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0
    });
  }

  async zadd(key, score, member) {
    const set = this.sortedSets.get(key) ?? new Map();
    set.set(member, Number(score));
    this.sortedSets.set(key, set);
  }

  async zrem(key, member) {
    this.sortedSets.get(key)?.delete(member);
  }

  async zrangeByScore(key, min, max, limit = 64) {
    return [...(this.sortedSets.get(key) ?? new Map()).entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([member]) => member);
  }
}
