"use strict";

const { buildCarrierAuthenticityResponseFields } = require("../shared/passports/carrier-authenticity");
const { getPassportFieldValue } = require("../shared/passports/passport-helpers");

module.exports = function createPassportRepresentationService({
  productIdentifierService = null,
  buildCanonicalPassportPayload = null,
} = {}) {
  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }

  function toIsoTimestamp(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function parseArrayValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [trimmed];
      }
    }
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }

  function toStandardDppStatus(releaseStatus) {
    const normalized = String(releaseStatus || "").trim().toLowerCase();
    if (normalized === "released") return "Active";
    if (normalized === "active") return "Active";
    if (normalized === "archived") return "Archived";
    if (normalized === "invalid") return "Invalid";
    if (normalized === "obsolete") return "Inactive";
    if (normalized === "inactive") return "Inactive";
    if (["draft", "in_review", "in_revision"].includes(normalized)) return "Inactive";
    return "Invalid";
  }

  function buildPlatformExtensions({ passportType = null, versionNumber = null, internalId = null } = {}) {
    const platform = {};
    if (passportType) platform.passportType = passportType;
    if (versionNumber !== null && versionNumber !== undefined) platform.versionNumber = versionNumber;
    if (internalId) platform.internalId = internalId;
    return Object.keys(platform).length ? { platform } : null;
  }

  function buildValidationSummary(issues = []) {
    const countsByCode = {};
    for (const issue of issues) {
      countsByCode[issue.code] = (countsByCode[issue.code] || 0) + 1;
    }
    return {
      valid: issues.length === 0,
      issueCount: issues.length,
      countsByCode,
    };
  }

  // Build a canonical JTC 18223-style operational DPP payload.
  // Internal fields (dppId, company_id, etc.) are mapped to the
  // standard external names. User-defined passport fields are
  // appended with their native types preserved (no String coercion).
  //
  // @param {object} passport  - normalised passport row
  // @param {object} typeDef   - passport_types row with fieldsJson
  // @param {object} options
  //   @param {string}  options.companyName  - human-readable company name
  //   @param {string}  options.granularity  - 'model' | 'item' | 'batch' (default: 'model')
  //   @param {object}  options.dppIdentity  - dpp-identity-service module (optional)
  function buildOperationalDppPayload(passport, typeDef, { companyName, granularity, dppIdentity } = {}) {
    const resolvedGranularity = granularity || "model";

    // ── economicOperatorId uses company DID when dppIdentity available ────────
    let economicOperatorId = passport.economicOperatorId || null;
    if (!economicOperatorId && dppIdentity) {
      economicOperatorId = dppIdentity.companyDid(passport.companyId);
    }

    // ── Product and DPP DIDs ──────────────────────────────────────────────────
    let productDid = null;
    let dppDidValue = null;
    let publicUrl = null;

    const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}, typeDef) || "";
    if (businessIdentifier) {
      productDid = productIdentifierService?.buildCanonicalProductDid?.({
        companyId: passport.companyId,
        passportType: passport.passportType || typeDef?.typeName || "passport",
        rawProductId: businessIdentifier,
        granularity: resolvedGranularity,
      }) || null;
    }

    const stableDppId = passport.lineageId || passport.dppId || passport.internalAliasId;
    if (dppIdentity && stableDppId) {
      try {
        dppDidValue = dppIdentity.dppDid(resolvedGranularity, stableDppId);
        publicUrl   = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      } catch {
        // internalAliasId may be malformed; leave DIDs null
      }
    }

    // ── Extract user-defined fields with native types ─────────────────────────
    const sections = typeDef?.fieldsJson?.sections || [];
    const userFields = {};
    const facilityId = passport.facilityId || null;
    const companyStub = companyName ? {
      companyName,
      didSlug: slugify(companyName),
      economicOperatorIdentifier: null,
      defaultGranularity: resolvedGranularity,
    } : null;
    const canonicalPayload = typeof buildCanonicalPassportPayload === "function"
      ? buildCanonicalPassportPayload(passport, typeDef, {
        granularity: resolvedGranularity,
        company: companyStub,
        companyName,
      })
      : null;

    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.dynamic) continue;
        const v = canonicalPayload?.fields && Object.prototype.hasOwnProperty.call(canonicalPayload.fields, field.key)
          ? canonicalPayload.fields[field.key]
          : getPassportFieldValue(passport, field.key);
        if (v !== null && v !== undefined && v !== "") {
          userFields[field.key] = v;
        }
      }
    }

    const contentSpecificationIds = parseArrayValue(
      passport.contentSpecificationIds
      || typeDef?.semanticModelKey
      || typeDef?.fieldsJson?.semanticModelKey
      || []
    );
    const resolvedVersionNumber = passport.versionNumber === null || passport.versionNumber === undefined || passport.versionNumber === ""
      ? null
      : Number(passport.versionNumber);
    const extensions = buildPlatformExtensions({
      passportType: passport.passportType || null,
      versionNumber: Number.isFinite(resolvedVersionNumber) ? resolvedVersionNumber : passport.versionNumber,
      internalId: passport.dppId || passport.guid || null,
    });
    if (extensions?.platform && !canonicalPayload?.extensions?.platform?.validation) {
      extensions.platform.validation = buildValidationSummary();
    }

    const internalAliasId = passport.internalAliasId || null;
    const uniqueProductIdentifier = canonicalPayload?.uniqueProductIdentifier || productDid || null;

    return {
      // JTC 18223 canonical header fields
      digitalProductPassportId:  passport.dppId || canonicalPayload?.digitalProductPassportId || dppDidValue || null,
      uniqueProductIdentifier,
      internalAliasId,
      granularity:               resolvedGranularity,
      dppSchemaVersion:          passport.dppSchemaVersion || typeDef?.fieldsJson?.dppSchemaVersion || "prEN 18223:2025",
      dppStatus:                 canonicalPayload?.dppStatus || toStandardDppStatus(passport.releaseStatus),
      lastUpdate:                canonicalPayload?.lastUpdate || canonicalPayload?.lastUpdated || toIsoTimestamp(passport.updatedAt || passport.createdAt),
      economicOperatorId:        canonicalPayload?.economicOperatorId || economicOperatorId,
      contentSpecificationIds:   Array.isArray(canonicalPayload?.contentSpecificationIds)
        ? canonicalPayload.contentSpecificationIds
        : (Array.isArray(contentSpecificationIds) ? contentSpecificationIds : []),
      passportPolicyKey:      canonicalPayload?.passportPolicyKey || passport.passportPolicyKey || null,
      carrierPolicyKey:          canonicalPayload?.carrierPolicyKey || passport.carrierPolicyKey || null,
      ...buildCarrierAuthenticityResponseFields(passport.carrierAuthenticity || canonicalPayload),
      ...(companyName ? { economicOperatorName: companyName } : {}),

      // DID-based identifiers (product-id-based, not record-id-based)
      ...(productDid  ? { productDid }           : {}),
      ...(dppDidValue ? { dppDid: dppDidValue }   : {}),
      ...(publicUrl   ? { publicUrl }             : {}),
      ...(facilityId  ? { facilityId }            : {}),

      // User-defined passport fields (native types preserved)
      ...userFields,

      ...(canonicalPayload?.extensions ? { extensions: canonicalPayload.extensions } : (extensions ? { extensions } : {})),
    };
  }

  return { buildOperationalDppPayload };
};
