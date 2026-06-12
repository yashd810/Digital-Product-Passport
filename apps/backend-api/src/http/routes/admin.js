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
} = require("../../shared/identifiers/passport-header-fields");

const COMPANY_POLICY_DEFAULTS = {
  default_granularity: "item",
  allow_granularity_override: false,
  mint_model_dids: true,
  mint_item_dids: true,
  mint_facility_dids: false,
  vc_issuance_enabled: true,
  jsonld_export_enabled: true,
  semantic_dictionary_enabled: true
};

const COMPANY_POLICY_BOOL_FIELDS = [
"allow_granularity_override",
"mint_model_dids",
"mint_item_dids",
"mint_facility_dids",
"vc_issuance_enabled",
"jsonld_export_enabled",
"semantic_dictionary_enabled"];

const COMPANY_TRUST_LEVELS = new Set(["BASIC", "VERIFIED_BUSINESS", "ENTERPRISE"]);

const ARCHIVED_HISTORY_REASON_SQL = `('before_archive_delete','before_bulk_archive_delete','before_delete','before_bulk_delete')`;
const ARCHIVED_HISTORY_FILTER_SQL = `("snapshotReason" IN ${ARCHIVED_HISTORY_REASON_SQL})`;


const RESERVED_PASSPORT_FIELD_KEYS = [
...SYSTEM_PASSPORT_FIELDS,
"modelName",
"internalAliasId",
"uniqueProductIdentifier",
"complianceProfileKey",
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
  "notified_bodies",
  "market_surveillance",
  "customs_authority",
  "eu_commission",
  "legitimate_interest",
  "economic_operator",
  "delegated_operator",
  "manufacturer",
  "authorized_representative",
  "importer",
  "distributor",
  "dealer",
  "fulfilment_service_provider",
  "professional_repairer",
  "independent_operator",
  "recycler",
  "main_dpp_service_provider",
  "backup_dpp_service_provider",
]);

const VALID_CONFIDENTIALITY_LEVELS = new Set([
  "public",
  "restricted",
  "confidential",
  "trade_secret",
  "regulated",
]);

const VALID_UPDATE_AUTHORITIES = new Set([
  "economic_operator",
  "delegated_operator",
  "manufacturer",
  "authorized_representative",
  "importer",
  "distributor",
  "dealer",
  "fulfilment_service_provider",
  "professional_repairer",
  "independent_operator",
  "recycler",
  "notified_bodies",
  "market_surveillance",
  "customs_authority",
  "eu_commission",
  "main_dpp_service_provider",
  "backup_dpp_service_provider",
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
  normalizePassportTypeSchema = ({ sections = [], systemHeader = null, currentSchemaVersion = 0 } = {}) => ({
    schemaVersion: Number.parseInt(currentSchemaVersion, 10) > 0 ? Number.parseInt(currentSchemaVersion, 10) : 1,
    systemHeader: normalizeSystemPassportHeader(systemHeader),
    sections: Array.isArray(sections) ? sections : [],
  }),
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

        const updateAuthority = Array.isArray(field?.updateAuthority)
          ? field.updateAuthority
          : (Array.isArray(field?.update_authority) ? field.update_authority : []);
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
      status: issues.length ? "attention_needed" : "ok",
      issueCount: issues.length,
      issues,
    };
  }

  function normalizeRequestedPassportTypeSchema({ sections, systemHeader, currentSchemaVersion }) {
    const systemHeaderValidation = validateSystemPassportHeader(systemHeader || normalizeSystemPassportHeader());
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
    });
  }

  async function ensureCompanyDppPolicy(companyId) {
    await pool.query(
      `INSERT INTO company_dpp_policies (
         company_id,
         default_granularity,
         allow_granularity_override,
         mint_model_dids,
         mint_item_dids,
         mint_facility_dids,
         vc_issuance_enabled,
         jsonld_export_enabled,
         semantic_dictionary_enabled
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id) DO NOTHING`,
      [
      companyId,
      COMPANY_POLICY_DEFAULTS.default_granularity,
      COMPANY_POLICY_DEFAULTS.allow_granularity_override,
      COMPANY_POLICY_DEFAULTS.mint_model_dids,
      COMPANY_POLICY_DEFAULTS.mint_item_dids,
      COMPANY_POLICY_DEFAULTS.mint_facility_dids,
      COMPANY_POLICY_DEFAULTS.vc_issuance_enabled,
      COMPANY_POLICY_DEFAULTS.jsonld_export_enabled,
      COMPANY_POLICY_DEFAULTS.semantic_dictionary_enabled]

    );
  }

  async function getCompanyDppPolicy(companyId) {
    await ensureCompanyDppPolicy(companyId);
    const result = await pool.query(
      `SELECT p.*
       FROM company_dpp_policies p
       WHERE p.company_id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  function validateCompanyDppPolicyInput(body = {}) {
    const nextPolicy = {};
    if (body.default_granularity !== undefined) {
      if (!["model", "batch", "item"].includes(body.default_granularity)) {
        throw new Error("default_granularity must be one of: model, batch, item");
      }
      nextPolicy.default_granularity = body.default_granularity;
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
    setClauses.push(`updated_at = NOW()`);
    params.push(companyId);

    const result = await pool.query(
      `UPDATE company_dpp_policies
       SET ${setClauses.join(", ")}
       WHERE company_id = $${idx}
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
