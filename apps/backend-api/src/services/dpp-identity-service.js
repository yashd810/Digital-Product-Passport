"use strict";

// ─── DPP IDENTITY SERVICE ─────────────────────────────────────────────────────
// Stable DID generation for the Digital Product Passport Platform.
// Consumer-facing public URLs use dppId; internalAliasId remains an internal company key.
//
// Domain is derived from APP_URL env var at call time (not module load time)
// so that tests or server can override APP_URL after require().

function getDomain() {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  try {
    return new URL(appUrl).host;
  } catch {
    return "localhost:3001";
  }
}

function getAppUrl() {
  return process.env.APP_URL || "http://localhost:3001";
}

// ─── SLUG HELPERS ─────────────────────────────────────────────────────────────

/**
 * Slugify a value: lowercase, replace non-alphanumeric with hyphens,
 * collapse multiple hyphens, trim leading/trailing hyphens.
 */
function slugify(value) {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNamespace(value) {
  return slugify(value || "passport") || "passport";
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

function assertId(value, name) {
  if (value == null || value === "") {
    throw new Error(`[dpp-identity] ${name} must be a non-null, non-empty value`);
  }
}

// ─── DID GENERATORS ──────────────────────────────────────────────────────────

/**
 * Platform issuer DID.
 * did:web:www.claros-dpp.online
 */
function platformDid() {
  return `did:web:${getDomain()}`;
}

/**
 * Economic operator (company) DID.
 * did:web:www.claros-dpp.online:did:company:<companyId>
 */
function companyDid(companyId) {
  assertId(companyId, "companyId");
  return `did:web:${getDomain()}:did:company:${companyId}`;
}

/**
 * Generic product subject DID.
 * did:web:www.claros-dpp.online:did:<passportType>:<model|batch|item>:<stableId>
 */
function productSubjectDid(passportType, level, stableId) {
  assertId(level, "level");
  assertId(stableId, "stableId");
  const normalizedLevel = String(level || "").trim().toLowerCase();
  if (!["model", "batch", "item"].includes(normalizedLevel)) {
    throw new Error("[dpp-identity] level must be one of: model, batch, item");
  }
  const encodedStableId = encodeURIComponent(String(stableId));
  return `did:web:${getDomain()}:did:${normalizeNamespace(passportType)}:${normalizedLevel}:${encodedStableId}`;
}

/**
 * Product model DID.
 */
function productModelDid(passportType, stableId) {
  return productSubjectDid(passportType, "model", stableId);
}

/**
 * Product item DID.
 */
function productItemDid(passportType, stableId) {
  return productSubjectDid(passportType, "item", stableId);
}

/**
 * Product batch DID.
 */
function productBatchDid(passportType, stableId) {
  return productSubjectDid(passportType, "batch", stableId);
}

/**
 * DPP record DID.
 * did:web:www.claros-dpp.online:did:dpp:<granularity>:<stableId>
 *
 * @param {string} granularity - 'model', 'item', or 'batch'
 */
function dppDid(granularity, stableId) {
  assertId(granularity, "granularity");
  assertId(stableId, "stableId");
  const encodedStableId = encodeURIComponent(String(stableId));
  return `did:web:${getDomain()}:did:dpp:${granularity}:${encodedStableId}`;
}

/**
 * Facility DID.
 * did:web:www.claros-dpp.online:did:facility:<encodedFacilityId>
 */
function facilityDid(facilityId) {
  assertId(facilityId, "facilityId");
  const encodedFacilityId = encodeURIComponent(String(facilityId));
  return `did:web:${getDomain()}:did:facility:${encodedFacilityId}`;
}

// ─── DID PARSER ───────────────────────────────────────────────────────────────

/**
 * Parse a did:web DID into its semantic components.
 * Returns null for any invalid or unrecognised DID.
 *
 * Recognised shapes:
 *   did:web:<domain>                                         → { type: 'platform' }
 *   did:web:<domain>:did:company:<companyId>                 → { type: 'company', companyId }
 *   did:web:<domain>:did:<passportType>:model:<stableId>     → { type: 'product', level: 'model', passportType, stableId }
 *   did:web:<domain>:did:<passportType>:batch:<stableId>     → { type: 'product', level: 'batch', passportType, stableId }
 *   did:web:<domain>:did:<passportType>:item:<stableId>      → { type: 'product', level: 'item',  passportType, stableId }
 *   did:web:<domain>:did:dpp:<granularity>:<stableId>        → { type: 'dpp', granularity, stableId }
 *   did:web:<domain>:did:facility:<facilityId>               → { type: 'facility', facilityId }
 */
function parseDid(did) {
  if (!did || typeof did !== "string") return null;
  if (!did.startsWith("did:web:")) return null;

  const withoutPrefix = did.slice("did:web:".length);
  // Split on ":" but the first segment is the domain (may contain dots but no colons in did:web)
  const parts = withoutPrefix.split(":");

  if (parts.length === 0) return null;

  const domain = parts[0];
  if (!domain) return null;

  // Platform DID — did:web:<domain>
  if (parts.length === 1) {
    return { type: "platform", domain };
  }

  // Remaining segments after the domain
  const rest = parts.slice(1);

  // All our extended DIDs start with "did" as the first path segment
  if (rest[0] !== "did") return null;

  // rest[0] = "did", rest[1] = type namespace
  const ns = rest[1];

  // Company: did:web:<domain>:did:company:<companyId>
  if (ns === "company" && rest.length === 3) {
    return {
      type: "company",
      domain,
      companyId: rest[2],
    };
  }

  // DPP: did:web:<domain>:did:dpp:<granularity>:<stableId>
  if (ns === "dpp" && rest.length === 4) {
    return {
      type: "dpp",
      domain,
      granularity: rest[2],
      stableId: decodeURIComponent(rest[3]),
    };
  }

  // Facility: did:web:<domain>:did:facility:<encodedFacilityId>
  if (ns === "facility" && rest.length === 3) {
    return {
      type: "facility",
      domain,
      facilityId: decodeURIComponent(rest[2]),
    };
  }

  // Generic product subject: did:web:<domain>:did:<passportType>:<level>:<stableId>
  if (rest.length === 4) {
    const level = rest[2];
    if (level !== "model" && level !== "batch" && level !== "item") return null;
    return {
      type: "product",
      domain,
      passportType: normalizeNamespace(ns),
      level,
      stableId: decodeURIComponent(rest[3]),
    };
  }

  return null;
}

// ─── DID → DOCUMENT URL ──────────────────────────────────────────────────────

/**
 * Map a DID to its did.json document URL following the did:web spec.
 *
 *   did:web:www.claros-dpp.online
 *     → https://www.claros-dpp.online/.well-known/did.json
 *
 *   did:web:www.claros-dpp.online:did:company:5
 *     → https://www.claros-dpp.online/did/company/5/did.json
 *
 *   did:web:www.claros-dpp.online:did:custom-passport-v1:batch:LOT-001
 *     → https://www.claros-dpp.online/did/custom-passport-v1/batch/LOT-001/did.json
 *
 *   did:web:www.claros-dpp.online:did:dpp:model:STYLE-001
 *     → https://www.claros-dpp.online/did/dpp/model/STYLE-001/did.json
 *
 *   did:web:www.claros-dpp.online:did:facility:PLANT-A
 *     → https://www.claros-dpp.online/did/facility/PLANT-A/did.json
 */
function didToDocumentUrl(did) {
  const parsed = parseDid(did);
  if (!parsed) return null;

  const base = `https://${parsed.domain}`;

  if (parsed.type === "platform") {
    return `${base}/.well-known/did.json`;
  }

  if (parsed.type === "company") {
    return `${base}/did/company/${parsed.companyId}/did.json`;
  }

  if (parsed.type === "product") {
    const encodedStableId = encodeURIComponent(parsed.stableId);
    return `${base}/did/${parsed.passportType}/${parsed.level}/${encodedStableId}/did.json`;
  }

  if (parsed.type === "dpp") {
    const encodedStableId = encodeURIComponent(parsed.stableId);
    return `${base}/did/dpp/${parsed.granularity}/${encodedStableId}/did.json`;
  }

  if (parsed.type === "facility") {
    const encodedFid = encodeURIComponent(parsed.facilityId);
    return `${base}/did/facility/${encodedFid}/did.json`;
  }

  return null;
}

// ─── CANONICAL PUBLIC URL ────────────────────────────────────────────────────

/**
 * Build the consumer-facing HTTPS public URL for a passport.
 *
 * Pattern: <appUrl>/dpp/<manufacturerSlug>/<modelSlug>/<encodedDppId>
 *
 * Uses the public DPP ID. internalAliasId stays an internal company identifier.
 *
 * @param {object} passport  - passport row (must have dppId, modelName, companyId)
 * @param {string} companyName - human-readable company name (used to derive manufacturerSlug)
 */
function buildCanonicalPublicUrl(passport, companyName) {
  const appUrl = getAppUrl();

  const routePassportId = passport.dppId || passport.guid;

  const manufacturerSlug = slugify(companyName || String(passport.companyId));
  const modelSlug = slugify(passport.modelName || routePassportId);
  const encodedPassportId = encodeURIComponent(String(routePassportId));

  return `${appUrl}/dpp/${manufacturerSlug}/${modelSlug}/${encodedPassportId}`;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  getDomain,
  slugify,
  normalizeNamespace,
  platformDid,
  companyDid,
  productSubjectDid,
  productModelDid,
  productItemDid,
  productBatchDid,
  dppDid,
  facilityDid,
  parseDid,
  didToDocumentUrl,
  buildCanonicalPublicUrl,
};
