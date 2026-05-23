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

  function extractBusinessIdentifierSource(source = null) {
    return productIdentifierService.extractBusinessProductIdentifier?.(source || {}) || "";
  }

  function buildStoredProductIdentifiers({ companyId, companySlug = null, companyName = null, passportType, internalAliasId, granularity, passportLike = null }) {
    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      companySlug,
      companyName,
      passportType,
      rawProductId: internalAliasId,
      canonicalProductIdSource: extractBusinessIdentifierSource(passportLike),
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
              COALESCE(p.default_granularity, 'item') AS default_granularity,
              COALESCE(p.allow_granularity_override, false) AS allow_granularity_override,
              COALESCE(p.mint_model_dids, true) AS mint_model_dids,
              COALESCE(p.mint_item_dids, true) AS mint_item_dids,
              COALESCE(p.mint_facility_dids, false) AS mint_facility_dids,
              COALESCE(p.vc_issuance_enabled, true) AS vc_issuance_enabled,
              COALESCE(p.jsonld_export_enabled, true) AS jsonld_export_enabled,
              COALESCE(p.claros_battery_dictionary_enabled, true) AS claros_battery_dictionary_enabled
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT economic_operator_identifier, economic_operator_identifier_scheme
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    const candidateFacilityId = extractExplicitFacilityId(requestedFields);
    if (!candidateFacilityId) {
      const defaultFacilityRes = await pool.query(
        `SELECT facility_identifier
         FROM company_facilities
         WHERE company_id = $1
           AND is_active = true
         ORDER BY updated_at DESC, id DESC`,
        [companyId]
      );
      if (defaultFacilityRes.rows.length === 1) {
        return defaultFacilityRes.rows[0].facility_identifier || null;
      }
      return null;
    }
    return candidateFacilityId;
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

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function buildComplianceManagedFields({
    companyId,
    passportType,
    granularity,
    requestedFields = {},
    facilitySource = requestedFields,
    existingFields = null,
  }) {
    const profile = complianceService.resolveProfileMetadata({ passportType, granularity });
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    let resolvedFacilityId = null;
    if (hasExplicitFacilityOverride(facilitySource)) {
      resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields: facilitySource });
    } else {
      resolvedFacilityId = extractExplicitFacilityId(existingFields);
      if (!resolvedFacilityId) {
        resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields: facilitySource });
      }
    }
    return {
      complianceProfileKey: profile.key,
      contentSpecificationIds: serializeProfileDefaultValue(
        requestedFields.contentSpecificationIds || profile.contentSpecificationIds
      ),
      carrierPolicyKey: requestedFields.carrierPolicyKey || profile.defaultCarrierPolicyKey || null,
      economicOperatorId: requestedFields.economicOperatorId || companyIdentity?.economic_operator_identifier || null,
      economicOperatorIdentifierScheme:
        requestedFields.economicOperatorIdentifierScheme
        || companyIdentity?.economic_operator_identifier_scheme
        || null,
      facilityId: resolvedFacilityId,
    };
  }

  async function loadCompanySerializationContext(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, 'item') AS default_granularity
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
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
    const fallbackGranularity = String(companyPolicy?.default_granularity || "item").trim().toLowerCase();
    const normalizedRequested = requestedGranularity === undefined || requestedGranularity === null || requestedGranularity === ""
      ? null
      : String(requestedGranularity).trim().toLowerCase();

    if (normalizedRequested && !VALID_GRANULARITIES.has(normalizedRequested)) {
      const error = new Error("granularity must be one of: model, batch, item");
      error.statusCode = 400;
      throw error;
    }

    if (!companyPolicy) return normalizedRequested || fallbackGranularity;

    if (!companyPolicy.allow_granularity_override && normalizedRequested && normalizedRequested !== fallbackGranularity) {
      const error = new Error(`Granularity override is disabled for this company. The enforced value is "${fallbackGranularity}".`);
      error.statusCode = 400;
      throw error;
    }

    const effectiveGranularity = normalizedRequested && companyPolicy.allow_granularity_override
      ? normalizedRequested
      : fallbackGranularity;

    if (effectiveGranularity === "model" && companyPolicy.mint_model_dids === false) {
      const error = new Error("Model-level DIDs are disabled for this company policy.");
      error.statusCode = 400;
      throw error;
    }
    if ((effectiveGranularity === "item" || effectiveGranularity === "batch") && companyPolicy.mint_item_dids === false) {
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

    if (complianceManagedFields.complianceProfileKey !== passport.complianceProfileKey) {
      nextFields.complianceProfileKey = complianceManagedFields.complianceProfileKey;
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
