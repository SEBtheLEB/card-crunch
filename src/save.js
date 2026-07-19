const RUN_SAVE_KEY = "cardCrunchRunSave";
const SHIELD_TOKEN_KEY = "cardCrunchShieldToken";

export function clearRunSave() {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/* Safe Bank Shield token: earned via rewarded ad on the pots screen,
   consumed the first time it triggers at 0 lives. */

export function hasShieldToken() {
  try {
    return localStorage.getItem(SHIELD_TOKEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function grantShieldToken() {
  try {
    localStorage.setItem(SHIELD_TOKEN_KEY, "1");
  } catch {
    // Ignore storage errors.
  }
}

export function consumeShieldToken() {
  try {
    localStorage.removeItem(SHIELD_TOKEN_KEY);
  } catch {
    // Ignore storage errors.
  }
}
