"use strict";

const nodeCrypto = require("crypto");
const logger = require("./logger");
const { normalizeSystemPassportHeader } = require("./passport-header-fields");
const {
  livePassportSystemColumns,
  livePassportSystemColumnDefinitions,
  systemPassportColumnMappings,
} = require("../shared/passports/system-passport-columns");
const { createAuditServiceHelpers } = require("../modules/passports/audit-service-helpers");
const {
  buildPublicPassportSnapshot,
} = require("../shared/passports/public-passport-snapshot");
const { createArchiveHistoryHelpers } = require("../modules/passports/archive-history-helpers");
const { createPassportQueryRepository } = require("../modules/passports/passport-query-repository");
const { createSchemaStorageHelpers } = require("../modules/passports/schema-storage-helpers");
const { createWorkflowHelpers } = require("../modules/passports/workflow-helpers");

const inRevisionStatusesSql       = `('inRevision')`;
const editableReleaseStatusesSql  = `('draft','inRevision')`;
const revisionBlockingStatusesSql = `('draft','inRevision','inReview')`;
const editSessionTimeoutHours     = 12;
const editSessionTimeoutSql       = `${editSessionTimeoutHours} hours`;
module.exports = function createPassportService({
  pool,
  // pure helpers (from passport-helpers.js)
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  generateInternalAliasIdValue,
  inRevisionStatus,
  systemPassportFields,
  getWritablePassportColumns,
  getStoredPassportValues,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  toStoredPassportValue,
  coerceBulkFieldValue,
  comparableHistoryFieldValue,
  formatHistoryFieldValue,
  getHistoryFieldDefs,
  flattenSchemaFieldsFromSections,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  // email service
  createTransporter,
  brandedEmail,
  renderInfoTable,
}) {
  const {
    logAudit,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    createNotification,
  } = createAuditServiceHelpers({
    pool,
    logger,
  });

  // ─── PASSPORT TYPE SCHEMA ────────────────────────────────────────────────

  async function getPassportTypeSchema(typeName) {
    const normalizedInput = String(typeName || "").trim();
    if (!normalizedInput) return null;
    const typeRes = await pool.query(
      `SELECT "typeName" AS "typeName", "displayName" AS "displayName", "fieldsJson" AS "fieldsJson"
       FROM "passportTypes"
       WHERE "typeName" = $1 OR LOWER("displayName") = LOWER($1)
       LIMIT 1`,
      [normalizedInput]
    );
    if (!typeRes.rows.length) return null;
    const sections = typeRes.rows[0]?.fieldsJson?.sections || [];
    const schemaFields = flattenSchemaFieldsFromSections(sections);
    return {
      typeName: typeRes.rows[0].typeName,
      displayName: typeRes.rows[0].displayName,
      fieldsJson: typeRes.rows[0].fieldsJson,
      schemaFields,
      allowedKeys: new Set(schemaFields.map(field => field.key).filter(Boolean)),
    };
  }

  // ─── PASSPORT QUERIES ────────────────────────────────────────────────────
  const {
    findExistingPassportByInternalAliasId,
    getPassportLineageContext,
    getCompanyNameMap,
    getPassportVersionsByLineage,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassport,
  } = createPassportQueryRepository({
    pool,
    getTable,
    normalizePassportRow,
    isPublicHistoryStatus,
  });
  const {
    archivePassportSnapshot,
    archivePassportSnapshots,
    updatePassportRowById,
    buildPassportVersionHistory,
    clearExpiredEditSessions: clearExpiredEditSessionsBase,
    listActiveEditSessions: listActiveEditSessionsBase,
    markOlderVersionsObsolete,
  } = createArchiveHistoryHelpers({
    pool,
    logger,
    systemPassportFields,
    getWritablePassportColumns,
    getStoredPassportValues,
    quoteSqlIdentifier,
    normalizePassportRow,
    normalizeReleaseStatus,
    isPublicHistoryStatus,
    comparableHistoryFieldValue,
    formatHistoryFieldValue,
    getHistoryFieldDefs,
    buildCurrentPublicPassportPath,
    buildInactivePublicPassportPath,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    getCompanyNameMap,
  });
  const {
    getLatestCompanyPassports,
    normalizePassportTypeSchema,
    getTypeSchemaVersion,
    buildPassportTypeSchemaChange,
    passportTypeHasStoredRecords,
    createPassportTable,
    assertPassportTypeStorageReady,
    validatePassportTypeStorage,
    queryTableStats,
  } = createSchemaStorageHelpers({
    pool,
    logger,
    getTable,
    normalizePassportRow,
    isEditablePassportStatus,
    quoteSqlIdentifier,
    joinQuotedSqlIdentifiers,
    systemPassportColumnMappings,
    livePassportSystemColumns,
    livePassportSystemColumnDefinitions,
    inRevisionStatusesSql,
  });
  const {
    submitPassportToWorkflow,
  } = createWorkflowHelpers({
    pool,
    logger,
    createTransporter,
    brandedEmail,
    renderInfoTable,
    getTable,
    normalizePassportRow,
    normalizeReleaseStatus,
    inRevisionStatus,
    editableReleaseStatusesSql,
    archivePassportSnapshot,
    createNotification,
    logAudit,
  });


  async function stripRestrictedFieldsForPublicView(passport, passportType) {
    if (!passport) return passport;
    if (!passportType) {
      const error = new Error("Passport type is required for a public snapshot");
      error.code = "passportTypeSchemaMissing";
      throw error;
    }
    const typeRes = await pool.query(
      'SELECT "fieldsJson" AS "fieldsJson" FROM "passportTypes" WHERE "typeName" = $1',
      [passportType]
    );
    if (!typeRes.rows.length) {
      const error = new Error(`Passport type schema not found for "${passportType}"`);
      error.code = "passportTypeSchemaMissing";
      throw error;
    }
    return buildPublicPassportSnapshot(passport, {
      typeName: passportType,
      fieldsJson: typeRes.rows[0].fieldsJson,
    });
  }

  // ─── EDIT SESSION HELPERS ────────────────────────────────────────────────
  async function clearExpiredEditSessions() {
    return clearExpiredEditSessionsBase(editSessionTimeoutSql);
  }

  async function listActiveEditSessions(passportDppId, currentUserId = null) {
    return listActiveEditSessionsBase(passportDppId, currentUserId, editSessionTimeoutSql);
  }

  // ─── MARK OBSOLETE ────────────────────────────────────────────────────────



  return {
    // SQL constants (useful for route files to construct queries)
    inRevisionStatusesSql,
    editableReleaseStatusesSql,
    revisionBlockingStatusesSql,
    editSessionTimeoutHours,
    editSessionTimeoutSql,
    // functions
    logAudit,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    createNotification,
    getPassportTypeSchema,
    findExistingPassportByInternalAliasId,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    getCompanyNameMap,
    stripRestrictedFieldsForPublicView,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassport,
    archivePassportSnapshot,
    archivePassportSnapshots,
    updatePassportRowById,
    buildPassportVersionHistory,
    clearExpiredEditSessions,
    listActiveEditSessions,
    markOlderVersionsObsolete,
    getLatestCompanyPassports,
    normalizePassportTypeSchema,
    getTypeSchemaVersion,
    buildPassportTypeSchemaChange,
    passportTypeHasStoredRecords,
    createPassportTable,
    assertPassportTypeStorageReady,
    validatePassportTypeStorage,
    queryTableStats,
    submitPassportToWorkflow,
  };
};
