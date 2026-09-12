// Browser persistence is optional. Cookie-backed sessions and in-memory UI state
// must keep working when storage is blocked or its quota has been exhausted.
export function getBrowserLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readLocalStorage(key, fallback = null, storage = getBrowserLocalStorage()) {
  try {
    return storage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalStorage(key, value, storage = getBrowserLocalStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
