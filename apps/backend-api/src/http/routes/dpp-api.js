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
const { createRequestResponseHelpers } = require("../../modules/dpp-api/request-response-helpers");
const { createResolutionHelpers } = require("../../modules/dpp-api/resolution-helpers");
const registerMutationRoutes = require("../../modules/dpp-api/register-mutation-routes");
const {
  createComplianceManagedFieldHelpers,
} = require("../../modules/passports/compliance-managed-fields");

// ─── COMPANY INTEGRATION DPP MUTATIONS ───────────────────────────────────────

module.exports = function registerDppApiRoutes(app, {
  pool,
  authenticateToken,
  requireBearerToken,
  integrationWriteRateLimit,
  requireEditor,
  getTable,
  normalizePassportRow,
  normalizeInternalAliasIdValue,
  extractExplicitFacilityId,
  getCompanyNameMap,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  didService,
  productIdentifierService,
  archivePassportSnapshot,
  updatePassportRowById,
  isEditablePassportStatus,
  logAudit,
  normalizePassportRequestBody,
  systemPassportFields,
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

  const validGranularities = new Set(["model", "batch", "item"]);
  const mergePatchContentType = "application/merge-patch+json";
  const {
    applyStandardsResultEnvelope,
    getRepresentationFromValue,
    buildMutationPassportPayload,
  } = createRequestResponseHelpers({
    buildCanonicalPassportPayload,
    buildExpandedPassportPayload,
  });
  const {
    parseDppIdentifier,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    resolveActiveReleasedPassportByDppId,
    resolveEditablePassportByDppId,
    usesConfiguredGlobalProductIdentifierScheme,
  } = createResolutionHelpers({
    pool,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    productIdentifierService,
    didService,
    isDppRecordId,
  });

  app.use("/api/companies/:companySlug/integrations/v1", (req, res, next) => {
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
    serializePolicyDefaultValue,
  } = complianceManagedFieldHelpers;

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    return complianceManagedFieldHelpers.resolveManagedFacilityId({
      companyId,
      requestedFields,
      allowDefaultFacility: false,
      validateExplicitFacility: true,
    });
  }

  async function buildStandardsCreateFields({ companyId, passportType, typeDef, granularity, requestedFields = {} }) {
    return complianceManagedFieldHelpers.buildComplianceManagedFields({
      companyId,
      passportType,
      typeDef,
      granularity,
      requestedFields,
      allowDefaultFacility: false,
      validateExplicitFacility: true,
      allowPolicyOverride: false,
    });
  }

  async function replicatePassportToBackup({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "releasedCurrent"
  }) {
    const passportDppId = passport?.dppId || null;
    if (!backupProviderService || !passportDppId || !passport?.companyId) {
      return { success: true, skipped: true, reason: "backupServiceUnavailable" };
    }
    return backupProviderService.replicatePassportSnapshot({
      passport,
      typeDef,
      companyName,
      reason,
      snapshotScope
    });
  }

  registerMutationRoutes(app, {
    pool,
    logger,
    authenticateToken,
    requireBearerToken,
    integrationWriteRateLimit,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeInternalAliasIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByInternalAliasId,
    productIdentifierService,
    complianceService,
    systemPassportFields,
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    generateDppRecordId,
    buildStandardsCreateFields,
    usesConfiguredGlobalProductIdentifierScheme,
    validGranularities,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializePolicyDefaultValue,
    resolveManagedFacilityId,
    mergePatchContentType,
  });

};
