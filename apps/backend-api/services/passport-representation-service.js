"use strict";

module.exports = function createPassportRepresentationService({
  productIdentifierService = null,
  buildCanonicalPassportPayload = null,
} = {}) {
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
    if (["draft", "in_review", "in_revision", "revised"].includes(normalized)) return "Inactive";
    return "Invalid";
  }

  function buildClarosExtensions({ passportType = null, versionNumber = null, internalId = null } = {}) {
    const claros = {};
    if (passportType) claros.passportType = passportType;
    if (versionNumber !== null && versionNumber !== undefined) claros.versionNumber = versionNumber;
    if (internalId) claros.internalId = internalId;
    return Object.keys(claros).length ? { claros } : null;
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
  // @param {object} typeDef   - passport_types row with fields_json
  // @param {object} options
  //   @param {string}  options.companyName  - human-readable company name
  //   @param {string}  options.granularity  - 'model' | 'item' | 'batch' (default: 'model')
  //   @param {object}  options.dppIdentity  - dpp-identity-service module (optional)
  function buildOperationalDppPayload(passport, typeDef, { companyName, granularity, dppIdentity } = {}) {
    const resolvedGranularity = granularity || "model";

    // ── economicOperatorId uses company DID when dppIdentity available ────────
    let economicOperatorId = passport.economic_operator_id || null;
    if (!economicOperatorId && dppIdentity) {
      economicOperatorId = dppIdentity.companyDid(passport.company_id);
    } else if (!economicOperatorId) {
      // Legacy fallback using :org: path
      const appUrl = process.env.APP_URL || "http://localhost:3001";
      const domain = new URL(appUrl).host;
      economicOperatorId = `did:web:${domain}:org:${passport.company_id}`;
    }

    // ── Product and DPP DIDs ──────────────────────────────────────────────────
    let productDid = null;
    let dppDidValue = null;
    let publicUrl = null;

    if (passport.product_identifier_did) {
      productDid = passport.product_identifier_did;
    }

    if (!productDid && passport.product_id) {
      productDid = productIdentifierService?.buildCanonicalProductDid?.({
        companyId: passport.company_id,
        passportType: passport.passport_type || typeDef?.type_name || "battery",
        rawProductId: passport.product_id,
        granularity: resolvedGranularity,
      }) || null;
    }

    if (dppIdentity && passport.product_id) {
      try {
        productDid  = productDid || dppIdentity.productModelDid(passport.company_id, passport.product_id);
        dppDidValue = dppIdentity.dppDid(resolvedGranularity, passport.company_id, passport.product_id);
        publicUrl   = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      } catch {
        // product_id may be malformed; leave DIDs null
      }
    }

    // ── Extract user-defined fields with native types ─────────────────────────
    const sections = typeDef?.fields_json?.sections || [];
    const userFields = {};
    const facilityId = passport.facility_id || null;
    const canonicalPayload = typeof buildCanonicalPassportPayload === "function"
      ? buildCanonicalPassportPayload(passport, typeDef, { granularity: resolvedGranularity })
      : null;

    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.dynamic) continue;
        const v = canonicalPayload?.fields && Object.prototype.hasOwnProperty.call(canonicalPayload.fields, field.key)
          ? canonicalPayload.fields[field.key]
          : passport[field.key];
        if (v !== null && v !== undefined && v !== "") {
          userFields[field.key] = v;
        }
      }
    }

    const contentSpecificationIds = parseArrayValue(
      passport.content_specification_ids
      || typeDef?.semantic_model_key
      || typeDef?.fields_json?.semanticModelKey
      || []
    );
    const resolvedVersionNumber = passport.version_number === null || passport.version_number === undefined || passport.version_number === ""
      ? null
      : Number(passport.version_number);
    const extensions = buildClarosExtensions({
      passportType: passport.passport_type || null,
      versionNumber: Number.isFinite(resolvedVersionNumber) ? resolvedVersionNumber : passport.version_number,
      internalId: passport.dppId || passport.dpp_id || null,
    });
    if (extensions?.claros && !canonicalPayload?.extensions?.claros?.validation) {
      extensions.claros.validation = buildValidationSummary();
    }

    return {
      // JTC 18223 canonical header fields
      digitalProductPassportId:  passport.dppId || passport.dpp_id || canonicalPayload?.digitalProductPassportId || dppDidValue || null,
      uniqueProductIdentifier:   canonicalPayload?.uniqueProductIdentifier || passport.product_id || productDid || null,
      granularity:               resolvedGranularity,
      dppSchemaVersion:          passport.dpp_schema_version || typeDef?.fields_json?.dppSchemaVersion || "prEN 18223:2025",
      dppStatus:                 canonicalPayload?.dppStatus || toStandardDppStatus(passport.release_status),
      lastUpdated:               canonicalPayload?.lastUpdated || toIsoTimestamp(passport.updated_at || passport.created_at),
      economicOperatorId:        canonicalPayload?.economicOperatorId || economicOperatorId,
      contentSpecificationIds:   Array.isArray(canonicalPayload?.contentSpecificationIds)
        ? canonicalPayload.contentSpecificationIds
        : (Array.isArray(contentSpecificationIds) ? contentSpecificationIds : []),
      complianceProfileKey:      canonicalPayload?.complianceProfileKey || passport.compliance_profile_key || null,
      carrierPolicyKey:          canonicalPayload?.carrierPolicyKey || passport.carrier_policy_key || null,
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
