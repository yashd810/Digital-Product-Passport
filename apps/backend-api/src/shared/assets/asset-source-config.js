"use strict";

const {
  isPrivateOrReservedHostname,
  normalizeHostname,
} = require("../security/network-address");

const allowedMethods = new Set(["GET", "POST"]);
const persistedConfigKeys = new Set([
  "url",
  "method",
  "recordPath",
  "fieldMap",
  "defaults",
  "credentialRef",
]);
const maxCredentialScopes = 32;
const maxCredentialBodyBytes = 64 * 1024;

function isPlainObject(value) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (prototype === Object.prototype || prototype === null);
}

function cloneJson(value, fieldName) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
    return JSON.parse(serialized);
  } catch {
    throw new Error(`${fieldName} must be JSON-serializable`);
  }
}

function hasInlineValue(value) {
  if (value === undefined || value === null || value === "") return false;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeAssetSourceMethod(value) {
  const method = String(value || "GET").trim().toUpperCase();
  if (!allowedMethods.has(method)) {
    throw new Error("sourceConfig.method must be GET or POST");
  }
  return method;
}

function normalizeCredentialRef(value) {
  const reference = String(value || "").trim();
  if (!reference) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(reference)) {
    throw new Error("sourceConfig.credentialRef must contain only letters, numbers, underscores, or hyphens");
  }
  return reference;
}

function normalizeCredentialEndpoint(value) {
  const rawUrl = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Credential allowedUrls entries must be valid HTTPS URLs");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Credential allowedUrls entries must be public HTTPS URLs without credentials, queries, or fragments");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || isPrivateOrReservedHostname(hostname)) {
    throw new Error("Credential allowedUrls entries must use public hosts");
  }
  parsed.hostname = hostname;
  return `${parsed.origin}${parsed.pathname}`;
}

function normalizeCredentialEndpoints(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxCredentialScopes) {
    throw new Error(`Credential allowedUrls must be an array with 1 to ${maxCredentialScopes} entries`);
  }
  return new Set(value.map((endpoint) => normalizeCredentialEndpoint(endpoint)));
}

function normalizeCredentialMethods(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowedMethods.size) {
    throw new Error("Credential allowedMethods must be a non-empty array of supported methods");
  }
  return new Set(value.map((method) => normalizeAssetSourceMethod(method)));
}

function normalizeCredentialCompanyIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxCredentialScopes) {
    throw new Error(`Credential companyIds must be an array with 1 to ${maxCredentialScopes} positive integers`);
  }

  const companyIds = value.map((companyId) => typeof companyId === "number" ? companyId : Number.NaN);
  if (companyIds.some((companyId) => !Number.isSafeInteger(companyId) || companyId < 1)) {
    throw new Error("Credential companyIds must contain positive integers");
  }
  return new Set(companyIds);
}

function hasInlineAssetSourceCredentials(sourceConfig) {
  return hasInlineValue(sourceConfig?.headers) || hasInlineValue(sourceConfig?.body);
}

function normalizeStoredUrl(value, { rejectSensitiveParts }) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("sourceConfig.url must be a valid URL");
  }
  const hasSensitiveParts = Boolean(parsed.username || parsed.password || parsed.search || parsed.hash);
  if (hasSensitiveParts && rejectSensitiveParts) {
    throw new Error("Persisted sourceConfig.url must not contain credentials, query parameters, or fragments");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeStoredAssetSourceConfig(value, { rejectInlineCredentials = true } = {}) {
  const source = isPlainObject(value) ? value : {};
  if (rejectInlineCredentials && hasInlineValue(source.headers)) {
    throw new Error("Persisted sourceConfig.headers are not supported; use sourceConfig.credentialRef backed by ASSET_SOURCE_CREDENTIALS_JSON");
  }
  if (rejectInlineCredentials && hasInlineValue(source.body)) {
    throw new Error("Persisted sourceConfig.body is not supported; use sourceConfig.credentialRef backed by ASSET_SOURCE_CREDENTIALS_JSON");
  }

  const normalized = {};
  const url = normalizeStoredUrl(source.url, { rejectSensitiveParts: rejectInlineCredentials });
  if (url) normalized.url = url;
  normalized.method = normalizeAssetSourceMethod(source.method);

  const recordPath = String(source.recordPath || "").trim();
  if (recordPath) normalized.recordPath = recordPath;
  if (isPlainObject(source.fieldMap)) normalized.fieldMap = cloneJson(source.fieldMap, "sourceConfig.fieldMap");
  if (isPlainObject(source.defaults)) normalized.defaults = cloneJson(source.defaults, "sourceConfig.defaults");
  const credentialRef = normalizeCredentialRef(source.credentialRef);
  if (credentialRef) normalized.credentialRef = credentialRef;

  const serialized = JSON.stringify(normalized);
  if (serialized.length > 32 * 1024) {
    throw new Error("Persisted sourceConfig must not exceed 32 KiB");
  }
  return normalized;
}

function toPublicAssetSourceConfig(value) {
  const source = normalizeStoredAssetSourceConfig(value);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => persistedConfigKeys.has(key))
  );
}

function parseAssetSourceCredentials(value) {
  if (!value) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ASSET_SOURCE_CREDENTIALS_JSON must be valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new Error("ASSET_SOURCE_CREDENTIALS_JSON must be an object keyed by credential reference");
  }

  const credentials = new Map();
  for (const [reference, config] of Object.entries(parsed)) {
    const normalizedReference = normalizeCredentialRef(reference);
    if (!normalizedReference || !isPlainObject(config)) {
      throw new Error("ASSET_SOURCE_CREDENTIALS_JSON contains an invalid credential reference");
    }
    const headers = isPlainObject(config.headers) ? cloneJson(config.headers, "credential headers") : {};
    const body = config.body === undefined ? undefined : cloneJson(config.body, "credential body");
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body), "utf8") > maxCredentialBodyBytes) {
      throw new Error("Credential body must not exceed 64 KiB");
    }
    credentials.set(normalizedReference, {
      headers,
      body,
      companyIds: normalizeCredentialCompanyIds(config.companyIds),
      allowedEndpoints: normalizeCredentialEndpoints(config.allowedUrls),
      allowedMethods: normalizeCredentialMethods(config.allowedMethods),
    });
  }
  return credentials;
}

module.exports = {
  hasInlineAssetSourceCredentials,
  normalizeAssetSourceMethod,
  normalizeStoredAssetSourceConfig,
  parseAssetSourceCredentials,
  toPublicAssetSourceConfig,
};
