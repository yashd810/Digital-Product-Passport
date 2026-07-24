import { lazy } from "react";

const lazyRecoveryKeyPrefix = "dpp-lazy-recovery:";

export function isLazyChunkLoadError(error) {
  const text = `${error?.name || ""} ${error?.message || error || ""}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

function getRecoveryStorage(runtime) {
  try {
    return runtime?.sessionStorage || null;
  } catch {
    return null;
  }
}

export function tryRecoverStaleLazyChunk(error, recoveryId, runtime = globalThis) {
  if (!isLazyChunkLoadError(error)) return false;

  const storage = getRecoveryStorage(runtime);
  const reload = runtime?.location?.reload;
  if (!storage || typeof reload !== "function") return false;

  const recoveryKey = `${lazyRecoveryKeyPrefix}${recoveryId}`;
  try {
    if (storage.getItem(recoveryKey) === "attempted") return false;
    storage.setItem(recoveryKey, "attempted");
    reload.call(runtime.location);
    return true;
  } catch {
    return false;
  }
}

export function createRecoverableLazyImporter(recoveryId, importer, runtime = globalThis) {
  const recoveryKey = `${lazyRecoveryKeyPrefix}${recoveryId}`;
  return async () => {
    try {
      const importedModule = await importer();
      try {
        getRecoveryStorage(runtime)?.removeItem(recoveryKey);
      } catch {
        // Storage is only a reload-loop guard; a successful module import is enough.
      }
      return importedModule;
    } catch (error) {
      if (tryRecoverStaleLazyChunk(error, recoveryId, runtime)) {
        // Keep Suspense active during the short interval before the browser reloads.
        return new Promise(() => {});
      }
      throw error;
    }
  };
}

export function lazyWithRecovery(recoveryId, importer) {
  return lazy(createRecoverableLazyImporter(recoveryId, importer));
}
