export const AUTH_ENV_NAMES = Object.freeze({
  supabaseUrl: "VITE_SUPABASE_URL",
  supabaseAnonKey: "VITE_SUPABASE_ANON_KEY",
  appUrl: "VITE_APP_URL"
});

export class AuthConfigurationError extends Error {
  constructor(missing = [], invalid = []) {
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.join(", ")}`);
    if (invalid.length) parts.push(`invalid ${invalid.join(", ")}`);
    super(`Card Crunch authentication is not configured: ${parts.join("; ")}. Use this app's dedicated Supabase project values.`);
    this.name = "AuthConfigurationError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

export function readAuthConfig(source = globalThis.__CARD_CRUNCH_AUTH_CONFIG__) {
  return Object.freeze({
    supabaseUrl: String(source?.supabaseUrl || "").trim().replace(/\/$/, ""),
    supabaseAnonKey: String(source?.supabaseAnonKey || "").trim(),
    appUrl: String(source?.appUrl || "").trim().replace(/\/$/, "")
  });
}

export function validateAuthConfig(config = readAuthConfig()) {
  const missing = Object.entries(AUTH_ENV_NAMES)
    .filter(([key]) => !config[key])
    .map(([, envName]) => envName);
  const invalid = [];
  if (config.supabaseUrl && !isDedicatedSupabaseUrl(config.supabaseUrl)) invalid.push(AUTH_ENV_NAMES.supabaseUrl);
  if (config.supabaseAnonKey && /REPLACE|YOUR_|placeholder/i.test(config.supabaseAnonKey)) invalid.push(AUTH_ENV_NAMES.supabaseAnonKey);
  if (config.appUrl && !isHttpUrl(config.appUrl)) invalid.push(AUTH_ENV_NAMES.appUrl);
  if (missing.length || invalid.length) throw new AuthConfigurationError(missing, invalid);
  return config;
}

export function getSupabaseProjectRef(config = readAuthConfig()) {
  try {
    const host = new URL(config.supabaseUrl).hostname.toLowerCase();
    return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function getWebOAuthCallback(locationLike = globalThis.location) {
  return new URL("/auth/callback", locationLike?.origin || "http://localhost:4183").href;
}

export function getAuthDiagnostics(config = readAuthConfig(), locationLike = globalThis.location) {
  return Object.freeze({
    origin: String(locationLike?.origin || "unavailable"),
    callback: getWebOAuthCallback(locationLike),
    projectRef: getSupabaseProjectRef(config),
    variables: Object.freeze({
      VITE_SUPABASE_URL: Boolean(config.supabaseUrl),
      VITE_SUPABASE_ANON_KEY: Boolean(config.supabaseAnonKey),
      VITE_APP_URL: Boolean(config.appUrl)
    })
  });
}

export function shouldShowAuthDiagnostics(locationLike = globalThis.location) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(String(locationLike?.hostname || "").toLowerCase());
}

function isDedicatedSupabaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
