/**
 * Optional browser persistence for the Passport Module Generator workspace.
 * Storage access, JSON corruption, and quota failures must not stop editing
 * or downloads. Resolving the storage property itself can throw in browsers.
 */
"use strict";

(function exposeWorkspaceStorage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleWorkspaceStorage = api;
})(typeof globalThis === "object" ? globalThis : null, () => {
  function createWorkspaceStorage(storageHost = globalThis) {
    return {
      read(storageName, key) {
        try {
          const raw = storageHost[storageName].getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      },
      write(storageName, key, value) {
        try {
          storageHost[storageName].setItem(key, JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      },
      remove(storageName, key) {
        try {
          storageHost[storageName].removeItem(key);
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  return { createWorkspaceStorage };
});
