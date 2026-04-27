"use strict";

module.exports = function createPassportRepresentationService({ productIdentifierService = null } = {}) {
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

  // Build a canonical JTC 18223-style operational DPP payload.
  // Internal fields (guid, company_id, etc.) are mapped to the
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
    const explicitFacilityId = passport.facility_id
      || passport.facility_identifier
      || passport.manufacturing_facility_id
      || passport.manufacturing_facility_identifier
      || null;
    let facilityId = explicitFacilityId;

    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.dynamic) continue;
        const v = passport[field.key];
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

    return {
      // JTC 18223 canonical header fields
      digitalProductPassportId:  dppDidValue || null,
      uniqueProductIdentifier:   productDid || null,
      granularity:               resolvedGranularity,
      dppSchemaVersion:          passport.dpp_schema_version || typeDef?.fields_json?.dppSchemaVersion || "prEN 18223:2025",
      dppStatus:                 passport.release_status,
      lastUpdate:                toIsoTimestamp(passport.updated_at || passport.created_at),
      economicOperatorId,
      contentSpecificationIds:   Array.isArray(contentSpecificationIds) ? contentSpecificationIds : [],
      complianceProfileKey:      passport.compliance_profile_key || null,
      carrierPolicyKey:          passport.carrier_policy_key || null,
      ...(companyName ? { economicOperatorName: companyName } : {}),

      // DID-based identifiers (product-id-based, not guid-based)
      ...(productDid  ? { productDid }           : {}),
      ...(dppDidValue ? { dppDid: dppDidValue }   : {}),
      ...(publicUrl   ? { publicUrl }             : {}),
      ...(facilityId  ? { facilityId }            : {}),

      // Platform metadata
      passportType:  passport.passport_type,
      versionNumber: passport.version_number,

      // User-defined passport fields (native types preserved)
      ...userFields,

      // Internal metadata (guid is internal only — not a primary field)
      _meta: {
        internalId: passport.guid,
      },
    };
  }

  return { buildOperationalDppPayload };
};
