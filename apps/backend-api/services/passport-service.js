"use strict";

const nodeCrypto = require("crypto");
const logger = require("./logger");
const { normalizeSystemPassportHeader } = require("./passport-header-fields");
const { createAuditServiceHelpers } = require("../src/modules/passports/audit-service-helpers");
const { createArchiveHistoryHelpers } = require("../src/modules/passports/archive-history-helpers");
const { createPassportQueryRepository } = require("../src/modules/passports/passport-query-repository");
const { createSchemaStorageHelpers } = require("../src/modules/passports/schema-storage-helpers");
const { createWorkflowHelpers } = require("../src/modules/passports/workflow-helpers");

const IN_REVISION_STATUSES_SQL       = `('in_revision')`;
const EDITABLE_RELEASE_STATUSES_SQL  = `('draft','in_revision')`;
const REVISION_BLOCKING_STATUSES_SQL = `('draft','in_revision','in_review')`;
const EDIT_SESSION_TIMEOUT_HOURS     = 12;
const EDIT_SESSION_TIMEOUT_SQL       = `${EDIT_SESSION_TIMEOUT_HOURS} hours`;
const LIVE_PASSPORT_SYSTEM_COLUMNS = new Set([
  "id",
  "dpp_id",
  "lineage_id",
  "company_id",
  "model_name",
  "internal_alias_id",
  "product_identifier_did",
  "product_image",
  "compliance_profile_key",
  "content_specification_ids",
  "carrier_policy_key",
  "carrier_authenticity",
  "economic_operator_id",
  "economic_operator_identifier_scheme",
  "facility_id",
  "granularity",
  "release_status",
  "version_number",
  "qr_code",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
  "deleted_at",
]);
const LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS = [
  ["dpp_id", "TEXT NOT NULL"],
  ["lineage_id", "TEXT NOT NULL"],
  ["company_id", "INTEGER NOT NULL"],
  ["model_name", "VARCHAR(255)"],
  ["internal_alias_id", "VARCHAR(255) NOT NULL"],
  ["product_identifier_did", "TEXT"],
  ["product_image", "TEXT"],
  ["compliance_profile_key", "VARCHAR(120) NOT NULL DEFAULT 'generic_dpp_v1'"],
  ["content_specification_ids", "TEXT"],
  ["carrier_policy_key", "VARCHAR(120)"],
  ["carrier_authenticity", "JSONB"],
  ["economic_operator_id", "TEXT"],
  ["economic_operator_identifier_scheme", "VARCHAR(80)"],
  ["facility_id", "TEXT"],
  ["granularity", "VARCHAR(20) NOT NULL DEFAULT 'model'"],
  ["release_status", "VARCHAR(50) NOT NULL DEFAULT 'draft'"],
  ["version_number", "INTEGER NOT NULL DEFAULT 1"],
  ["qr_code", "TEXT"],
  ["created_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  ["updated_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  ["created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
  ["updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
  ["deleted_at", "TIMESTAMPTZ"],
];

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
      `SELECT type_name, display_name, fields_json
       FROM passport_types
       WHERE type_name = $1 OR LOWER(display_name) = LOWER($1)
       LIMIT 1`,
      [normalizedInput]
    );
    if (!typeRes.rows.length) return null;
    const sections = typeRes.rows[0]?.fields_json?.sections || [];
    const schemaFields = sections.flatMap(section => section.fields || []);
    const normalizeAlias = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const aliasToKey = new Map();
    for (const field of schemaFields) {
      if (!field?.key) continue;
      const aliases = [
        field.key,
        field.elementId,
        field.element_id,
        field.semanticId,
        field.semantic_id,
      ].filter(Boolean);
      for (const alias of aliases) {
        aliasToKey.set(normalizeAlias(alias), field.key);
      }
    }
    return {
      typeName: typeRes.rows[0].type_name,
      displayName: typeRes.rows[0].display_name,
      schemaFields,
      allowedKeys: new Set(schemaFields.map(field => field.key).filter(Boolean)),
      aliasToKey,
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
  } = createSchemaStorageHelpers({
    pool,
    logger,
    getTable,
    normalizePassportRow,
    isEditablePassportStatus,
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
        "SELECT fields_json FROM passport_types WHERE type_name = $1",
        [passportType]
      );
      if (!typeRes.rows.length) return sanitized;
      const sections = typeRes.rows[0].fields_json?.sections || [];
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
    submitPassportToWorkflow,
  };
};
