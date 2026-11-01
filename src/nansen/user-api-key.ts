/** Browser-only user Nansen key for Uncle (BYOK). Never used for shelf/thesis. */

export const USER_NANSEN_API_KEY_HEADER = 'x-user-nansen-api-key';
export const USER_NANSEN_API_KEY_STORAGE = 'iroh-user-nansen-api-key';
/** ponytail: length guard only; Nansen validates the key on the call. */
export const USER_NANSEN_API_KEY_MAX_LENGTH = 256;

function readStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getUserNansenApiKey(): string | null {
  const storage = readStorage();
  if (!storage) return null;
  try {
    const value = storage.getItem(USER_NANSEN_API_KEY_STORAGE)?.trim() ?? '';
    if (!value || value.length > USER_NANSEN_API_KEY_MAX_LENGTH) return null;
    return value;
  } catch {
    return null;
  }
}

/** Returns false when empty, too long, or storage is blocked. */
export function setUserNansenApiKey(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > USER_NANSEN_API_KEY_MAX_LENGTH) return false;
  const storage = readStorage();
  if (!storage) return false;
  try {
    storage.setItem(USER_NANSEN_API_KEY_STORAGE, value);
    return true;
  } catch {
    return false;
  }
}

export function clearUserNansenApiKey(): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.removeItem(USER_NANSEN_API_KEY_STORAGE);
  } catch {
    /* Storage may be blocked. */
  }
}
