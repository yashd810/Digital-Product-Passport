"use strict";
const logger = require("../src/infrastructure/logging/logger");
const {
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
} = require("../src/shared/passports/carrier-authenticity");
const {
  generateDppRecordId,
  isDppRecordId
} = require("../src/shared/identifiers/dpp-record-id");
const registerDidRoutes = require("../src/modules/dpp-api/register-did-routes");
const { createElementHelpers } = require("../src/modules/dpp-api/element-helpers");
const { createRequestResponseHelpers } = require("../src/modules/dpp-api/request-response-helpers");
const { createResolutionHelpers } = require("../src/modules/dpp-api/resolution-helpers");
const registerElementRoutes = require("../src/modules/dpp-api/register-element-routes");
const registerMutationRoutes = require("../src/modules/dpp-api/register-mutation-routes");
const registerPublicReadRoutes = require("../src/modules/dpp-api/register-public-read-routes");

// ─── DPP API ROUTES ───────────────────────────────────────────────────────────
// All DID paths use companyId + product_id — never the record ID.
// Conforms to the did:web spec for DID document resolution.

module.exports = function registerDppApiRoutes(app, {
  pool,
  publicReadRateLimit,
  authenticateToken,
  requireEditor,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  extractExplicitFacilityId,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  signingService,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  buildExpandedDataElement,
  buildPassportJsonLdContext,
  didService,
  dppIdentity, // the dpp-identity-service module
  productIdentifierService,
  archivePassportSnapshot,
  updatePassportRowById,
  isEditablePassportStatus,
  logAudit,
  accessRightsService,
  normalizePassportRequestBody,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  toStoredPassportValue,
  getPassportTypeSchema,
  findExistingPassportByProductId,
  complianceService,
  backupProviderService
}) {
  // ─── HELPERS ───────────────────────────────────────────────────────────────

  function getActorIdentifier(user) {
    return (
      user?.actorIdentifier ||
      user?.globallyUniqueOperatorId ||
      user?.operatorIdentifier ||
      user?.economicOperatorId ||
      user?.email ||
      (user?.userId ? `user:${user.userId}` : null)
    );
  }

  function extractCanonicalElementValue(payload, elementIdPath) {
    if (!payload || !elementIdPath) return undefined;
    if (payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, elementIdPath)) {
      return payload.fields[elementIdPath];
    }
    if (Object.prototype.hasOwnProperty.call(payload, elementIdPath)) {
      return payload[elementIdPath];
    }
    return undefined;
  }

  const VALID_GRANULARITIES = new Set(["model", "batch", "item"]);
  const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";
  const {
    normalizeSupportedElementIdPath,
    extractElementValue,
    setStructuredElementValue,
    findSchemaFieldDefinition,
    buildElementEnvelope,
    parseElementUpdatePayload,
  } = createElementHelpers({
    buildExpandedDataElement,
    dppIdentity,
    productIdentifierService,
  });
  const {
    getAppUrl,
    applyStandardsResultEnvelope,
    loadReleasedPassport,
    acceptsJsonLd,
    getRepresentation,
    getRepresentationFromValue,
    buildMutationPassportPayload,
    buildPassportResponse,
    dbLookupByCompanyAndProduct,
    dbLookupByProductIdOnly,
  } = createRequestResponseHelpers({
    pool,
    getTable,
    normalizeProductIdValue,
    stripRestrictedFieldsForPublicView,
    getCompanyNameMap,
    resolveReleasedPassportByProductId,
    buildOperationalDppPayload,
    buildCanonicalPassportPayload,
    buildExpandedPassportPayload,
    dppIdentity,
  });
  const {
    parseDppIdentifier,
    buildDppIdentifierFields,
    buildIdentifierLineageEnvelope,
    buildRegistrationId,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    resolvePassportByStableDppId,
    resolveReleasedPassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    loadReleasedPassportAtDate,
    resolveEditablePassportByDppId,
    resolveEditablePassportForIdentifier,
    buildBatchLookupResult,
    encodeBatchCursor,
    decodeBatchCursor,
    normalizeRequestedProductIds,
    parseBatchLimit,
    usesConfiguredGlobalProductIdentifierScheme,
    buildPassportServiceEndpoints,
    loadCompanyById,
    resolveLegacyPassportDidTarget,
  } = createResolutionHelpers({
    pool,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    normalizeProductIdValue,
    productIdentifierService,
    didService,
    dppIdentity,
    isDppRecordId,
    loadReleasedPassport,
    dbLookupByCompanyAndProduct,
    dbLookupByProductIdOnly,
    buildPassportResponse,
    getRepresentationFromValue,
    buildPassportJsonLdContext,
  });

  app.use("/api/v1", (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(applyStandardsResultEnvelope(req, res, payload));
    next();
  });

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT economic_operator_identifier, economic_operator_identifier_scheme
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    return result.rows[0] || null;
  }

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    const candidateFacilityId = extractExplicitFacilityId(requestedFields);
    if (!candidateFacilityId) return null;

    const facilityRes = await pool.query(
      `SELECT facility_identifier
       FROM company_facilities
       WHERE company_id = $1
         AND facility_identifier = $2
         AND is_active = true
       LIMIT 1`,
      [companyId, candidateFacilityId]
    ).catch(() => ({ rows: [] }));
    if (!facilityRes.rows.length) {
      const error = new Error(`Unknown or inactive facility identifier "${candidateFacilityId}"`);
      error.statusCode = 400;
      throw error;
    }
    return candidateFacilityId;
  }

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function buildStandardsCreateFields({ companyId, passportType, granularity, requestedFields = {} }) {
    const profile = complianceService?.resolveProfileMetadata?.({ passportType, granularity }) || {
      key: "generic_dpp_v1",
      contentSpecificationIds: [],
      defaultCarrierPolicyKey: null
    };
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    const resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields });
    return {
      compliance_profile_key: requestedFields.compliance_profile_key || profile.key,
      content_specification_ids: serializeProfileDefaultValue(
        requestedFields.content_specification_ids || profile.contentSpecificationIds || []
      ),
      carrier_policy_key: requestedFields.carrier_policy_key || profile.defaultCarrierPolicyKey || null,
      economic_operator_id: requestedFields.economic_operator_id || companyIdentity?.economic_operator_identifier || null,
      facility_id: resolvedFacilityId
    };
  }

  async function replicatePassportToBackup({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current"
  }) {
    const passportDppId = passport?.dppId || passport?.dpp_id || null;
    if (!backupProviderService || !passportDppId || !passport?.company_id) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }
    return backupProviderService.replicatePassportSnapshot({
      passport,
      typeDef,
      companyName,
      reason,
      snapshotScope
    });
  }

  async function updateEditableElement({ editable, normalizedPath, value, user }) {
    const headerFieldMap = {
      dppSchemaVersion: "dpp_schema_version",
      facilityId: "facility_id",
      economicOperatorId: "economic_operator_id",
      complianceProfileKey: "compliance_profile_key",
      carrierPolicyKey: "carrier_policy_key",
      contentSpecificationIds: "content_specification_ids"
    };
    const targetElementIdPath = normalizedPath?.path || "";
    const rootElementIdPath = normalizedPath?.rootElementIdPath || targetElementIdPath;
    const schemaField = findSchemaFieldDefinition(editable.typeDef, rootElementIdPath);
    const targetColumn = schemaField?.key || headerFieldMap[rootElementIdPath] || null;
    if (!targetColumn) {
      return {
        statusCode: 400,
        body: { error: "This element path is not writable through the standards element API" }
      };
    }

    const writeDecision = await accessRightsService.canWriteElement({
      passportDppId: editable.passport.dppId,
      typeDef: editable.typeDef,
      elementIdPath: targetElementIdPath,
      user,
      passportCompanyId: editable.passport.company_id
    });
    if (!writeDecision.allowed) {
      return {
        statusCode: 403,
        body: {
          error: "FORBIDDEN",
          updateAuthority: writeDecision.updateAuthority,
          confidentiality: writeDecision.confidentiality
        }
      };
    }

    let storedValue = value;
    if (normalizedPath?.childSegments?.length) {
      const nestedWrite = setStructuredElementValue(editable.passport[targetColumn], normalizedPath.childSegments, value);
      if (nestedWrite.error) {
        return {
          statusCode: 400,
          body: { error: nestedWrite.error }
        };
      }
      storedValue = nestedWrite.value;
    }

    await archivePassportSnapshot({
      passport: editable.passport,
      passportType: editable.passport.passport_type,
      archivedBy: user.userId,
      actorIdentifier: getActorIdentifier(user),
      snapshotReason: "before_patch_element",
    });

    const updateResult = await updatePassportRowById({
      tableName: editable.tableName,
      rowId: editable.passport.id,
      userId: user.userId,
      data: { [targetColumn]: storedValue },
      includeUpdatedRow: true,
    });
    if (updateResult?.updatedRow) {
      await archivePassportSnapshot({
        passport: updateResult.updatedRow,
        passportType: editable.passport.passport_type,
        archivedBy: user.userId,
        actorIdentifier: getActorIdentifier(user),
        snapshotReason: "after_patch_element",
      });
    }

    await logAudit(
      editable.passport.company_id,
      user.userId,
      "PATCH_DPP_ELEMENT",
      editable.tableName,
      editable.passport.dppId,
      { [targetColumn]: editable.passport[targetColumn] ?? null },
      { [targetColumn]: storedValue },
      {
        actorIdentifier: user.actorIdentifier || user.email || `user:${user.userId}`,
        audience: writeDecision.matchedAuthority || "economic_operator"
      }
    );

    const sourcePassport = { ...editable.passport, [targetColumn]: storedValue };
    const canonicalPayload = buildCanonicalPassportPayload(sourcePassport, editable.typeDef, { companyName: "" });
    return {
      statusCode: 200,
      body: buildElementEnvelope(
        sourcePassport,
        editable.typeDef,
        normalizedPath,
        extractElementValue(canonicalPayload, normalizedPath)
      )
    };
  }

  registerPublicReadRoutes(app, {
    logger,
    publicReadRateLimit,
    dbLookupByProductIdOnly,
    buildPassportResponse,
    acceptsJsonLd,
    buildPassportJsonLdContext,
    normalizeRequestedProductIds,
    parseBatchLimit,
    decodeBatchCursor,
    encodeBatchCursor,
    getRepresentationFromValue,
    buildBatchLookupResult,
    resolveReleasedPassportForIdentifier,
    loadReleasedPassportAtDate,
    resolveReleasedPassportByDppId,
    productIdentifierService,
    buildIdentifierLineageEnvelope,
  });

  registerMutationRoutes(app, {
    pool,
    logger,
    authenticateToken,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeProductIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByProductId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    buildCanonicalPassportPayload,
    dppIdentity,
    generateDppRecordId,
    buildStandardsCreateFields,
    usesConfiguredGlobalProductIdentifierScheme,
    VALID_GRANULARITIES,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    buildRegistrationId,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializeProfileDefaultValue,
    resolveManagedFacilityId,
    MERGE_PATCH_CONTENT_TYPE,
  });

  registerElementRoutes(app, {
    logger,
    publicReadRateLimit,
    authenticateToken,
    requireEditor,
    accessRightsService,
    parseDppIdentifier,
    normalizeSupportedElementIdPath,
    resolveReleasedPassportByDppId,
    buildCanonicalPassportPayload,
    extractElementValue,
    buildElementEnvelope,
    resolveEditablePassportByDppId,
    isEditablePassportStatus,
    parseElementUpdatePayload,
    updateEditableElement,
  });

  registerDidRoutes(app, {
    pool,
    logger,
    publicReadRateLimit,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    loadCompanyById,
    resolveLegacyPassportDidTarget,
    dbLookupByCompanyAndProduct,
    getAppUrl,
    didService,
    dppIdentity,
  });
};
