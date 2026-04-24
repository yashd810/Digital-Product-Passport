"use strict";

module.exports = function createPassportRepresentationService() {
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
    let economicOperatorId;
    if (dppIdentity) {
      economicOperatorId = dppIdentity.companyDid(passport.company_id);
    } else {
      // Legacy fallback using :org: path
      const appUrl = process.env.APP_URL || "http://localhost:3001";
      const domain = new URL(appUrl).host;
      economicOperatorId = `did:web:${domain}:org:${passport.company_id}`;
    }

    // ── Product and DPP DIDs ──────────────────────────────────────────────────
    let productDid = null;
    let dppDidValue = null;
    let publicUrl = null;

    if (dppIdentity && passport.product_id) {
      try {
        productDid  = dppIdentity.productModelDid(passport.company_id, passport.product_id);
        dppDidValue = dppIdentity.dppDid(resolvedGranularity, passport.company_id, passport.product_id);
        publicUrl   = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      } catch {
        // product_id may be malformed; leave DIDs null
      }
    }

    // ── Extract user-defined fields with native types ─────────────────────────
    const sections = typeDef?.fields_json?.sections || [];
    const userFields = {};
    let facilityId = null;

    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.dynamic) continue;
        const v = passport[field.key];
        if (v !== null && v !== undefined && v !== "") {
          userFields[field.key] = v;

          // Look for a field key containing "facility" to extract facilityId
          if (!facilityId && field.key.toLowerCase().includes("facility")) {
            facilityId = v;
          }
        }
      }
    }

    return {
      // JTC 18223 canonical header fields
      digitalProductPassportId:  passport.product_id || null,
      uniqueProductIdentifier:   passport.product_id  || null,
      granularity:               resolvedGranularity,
      dppSchemaVersion:          "1.0",
      dppStatus:                 passport.release_status,
      lastUpdate:                passport.updated_at,
      economicOperatorId,
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
