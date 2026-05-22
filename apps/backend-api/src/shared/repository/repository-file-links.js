"use strict";

const crypto = require("crypto");

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, nextPath) {
  return `${normalizeBaseUrl(base)}/${String(nextPath || "").replace(/^\/+/, "")}`;
}

function getRepositoryFileLinkSecret() {
  return String(
    process.env.REPOSITORY_FILE_LINK_SECRET
    || process.env.JWT_SECRET
    || "local-dev-repository-link-secret"
  );
}

function signPayload(payload) {
  return crypto
    .createHmac("sha256", getRepositoryFileLinkSecret())
    .update(String(payload || ""))
    .digest("base64url");
}

function encodeRepositoryFileToken({ companyId, itemId }) {
  const payload = JSON.stringify({
    companyId: Number.parseInt(companyId, 10),
    itemId: Number.parseInt(itemId, 10),
  });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function decodeRepositoryFileToken(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const companyId = Number.parseInt(parsed?.companyId, 10);
  const itemId = Number.parseInt(parsed?.itemId, 10);
  if (!Number.isInteger(companyId) || companyId < 1 || !Number.isInteger(itemId) || itemId < 1) {
    return null;
  }

  return { companyId, itemId };
}

function buildRepositoryFilePublicPath({ companyId, itemId }) {
  return `/repository-files/${encodeRepositoryFileToken({ companyId, itemId })}`;
}

function buildRepositoryFilePublicUrl({ appBaseUrl, companyId, itemId }) {
  return joinUrl(appBaseUrl, buildRepositoryFilePublicPath({ companyId, itemId }));
}

const LEGACY_REPOSITORY_FILE_ROUTE = /\/api\/companies\/(\d+)\/repository\/(\d+)\/file(?:[/?#].*)?$/i;
const OPAQUE_REPOSITORY_FILE_ROUTE = /\/repository-files\/([^/?#]+)(?:[/?#].*)?$/i;

function buildRepositoryFileAccessPayload({ companyId, itemId, expiresAt }) {
  return JSON.stringify({
    companyId: Number.parseInt(companyId, 10),
    itemId: Number.parseInt(itemId, 10),
    exp: Number.parseInt(expiresAt, 10),
  });
}

function getRepositoryFileAccessTtlSeconds() {
  const parsed = Number.parseInt(process.env.REPOSITORY_FILE_ACCESS_TTL_SECONDS || "900", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function encodeRepositoryFileAccessToken({ companyId, itemId, expiresAt }) {
  const payload = buildRepositoryFileAccessPayload({ companyId, itemId, expiresAt });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function decodeRepositoryFileAccessToken(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = signPayload(encodedPayload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const companyId = Number.parseInt(parsed?.companyId, 10);
  const itemId = Number.parseInt(parsed?.itemId, 10);
  const expiresAt = Number.parseInt(parsed?.exp, 10);
  if (!Number.isInteger(companyId) || companyId < 1 || !Number.isInteger(itemId) || itemId < 1) return null;
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) return null;
  if (Date.now() > expiresAt) return null;
  return { companyId, itemId, expiresAt };
}

function buildRepositoryFileAccessPath({ companyId, itemId, expiresAt = Date.now() + (getRepositoryFileAccessTtlSeconds() * 1000) }) {
  return `/repository-files/access/${encodeRepositoryFileAccessToken({ companyId, itemId, expiresAt })}`;
}

function buildRepositoryFileAccessUrl({ appBaseUrl, companyId, itemId, expiresAt }) {
  return joinUrl(appBaseUrl, buildRepositoryFileAccessPath({ companyId, itemId, expiresAt }));
}

function parseRepositoryFileReference(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  let pathname = trimmed;
  try {
    const parsed = new URL(trimmed, "http://local.invalid");
    pathname = `${parsed.pathname}${parsed.search || ""}${parsed.hash || ""}`;
  } catch {
    pathname = trimmed;
  }

  const legacyMatch = pathname.match(LEGACY_REPOSITORY_FILE_ROUTE);
  if (legacyMatch) {
    const companyId = Number.parseInt(legacyMatch[1], 10);
    const itemId = Number.parseInt(legacyMatch[2], 10);
    if (Number.isInteger(companyId) && companyId > 0 && Number.isInteger(itemId) && itemId > 0) {
      return { companyId, itemId };
    }
    return null;
  }

  const opaqueMatch = pathname.match(OPAQUE_REPOSITORY_FILE_ROUTE);
  if (!opaqueMatch) return null;
  return decodeRepositoryFileToken(opaqueMatch[1]);
}

function rewriteLegacyRepositoryFileLink(value, { appBaseUrl } = {}) {
  const resolved = parseRepositoryFileReference(value);
  if (!resolved) return value;
  if (!appBaseUrl) return buildRepositoryFilePublicPath(resolved);
  return buildRepositoryFilePublicUrl({ appBaseUrl, ...resolved });
}

function rewriteLegacyRepositoryLinksDeep(value, options = {}) {
  if (typeof value === "string") return rewriteLegacyRepositoryFileLink(value, options);
  if (Array.isArray(value)) return value.map((entry) => rewriteLegacyRepositoryLinksDeep(entry, options));
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewriteLegacyRepositoryLinksDeep(entry, options);
  }
  return next;
}

function rewriteRepositoryFileLinkForSignedAccess(value, { appBaseUrl, expiresAt } = {}) {
  const resolved = parseRepositoryFileReference(value);
  if (!resolved) return value;
  if (!appBaseUrl) return buildRepositoryFileAccessPath({ ...resolved, expiresAt });
  return buildRepositoryFileAccessUrl({ appBaseUrl, ...resolved, expiresAt });
}

function rewriteRepositoryLinksForSignedAccessDeep(value, options = {}) {
  if (typeof value === "string") return rewriteRepositoryFileLinkForSignedAccess(value, options);
  if (Array.isArray(value)) return value.map((entry) => rewriteRepositoryLinksForSignedAccessDeep(entry, options));
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewriteRepositoryLinksForSignedAccessDeep(entry, options);
  }
  return next;
}

module.exports = {
  buildRepositoryFileAccessPath,
  buildRepositoryFileAccessUrl,
  buildRepositoryFilePublicPath,
  buildRepositoryFilePublicUrl,
  decodeRepositoryFileAccessToken,
  decodeRepositoryFileToken,
  parseRepositoryFileReference,
  rewriteLegacyRepositoryFileLink,
  rewriteLegacyRepositoryLinksDeep,
  rewriteRepositoryFileLinkForSignedAccess,
  rewriteRepositoryLinksForSignedAccessDeep,
};
