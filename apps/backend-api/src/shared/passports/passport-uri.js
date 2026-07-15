"use strict";

const { getOptionalConfiguredOrigin } = require("../security/configured-origin");
const { isPrivateOrReservedHostname } = require("../security/network-address");

const httpProtocols = new Set(["http:", "https:"]);
const identifierProtocols = new Set(["did:", "urn:"]);
const vettedResourceRoots = Object.freeze([
  "/public-files",
  "/repository-files",
  "/storage",
]);
const unsafeUriCharacters = /[\u0000-\u001F\u007F\s\\]/;
const maxInlineRasterImageBytes = 5 * 1024 * 1024;
const maxPathDecodePasses = 8;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseAbsoluteUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function hasUnsafePathTraversal(pathname) {
  let decoded = pathname;
  for (let index = 0; index < maxPathDecodePasses; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded.split("/").some((segment) => segment === "." || segment === "..")
          || /[\u0000-\u001F\u007F\\]/.test(decoded);
      }
      decoded = next;
    } catch {
      return true;
    }
  }

  return true;
}

function normalizeSafeHttpUrl(value) {
  const text = normalizeText(value);
  if (!text || unsafeUriCharacters.test(text)) return null;

  const parsed = parseAbsoluteUrl(text);
  if (
    !parsed
    || !httpProtocols.has(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || isPrivateOrReservedHostname(parsed.hostname)
  ) {
    return null;
  }
  return parsed.toString();
}

function normalizeSafeIdentifierUri(value) {
  const text = normalizeText(value);
  if (!text || unsafeUriCharacters.test(text)) return null;

  const schemeMatch = text.match(/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/);
  if (!schemeMatch) return null;
  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  const remainder = schemeMatch[2];
  if (!identifierProtocols.has(protocol) || !remainder || remainder.startsWith("//")) return null;

  const parsed = parseAbsoluteUrl(text);
  if (!parsed || parsed.protocol !== protocol || parsed.username || parsed.password || parsed.host) return null;

  if (protocol === "did:" && !/^did:[a-z0-9]+:[^\s]+$/i.test(text)) return null;
  if (protocol === "urn:" && !/^urn:[a-z0-9][a-z0-9-]{1,31}:[^\s]+$/i.test(text)) return null;
  return text;
}

function normalizeVettedRelativeResourcePath(value) {
  const text = normalizeText(value);
  if (
    !text
    || unsafeUriCharacters.test(text)
    || !text.startsWith("/")
    || text.startsWith("//")
  ) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(text, "https://resource-path.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://resource-path.invalid" || hasUnsafePathTraversal(parsed.pathname)) return null;

  const hasVettedRoot = vettedResourceRoots.some((root) =>
    parsed.pathname === root || parsed.pathname.startsWith(`${root}/`)
  );
  if (!hasVettedRoot) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function normalizeConfiguredResourceUrl(value) {
  const text = normalizeText(value);
  if (!text || unsafeUriCharacters.test(text)) return null;

  const apiOrigin = getOptionalConfiguredOrigin("SERVER_URL");
  if (!apiOrigin) return null;

  const parsed = parseAbsoluteUrl(text);
  if (
    !parsed
    || !httpProtocols.has(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.origin !== apiOrigin
  ) {
    return null;
  }

  const safeResourcePath = normalizeVettedRelativeResourcePath(
    `${parsed.pathname}${parsed.search}${parsed.hash}`
  );
  return safeResourcePath ? `${apiOrigin}${safeResourcePath}` : null;
}

function normalizeSafeRasterImageDataUrl(value, { maxBytes = maxInlineRasterImageBytes } = {}) {
  const text = normalizeText(value);
  if (!text || unsafeUriCharacters.test(text)) return null;
  const match = text.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;

  const payload = match[2];
  if (payload.length % 4 !== 0) return null;
  const paddingBytes = payload.endsWith("==") ? 2 : (payload.endsWith("=") ? 1 : 0);
  const byteLength = (payload.length / 4) * 3 - paddingBytes;
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maxBytes) return null;
  return text;
}

function normalizeSafeImageReference(value, { allowInlineRaster = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (allowInlineRaster) {
    const inlineRaster = normalizeSafeRasterImageDataUrl(value);
    if (inlineRaster) return inlineRaster;
  }
  return normalizePassportUri(value, { resource: true });
}

function isResourceField(fieldDef = {}) {
  return ["file", "symbol", "url"].includes(String(fieldDef?.type || "").trim().toLowerCase());
}

function normalizePassportUri(value, { resource = false } = {}) {
  const text = normalizeText(value);
  if (!text) return text;

  const safeHttpUrl = normalizeSafeHttpUrl(text);
  if (safeHttpUrl) return safeHttpUrl;

  if (resource) {
    // The API itself may be on localhost or an RFC1918 address in local and
    // private deployments. Permit only its configured origin and only public
    // resource routes; every other private-network URL remains blocked above.
    const safeConfiguredResourceUrl = normalizeConfiguredResourceUrl(text);
    if (safeConfiguredResourceUrl) return safeConfiguredResourceUrl;

    const safeRelativePath = normalizeVettedRelativeResourcePath(text);
    if (safeRelativePath) return safeRelativePath;
    throw new Error("Expected an HTTP(S) resource URL without credentials or a vetted local resource path");
  }

  const safeIdentifier = normalizeSafeIdentifierUri(text);
  if (safeIdentifier) return safeIdentifier;
  throw new Error("Expected an HTTP(S), did:, or urn: URI without credentials");
}

function isSafePassportUri(value, options = {}) {
  try {
    return Boolean(normalizePassportUri(value, options));
  } catch {
    return false;
  }
}

module.exports = {
  vettedResourceRoots,
  normalizeSafeHttpUrl,
  normalizeSafeIdentifierUri,
  normalizeVettedRelativeResourcePath,
  normalizeConfiguredResourceUrl,
  normalizeSafeRasterImageDataUrl,
  normalizeSafeImageReference,
  normalizePassportUri,
  isSafePassportUri,
  isResourceField,
};
