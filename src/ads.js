/*
 * Ad manager abstraction for Card Crunch.
 *
 * No real ad SDK is bundled. To integrate Google AdMob (or any Google
 * Play-compatible provider), assign `adManager.provider` to an object with:
 *
 *   isRewardedReady(): boolean
 *   showRewarded({ onReward, onDismiss, onFail }): void
 *   isInterstitialReady(): boolean            (optional)
 *   showInterstitial({ onDismiss }): void     (optional)
 *
 * Until a provider is connected, rewarded ads use a visible placeholder
 * overlay (3s countdown + claim) so the whole reward loop is testable,
 * and interstitials are silently skipped.
 */

const AD_STATS_KEY = "cardCrunchAdStats";
const POINTER_CLICK_SUPPRESS_MS = 900;
let lastPointerActionAt = -Infinity;

const INTERSTITIAL_RULES = {
  minRunsBetween: 4,
  minRunDurationMs: 30000,
  minMsAfterRewarded: 60000,
  minMsBetween: 120000
};

function loadStats() {
  try {
    const stats = JSON.parse(localStorage.getItem(AD_STATS_KEY) ?? "null");
    return stats && typeof stats === "object" ? stats : {};
  } catch {
    return {};
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(AD_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Storage errors must never break gameplay.
  }
}

export const adManager = {
  provider: null,

  canShowRewardedAd() {
    if (this.provider) return Boolean(this.provider.isRewardedReady?.());
    return true;
  },

  /*
   * Shows a rewarded ad and resolves `true` only when the reward was earned.
   * `rewardType` is a label ("revive", "recoverLost", "bonusBank", "shield",
   * "hint") recorded for analytics and passed to the provider.
   */
  async showRewardedAd(rewardType) {
    if (!this.canShowRewardedAd()) return false;

    const earned = this.provider
      ? await showProviderRewarded(this.provider, rewardType)
      : await showPlaceholderRewarded(rewardType);

    if (earned) {
      const stats = loadStats();
      stats.rewardedWatched = (stats.rewardedWatched ?? 0) + 1;
      stats.lastRewardedAt = Date.now();
      stats.lastRewardType = rewardType;
      saveStats(stats);
    }
    return earned;
  },

  /* Call once per fully completed run (after the loss is accepted). */
  registerCompletedRun({ durationMs = 0 } = {}) {
    const stats = loadStats();
    stats.runsSinceLastInterstitial = (stats.runsSinceLastInterstitial ?? 0) + 1;
    stats.lastRunDurationMs = durationMs;
    saveStats(stats);
  },

  /*
   * Interstitials are intentionally rare. Rules: only after several full
   * runs, never after short runs, never right after a rewarded ad, never
   * right after unlocking a pot. With no provider this is a no-op (the
   * pacing counters still tick so a future SDK drop-in behaves correctly).
   */
  maybeShowInterstitial({ runDurationMs = 0, justUnlockedPot = false } = {}) {
    const stats = loadStats();
    const now = Date.now();
    const eligible =
      !justUnlockedPot &&
      runDurationMs >= INTERSTITIAL_RULES.minRunDurationMs &&
      (stats.runsSinceLastInterstitial ?? 0) >= INTERSTITIAL_RULES.minRunsBetween &&
      now - (stats.lastRewardedAt ?? 0) >= INTERSTITIAL_RULES.minMsAfterRewarded &&
      now - (stats.lastInterstitialAt ?? 0) >= INTERSTITIAL_RULES.minMsBetween;

    if (!eligible) return false;
    if (!this.provider?.isInterstitialReady?.()) return false;

    stats.runsSinceLastInterstitial = 0;
    stats.lastInterstitialAt = now;
    saveStats(stats);
    this.provider.showInterstitial?.({ onDismiss: () => {} });
    return true;
  }
};

function showProviderRewarded(provider, rewardType) {
  return new Promise((resolve) => {
    let rewarded = false;
    try {
      provider.showRewarded({
        rewardType,
        onReward: () => {
          rewarded = true;
        },
        onDismiss: () => resolve(rewarded),
        onFail: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });
}

function showPlaceholderRewarded(rewardType) {
  return new Promise((resolve) => {
    const overlay = document.createElement("section");
    overlay.className = "ad-placeholder-overlay";
    overlay.setAttribute("aria-label", "Rewarded ad placeholder");
    overlay.innerHTML = `
      <div class="ad-placeholder-card">
        <button type="button" class="ad-placeholder-close" aria-label="Close ad, no reward">&times;</button>
        <span class="ad-placeholder-tag">Rewarded Ad &middot; ${rewardType}</span>
        <strong class="ad-placeholder-count">3</strong>
        <p>Placeholder &mdash; connect a real SDK via <b>adManager.provider</b> in src/ads.js.</p>
        <button type="button" class="ad-placeholder-claim" disabled>Reward in 3&hellip;</button>
      </div>
    `;

    const countEl = overlay.querySelector(".ad-placeholder-count");
    const claimEl = overlay.querySelector(".ad-placeholder-claim");
    const closeEl = overlay.querySelector(".ad-placeholder-close");
    let remaining = 3;
    let settled = false;

    const finish = (earned) => {
      if (settled) return;
      settled = true;
      window.clearInterval(tickId);
      overlay.remove();
      resolve(earned);
    };

    const tickId = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        countEl.textContent = String(remaining);
        claimEl.textContent = `Reward in ${remaining}...`;
        return;
      }
      window.clearInterval(tickId);
      countEl.textContent = "OK";
      claimEl.disabled = false;
      claimEl.textContent = "CLAIM REWARD";
    }, 1000);

    bindInstantAdButton(claimEl, () => {
      if (claimEl.disabled) return;
      finish(true);
    });
    bindInstantAdButton(closeEl, () => finish(false));
    document.body.appendChild(overlay);
  });
}

function bindInstantAdButton(button, action) {
  if (!button || typeof action !== "function") return;
  button.addEventListener("pointerup", (event) => {
    if (button.disabled) return;
    lastPointerActionAt = performance.now();
    event.preventDefault();
    event.stopPropagation();
    action(event);
  });
  button.addEventListener("click", (event) => {
    if (button.disabled) return;
    if (performance.now() - lastPointerActionAt < POINTER_CLICK_SUPPRESS_MS) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    action(event);
  });
}
