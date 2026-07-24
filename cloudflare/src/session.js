import { SESSION_LIFETIME_MS, sanitizeId } from "./protocol.js";

const encoder = new TextEncoder();

export async function createSignedSession(secret, now = Date.now()) {
  assertSecret(secret);
  const payload = {
    id: crypto.randomUUID(),
    exp: now + SESSION_LIFETIME_MS
  };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = await sign(secret, encoded);
  return {
    playerId: payload.id,
    sessionToken: `${encoded}.${signature}`,
    expiresAt: payload.exp
  };
}

export async function verifySignedSession(secret, playerId, token, now = Date.now()) {
  assertSecret(secret);
  const safeId = sanitizeId(playerId);
  const [encoded, suppliedSignature] = String(token || "").split(".");
  if (!safeId || !encoded || !suppliedSignature) return false;
  const expectedSignature = await sign(secret, encoded);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded));
    return payload.id === safeId && Number(payload.exp) > now;
  } catch {
    return false;
  }
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function encodeBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function assertSecret(secret) {
  if (String(secret || "").length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
}
