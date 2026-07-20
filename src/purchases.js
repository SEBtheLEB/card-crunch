/* Google Play Billing abstraction. The web build never simulates a paid
   purchase; the Android billing provider must confirm the transaction. */
export const purchaseManager = {
  provider: null,

  setProvider(provider) {
    this.provider = provider ?? null;
  },

  isAvailable() {
    return Boolean(this.provider?.isReady?.()) || isExplicitDevelopmentMockEnabled();
  },

  isDevelopmentMock() {
    return !this.provider && isExplicitDevelopmentMockEnabled();
  },

  async getProduct(productId) {
    if (!this.provider?.getProduct) return null;
    try {
      return await this.provider.getProduct(productId);
    } catch {
      return null;
    }
  },

  async buy(productId) {
    if (!this.isAvailable()) return { success: false, reason: "unavailable" };
    if (this.isDevelopmentMock()) {
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      return {
        success: true,
        verified: true,
        developmentMock: true,
        transactionId: `dev-${productId}-${Date.now()}`
      };
    }
    try {
      const result = await this.provider.purchase?.(productId);
      return result?.verified === true
        ? { success: true, verified: true, transactionId: result.transactionId ?? "", receipt: result.receipt ?? null }
        : { success: false, reason: result?.reason ?? "unverified" };
    } catch {
      return { success: false, reason: "failed" };
    }
  },

  async restorePurchases() {
    if (!this.provider?.restorePurchases) return { success: false, reason: "unavailable", purchases: [] };
    try {
      const result = await this.provider.restorePurchases();
      return result?.verified === true
        ? { success: true, purchases: Array.isArray(result.purchases) ? result.purchases : [] }
        : { success: false, reason: result?.reason ?? "unverified", purchases: [] };
    } catch {
      return { success: false, reason: "failed", purchases: [] };
    }
  }
};

function isExplicitDevelopmentMockEnabled() {
  if (!globalThis.location) return false;
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  return localHost && new URLSearchParams(location.search).get("mock-billing") === "1";
}
