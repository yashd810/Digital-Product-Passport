const {
  createComplianceManagedFieldHelpers,
} = require("./compliance-managed-fields");

function createComplianceHelpers({
  pool,
  complianceService,
  productIdentifierService,
  extractExplicitFacilityId,
  getTable,
  getPassportTypeSchema,
  normalizePassportRow,
  normalizeInternalAliasIdValue,
  normalizeReleaseStatus,
  updatePassportRowById,
}) {
  const VALID_GRANULARITIES = new Set(["model", "batch", "item"]);

  function extractBusinessIdentifierSource(source = null, typeDef = null) {
    return productIdentifierService.extractBusinessProductIdentifier?.(source || {}, typeDef) || "";
  }

  function buildStoredProductIdentifiers({ companyId, companySlug = null, companyName = null, passportType, internalAliasId, granularity, passportLike = null, typeDef = null }) {
    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      companySlug,
      companyName,
      passportType,
      rawProductId: internalAliasId,
      canonicalProductIdSource: extractBusinessIdentifierSource(passportLike, typeDef),
      granularity,
    });
    return {
      internalAliasId: normalized.internalAliasIdInput || null,
      uniqueProductIdentifier: normalized.productIdentifierDid || null,
    };
  }

  async function hasReleasedLineageVersion({ tableName, lineageId, excludeDppId = null }) {
    const params = [lineageId];
    let excludeSql = "";
    if (excludeDppId) {
      params.push(excludeDppId);
      excludeSql = ` AND "dppId" <> $${params.length}`;
    }
    const result = await pool.query(
      `SELECT 1
       FROM ${tableName}
       WHERE "lineageId" = $1
         AND "releaseStatus" IN ('released', 'obsolete')
         AND "deletedAt" IS NULL${excludeSql}
       LIMIT 1`,
      params
    );
    return result.rows.length > 0;
  }

  async function getCompanyDppPolicy(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              COALESCE(p."defaultGranularity", 'item') AS "defaultGranularity",
              COALESCE(p."allowGranularityOverride", false) AS "allowGranularityOverride",
              COALESCE(p."mintModelDids", true) AS "mintModelDids",
              COALESCE(p."mintItemDids", true) AS "mintItemDids",
              COALESCE(p."mintFacilityDids", false) AS "mintFacilityDids",
              COALESCE(p."vcIssuanceEnabled", true) AS "vcIssuanceEnabled",
              COALESCE(p."jsonldExportEnabled", true) AS "jsonldExportEnabled",
              COALESCE(p."semanticDictionaryEnabled", true) AS "semanticDictionaryEnabled"
       FROM companies c
       LEFT JOIN "companyDppPolicies" p ON p."companyId" = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  const {
    buildComplianceManagedFields,
  } = createComplianceManagedFieldHelpers({
    pool,
    complianceService,
    extractExplicitFacilityId,
  });

  async function loadCompanySerializationContext(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c."companyName" AS "companyName",
              c."didSlug" AS "didSlug",
              COALESCE(p."defaultGranularity", 'item') AS "dppGranularity",
              COALESCE(p."defaultGranularity", 'item') AS "defaultGranularity"
       FROM companies c
       LEFT JOIN "companyDppPolicies" p ON p."companyId" = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  function isFullRepresentationRequest(value) {
    return String(value || "").trim().toLowerCase() === "full";
  }

  function resolveGranularityForCreate(companyPolicy, requestedGranularity) {
    const enforcedGranularity = String(companyPolicy?.defaultGranularity || "item").trim().toLowerCase();
    const normalizedRequested = requestedGranularity === undefined || requestedGranularity === null || requestedGranularity === ""
      ? null
      : String(requestedGranularity).trim().toLowerCase();

    if (normalizedRequested && !VALID_GRANULARITIES.has(normalizedRequested)) {
      const error = new Error("granularity must be one of: model, batch, item");
      error.statusCode = 400;
      throw error;
    }

    if (!companyPolicy) return normalizedRequested || enforcedGranularity;

    if (!companyPolicy.allowGranularityOverride && normalizedRequested && normalizedRequested !== enforcedGranularity) {
      const error = new Error(`Granularity override is disabled for this company. The enforced value is "${enforcedGranularity}".`);
      error.statusCode = 400;
      throw error;
    }

    const effectiveGranularity = normalizedRequested && companyPolicy.allowGranularityOverride
      ? normalizedRequested
      : enforcedGranularity;

    if (effectiveGranularity === "model" && companyPolicy.mintModelDids === false) {
      const error = new Error("Model-level DIDs are disabled for this company policy.");
      error.statusCode = 400;
      throw error;
    }
    if ((effectiveGranularity === "item" || effectiveGranularity === "batch") && companyPolicy.mintItemDids === false) {
      const error = new Error("Item-level DIDs are disabled for this company policy.");
      error.statusCode = 400;
      throw error;
    }

    return effectiveGranularity;
  }

  async function loadLatestLivePassport({ companyId, dppId, passportType, releaseStatusSql = null }) {
    const tableName = getTable(passportType);
    const result = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "dppId" = $1
         AND "companyId" = $2
         ${releaseStatusSql ? `AND "releaseStatus" IN ${releaseStatusSql}` : ""}
         AND "deletedAt" IS NULL
       ORDER BY "versionNumber" DESC
       LIMIT 1`,
      [dppId, companyId]
    );
    return result.rows[0] || null;
  }

  async function evaluateCompliance(passport, passportType) {
    return complianceService.evaluatePassport(
      { ...normalizePassportRow(passport), passportType },
      passportType
    );
  }

  async function reconcileManagedReleaseFields({ passport, companyId, passportType, userId }) {
    if (!passport) return passport;

    const typeSchema = await getPassportTypeSchema(passportType);
    if (!typeSchema) return passport;

    const nextFields = {};
    const effectiveGranularity = passport.granularity || "item";
    const normalizedProductId = normalizeInternalAliasIdValue(passport.internalAliasId);

    if (normalizedProductId) {
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        passportType: typeSchema.typeName,
        internalAliasId: normalizedProductId,
        granularity: effectiveGranularity,
        passportLike: passport,
      });
      if (storedProductIdentifiers.internalAliasId && storedProductIdentifiers.internalAliasId !== passport.internalAliasId) {
        nextFields.internalAliasId = storedProductIdentifiers.internalAliasId;
      }
      if (storedProductIdentifiers.uniqueProductIdentifier !== passport.uniqueProductIdentifier) {
        nextFields.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
      }
    }

    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: typeSchema.typeName,
      granularity: effectiveGranularity,
      requestedFields: passport,
      existingFields: passport,
    });

    if (complianceManagedFields.passportPolicyKey !== passport.passportPolicyKey) {
      nextFields.passportPolicyKey = complianceManagedFields.passportPolicyKey;
    }
    if (complianceManagedFields.contentSpecificationIds !== passport.contentSpecificationIds) {
      nextFields.contentSpecificationIds = complianceManagedFields.contentSpecificationIds;
    }
    if (complianceManagedFields.carrierPolicyKey !== passport.carrierPolicyKey) {
      nextFields.carrierPolicyKey = complianceManagedFields.carrierPolicyKey;
    }
    if (complianceManagedFields.economicOperatorId !== passport.economicOperatorId) {
      nextFields.economicOperatorId = complianceManagedFields.economicOperatorId;
    }
    if (complianceManagedFields.economicOperatorIdentifierScheme !== passport.economicOperatorIdentifierScheme) {
      nextFields.economicOperatorIdentifierScheme = complianceManagedFields.economicOperatorIdentifierScheme;
    }
    if (complianceManagedFields.facilityId !== passport.facilityId) {
      nextFields.facilityId = complianceManagedFields.facilityId;
    }

    const updateKeys = Object.keys(nextFields);
    if (!updateKeys.length) {
      return passport;
    }

    const updateResult = await updatePassportRowById({
      tableName: getTable(typeSchema.typeName),
      rowId: passport.id,
      userId,
      data: nextFields,
      includeUpdatedRow: true,
    });

    return updateResult.updatedRow || { ...passport, ...nextFields };
  }

  return {
    VALID_GRANULARITIES,
    buildComplianceManagedFields,
    buildStoredProductIdentifiers,
    evaluateCompliance,
    getCompanyDppPolicy,
    hasReleasedLineageVersion,
    isFullRepresentationRequest,
    loadCompanySerializationContext,
    loadLatestLivePassport,
    reconcileManagedReleaseFields,
    resolveGranularityForCreate,
  };
}

module.exports = {
  createComplianceHelpers,
};
