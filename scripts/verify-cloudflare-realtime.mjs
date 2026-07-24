const origin = String(process.env.CARD_CRUNCH_REALTIME_ORIGIN
  || "https://card-crunch-realtime.stlprodz1101.workers.dev").replace(/\/$/, "");
const socketOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

if (typeof WebSocket !== "function") {
  throw new Error("This live check requires Node.js 22 or newer for WebSocket support.");
}

const createSession = async () => {
  const response = await fetch(`${origin}/session`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok || !payload.session) throw new Error("Unable to create a realtime session.");
  return payload.session;
};

const openSocket = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  const timeout = setTimeout(() => reject(new Error(`Timed out opening ${url}`)), 12_000);
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    resolve(socket);
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error(`Failed to open ${url}`));
  }, { once: true });
});

const waitForMessage = (socket, wantedType, timeoutMs = 12_000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${wantedType}`)), timeoutMs);
  const onMessage = (event) => {
    const payload = JSON.parse(String(event.data));
    if (payload.type !== wantedType) return;
    clearTimeout(timeout);
    socket.removeEventListener("message", onMessage);
    resolve(payload);
  };
  socket.addEventListener("message", onMessage);
});

const playerQuery = (session, displayName) => new URLSearchParams({
  playerId: session.playerId,
  sessionToken: session.sessionToken,
  displayName,
  skinId: "classic"
});

const roomUrl = (session, matched) => `${socketOrigin}/match/${matched.room.matchId}?${new URLSearchParams({
  playerId: session.playerId,
  roomToken: matched.room.roomToken
})}`;

const sockets = [];
try {
  const [alphaSession, bravoSession] = await Promise.all([createSession(), createSession()]);
  const alphaLobby = await openSocket(`${socketOrigin}/matchmaking?${playerQuery(alphaSession, "Alpha")}`);
  sockets.push(alphaLobby);
  const alphaMatchedPromise = waitForMessage(alphaLobby, "matched");
  const bravoLobby = await openSocket(`${socketOrigin}/matchmaking?${playerQuery(bravoSession, "Bravo")}`);
  sockets.push(bravoLobby);
  const [alphaMatched, bravoMatched] = await Promise.all([
    alphaMatchedPromise,
    waitForMessage(bravoLobby, "matched")
  ]);

  if (alphaMatched.room.matchId !== bravoMatched.room.matchId) {
    throw new Error("Players were assigned to different match rooms.");
  }

  const [alphaRoom, bravoRoom] = await Promise.all([
    openSocket(roomUrl(alphaSession, alphaMatched)),
    openSocket(roomUrl(bravoSession, bravoMatched))
  ]);
  sockets.push(alphaRoom, bravoRoom);

  const scorePushPromise = waitForMessage(bravoRoom, "snapshot");
  alphaRoom.send(JSON.stringify({ type: "score", score: 12_345 }));
  let scorePush = await scorePushPromise;
  while (scorePush.match.opponent.score !== 12_345) {
    scorePush = await waitForMessage(bravoRoom, "snapshot");
  }

  const syncPromise = waitForMessage(alphaRoom, "snapshot");
  alphaRoom.send(JSON.stringify({ type: "sync" }));
  const synced = await syncPromise;
  if (synced.match.you.score !== 12_345) throw new Error("Room resynchronization returned the wrong score.");

  console.log(JSON.stringify({
    ok: true,
    origin,
    matchId: alphaMatched.room.matchId,
    opponentScorePush: scorePush.match.opponent.score,
    synchronizedScore: synced.match.you.score
  }, null, 2));
} finally {
  for (const socket of sockets) {
    try { socket.close(1000, "test-complete"); } catch {}
  }
}
