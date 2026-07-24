import {
  KeychainAccess,
  SecureStorage
} from "@aparajita/capacitor-secure-storage";

globalThis.__CARD_CRUNCH_CAPACITOR_SECURE_STORAGE__ = Object.freeze({
  storage: SecureStorage,
  whenUnlockedThisDeviceOnly: KeychainAccess.whenUnlockedThisDeviceOnly
});
