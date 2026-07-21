import { createMatchmakingStore } from "./_redis.js";
import { handleMatchmakingAction, MatchmakingError } from "./_matchmakingCore.js";

const ALLOWED_ORIGINS = new Set([
  "https://card-crunch.vercel.app",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
  "http://127.0.0.1"
]);

export default async function handler(request, response) {
  applyHeaders(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ ok: false, code: "method_not_allowed" });

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const store = createMatchmakingStore();
    const result = await handleMatchmakingAction(store, body.action, body, Date.now());
    return response.status(200).json(result);
  } catch (error) {
    const statusCode = error instanceof MatchmakingError ? error.statusCode : 500;
    const code = error instanceof MatchmakingError ? error.code : "server_error";
    if (statusCode >= 500) console.error("[matchmaking]", error);
    return response.status(statusCode).json({
      ok: false,
      code,
      message: statusCode >= 500 ? "Online play is temporarily unavailable." : error.message
    });
  }
}

function applyHeaders(request, response) {
  const origin = String(request.headers.origin || "");
  if (isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
