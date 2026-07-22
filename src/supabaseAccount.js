import {
  getAuthDiagnostics,
  getWebOAuthCallback,
  readAuthConfig,
  shouldShowAuthDiagnostics,
  validateAuthConfig
} from "./authConfig.js?v=179";

export const CARD_CRUNCH_AUTH_STORAGE_KEY = "card-crunch-auth-v1";
export const CARD_CRUNCH_AUTH_PROFILE_KEY = "cardCrunchAuthenticatedProfileV1";
export const CARD_CRUNCH_NATIVE_CALLBACK = "cardcrunch://auth/callback";

export function createCardCrunchSupabaseClient(config = readAuthConfig()) {
  const validatedConfig = validateAuthConfig(config);
  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== "function") {
    throw new Error("Card Crunch authentication could not load the Supabase client library.");
  }
  return createClient(validatedConfig.supabaseUrl, validatedConfig.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storageKey: CARD_CRUNCH_AUTH_STORAGE_KEY
    }
  });
}

export function initializeSupabaseAccount({ bindAction, showPage } = {}) {
  const config = readAuthConfig();
  const diagnostics = getAuthDiagnostics(config);
  const elements = getElements();
  let client = null;
  let user = null;
  let busy = false;

  renderDiagnostics(elements, diagnostics);

  const setStatus = (message, tone = "") => {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  };
  const setBusy = (value) => {
    busy = Boolean(value);
    [elements.google, elements.signOut].forEach((button) => {
      if (button) button.disabled = busy || !client;
    });
  };
  const render = (nextUser = user) => {
    user = nextUser || null;
    const signedIn = Boolean(user);
    elements.signedOut?.toggleAttribute("hidden", signedIn);
    elements.signedIn?.toggleAttribute("hidden", !signedIn);
    if (!signedIn) {
      persistPublicProfile(null);
      return;
    }
    const metadata = user.user_metadata || {};
    const displayName = metadata.full_name || metadata.name || user.email?.split("@")[0] || "Card Crunch Player";
    const avatarUrl = metadata.avatar_url || metadata.picture || "";
    if (elements.name) elements.name.textContent = displayName;
    if (elements.email) elements.email.textContent = user.email || "Google account connected";
    if (elements.initials) elements.initials.textContent = initials(displayName);
    if (elements.avatar) {
      elements.avatar.hidden = !avatarUrl;
      if (avatarUrl) elements.avatar.src = avatarUrl;
      else elements.avatar.removeAttribute("src");
    }
    persistPublicProfile({ id: user.id, displayName, email: user.email || "", avatarUrl });
  };

  const completeCallback = async (callbackUrl, { native = false } = {}) => {
    if (!client) return;
    const url = new URL(callbackUrl);
    const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (providerError) throw new Error(providerError);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google did not return an authorization code.");
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    render(data.user || data.session?.user || null);
    setBusy(false);
    setStatus("Signed in to your dedicated Card Crunch account.", "good");
    if (native) await closeNativeBrowser();
    else globalThis.history?.replaceState?.({}, "", "/");
    showPage?.("account");
  };

  const signInWithGoogle = async () => {
    if (!client || busy) return;
    setBusy(true);
    setStatus("Opening Google sign-in for Card Crunch...");
    try {
      const native = isNativePlatform();
      const redirectTo = native ? CARD_CRUNCH_NATIVE_CALLBACK : getWebOAuthCallback();
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: native }
      });
      if (error) throw error;
      if (native) {
        if (!data?.url) throw new Error("Supabase did not return the Google authorization URL.");
        await openNativeBrowser(data.url);
      }
    } catch (error) {
      setStatus(error.message || "Google sign-in could not start.", "bad");
      setBusy(false);
    }
  };

  bindAction?.(elements.google, signInWithGoogle);
  bindAction?.(elements.signOut, async () => {
    if (!client || busy) return;
    setBusy(true);
    const { error } = await client.auth.signOut();
    if (error) setStatus(error.message, "bad");
    else {
      render(null);
      setStatus("Signed out of Card Crunch on this device.");
    }
    setBusy(false);
  });

  const boot = async () => {
    try {
      client = createCardCrunchSupabaseClient(config);
      globalThis.cardCrunchAuth = { client, get user() { return user; } };
      setBusy(false);
      client.auth.onAuthStateChange((_event, session) => {
        render(session?.user || null);
        setBusy(false);
      });
      await installNativeCallbackListener((url) => completeCallback(url, { native: true }));
      if (globalThis.location?.pathname === "/auth/callback") {
        setStatus("Finishing Google sign-in...");
        await completeCallback(globalThis.location.href);
        return;
      }
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      render(data.session?.user || null);
      setStatus(data.session ? "Your Card Crunch account is connected." : "Sign in with Google to create your Card Crunch account.", data.session ? "good" : "");
    } catch (error) {
      client = null;
      globalThis.cardCrunchAuth = null;
      render(null);
      setBusy(true);
      setStatus(error.message || "Card Crunch authentication is unavailable.", "bad");
      if (isDevelopmentHost()) console.error("[Card Crunch auth]", error);
    }
  };

  setBusy(true);
  void boot();
  return { get client() { return client; }, get user() { return user; }, signInWithGoogle };
}

function getElements() {
  return {
    signedOut: document.querySelector("#cardCrunchAccountSignedOut"),
    signedIn: document.querySelector("#cardCrunchAccountSignedIn"),
    google: document.querySelector("#cardCrunchGoogleSignInButton"),
    signOut: document.querySelector("#cardCrunchSignOutButton"),
    status: document.querySelector("#cardCrunchAccountStatus"),
    avatar: document.querySelector("#cardCrunchAccountAvatar"),
    initials: document.querySelector("#cardCrunchAccountInitials"),
    name: document.querySelector("#cardCrunchAccountName"),
    email: document.querySelector("#cardCrunchAccountEmail"),
    diagnostics: document.querySelector("#authDiagnostics")
  };
}

function renderDiagnostics(elements, diagnostics) {
  if (!elements.diagnostics || !shouldShowAuthDiagnostics()) return;
  elements.diagnostics.hidden = false;
  const values = {
    authDiagnosticOrigin: diagnostics.origin,
    authDiagnosticCallback: diagnostics.callback,
    authDiagnosticProjectRef: diagnostics.projectRef,
    authDiagnosticVariables: Object.entries(diagnostics.variables).map(([name, present]) => `${name}: ${present ? "present" : "missing"}`).join(" | ")
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = value;
  }
}

function persistPublicProfile(profile) {
  try {
    if (profile) localStorage.setItem(CARD_CRUNCH_AUTH_PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(CARD_CRUNCH_AUTH_PROFILE_KEY);
  } catch {}
  globalThis.dispatchEvent?.(new CustomEvent("card-crunch-auth-change", { detail: { profile } }));
}

function isNativePlatform() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.()) || globalThis.location?.protocol === "capacitor:";
}

function isDevelopmentHost() {
  return ["localhost", "127.0.0.1", "[::1]"].includes(String(globalThis.location?.hostname || "").toLowerCase());
}

async function installNativeCallbackListener(onUrl) {
  const appPlugin = globalThis.Capacitor?.Plugins?.App;
  if (!isNativePlatform() || typeof appPlugin?.addListener !== "function") return;
  await appPlugin.addListener("appUrlOpen", ({ url }) => {
    if (String(url || "").startsWith(CARD_CRUNCH_NATIVE_CALLBACK)) void onUrl(url);
  });
}

async function openNativeBrowser(url) {
  const browserPlugin = globalThis.Capacitor?.Plugins?.Browser;
  if (typeof browserPlugin?.open !== "function") throw new Error("The native browser plugin is unavailable.");
  await browserPlugin.open({ url, presentationStyle: "popover" });
}

async function closeNativeBrowser() {
  try { await globalThis.Capacitor?.Plugins?.Browser?.close?.(); } catch {}
}

function initials(value) {
  return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CC";
}
