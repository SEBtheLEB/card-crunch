import {
  CARD_CRUNCH_SAVE_FORMAT_VERSION,
  CARD_CRUNCH_SAVE_SLOT_KEY
} from "./stlPlatformConfig.js?v=189";
import { sha256Hex } from "./stlPlatformClient.js?v=189";

const CLOUD_META_KEY = "cardCrunchStlCloudMetaV1";
const SAVE_KEYS = Object.freeze([
  "cardCrunchBestScore",
  "cardCrunchBestStreak",
  "cardCrunchTotalCrunches",
  "cardCrunchLevelPots",
  "cardCrunchCoins",
  "cardCrunchEconomyV1",
  "cardCrunchCardCollectionV1",
  "cardCrunchStoreV1",
  "cardCrunchShieldToken",
  "cardCrunchTheme",
  "cardCrunchCardSkin"
]);

export async function createCardCrunchSaveUpload({ state, gameId, deviceId, gameBuild }) {
  const snapshot = createLocalSaveSnapshot(state);
  const serialized = stableStringify(snapshot);
  const bytes = new TextEncoder().encode(serialized);
  const checksum = await sha256Hex(bytes);
  const meta = readCloudMeta();
  return {
    data: bytes,
    checksum,
    gameId,
    deviceId,
    gameBuild,
    slotKey: CARD_CRUNCH_SAVE_SLOT_KEY,
    displayName: "Card Crunch Progress",
    expectedRevision: meta.revision,
    parentVersionId: meta.versionId || undefined,
    saveFormatVersion: CARD_CRUNCH_SAVE_FORMAT_VERSION,
    compression: "none",
    clientCreatedAt: new Date().toISOString(),
    progressSummary: createProgressSummary(snapshot),
    playSeconds: Math.max(0, Math.floor((Date.now() - Number(state?.runStartedAt || Date.now())) / 1000))
  };
}

export function createLocalSaveSnapshot(state = {}) {
  const storage = {};
  for (const key of SAVE_KEYS) storage[key] = safeGet(key);
  const pots = Array.isArray(state.pots)
    ? state.pots.map((pot) => ({ id: pot.id, progress: pot.progress, target: pot.target, complete: Boolean(pot.complete) }))
    : parseJson(storage.cardCrunchLevelPots, []);
  return {
    schema: 1,
    app: "Card Crunch",
    capturedAt: new Date().toISOString(),
    stats: {
      bestScore: Math.max(0, Number(storage.cardCrunchBestScore) || Number(state.bestScore) || 0),
      bestStreak: Math.max(0, Number(storage.cardCrunchBestStreak) || Number(state.bestRunStreak) || 0),
      totalCrunches: Math.max(0, Number(storage.cardCrunchTotalCrunches) || 0),
      coins: Math.max(0, Number(storage.cardCrunchCoins) || 0)
    },
    progress: {
      pots,
      economy: parseJson(storage.cardCrunchEconomyV1, null),
      cardCollection: parseJson(storage.cardCrunchCardCollectionV1, null),
      store: parseJson(storage.cardCrunchStoreV1, null),
      shieldToken: storage.cardCrunchShieldToken === "1",
      theme: storage.cardCrunchTheme || "midnight-gold",
      cardSkin: storage.cardCrunchCardSkin || "classic"
    },
    storage
  };
}

export function applyCloudSaveSnapshot(snapshot, { applyCloudProgress } = {}) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.app !== "Card Crunch") {
    return { applied: false, reason: "not-card-crunch" };
  }
  if (snapshot.schema !== 1) return { applied: false, reason: "unsupported-save-version" };
  if (applyCloudProgress) applyCloudProgress({ stats: snapshot.stats, progress: snapshot.progress });
  return { applied: true };
}

export function noteCloudUploadResult(result) {
  const version = result?.version;
  const slot = result?.slot;
  if (!version && !slot) return;
  writeCloudMeta({
    revision: Math.max(0, Number(version?.revision ?? slot?.currentRevision) || 0),
    versionId: version?.saveVersionId || slot?.currentVersionId || "",
    slotId: slot?.slotId || version?.slotId || "",
    updatedAt: new Date().toISOString()
  });
}

export function detectSaveConflict({ localSnapshot, remoteVersion }) {
  const localUpdated = Date.parse(localSnapshot?.capturedAt || 0);
  const remoteUpdated = Date.parse(remoteVersion?.clientCreatedAt || remoteVersion?.serverReceivedAt || 0);
  const meta = readCloudMeta();
  if (!remoteVersion || !remoteVersion.revision) return { conflict: false };
  if (remoteVersion.revision > meta.revision && localUpdated > remoteUpdated) {
    return {
      conflict: true,
      reason: "local-and-cloud-both-advanced",
      localUpdatedAt: localSnapshot.capturedAt,
      remoteUpdatedAt: remoteVersion.clientCreatedAt || remoteVersion.serverReceivedAt
    };
  }
  return { conflict: false };
}

export function readCloudMeta() {
  return {
    revision: 0,
    versionId: "",
    slotId: "",
    ...parseJson(safeGet(CLOUD_META_KEY), {})
  };
}

function writeCloudMeta(meta) {
  try { localStorage.setItem(CLOUD_META_KEY, JSON.stringify(meta)); } catch {}
}

function createProgressSummary(snapshot) {
  const pots = Array.isArray(snapshot.progress?.pots) ? snapshot.progress.pots : [];
  const completedPots = pots.filter((pot) => pot.complete).length;
  const activePot = pots.find((pot) => !pot.complete) || pots[pots.length - 1] || null;
  return {
    bestScore: snapshot.stats.bestScore,
    bestStreak: snapshot.stats.bestStreak,
    totalCrunches: snapshot.stats.totalCrunches,
    coins: snapshot.stats.coins,
    completedPots,
    activePotId: activePot?.id ?? 0,
    activePotProgress: activePot?.progress ?? 0
  };
}

function safeGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
