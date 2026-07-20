const API_BASE = "https://stlproductionz.io/api/games";
const GAME_ID = "card-crunch";
const SESSION_KEY = "stl_account_session_v1";

export class STLAccountClient extends EventTarget {
  constructor({ apiBase = API_BASE, gameId = GAME_ID, storage = globalThis.localStorage } = {}) {
    super();
    this.apiBase = String(apiBase).replace(/\/+$/, "");
    this.gameId = gameId;
    this.storage = storage;
    this.session = readSession(storage);
  }

  get signedIn() {
    return Boolean(this.session?.accessToken);
  }

  get user() {
    return this.session?.user || null;
  }

  async signInWithGoogle() {
    const url = new URL(`${this.apiBase}/auth/google/start`);
    url.searchParams.set("return_to", globalThis.location.href);
    const popup = globalThis.open(url, "stl-account-google", "popup,width=520,height=720");
    if (!popup) throw new Error("Allow popups to continue with Google");

    const expectedOrigin = new URL(this.apiBase).origin;
    const result = await new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => finish(() => reject(new Error("Google sign-in timed out"))), 5 * 60 * 1000);
      const poll = globalThis.setInterval(() => {
        if (popup.closed) finish(() => reject(new Error("Google sign-in was cancelled")));
      }, 500);
      const onMessage = (event) => {
        if (event.origin !== expectedOrigin || event.data?.type !== "stl-account-google-result") return;
        finish(() => event.data?.ok && event.data?.session
          ? resolve(event.data)
          : reject(new Error("Google sign-in failed")));
      };
      const finish = (callback) => {
        globalThis.clearTimeout(timeout);
        globalThis.clearInterval(poll);
        globalThis.removeEventListener("message", onMessage);
        try { popup.close(); } catch {}
        callback();
      };
      globalThis.addEventListener("message", onMessage);
    });

    this.setSession(result.session);
    return result.user;
  }

  async refresh() {
    if (!this.session?.refreshToken) throw new Error("Sign in to continue");
    const payload = await this.request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: this.session.refreshToken },
      authenticated: false
    });
    this.setSession(payload.session);
    return payload.user;
  }

  async signOut() {
    try { await this.request("/auth/logout", { method: "POST" }); } catch {}
    this.setSession(null);
  }

  getProfile() {
    return this.request("/profile");
  }

  getProgress() {
    return this.request(`/progress?gameId=${encodeURIComponent(this.gameId)}`);
  }

  syncProgress(progress) {
    return this.request("/progress", {
      method: "PUT",
      body: { ...progress, gameId: this.gameId }
    });
  }

  async request(path, { method = "GET", body, authenticated = true, retry = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated && this.session?.accessToken) headers["X-STL-Account-Token"] = this.session.accessToken;
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      mode: "cors",
      credentials: "omit",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && retry && authenticated && this.session?.refreshToken) {
      await this.refresh();
      return this.request(path, { method, body, authenticated, retry: false });
    }
    if (!response.ok || payload.ok === false) throw new Error(payload.message || "STL Account request failed");
    return payload;
  }

  setSession(session) {
    this.session = session?.accessToken ? session : null;
    try {
      if (this.session) this.storage?.setItem(SESSION_KEY, JSON.stringify(this.session));
      else this.storage?.removeItem(SESSION_KEY);
    } catch {}
    this.dispatchEvent(new Event("sessionchange"));
  }
}

export function initializeSTLAccount({ getState, applyCloudProgress, bindAction } = {}) {
  const client = new STLAccountClient();
  const elements = {
    signedOut: document.querySelector("#stlAccountSignedOut"),
    signedIn: document.querySelector("#stlAccountSignedIn"),
    google: document.querySelector("#stlGoogleSignInButton"),
    signOut: document.querySelector("#stlSignOutButton"),
    sync: document.querySelector("#stlSyncButton"),
    status: document.querySelector("#stlAccountStatus"),
    avatar: document.querySelector("#stlAccountAvatar"),
    initials: document.querySelector("#stlAccountInitials"),
    name: document.querySelector("#stlAccountName"),
    email: document.querySelector("#stlAccountEmail"),
    syncTime: document.querySelector("#stlAccountSyncTime")
  };

  const setBusy = (busy) => {
    [elements.google, elements.signOut, elements.sync].forEach((button) => {
      if (button) button.disabled = busy;
    });
  };
  const setStatus = (message, tone = "") => {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  };

  const render = (profile = null) => {
    const signedIn = client.signedIn;
    elements.signedOut?.toggleAttribute("hidden", signedIn);
    elements.signedIn?.toggleAttribute("hidden", !signedIn);
    if (!signedIn) return;
    const user = profile?.profile || profile?.user || client.user || {};
    const displayName = user.displayName || user.display_name || user.email?.split("@")[0] || "STL Player";
    if (elements.name) elements.name.textContent = displayName;
    if (elements.email) elements.email.textContent = user.email || client.user?.email || "Shared STL Account";
    if (elements.initials) elements.initials.textContent = initials(displayName);
    const avatarUrl = user.avatarUrl || user.avatar_url || "";
    if (elements.avatar) {
      elements.avatar.hidden = !avatarUrl;
      if (avatarUrl) elements.avatar.src = avatarUrl;
    }
  };

  const sync = async ({ quiet = false } = {}) => {
    if (!client.signedIn) return;
    setBusy(true);
    if (!quiet) setStatus("Syncing your Card Crunch record...");
    try {
      const state = getState?.() || {};
      const result = await client.syncProgress(buildCardCrunchProgressSnapshot({ state }));
      const stamp = new Date(result.game?.statsUpdatedAt || Date.now()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      if (elements.syncTime) elements.syncTime.textContent = `Last synced ${stamp}`;
      setStatus("Your progress and achievements are connected to STL Productionz.", "good");
    } catch (error) {
      setStatus(error.message || "Progress could not sync right now.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const hydrate = async () => {
    render();
    if (!client.signedIn) {
      setStatus("Sign in once and Card Crunch will appear on your STL profile.");
      return;
    }
    setBusy(true);
    setStatus("Connecting your shared profile...");
    try {
      const [profile, cloud] = await Promise.all([client.getProfile(), client.getProgress()]);
      applyCloudProgress?.(cloud.game);
      render(profile);
      await sync({ quiet: true });
    } catch (error) {
      setStatus(error.message || "Your STL profile could not load.", "bad");
    } finally {
      setBusy(false);
    }
  };

  bindAction(elements.google, async () => {
    setBusy(true);
    setStatus("Opening secure Google sign-in...");
    try {
      await client.signInWithGoogle();
      await hydrate();
    } catch (error) {
      setStatus(error.message || "Google sign-in could not finish.", "bad");
      setBusy(false);
    }
  });
  bindAction(elements.sync, () => sync());
  bindAction(elements.signOut, async () => {
    setBusy(true);
    await client.signOut();
    render();
    setStatus("Signed out of Card Crunch on this device.");
    setBusy(false);
  });
  client.addEventListener("sessionchange", () => render());
  window.addEventListener("card-crunch-menu-page-change", (event) => {
    if (event.detail?.pageName === "account") hydrate();
    else if (event.detail?.pageName === "home" && client.signedIn) sync({ quiet: true });
  });
  window.addEventListener("focus", () => {
    if (client.signedIn) sync({ quiet: true });
  });
  hydrate();
  return { client, sync };
}

export function buildCardCrunchProgressSnapshot({ state = {}, storage = globalThis.localStorage } = {}) {
  const bestScore = Math.max(0, integer(state.bestScore || readNumber(storage, "cardCrunchBestScore")));
  const bestStreak = Math.max(0, integer(state.bestRunStreak || state.streak || readNumber(storage, "cardCrunchBestStreak")));
  const totalCrunches = Math.max(0, integer(readNumber(storage, "cardCrunchTotalCrunches")));
  const pots = Array.isArray(state.pots) ? state.pots : readJson(storage, "cardCrunchLevelPots", []);
  const potsCleared = pots.filter((pot) => pot?.complete || Number(pot?.progress) >= Number(pot?.target) && Number(pot?.target) > 0).length;
  const coins = Math.max(0, integer(readNumber(storage, "cardCrunchCoins")));
  const now = new Date().toISOString();
  const achievementSpecs = [
    ["first-crunch", "First Crunch", "Complete your first successful Crunch.", totalCrunches >= 1, Math.min(1, totalCrunches)],
    ["streak-ten", "Hot Hand", "Reach a 10-Crunch streak.", bestStreak >= 10, Math.min(1, bestStreak / 10)],
    ["million-run", "Million-Dollar Hand", "Score at least 1,000,000 in a run.", bestScore >= 1_000_000, Math.min(1, bestScore / 1_000_000)],
    ["pot-collector", "Pot Collector", "Clear 10 challenge pots.", potsCleared >= 10, Math.min(1, potsCleared / 10)]
  ];
  const achievements = Object.fromEntries(achievementSpecs.map(([id, title, description, unlocked, progress]) => [id, {
    title,
    description,
    points: 100,
    progress,
    unlocked,
    unlockedAt: unlocked ? now : ""
  }]));

  return {
    stats: { bestScore, bestStreak, totalCrunches, potsCleared, coins },
    totals: { achievements: achievementSpecs.filter((entry) => entry[3]).length },
    achievements,
    progress: {
      version: 1,
      pots: pots.map((pot) => ({ id: integer(pot?.id), progress: Math.max(0, Number(pot?.progress) || 0), complete: Boolean(pot?.complete) })),
      wallet: { coins }
    },
    metadata: { platform: "card-crunch-web", syncedAt: now }
  };
}

function readSession(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SESSION_KEY) || "null");
    return value?.accessToken ? value : null;
  } catch {
    return null;
  }
}

function readNumber(storage, key) {
  try { return Number(storage?.getItem(key)) || 0; } catch { return 0; }
}

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || "null") || fallback; } catch { return fallback; }
}

function integer(value) {
  return Math.floor(Number(value) || 0);
}

function initials(value) {
  return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "STL";
}

export const STL_ACCOUNT_API_BASE = API_BASE;
