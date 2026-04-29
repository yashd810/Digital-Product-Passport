"use strict";

// ─── DPP IDENTITY SERVICE ─────────────────────────────────────────────────────
// Stable, product-id-based DID generation for the Claros DPP platform.
// All DIDs use companyId + product_id — never the record ID.
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
 * Product model DID.
 * did:web:www.claros-dpp.online:did:battery:model:<companyId>:<encodedProductId>
 */
function productModelDid(companyId, productId) {
  assertId(companyId, "companyId");
  assertId(productId, "productId");
  const encodedProductId = encodeURIComponent(String(productId));
  return `did:web:${getDomain()}:did:battery:model:${companyId}:${encodedProductId}`;
}

/**
 * Product item DID.
 * did:web:www.claros-dpp.online:did:battery:item:<companyId>:<encodedProductId>
 */
function productItemDid(companyId, productId) {
  assertId(companyId, "companyId");
  assertId(productId, "productId");
  const encodedProductId = encodeURIComponent(String(productId));
  return `did:web:${getDomain()}:did:battery:item:${companyId}:${encodedProductId}`;
}

/**
 * DPP record DID.
 * did:web:www.claros-dpp.online:did:dpp:<granularity>:<companyId>:<encodedProductId>
 *
 * @param {string} granularity - 'model', 'item', or 'batch'
 */
function dppDid(granularity, companyId, productId) {
  assertId(granularity, "granularity");
  assertId(companyId, "companyId");
  assertId(productId, "productId");
  const encodedProductId = encodeURIComponent(String(productId));
  return `did:web:${getDomain()}:did:dpp:${granularity}:${companyId}:${encodedProductId}`;
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
 *   did:web:<domain>:did:battery:model:<cId>:<pId>           → { type: 'battery', level: 'model', companyId, productId }
 *   did:web:<domain>:did:battery:item:<cId>:<pId>            → { type: 'battery', level: 'item',  companyId, productId }
 *   did:web:<domain>:did:dpp:<granularity>:<cId>:<pId>       → { type: 'dpp', granularity, companyId, productId }
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

  // Battery model/item: did:web:<domain>:did:battery:<level>:<companyId>:<encodedProductId>
  if (ns === "battery" && rest.length === 5) {
    const level = rest[2];
    if (level !== "model" && level !== "item") return null;
    return {
      type: "battery",
      domain,
      level,
      companyId: rest[3],
      productId: decodeURIComponent(rest[4]),
    };
  }

  // DPP: did:web:<domain>:did:dpp:<granularity>:<companyId>:<encodedProductId>
  if (ns === "dpp" && rest.length === 5) {
    return {
      type: "dpp",
      domain,
      granularity: rest[2],
      companyId: rest[3],
      productId: decodeURIComponent(rest[4]),
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
 *   did:web:www.claros-dpp.online:did:battery:model:5:ACME-001
 *     → https://www.claros-dpp.online/did/battery/model/5/ACME-001/did.json
 *
 *   did:web:www.claros-dpp.online:did:dpp:model:5:ACME-001
 *     → https://www.claros-dpp.online/did/dpp/model/5/ACME-001/did.json
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

  if (parsed.type === "battery") {
    const encodedPid = encodeURIComponent(parsed.productId);
    return `${base}/did/battery/${parsed.level}/${parsed.companyId}/${encodedPid}/did.json`;
  }

  if (parsed.type === "dpp") {
    const encodedPid = encodeURIComponent(parsed.productId);
    return `${base}/did/dpp/${parsed.granularity}/${parsed.companyId}/${encodedPid}/did.json`;
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
 * Pattern: <appUrl>/dpp/<manufacturerSlug>/<modelSlug>/<encodedProductId>
 *
 * Uses product_id (NOT the record ID). Falls back to /passport/<dppId> only if no product_id.
 *
 * @param {object} passport  - passport row (must have product_id, model_name, dppId, company_id)
 * @param {string} companyName - human-readable company name (used to derive manufacturerSlug)
 */
function buildCanonicalPublicUrl(passport, companyName) {
  const appUrl = getAppUrl();

  const productId = passport.product_id;
  if (!productId) {
    // Fallback: record-id-based URL when no product identifier is available
    return `${appUrl}/passport/${passport.dppId || passport.dpp_id}`;
  }

  const manufacturerSlug = slugify(companyName || String(passport.company_id));
  const modelSlug        = slugify(passport.model_name || productId);
  const encodedProductId = encodeURIComponent(String(productId));

  return `${appUrl}/dpp/${manufacturerSlug}/${modelSlug}/${encodedProductId}`;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  getDomain,
  slugify,
  platformDid,
  companyDid,
  productModelDid,
  productItemDid,
  dppDid,
  facilityDid,
  parseDid,
  didToDocumentUrl,
  buildCanonicalPublicUrl,
};
