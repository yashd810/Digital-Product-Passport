"use strict";
const registerAnalyticsRoutes = require("../../modules/admin/register-analytics-routes");
const registerCatalogRoutes = require("../../modules/admin/register-catalog-routes");
const registerCompanyRoutes = require("../../modules/admin/register-company-routes");
const registerSuperAdminRoutes = require("../../modules/admin/register-super-admin-routes");
const registerUserAccessRoutes = require("../../modules/admin/register-user-access-routes");
const { SYSTEM_PASSPORT_FIELDS } = require("../../shared/passports/passport-helpers");
const {
  normalizeSystemPassportHeader,
  validateSystemPassportHeader,
} = require("../../services/passport-header-fields");

const COMPANY_POLICY_DEFAULTS = {
  defaultGranularity: "item",
  allowGranularityOverride: false,
  mintModelDids: true,
  mintItemDids: true,
  mintFacilityDids: false,
  vcIssuanceEnabled: true,
  jsonldExportEnabled: true,
  semanticDictionaryEnabled: true
};

const COMPANY_POLICY_BOOL_FIELDS = [
"allowGranularityOverride",
"mintModelDids",
"mintItemDids",
"mintFacilityDids",
"vcIssuanceEnabled",
"jsonldExportEnabled",
"semanticDictionaryEnabled"];

const COMPANY_TRUST_LEVELS = new Set(["BASIC", "VERIFIED_BUSINESS", "ENTERPRISE"]);

const ARCHIVED_HISTORY_REASON_SQL = `('beforeArchiveDelete','beforeBulkArchiveDelete','beforeDelete','beforeBulkDelete')`;
const ARCHIVED_HISTORY_FILTER_SQL = `("snapshotReason" IN ${ARCHIVED_HISTORY_REASON_SQL})`;


const RESERVED_PASSPORT_FIELD_KEYS = [
...SYSTEM_PASSPORT_FIELDS,
"modelName",
"internalAliasId",
"uniqueProductIdentifier",
"passportPolicyKey",
"contentSpecificationIds",
"carrierPolicyKey",
"economicOperatorId",
"facilityId",
"granularity",
"digitalProductPassportId",
"uniqueProductIdentifier",
"dppSchemaVersion",
"dppStatus",
"lastUpdate",
"economicOperatorId",
"facilityId",
"contentSpecificationIds",
"subjectDid",
"dppDid",
"companyDid"];


const RESERVED_PASSPORT_SEMANTIC_IDS = [
"dpp:digitalProductPassportId",
"dpp:uniqueProductIdentifier",
"dpp:granularity",
"dpp:dppSchemaVersion",
"dpp:dppStatus",
"dpp:lastUpdate",
"dpp:economicOperatorId",
"dpp:facilityId",
"dpp:contentSpecificationIds",
"dpp:subjectDid",
"dpp:dppDid",
"dpp:companyDid",
"dpp:dppId",
"dpp:internalAliasId"];


const RESERVED_PASSPORT_FIELD_KEY_SET = new Set(RESERVED_PASSPORT_FIELD_KEYS);
const RESERVED_PASSPORT_SEMANTIC_ID_SET = new Set(RESERVED_PASSPORT_SEMANTIC_IDS);

const VALID_ACCESS_LEVELS = new Set([
  "public",
  "consumers",
  "notifiedBodies",
  "marketSurveillance",
  "customsAuthority",
  "euCommission",
  "legitimateInterest",
  "economicOperator",
  "delegatedOperator",
  "manufacturer",
  "authorizedRepresentative",
  "importer",
  "distributor",
  "dealer",
  "fulfilmentServiceProvider",
  "professionalRepairer",
  "independentOperator",
  "recycler",
  "mainDppServiceProvider",
  "backupDppServiceProvider",
]);

const VALID_CONFIDENTIALITY_LEVELS = new Set([
  "public",
  "restricted",
  "confidential",
  "tradeSecret",
  "regulated",
]);

const VALID_UPDATE_AUTHORITIES = new Set([
  "economicOperator",
  "delegatedOperator",
  "manufacturer",
  "authorizedRepresentative",
  "importer",
  "distributor",
  "dealer",
  "fulfilmentServiceProvider",
  "professionalRepairer",
  "independentOperator",
  "recycler",
  "notifiedBodies",
  "marketSurveillance",
  "customsAuthority",
  "euCommission",
  "mainDppServiceProvider",
  "backupDppServiceProvider",
  "system",
]);

module.exports = function registerAdminRoutes(app, {
  pool,
  multer,
  authenticateToken,
  isSuperAdmin,
  checkCompanyAccess,
  verifyPassword,
  logAudit,
  backupProviderService,
  productIdentifierService,
  getTable,
  normalizePassportTypeSchema = ({ sections = [], systemHeader = null, currentSchemaVersion = 0, sourceModule = null, identity = null } = {}) => {
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
    return schema;
  },
  getTypeSchemaVersion = (fieldsJson = {}) => Number.parseInt(fieldsJson.schemaVersion, 10) || 1,
  buildPassportTypeSchemaChange = () => ({ added: [], removed: [], typeChanged: [], additive: true }),
  passportTypeHasStoredRecords = async () => false,
  createPassportTable,
  validatePassportTypeStorage = null,
  queryTableStats,
  publicReadRateLimit,
  GLOBAL_SYMBOLS_DIR,
  REPO_BASE_DIR,
  FILES_BASE_DIR,
  IN_REVISION_STATUS,
  IN_REVISION_STATUSES_SQL,
  createTransporter,
  brandedEmail,
  renderInfoTable,
  storageService
}) {
  function findReservedPassportHeaderFieldConflicts(sections = []) {
    const conflicts = [];
    for (const section of sections || []) {
      for (const field of section?.fields || []) {
        if (RESERVED_PASSPORT_FIELD_KEY_SET.has(field?.key)) {
          conflicts.push({
            field: field.key,
            conflictType: "key",
            reservedField: field.key,
            message: `Field "${field.key}" is already generated by the passport registry/header and does not need to be created again.`
          });
        }

        const semanticId = field?.semanticId || null;
        if (RESERVED_PASSPORT_SEMANTIC_ID_SET.has(semanticId)) {
          conflicts.push({
            field: field.key,
            semanticId,
            conflictType: "semanticId",
            reservedField: semanticId,
            message: `Field "${field.key}" uses reserved semanticId "${semanticId}", which is already generated by the passport registry/header and does not need to be created again.`
          });
        }
      }
    }
    return conflicts;
  }

  function validatePassportTypeSections(sections) {
    if (!Array.isArray(sections) || sections.length === 0) {
      return "At least one section is required";
    }
    const seenFieldKeys = new Set();
    for (const section of sections) {
      if (!section.key || !section.label || !Array.isArray(section.fields)) {
        return "Each section must have key, label, and fields array";
      }
      if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(section.key)) {
        return `Invalid section key: ${section.key}. Section keys must be camelCase, start with a lowercase letter, and contain only letters and numbers.`;
      }
      for (const field of section.fields) {
        if (!field.key || !field.label || !field.type) {
          return "Each field must have key, label, and type";
        }
        if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(field.key)) {
          return `Invalid field key: ${field.key}. Field keys must be camelCase, start with a lowercase letter, and contain only letters and numbers.`;
        }
        if (seenFieldKeys.has(field.key)) {
          return `Duplicate field key: ${field.key}`;
        }
        seenFieldKeys.add(field.key);
        if (!["text", "textarea", "boolean", "file", "table", "url", "date", "symbol"].includes(field.type)) {
          return `Invalid field type: ${field.type}`;
        }
      }
    }
    return null;
  }

  function validatePassportTypeFieldGovernance(sections = []) {
    const issues = [];

    for (const section of sections) {
      for (const field of section?.fields || []) {
        const access = Array.isArray(field?.access) ? field.access.filter(Boolean) : [];
        if (!access.length) {
          issues.push({
            code: "FIELD_ACCESS_MISSING",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" must expose at least one audience.`,
          });
        } else {
          const invalidAccess = access.filter((entry) => !VALID_ACCESS_LEVELS.has(entry));
          if (invalidAccess.length) {
            issues.push({
              code: "FIELD_ACCESS_INVALID",
              key: field.key,
              label: field.label || field.key,
              section: section.label || section.key || null,
              message: `Field "${field.label || field.key}" uses unsupported access values: ${invalidAccess.join(", ")}.`,
            });
          }
        }

        const confidentiality = String(field?.confidentiality || "").trim().toLowerCase();
        if (!confidentiality) {
          issues.push({
            code: "FIELD_CONFIDENTIALITY_MISSING",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" must declare a confidentiality classification.`,
          });
        } else if (!VALID_CONFIDENTIALITY_LEVELS.has(confidentiality)) {
          issues.push({
            code: "FIELD_CONFIDENTIALITY_INVALID",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" uses unsupported confidentiality value "${field.confidentiality}".`,
          });
        }

        const updateAuthority = Array.isArray(field?.updateAuthority) ? field.updateAuthority : [];
        if (!updateAuthority.length) {
          issues.push({
            code: "FIELD_UPDATE_AUTHORITY_MISSING",
            key: field.key,
            label: field.label || field.key,
            section: section.label || section.key || null,
            message: `Field "${field.label || field.key}" must declare at least one update authority.`,
          });
        } else {
          const invalidUpdateAuthority = updateAuthority.filter((entry) => !VALID_UPDATE_AUTHORITIES.has(entry));
          if (invalidUpdateAuthority.length) {
            issues.push({
              code: "FIELD_UPDATE_AUTHORITY_INVALID",
              key: field.key,
              label: field.label || field.key,
              section: section.label || section.key || null,
              message: `Field "${field.label || field.key}" uses unsupported updateAuthority values: ${invalidUpdateAuthority.join(", ")}.`,
            });
          }
        }
      }
    }

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

  function normalizeRequestedPassportTypeSchema({ sections, systemHeader, currentSchemaVersion, sourceModule = null, identity = null }) {
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
      COMPANY_POLICY_DEFAULTS.defaultGranularity,
      COMPANY_POLICY_DEFAULTS.allowGranularityOverride,
      COMPANY_POLICY_DEFAULTS.mintModelDids,
      COMPANY_POLICY_DEFAULTS.mintItemDids,
      COMPANY_POLICY_DEFAULTS.mintFacilityDids,
      COMPANY_POLICY_DEFAULTS.vcIssuanceEnabled,
      COMPANY_POLICY_DEFAULTS.jsonldExportEnabled,
      COMPANY_POLICY_DEFAULTS.semanticDictionaryEnabled]

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

  function validateCompanyDppPolicyInput(body = {}) {
    const nextPolicy = {};
    if (body.defaultGranularity !== undefined) {
      if (!["model", "batch", "item"].includes(body.defaultGranularity)) {
        throw new Error("defaultGranularity must be one of: model, batch, item");
      }
      nextPolicy.defaultGranularity = body.defaultGranularity;
    }

    COMPANY_POLICY_BOOL_FIELDS.forEach((field) => {
      if (body[field] === undefined) return;
      if (typeof body[field] !== "boolean") {
        throw new Error(`${field} must be a boolean`);
      }
      nextPolicy[field] = body[field];
    });

    return nextPolicy;
  }

  async function updateCompanyDppPolicy(companyId, updates) {
    const setClauses = [];
    const params = [];
    let idx = 1;

    Object.entries(updates).forEach(([key, value]) => {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    });
    setClauses.push(`updatedAt = NOW()`);
    params.push(companyId);

    const result = await pool.query(
      `UPDATE "companyDppPolicies"
       SET ${setClauses.join(", ")}
       WHERE "companyId" = $${idx}
       RETURNING *`,
      params
    );

    return result.rows[0] || null;
  }

  registerCatalogRoutes(app, {
    pool,
    multer,
    authenticateToken,
    isSuperAdmin,
    checkCompanyAccess,
    verifyPassword,
    logAudit,
    getTable,
    publicReadRateLimit,
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
    REPO_BASE_DIR,
    FILES_BASE_DIR,
    COMPANY_TRUST_LEVELS,
  });

  registerSuperAdminRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    logAudit,
    createTransporter,
    brandedEmail,
    renderInfoTable,
  });

  registerAnalyticsRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    queryTableStats,
    getTable,
    ARCHIVED_HISTORY_FILTER_SQL,
  });

  registerUserAccessRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    getTable,
  });

};
