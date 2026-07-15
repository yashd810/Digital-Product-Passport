"use strict";

function normalizeConfiguredOrigin(value, name = "origin") {
  const rawValue = String(value || "");
  if (!rawValue || rawValue.trim() !== rawValue || /[\u0000-\u001F\u007F\s\\]/.test(rawValue)) {
    throw new Error(`${name} must be configured`);
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }

  const hasNonOriginComponents = Boolean(
    parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== "/")
    || parsed.search
    || parsed.hash
  );
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname
    || hasNonOriginComponents) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials, paths, queries, or fragments`);
  }

  return parsed.origin;
}

function getConfiguredOrigin(name) {
  return normalizeConfiguredOrigin(process.env[name], name);
}

function getAppOrigin() {
  return getConfiguredOrigin("APP_URL");
}

function getApiOrigin() {
  return getConfiguredOrigin("SERVER_URL");
}

function getPublicViewerOrigin() {
  return getConfiguredOrigin("VITE_PUBLIC_VIEWER_URL");
}

function getOptionalConfiguredOrigin(name) {
  const value = String(process.env[name] || "");
  return value ? normalizeConfiguredOrigin(value, name) : null;
}

module.exports = {
  getApiOrigin,
  getAppOrigin,
  getPublicViewerOrigin,
  getConfiguredOrigin,
  getOptionalConfiguredOrigin,
  normalizeConfiguredOrigin,
};
