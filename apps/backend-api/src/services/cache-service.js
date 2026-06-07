"use strict";

function ttlToExpiresAt(ttlSeconds) {
  const ttl = Number(ttlSeconds || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  return Date.now() + (ttl * 1000);
}

function createMemoryCache() {
  const store = new Map();

  function readEntry(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  }

  return {
    name: "memory",
    async get(key) {
      const entry = readEntry(key);
      return entry ? entry.value : null;
    },
    async set(key, value, ttlSeconds) {
      store.set(String(key), { value, expiresAt: ttlToExpiresAt(ttlSeconds) });
      return true;
    },
    async del(key) {
      store.delete(String(key));
      return true;
    },
    async wrap(key, ttlSeconds, loader) {
      const cached = await this.get(key);
      if (cached !== null && cached !== undefined) return cached;
      const next = await loader();
      await this.set(key, next, ttlSeconds);
      return next;
    },
  };
}

function createNoopCache() {
  return {
    name: "noop",
    async get() { return null; },
    async set() { return false; },
    async del() { return false; },
    async wrap(_key, _ttlSeconds, loader) { return loader(); },
  };
}

function createCacheService() {
  const provider = String(process.env.CACHE_PROVIDER || "memory").trim().toLowerCase();
  if (provider === "none" || provider === "noop" || provider === "disabled") {
    return createNoopCache();
  }
  return createMemoryCache();
}

module.exports = createCacheService;
