export const MATCH_DURATION_MS = 60_000;
export const MATCH_COUNTDOWN_MS = 4_500;
export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MAX_SCORE = 999_999_999_999;

export function sanitizeName(value) {
  const name = String(value || "Player").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 18);
  return name || "Player";
}

export function sanitizeSkin(value) {
  return String(value || "classic").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "classic";
}

export function sanitizeId(value) {
  const id = String(value || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64);
  return id.length >= 16 ? id : "";
}

export function clampScore(value) {
  return Math.max(0, Math.min(MAX_SCORE, Math.floor(Number(value) || 0)));
}

export function settleMatch(match, now = Date.now()) {
  if (!match || match.status === "complete") return match;
  if (now >= match.endsAt) {
    match.status = "complete";
    match.completedAt = now;
    match.winnerId = match.scoreA === match.scoreB
      ? "draw"
      : match.scoreA > match.scoreB ? match.playerA.id : match.playerB.id;
  } else {
    match.status = now >= match.startsAt ? "active" : "countdown";
  }
  return match;
}

export function buildMatchView(match, playerId, now = Date.now()) {
  settleMatch(match, now);
  const slot = match.playerA.id === playerId ? "a" : match.playerB.id === playerId ? "b" : "";
  if (!slot) return null;
  const you = slot === "a" ? match.playerA : match.playerB;
  const opponent = slot === "a" ? match.playerB : match.playerA;
  const yourScore = slot === "a" ? match.scoreA : match.scoreB;
  const opponentScore = slot === "a" ? match.scoreB : match.scoreA;
  const winner = match.status !== "complete"
    ? "pending"
    : match.winnerId === "draw" ? "draw" : match.winnerId === playerId ? "you" : "opponent";
  return {
    id: match.id,
    status: match.status,
    startsAt: match.startsAt,
    endsAt: match.endsAt,
    durationMs: MATCH_DURATION_MS,
    you: { ...you, score: yourScore },
    opponent: { ...opponent, score: opponentScore },
    winner,
    forfeitBy: match.forfeitBy || ""
  };
}

export function createMatchRecord({ id, playerA, playerB, now = Date.now() }) {
  const startsAt = now + MATCH_COUNTDOWN_MS;
  return {
    id,
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

export function publicPlayer(player) {
  return {
    id: sanitizeId(player?.id),
    displayName: sanitizeName(player?.displayName),
    skinId: sanitizeSkin(player?.skinId)
  };
}
