"use strict";
const logger = require("../../services/logger");
const {
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
} = require("../../shared/passports/carrier-authenticity");
const {
  generateDppRecordId,
  isDppRecordId
} = require("../../services/dpp-record-id");
const registerDidRoutes = require("../../modules/dpp-api/register-did-routes");
const { createElementHelpers } = require("../../modules/dpp-api/element-helpers");
const { createRequestResponseHelpers } = require("../../modules/dpp-api/request-response-helpers");
const { createResolutionHelpers } = require("../../modules/dpp-api/resolution-helpers");
const registerElementRoutes = require("../../modules/dpp-api/register-element-routes");
const registerMutationRoutes = require("../../modules/dpp-api/register-mutation-routes");
const registerPublicReadRoutes = require("../../modules/dpp-api/register-public-read-routes");
const {
  createComplianceManagedFieldHelpers,
} = require("../../modules/passports/compliance-managed-fields");

// ─── DPP API ROUTES ───────────────────────────────────────────────────────────
// All DID paths use companyId + internalAliasId — never the record ID.
// Conforms to the did:web spec for DID document resolution.

module.exports = function registerDppApiRoutes(app, {
  pool,
  publicReadRateLimit,
  authenticateToken,
  requireEditor,
  getTable,
  normalizePassportRow,
  normalizeInternalAliasIdValue,
  extractExplicitFacilityId,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByInternalAliasId,
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
  joinQuotedSqlIdentifiers,
  toStoredPassportValue,
  getPassportTypeSchema,
  findExistingPassportByInternalAliasId,
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
    dbLookupByInternalAliasIdOnly,
  } = createRequestResponseHelpers({
    pool,
    getTable,
    normalizeInternalAliasIdValue,
    stripRestrictedFieldsForPublicView,
    getCompanyNameMap,
    resolveReleasedPassportByInternalAliasId,
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
  } = createResolutionHelpers({
    pool,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    normalizeInternalAliasIdValue,
    productIdentifierService,
    didService,
    dppIdentity,
    isDppRecordId,
    loadReleasedPassport,
    dbLookupByCompanyAndProduct,
    dbLookupByInternalAliasIdOnly,
    buildPassportResponse,
    getRepresentationFromValue,
    buildPassportJsonLdContext,
  });

  app.use("/api/v1", (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(applyStandardsResultEnvelope(req, res, payload));
    next();
  });

  const complianceManagedFieldHelpers = createComplianceManagedFieldHelpers({
    pool,
    complianceService,
    extractExplicitFacilityId,
  });
  const {
    serializeProfileDefaultValue,
  } = complianceManagedFieldHelpers;

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    return complianceManagedFieldHelpers.resolveManagedFacilityId({
      companyId,
      requestedFields,
      allowDefaultFacility: false,
      validateExplicitFacility: true,
    });
  }

  async function buildStandardsCreateFields({ companyId, passportType, granularity, requestedFields = {} }) {
    return complianceManagedFieldHelpers.buildComplianceManagedFields({
      companyId,
      passportType,
      granularity,
      requestedFields,
      allowDefaultFacility: false,
      validateExplicitFacility: true,
      allowProfileOverride: false,
    });
  }

  async function replicatePassportToBackup({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current"
  }) {
    const passportDppId = passport?.dppId || null;
    if (!backupProviderService || !passportDppId || !passport?.companyId) {
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
      dppSchemaVersion: "dppSchemaVersion",
      facilityId: "facilityId",
      economicOperatorId: "economicOperatorId",
      complianceProfileKey: "complianceProfileKey",
      carrierPolicyKey: "carrierPolicyKey",
      contentSpecificationIds: "contentSpecificationIds"
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
      passportCompanyId: editable.passport.companyId
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
      editable.passport.companyId,
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
    dbLookupByInternalAliasIdOnly,
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
    normalizeInternalAliasIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByInternalAliasId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
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
    dbLookupByCompanyAndProduct,
    dbLookupByInternalAliasIdOnly,
    getAppUrl,
    didService,
    dppIdentity,
  });
};
