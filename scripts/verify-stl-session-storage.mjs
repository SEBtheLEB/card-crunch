import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SESSION_KEY = "cardCrunchStlSessionV1";
const TRANSACTION_KEY = "cardCrunchStlAuthTransactionV1";

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createMemoryStorage()
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: createMemoryStorage()
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { onLine: true, userAgent: "Card Crunch secure-storage verifier" }
});
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: {
    hostname: "card-crunch.vercel.app",
    origin: "https://card-crunch.vercel.app"
  }
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis
});

const {
  CardCrunchSTLClient,
  defaultScopes
} = await import(`../src/stlPlatformClient.js?secure-storage-verify=${Date.now()}`);

const config = Object.freeze({
  baseUrl: "https://accounts.stlproductionz.io",
  clientId: "card-crunch-mobile",
  gameId: "c32010e4-b054-4b59-a636-aa2c5a991d64",
  developmentRedirectUri: "cardcrunch-dev://auth/callback",
  productionRedirectUri: "cardcrunch://auth/callback"
});
const durableDeviceId = "78711b16-dad0-4f34-9870-30765ee988a6";
const userId = "1c5cedc2-156c-46eb-b01b-ea1e9b6fc8c1";
const sessionId = "4d4afc0e-2f6a-4ae0-94e2-619511539921";
let refreshMode = "success";
let refreshRequests = 0;
let signOutMode = "success";

const sessionPayload = ({
  accessToken = "card-crunch-access-token",
  refreshToken = "card-crunch-refresh-token",
  expiresAt = "2099-01-01T00:00:00.000Z"
} = {}) => ({
  accessToken,
  refreshToken,
  tokenType: "Bearer",
  expiresAt,
  refreshExpiresAt: "2099-02-01T00:00:00.000Z",
  scopes: defaultScopes(),
  sessionId,
  deviceId: durableDeviceId,
  userId
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/api/v1/auth/token")) {
    return Response.json(sessionPayload());
  }
  if (String(url).endsWith("/api/v1/auth/refresh")) {
    refreshRequests += 1;
    if (refreshMode === "invalid") {
      return Response.json({
        error: {
          code: "INVALID_REFRESH_TOKEN",
          message: "Refresh token is no longer valid."
        }
      }, { status: 401 });
    }
    return Response.json(sessionPayload({
      accessToken: "rotated-card-crunch-access-token",
      refreshToken: "rotated-card-crunch-refresh-token"
    }));
  }
  if (String(url).endsWith("/api/v1/auth/sign-out") && signOutMode === "fail") {
    return Response.json({
      error: {
        code: "PLATFORM_UNAVAILABLE",
        message: "Remote sign-out is unavailable."
      }
    }, { status: 503 });
  }
  return Response.json({});
};

for (const key of [
  SESSION_KEY,
  `cap_sec_${SESSION_KEY}`,
  `capacitor-storage_${SESSION_KEY}`
]) {
  localStorage.setItem(key, JSON.stringify({ refreshToken: "unsafe-browser-copy" }));
}

let webSecureStorageCalls = 0;
globalThis.Capacitor = {
  getPlatform: () => "web",
  isNativePlatform: () => false
};
globalThis.__CARD_CRUNCH_CAPACITOR_SECURE_STORAGE__ = {
  storage: {
    get: async () => { webSecureStorageCalls += 1; return null; },
    set: async () => { webSecureStorageCalls += 1; },
    remove: async () => { webSecureStorageCalls += 1; }
  },
  whenUnlockedThisDeviceOnly: 1
};

const webClient = new CardCrunchSTLClient(config);
assert.equal(webClient.storageSecurity, "memory-only");
const webTransaction = await webClient.beginSignIn();
await webClient.completeSignIn(
  `cardcrunch://auth/callback?code=web-code&state=${webTransaction.state}`
);
assert.equal(webSecureStorageCalls, 0, "the secure-storage plugin's plaintext web adapter must never run");
assert.equal(localStorage.getItem(SESSION_KEY), null);
assert.equal(localStorage.getItem(`cap_sec_${SESSION_KEY}`), null);
assert.equal(localStorage.getItem(`capacitor-storage_${SESSION_KEY}`), null);
assert.equal(
  await new CardCrunchSTLClient(config).restoreSession(),
  null,
  "browser refresh tokens must not survive a new client process"
);

const protectedValues = new Map();
const secureStorageCalls = [];
const nativeSecureStorage = {
  async setSynchronize(value) {
    secureStorageCalls.push(["setSynchronize", value]);
  },
  async setDefaultKeychainAccess(value) {
    secureStorageCalls.push(["setDefaultKeychainAccess", value]);
  },
  async get(key) {
    secureStorageCalls.push(["get", key]);
    if (protectedValues.get(key) === "__CORRUPT__") {
      const error = new Error("Stored session is corrupt.");
      error.code = "invalidData";
      throw error;
    }
    return protectedValues.has(key) ? structuredClone(protectedValues.get(key)) : null;
  },
  async set(key, value, convertDate, synchronize, access) {
    secureStorageCalls.push(["set", key, convertDate, synchronize, access]);
    protectedValues.set(key, structuredClone(value));
  },
  async remove(key) {
    secureStorageCalls.push(["remove", key]);
    return protectedValues.delete(key);
  }
};

globalThis.Capacitor = {
  getPlatform: () => "android",
  isNativePlatform: () => true
};
globalThis.__CARD_CRUNCH_CAPACITOR_SECURE_STORAGE__ = {
  storage: nativeSecureStorage,
  whenUnlockedThisDeviceOnly: 1
};

const nativeClientBeforeRestart = new CardCrunchSTLClient(config);
assert.equal(nativeClientBeforeRestart.storageSecurity, "os-protected");
const nativeTransaction = await nativeClientBeforeRestart.beginSignIn();
assert.ok(protectedValues.has(TRANSACTION_KEY), "native PKCE state must survive a process restart");
assert.equal(sessionStorage.getItem(TRANSACTION_KEY), null);

const nativeClientAfterRestart = new CardCrunchSTLClient(config);
await nativeClientAfterRestart.completeSignIn(
  `cardcrunch://auth/callback?code=native-code&state=${nativeTransaction.state}`
);
assert.equal(protectedValues.get(SESSION_KEY)?.refreshToken, "card-crunch-refresh-token");
assert.equal(protectedValues.has(TRANSACTION_KEY), false, "native PKCE state must be single-use");
const cancelledTransaction = await nativeClientAfterRestart.beginSignIn();
await assert.rejects(
  nativeClientAfterRestart.completeSignIn(
    `cardcrunch://auth/callback?error=access_denied&state=${cancelledTransaction.state}`
  ),
  (error) => error?.code === "AUTHORIZATION_DENIED"
);
assert.equal(
  protectedValues.has(TRANSACTION_KEY),
  false,
  "cancelled authorization must remove pending native PKCE state"
);
assert.equal(
  (await new CardCrunchSTLClient(config).restoreSession())?.userId,
  userId,
  "the protected native session must survive a new client process"
);
assert.ok(
  secureStorageCalls.some(([name, value]) => name === "setSynchronize" && value === false),
  "native session storage must disable iCloud synchronization"
);
assert.ok(
  secureStorageCalls.some(([name, value]) => name === "setDefaultKeychainAccess" && value === 1),
  "native sessions must use device-only Keychain access"
);

protectedValues.set(SESSION_KEY, sessionPayload({
  expiresAt: "2000-01-01T00:00:00.000Z"
}));
refreshRequests = 0;
const concurrentRefreshClient = new CardCrunchSTLClient(config);
const [firstRefresh, secondRefresh] = await Promise.all([
  concurrentRefreshClient.restoreSession(),
  concurrentRefreshClient.restoreSession()
]);
assert.equal(refreshRequests, 1, "concurrent requests must share one refresh-token rotation");
assert.equal(firstRefresh.refreshToken, "rotated-card-crunch-refresh-token");
assert.equal(secondRefresh.refreshToken, "rotated-card-crunch-refresh-token");
assert.equal(protectedValues.get(SESSION_KEY)?.refreshToken, "rotated-card-crunch-refresh-token");

protectedValues.set(SESSION_KEY, sessionPayload({
  expiresAt: "2000-01-01T00:00:00.000Z"
}));
refreshMode = "invalid";
await assert.rejects(
  new CardCrunchSTLClient(config).restoreSession(),
  (error) => error?.code === "INVALID_REFRESH_TOKEN"
);
assert.equal(
  protectedValues.has(SESSION_KEY),
  false,
  "a permanently rejected refresh token must be removed from protected storage"
);

refreshMode = "success";
protectedValues.set(SESSION_KEY, "__CORRUPT__");
assert.equal(
  await new CardCrunchSTLClient(config).restoreSession(),
  null,
  "corrupt protected sessions must be discarded"
);
assert.equal(protectedValues.has(SESSION_KEY), false);

protectedValues.set(SESSION_KEY, sessionPayload());
await new CardCrunchSTLClient(config).beginSignIn();
signOutMode = "fail";
await assert.rejects(
  new CardCrunchSTLClient(config).signOut(),
  (error) => error?.code === "PLATFORM_UNAVAILABLE"
);
assert.equal(
  protectedValues.has(SESSION_KEY),
  false,
  "local protected state must clear even if remote revocation is unavailable"
);
assert.equal(
  protectedValues.has(TRANSACTION_KEY),
  false,
  "local sign-out must clear pending native PKCE state"
);

delete globalThis.__CARD_CRUNCH_CAPACITOR_SECURE_STORAGE__;
const mispackagedNativeClient = new CardCrunchSTLClient(config);
assert.equal(mispackagedNativeClient.storageSecurity, "unavailable");
await assert.rejects(
  mispackagedNativeClient.restoreSession(),
  (error) => error?.code === "SECURE_STORAGE_UNAVAILABLE"
);

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.dependencies["@aparajita/capacitor-secure-storage"], "8.0.0");
const capacitorSettings = await readFile(resolve(root, "android/capacitor.settings.gradle"), "utf8");
assert.match(capacitorSettings, /aparajita-capacitor-secure-storage/);
const capacitorBuild = await readFile(resolve(root, "android/app/capacitor.build.gradle"), "utf8");
assert.match(capacitorBuild, /implementation project\(':aparajita-capacitor-secure-storage'\)/);

globalThis.fetch = originalFetch;
console.log("Verified OS-protected native STL sessions, durable native PKCE, single-flight refresh rotation, and memory-only browser auth.");
