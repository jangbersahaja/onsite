export const rememberedPinUserStorageKey = "onsite:remembered-pin-user-id";

export function subscribeToRememberedPinUser(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function getRememberedPinUser() {
  try {
    return window.localStorage.getItem(rememberedPinUserStorageKey);
  } catch {
    return null;
  }
}

export function rememberPinUser(userId: string) {
  try {
    window.localStorage.setItem(rememberedPinUserStorageKey, userId);
  } catch {
    // Password sign-in remains available when browser storage is disabled.
  }
}

export function forgetPinUser() {
  try {
    window.localStorage.removeItem(rememberedPinUserStorageKey);
  } catch {
    // Password sign-in remains available when browser storage is disabled.
  }
}
