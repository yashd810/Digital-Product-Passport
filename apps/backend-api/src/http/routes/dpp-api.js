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
const { createRequestResponseHelpers } = require("../../modules/dpp-api/request-response-helpers");
const { createResolutionHelpers } = require("../../modules/dpp-api/resolution-helpers");
const registerMutationRoutes = require("../../modules/dpp-api/register-mutation-routes");
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
  buildPassportJsonLdContext,
  didService,
  dppIdentity, // the dpp-identity-service module
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
    getAppUrl,
    applyStandardsResultEnvelope,
    loadReleasedPassport,
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

  async function buildStandardsCreateFields({ companyId, passportType, granularity, requestedFields = {} }) {
    return complianceManagedFieldHelpers.buildComplianceManagedFields({
      companyId,
      passportType,
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

  registerDidRoutes(app, {
    logger,
    publicReadRateLimit,
    dbLookupByInternalAliasIdOnly,
    getAppUrl,
    dppIdentity,
  });
};
