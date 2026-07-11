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

const opaqueRepositoryFileRoute = /\/repository-files\/([^/?#]+)(?:[/?#].*)?$/i;
const opaquePassportAttachmentRoute = /\/public-files\/([a-zA-Z0-9_-]{8,24})(?:[?#].*)?$/i;

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

function encodePassportAttachmentAccessToken({
  publicId,
  passportDppId,
  fieldKey,
  expiresAt = Date.now() + (getRepositoryFileAccessTtlSeconds() * 1000),
}) {
  const normalizedPublicId = String(publicId || "").trim();
  const normalizedPassportDppId = String(passportDppId || "").trim();
  const normalizedFieldKey = String(fieldKey || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,24}$/.test(normalizedPublicId)) {
    throw new Error("Invalid passport attachment identifier");
  }
  if (!normalizedPassportDppId || normalizedPassportDppId.length > 200) {
    throw new Error("Invalid passport attachment DPP identifier");
  }
  if (!/^[a-z][A-Za-z0-9]{0,99}$/.test(normalizedFieldKey)) {
    throw new Error("Invalid passport attachment field key");
  }
  const payload = JSON.stringify({
    publicId: normalizedPublicId,
    passportDppId: normalizedPassportDppId,
    fieldKey: normalizedFieldKey,
    exp: Number.parseInt(expiresAt, 10),
  });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function decodePassportAttachmentAccessToken(token) {
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

  const publicId = String(parsed?.publicId || "").trim();
  const passportDppId = String(parsed?.passportDppId || "").trim();
  const fieldKey = String(parsed?.fieldKey || "").trim();
  const expiresAt = Number.parseInt(parsed?.exp, 10);
  if (!/^[a-zA-Z0-9_-]{8,24}$/.test(publicId)) return null;
  if (!passportDppId || passportDppId.length > 200) return null;
  if (!/^[a-z][A-Za-z0-9]{0,99}$/.test(fieldKey)) return null;
  if (!Number.isInteger(expiresAt) || expiresAt <= 0 || Date.now() > expiresAt) return null;
  return { publicId, passportDppId, fieldKey, expiresAt };
}

function buildPassportAttachmentAccessPath({ publicId, passportDppId, fieldKey, expiresAt }) {
  return `/public-files/access/${encodePassportAttachmentAccessToken({
    publicId,
    passportDppId,
    fieldKey,
    expiresAt,
  })}`;
}

function buildPassportAttachmentAccessUrl({ appBaseUrl, publicId, passportDppId, fieldKey, expiresAt }) {
  return joinUrl(appBaseUrl, buildPassportAttachmentAccessPath({
    publicId,
    passportDppId,
    fieldKey,
    expiresAt,
  }));
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

  const opaqueMatch = pathname.match(opaqueRepositoryFileRoute);
  if (!opaqueMatch) return null;
  return decodeRepositoryFileToken(opaqueMatch[1]);
}

function parsePassportAttachmentReference(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let pathname = value.trim();
  try {
    const parsed = new URL(pathname, "http://local.invalid");
    pathname = `${parsed.pathname}${parsed.search || ""}${parsed.hash || ""}`;
  } catch {
    // Keep the original relative path.
  }
  const match = pathname.match(opaquePassportAttachmentRoute);
  return match ? { publicId: match[1] } : null;
}

function rewriteRepositoryFileLink(value, { appBaseUrl } = {}) {
  const resolved = parseRepositoryFileReference(value);
  if (!resolved) return value;
  if (!appBaseUrl) return buildRepositoryFilePublicPath(resolved);
  return buildRepositoryFilePublicUrl({ appBaseUrl, ...resolved });
}

function rewriteRepositoryLinksDeep(value, options = {}) {
  if (typeof value === "string") return rewriteRepositoryFileLink(value, options);
  if (Array.isArray(value)) return value.map((entry) => rewriteRepositoryLinksDeep(entry, options));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewriteRepositoryLinksDeep(entry, options);
  }
  return next;
}

function rewriteRepositoryFileLinkForSignedAccess(value, {
  appBaseUrl,
  passportDppId,
  fieldKey,
  expiresAt,
} = {}) {
  const resolved = parseRepositoryFileReference(value);
  if (resolved) {
    if (!appBaseUrl) return buildRepositoryFileAccessPath({ ...resolved, expiresAt });
    return buildRepositoryFileAccessUrl({ appBaseUrl, ...resolved, expiresAt });
  }

  const attachment = parsePassportAttachmentReference(value);
  if (!attachment) return value;
  const normalizedPassportDppId = String(passportDppId || "").trim();
  const normalizedFieldKey = String(fieldKey || "").trim();
  if (!normalizedPassportDppId || !normalizedFieldKey) return value;
  if (!appBaseUrl) {
    return buildPassportAttachmentAccessPath({
      ...attachment,
      passportDppId: normalizedPassportDppId,
      fieldKey: normalizedFieldKey,
      expiresAt,
    });
  }
  return buildPassportAttachmentAccessUrl({
    appBaseUrl,
    ...attachment,
    passportDppId: normalizedPassportDppId,
    fieldKey: normalizedFieldKey,
    expiresAt,
  });
}

function rewriteRepositoryLinksForSignedAccessDeep(value, options = {}) {
  if (typeof value === "string") return rewriteRepositoryFileLinkForSignedAccess(value, options);
  if (Array.isArray(value)) return value.map((entry) => rewriteRepositoryLinksForSignedAccessDeep(entry, options));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewriteRepositoryLinksForSignedAccessDeep(entry, {
      ...options,
      fieldKey: options.fieldKey || key,
    });
  }
  return next;
}

module.exports = {
  buildPassportAttachmentAccessPath,
  buildPassportAttachmentAccessUrl,
  buildRepositoryFileAccessPath,
  buildRepositoryFileAccessUrl,
  buildRepositoryFilePublicPath,
  buildRepositoryFilePublicUrl,
  decodePassportAttachmentAccessToken,
  decodeRepositoryFileAccessToken,
  decodeRepositoryFileToken,
  encodePassportAttachmentAccessToken,
  parsePassportAttachmentReference,
  parseRepositoryFileReference,
  rewriteRepositoryFileLink,
  rewriteRepositoryLinksDeep,
  rewriteRepositoryFileLinkForSignedAccess,
  rewriteRepositoryLinksForSignedAccessDeep,
};
