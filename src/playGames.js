const NATIVE_PLUGIN = "GooglePlayGames";

export async function initializePlayGames() {
  const plugin = getPlugin();
  if (!plugin) return { available: false, authenticated: false };
  try {
    const result = await plugin.signIn();
    return { available: true, authenticated: Boolean(result?.authenticated) };
  } catch (error) {
    console.info("Play Games sign-in unavailable until Play Console IDs are configured.", error?.message ?? error);
    return { available: true, authenticated: false };
  }
}

export async function submitBestScore(score) {
  const plugin = getPlugin();
  const normalizedScore = Math.max(0, Math.round(Number(score) || 0));
  if (!plugin || normalizedScore <= 0) return false;
  try {
    await plugin.submitScore({ score: normalizedScore });
    return true;
  } catch (error) {
    console.info("Play Games score submission skipped.", error?.message ?? error);
    return false;
  }
}

export async function showPlayLeaderboard() {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    await plugin.showLeaderboard();
    return true;
  } catch (error) {
    console.info("Play Games leaderboard is not configured yet.", error?.message ?? error);
    return false;
  }
}

export function isPlayGamesAvailable() {
  return Boolean(getPlugin());
}

function getPlugin() {
  return globalThis.Capacitor?.Plugins?.[NATIVE_PLUGIN] ?? null;
}
