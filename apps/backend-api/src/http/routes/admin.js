"use strict";
const registerAnalyticsRoutes = require("../../modules/admin/register-analytics-routes");
const registerCatalogRoutes = require("../../modules/admin/register-catalog-routes");
const registerCompanyRoutes = require("../../modules/admin/register-company-routes");
const registerSuperAdminRoutes = require("../../modules/admin/register-super-admin-routes");
const registerUserAccessRoutes = require("../../modules/admin/register-user-access-routes");
const {
  findReservedPassportHeaderFieldConflicts,
  validatePassportTypeSections,
} = require("../../modules/admin/passport-type-schema-guardrails");
const { walkSchemaSections } = require("../../shared/passports/passport-helpers");
const {
  normalizeSystemPassportHeader,
  validateSystemPassportHeader,
} = require("../../services/passport-header-fields");
const {
  buildCompanyDppPolicyUpdateQuery,
  companyPolicyDefaults,
  validateCompanyDppPolicyInput,
} = require("../../services/company-dpp-policy");

const companyTrustLevels = new Set(["basic", "verifiedBusiness", "enterprise"]);

const archivedHistoryReasonSql = `('beforeArchiveDelete','beforeBulkArchiveDelete','beforeDelete','beforeBulkDelete')`;
const archivedHistoryFilterSql = `("snapshotReason" IN ${archivedHistoryReasonSql})`;

const validConfidentialityLevels = new Set([
  "public",
  "restricted",
]);

module.exports = function registerAdminRoutes(app, {
  pool,
  multer,
  authenticateToken,
  isSuperAdmin,
  verifyPassword,
  hashOpaqueToken,
  generateOneTimeToken,
  logAudit,
  backupProviderService,
  productIdentifierService,
  getTable,
  normalizePassportTypeSchema = ({
    sections = [],
    systemHeader = null,
    currentSchemaVersion = 0,
    sourceModule = null,
    identity = null,
    semanticGraph = null,
  } = {}) => {
    const schema = {
      schemaVersion: Number.parseInt(currentSchemaVersion, 10) > 0 ? Number.parseInt(currentSchemaVersion, 10) : 1,
      systemHeader: systemHeader ? normalizeSystemPassportHeader(systemHeader) : null,
      sections: Array.isArray(sections) ? sections : [],
    };
    const normalizedSourceModule = String(sourceModule || "").trim();
    if (normalizedSourceModule) schema.sourceModule = normalizedSourceModule;
    if (identity && typeof identity === "object" && !Array.isArray(identity)) {
      schema.identity = identity;
    }
    if (semanticGraph && typeof semanticGraph === "object" && !Array.isArray(semanticGraph)) {
      schema.semanticGraph = semanticGraph;
    }
    return schema;
  },
  getTypeSchemaVersion = (fieldsJson = {}) => Number.parseInt(fieldsJson.schemaVersion, 10) || 1,
  buildPassportTypeSchemaChange = () => ({ added: [], removed: [], typeChanged: [], additive: true }),
  passportTypeHasStoredRecords = async () => false,
  createPassportTable,
  validatePassportTypeStorage = null,
  queryTableStats,
  repoBaseDir,
  filesBaseDir,
  inRevisionStatus,
  inRevisionStatusesSql,
  createTransporter,
  brandedEmail,
  renderInfoTable,
  storageService
}) {
  function validatePassportTypeFieldGovernance(sections = []) {
    const issues = [];

    walkSchemaSections(sections, (section) => {
      for (const field of Array.isArray(section?.fields) ? section.fields : []) {
        const confidentiality = String(field?.confidentiality || "").trim().toLowerCase();
        if (!confidentiality) {
          issues.push({
            code: "fieldConfidentialityMissing",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" must declare a confidentiality classification.`,
          });
        } else if (!validConfidentialityLevels.has(confidentiality)) {
          issues.push({
            code: "fieldConfidentialityInvalid",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" uses unsupported confidentiality value "${field.confidentiality}".`,
          });
        }
      }
    });

    return issues;
  }

  function buildPassportTypeGovernanceCheck(sections = []) {
    const issues = validatePassportTypeFieldGovernance(sections);
    return {
      status: issues.length ? "attentionNeeded" : "ok",
      issueCount: issues.length,
      issues,
    };
  }

  function normalizeRequestedPassportTypeSchema({
    sections,
    systemHeader,
    currentSchemaVersion,
    sourceModule = null,
    identity = null,
    semanticGraph = null,
  }) {
    if (!systemHeader) {
      const error = new Error("Passport types must define an explicit systemHeader.");
      error.statusCode = 400;
      throw error;
    }
    const systemHeaderValidation = validateSystemPassportHeader(systemHeader, sections);
    if (!systemHeaderValidation.valid) {
      const error = new Error(systemHeaderValidation.error);
      error.statusCode = 400;
      error.details = systemHeaderValidation;
      throw error;
    }
    return normalizePassportTypeSchema({
      sections,
      systemHeader: normalizeSystemPassportHeader(systemHeader),
      currentSchemaVersion,
      sourceModule,
      identity,
      semanticGraph,
    });
  }

  async function ensureCompanyDppPolicy(companyId) {
    await pool.query(
      `INSERT INTO "companyDppPolicies" (
         "companyId",
         "defaultGranularity",
         "allowGranularityOverride",
         "mintModelDids",
         "mintItemDids",
         "mintFacilityDids",
         "vcIssuanceEnabled",
         "jsonldExportEnabled",
         "semanticDictionaryEnabled"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ("companyId") DO NOTHING`,
      [
      companyId,
      companyPolicyDefaults.defaultGranularity,
      companyPolicyDefaults.allowGranularityOverride,
      companyPolicyDefaults.mintModelDids,
      companyPolicyDefaults.mintItemDids,
      companyPolicyDefaults.mintFacilityDids,
      companyPolicyDefaults.vcIssuanceEnabled,
      companyPolicyDefaults.jsonldExportEnabled,
      companyPolicyDefaults.semanticDictionaryEnabled]

    );
  }

  async function getCompanyDppPolicy(companyId) {
    await ensureCompanyDppPolicy(companyId);
    const result = await pool.query(
      `SELECT p.*
       FROM "companyDppPolicies" p
       WHERE p."companyId" = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function updateCompanyDppPolicy(companyId, updates) {
    const { sql, params } = buildCompanyDppPolicyUpdateQuery(companyId, updates);

    const result = await pool.query(sql, params);

    return result.rows[0] || null;
  }

  registerCatalogRoutes(app, {
    pool,
    multer,
    authenticateToken,
    isSuperAdmin,
    verifyPassword,
    logAudit,
    getTable,
    createPassportTable,
    passportTypeHasStoredRecords,
    buildPassportTypeSchemaChange,
    normalizeRequestedPassportTypeSchema,
    getTypeSchemaVersion,
    findReservedPassportHeaderFieldConflicts,
    validatePassportTypeSections,
    buildPassportTypeGovernanceCheck,
    storageService,
  });

  registerCompanyRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    verifyPassword,
    logAudit,
    backupProviderService,
    productIdentifierService,
    getTable,
    ensureCompanyDppPolicy,
    getCompanyDppPolicy,
    validateCompanyDppPolicyInput,
    updateCompanyDppPolicy,
    storageService,
    repoBaseDir,
    filesBaseDir,
    companyTrustLevels,
  });

  registerSuperAdminRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    logAudit,
    createTransporter,
    brandedEmail,
    renderInfoTable,
    hashOpaqueToken,
    generateOneTimeToken,
  });

  registerAnalyticsRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    queryTableStats,
    getTable,
    archivedHistoryFilterSql,
  });

  registerUserAccessRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    getTable,
  });

};
