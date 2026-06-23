"use strict";

function createComplianceManagedFieldHelpers({
  pool,
  complianceService,
  extractExplicitFacilityId,
}) {
  function serializePolicyDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  function hasOwnValue(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
  }

  function hasExplicitFacilityOverride(source = {}) {
    return (
      hasOwnValue(source, "facilityId")
      || hasOwnValue(source, "facilityIdentifier")
      || hasOwnValue(source, "manufacturingFacilityId")
      || hasOwnValue(source, "manufacturingFacilityIdentifier")
      || hasOwnValue(source, "manufacturingFacility")
    );
  }

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT "economicOperatorIdentifier" AS "economicOperatorIdentifier",
              "economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    return result.rows[0] || null;
  }

  async function validateExplicitFacilityId({ companyId, facilityId }) {
    const result = await pool.query(
      `SELECT "facilityIdentifier"
       FROM "companyFacilities"
       WHERE "companyId" = $1
         AND "facilityIdentifier" = $2
         AND "isActive" = true
       LIMIT 1`,
      [companyId, facilityId]
    ).catch(() => ({ rows: [] }));
    if (result.rows.length) return facilityId;

    const error = new Error(`Unknown or inactive facility identifier "${facilityId}"`);
    error.statusCode = 400;
    throw error;
  }

  async function resolveManagedFacilityId({
    companyId,
    requestedFields = {},
    allowDefaultFacility = true,
    validateExplicitFacility = false,
  }) {
    const candidateFacilityId = extractExplicitFacilityId(requestedFields);
    if (candidateFacilityId) {
      return validateExplicitFacility
        ? validateExplicitFacilityId({ companyId, facilityId: candidateFacilityId })
        : candidateFacilityId;
    }

    if (!allowDefaultFacility) return null;

    const defaultFacilityRes = await pool.query(
      `SELECT "facilityIdentifier"
       FROM "companyFacilities"
       WHERE "companyId" = $1
         AND "isActive" = true
       ORDER BY "updatedAt" DESC, id DESC`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    if (defaultFacilityRes.rows.length === 1) {
      return defaultFacilityRes.rows[0].facilityIdentifier || null;
    }
    return null;
  }

  async function buildComplianceManagedFields({
    companyId,
    passportType,
    granularity,
    requestedFields = {},
    facilitySource = requestedFields,
    existingFields = null,
    allowDefaultFacility = true,
    validateExplicitFacility = false,
    allowPolicyOverride = false,
    allowContentSpecificationOverride = false,
  }) {
    const policy = complianceService.resolvePassportPolicyMetadata({ passportType, granularity });
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    let resolvedFacilityId = null;

    if (hasExplicitFacilityOverride(facilitySource)) {
      resolvedFacilityId = await resolveManagedFacilityId({
        companyId,
        requestedFields: facilitySource,
        allowDefaultFacility: false,
        validateExplicitFacility,
      });
    } else {
      resolvedFacilityId = extractExplicitFacilityId(existingFields);
      if (!resolvedFacilityId) {
        resolvedFacilityId = await resolveManagedFacilityId({
          companyId,
          requestedFields: facilitySource,
          allowDefaultFacility,
          validateExplicitFacility,
        });
      }
    }

    return {
      passportPolicyKey: allowPolicyOverride && requestedFields.passportPolicyKey
        ? requestedFields.passportPolicyKey
        : policy.key,
      contentSpecificationIds: serializePolicyDefaultValue(
        allowContentSpecificationOverride && requestedFields.contentSpecificationIds
          ? requestedFields.contentSpecificationIds
          : policy.contentSpecificationIds
      ),
      carrierPolicyKey: requestedFields.carrierPolicyKey || policy.defaultCarrierPolicyKey || null,
      economicOperatorId: requestedFields.economicOperatorId || companyIdentity?.economicOperatorIdentifier || null,
      economicOperatorIdentifierScheme:
        requestedFields.economicOperatorIdentifierScheme
        || companyIdentity?.economicOperatorIdentifierScheme
        || null,
      facilityId: resolvedFacilityId,
    };
  }

  return {
    buildComplianceManagedFields,
    hasExplicitFacilityOverride,
    loadCompanyComplianceIdentity,
    resolveManagedFacilityId,
    serializePolicyDefaultValue,
  };
}

module.exports = {
  createComplianceManagedFieldHelpers,
};
