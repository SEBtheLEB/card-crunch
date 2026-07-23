export const CARD_CRUNCH_STL_GAME_ID = "c32010e4-b054-4b59-a636-aa2c5a991d64";
export const CARD_CRUNCH_STL_CLIENT_ID = "card-crunch-mobile";
export const CARD_CRUNCH_DEV_CALLBACK = "cardcrunch-dev://auth/callback";
export const CARD_CRUNCH_PROD_CALLBACK = "cardcrunch://auth/callback";
export const CARD_CRUNCH_SAVE_SLOT_KEY = "card-crunch-primary";
export const CARD_CRUNCH_SAVE_FORMAT_VERSION = "card-crunch-save-v1";

export const STL_ENV_NAMES = Object.freeze({
  baseUrl: "VITE_STL_PLATFORM_URL",
  clientId: "VITE_STL_CLIENT_ID",
  gameId: "VITE_STL_GAME_ID",
  developmentRedirectUri: "VITE_STL_REDIRECT_URI_DEV",
  productionRedirectUri: "VITE_STL_REDIRECT_URI_PROD"
});

export class STLPlatformConfigurationError extends Error {
  constructor(missing = [], invalid = []) {
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.join(", ")}`);
    if (invalid.length) parts.push(`invalid ${invalid.join(", ")}`);
    super(`Card Crunch STL Platform is not configured: ${parts.join("; ")}.`);
    this.name = "STLPlatformConfigurationError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

export function readSTLPlatformConfig(source = globalThis.__CARD_CRUNCH_STL_CONFIG__) {
  return Object.freeze({
    baseUrl: String(source?.baseUrl || "").trim().replace(/\/+$/, ""),
    clientId: String(source?.clientId || CARD_CRUNCH_STL_CLIENT_ID).trim(),
    gameId: String(source?.gameId || CARD_CRUNCH_STL_GAME_ID).trim(),
    developmentRedirectUri: String(source?.developmentRedirectUri || CARD_CRUNCH_DEV_CALLBACK).trim(),
    productionRedirectUri: String(source?.productionRedirectUri || CARD_CRUNCH_PROD_CALLBACK).trim()
  });
}

export function getRuntimeRedirectUri(config = readSTLPlatformConfig(), locationLike = globalThis.location) {
  const host = String(locationLike?.hostname || "").toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return local ? config.developmentRedirectUri : config.productionRedirectUri;
}

export function validateSTLPlatformConfig(config = readSTLPlatformConfig(), locationLike = globalThis.location) {
  const missing = [];
  const invalid = [];
  if (!config.baseUrl) missing.push(STL_ENV_NAMES.baseUrl);
  if (!config.clientId) missing.push(STL_ENV_NAMES.clientId);
  if (!config.gameId) missing.push(STL_ENV_NAMES.gameId);
  if (!config.developmentRedirectUri) missing.push(STL_ENV_NAMES.developmentRedirectUri);
  if (!config.productionRedirectUri) missing.push(STL_ENV_NAMES.productionRedirectUri);

  if (config.baseUrl && !isHttpsOrLoopback(config.baseUrl)) invalid.push(STL_ENV_NAMES.baseUrl);
  if (config.clientId && !/^[a-z][a-z0-9._-]{2,127}$/.test(config.clientId)) invalid.push(STL_ENV_NAMES.clientId);
  if (config.gameId && !isUuid(config.gameId)) invalid.push(STL_ENV_NAMES.gameId);
  if (config.developmentRedirectUri && config.developmentRedirectUri !== CARD_CRUNCH_DEV_CALLBACK) invalid.push(STL_ENV_NAMES.developmentRedirectUri);
  if (config.productionRedirectUri && config.productionRedirectUri !== CARD_CRUNCH_PROD_CALLBACK) invalid.push(STL_ENV_NAMES.productionRedirectUri);
  if (getRuntimeRedirectUri(config, locationLike) && !isAllowedCardCrunchCallback(getRuntimeRedirectUri(config, locationLike))) {
    invalid.push("runtimeRedirectUri");
  }

  if (missing.length || invalid.length) throw new STLPlatformConfigurationError(missing, invalid);
  return config;
}

export function isAllowedCardCrunchCallback(value) {
  return value === CARD_CRUNCH_DEV_CALLBACK || value === CARD_CRUNCH_PROD_CALLBACK;
}

export function getSTLPlatformDiagnostics(config = readSTLPlatformConfig(), locationLike = globalThis.location) {
  return Object.freeze({
    origin: String(locationLike?.origin || "native"),
    baseUrl: config.baseUrl || "unconfigured",
    clientId: config.clientId || "unconfigured",
    gameId: config.gameId || "unconfigured",
    redirectUri: getRuntimeRedirectUri(config, locationLike),
    callbacks: `${CARD_CRUNCH_DEV_CALLBACK} | ${CARD_CRUNCH_PROD_CALLBACK}`,
    variables: Object.freeze({
      [STL_ENV_NAMES.baseUrl]: Boolean(config.baseUrl),
      [STL_ENV_NAMES.clientId]: Boolean(config.clientId),
      [STL_ENV_NAMES.gameId]: Boolean(config.gameId),
      [STL_ENV_NAMES.developmentRedirectUri]: Boolean(config.developmentRedirectUri),
      [STL_ENV_NAMES.productionRedirectUri]: Boolean(config.productionRedirectUri)
    })
  });
}

export function shouldShowSTLDiagnostics(locationLike = globalThis.location) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(String(locationLike?.hostname || "").toLowerCase());
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHttpsOrLoopback(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
