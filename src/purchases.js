/* Google Play Billing abstraction. The web build never simulates a paid
   purchase; the Android billing provider must confirm the transaction. */
export const purchaseManager = {
  provider: null,

  isAvailable() {
    return Boolean(this.provider?.isReady?.());
  },

  async buy(productId) {
    if (!this.isAvailable()) return { success: false, reason: "unavailable" };
    try {
      const result = await this.provider.purchase?.(productId);
      return result?.verified === true
        ? { success: true, transactionId: result.transactionId ?? "" }
        : { success: false, reason: result?.reason ?? "unverified" };
    } catch {
      return { success: false, reason: "failed" };
    }
  }
};
