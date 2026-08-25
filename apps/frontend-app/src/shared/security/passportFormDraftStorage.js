export const passportFormDraftStoragePrefix = "passport-form-draft:";

function getBrowserSessionStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Remove only passport form draft entries from session storage. The key list is
 * collected before deletion because Storage reindexes as items are removed.
 */
export function clearPassportFormDrafts(storage = getBrowserSessionStorage()) {
  if (typeof storage?.key !== "function" || typeof storage?.removeItem !== "function") return 0;

  const draftKeys = [];
  try {
    const length = Number(storage.length);
    for (let index = 0; index < (Number.isFinite(length) ? length : 0); index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(passportFormDraftStoragePrefix)) {
        draftKeys.push(key);
      }
    }
  } catch {
    return 0;
  }

  let cleared = 0;
  draftKeys.forEach((key) => {
    try {
      storage.removeItem(key);
      cleared += 1;
    } catch {
      // Storage can be disabled by browser privacy settings; logout still proceeds.
    }
  });
  return cleared;
}
