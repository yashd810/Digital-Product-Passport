"use strict";

const nodeCrypto = require("crypto");
const logger = require("./logger");
const { normalizeSystemPassportHeader } = require("./passport-header-fields");
const {
  LIVE_PASSPORT_SYSTEM_COLUMNS,
  LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS,
  SYSTEM_PASSPORT_COLUMN_MAPPINGS,
} = require("../shared/passports/system-passport-columns");
const { createAuditServiceHelpers } = require("../modules/passports/audit-service-helpers");
const { createArchiveHistoryHelpers } = require("../modules/passports/archive-history-helpers");
const { createPassportQueryRepository } = require("../modules/passports/passport-query-repository");
const { createSchemaStorageHelpers } = require("../modules/passports/schema-storage-helpers");
const { createWorkflowHelpers } = require("../modules/passports/workflow-helpers");

const IN_REVISION_STATUSES_SQL       = `('in_revision')`;
const EDITABLE_RELEASE_STATUSES_SQL  = `('draft','in_revision')`;
const REVISION_BLOCKING_STATUSES_SQL = `('draft','in_revision','in_review')`;
const EDIT_SESSION_TIMEOUT_HOURS     = 12;
const EDIT_SESSION_TIMEOUT_SQL       = `${EDIT_SESSION_TIMEOUT_HOURS} hours`;
module.exports = function createPassportService({
  pool,
  // pure helpers (from passport-helpers.js)
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  getStoredPassportValues,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  toStoredPassportValue,
  coerceBulkFieldValue,
  comparableHistoryFieldValue,
  formatHistoryFieldValue,
  getHistoryFieldDefs,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  productIdentifierService,
  // email service
  createTransporter,
  brandedEmail,
}) {
  function isMissingRelationError(error) {
    return error?.code === "42P01";
  }

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
       FROM passport_types
       WHERE "typeName" = $1 OR LOWER("displayName") = LOWER($1)
       LIMIT 1`,
      [normalizedInput]
    );
    if (!typeRes.rows.length) return null;
    const sections = typeRes.rows[0]?.fieldsJson?.sections || [];
    const schemaFields = sections.flatMap(section => section.fields || []);
    return {
      typeName: typeRes.rows[0].typeName,
      displayName: typeRes.rows[0].displayName,
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
    resolveReleasedPassportByInternalAliasId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassportByInternalAliasId,
    resolveCompanyPreviewPassport,
  } = createPassportQueryRepository({
    pool,
    logger,
    getTable,
    normalizePassportRow,
    normalizeInternalAliasIdValue,
    productIdentifierService,
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
    SYSTEM_PASSPORT_FIELDS,
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
    validatePassportTypeStorage,
    queryTableStats,
    migratePassportStorageToSchemaKeys,
  } = createSchemaStorageHelpers({
    pool,
    logger,
    getTable,
    normalizePassportRow,
    isEditablePassportStatus,
    quoteSqlIdentifier,
    joinQuotedSqlIdentifiers,
    SYSTEM_PASSPORT_COLUMN_MAPPINGS,
    LIVE_PASSPORT_SYSTEM_COLUMNS,
    LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS,
    IN_REVISION_STATUSES_SQL,
  });
  const {
    submitPassportToWorkflow,
  } = createWorkflowHelpers({
    pool,
    logger,
    createTransporter,
    brandedEmail,
    getTable,
    normalizePassportRow,
    normalizeReleaseStatus,
    IN_REVISION_STATUS,
    EDITABLE_RELEASE_STATUSES_SQL,
    archivePassportSnapshot,
    createNotification,
    logAudit,
  });


  async function stripRestrictedFieldsForPublicView(passport, passportType) {
    if (!passport || !passportType) return passport;
    const sanitized = { ...passport };
    delete sanitized.company_id;
    delete sanitized.companyId;
    try {
      const typeRes = await pool.query(
        'SELECT "fieldsJson" AS "fieldsJson" FROM passport_types WHERE "typeName" = $1',
        [passportType]
      );
      if (!typeRes.rows.length) return sanitized;
      const sections = typeRes.rows[0].fieldsJson?.sections || [];
      for (const section of sections) {
        for (const field of (section.fields || [])) {
          const access = field.access || ["public"];
          if (!access.includes("public")) delete sanitized[field.key];
        }
      }
    } catch {
      return sanitized;
    }
    return sanitized;
  }

  // ─── EDIT SESSION HELPERS ────────────────────────────────────────────────
  async function clearExpiredEditSessions() {
    return clearExpiredEditSessionsBase(EDIT_SESSION_TIMEOUT_SQL);
  }

  async function listActiveEditSessions(passportDppId, currentUserId = null) {
    return listActiveEditSessionsBase(passportDppId, currentUserId, EDIT_SESSION_TIMEOUT_SQL);
  }

  // ─── MARK OBSOLETE ────────────────────────────────────────────────────────



  return {
    // SQL constants (useful for route files to construct queries)
    IN_REVISION_STATUSES_SQL,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    EDIT_SESSION_TIMEOUT_HOURS,
    EDIT_SESSION_TIMEOUT_SQL,
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
    resolveReleasedPassportByInternalAliasId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassportByInternalAliasId,
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
    validatePassportTypeStorage,
    queryTableStats,
    migratePassportStorageToSchemaKeys,
    submitPassportToWorkflow,
  };
};
