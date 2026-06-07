"use strict";
const path           = require("path");
const {
  assertProductionStorageReadiness,
  assertRequiredProductionEnvironment,
  deriveRuntimeFlags,
  deriveRuntimePaths,
  ensureLocalDirectories,
  initEnvironment,
  isPassportStorageKey,
  isPlainRecord,
  normalizeIncomingDppIdentifiers,
  normalizeOutgoingDppIdentifiers,
  normalizeStorageRequestKey,
  toBooleanEnv,
} = require("../src/bootstrap/runtime-config");
initEnvironment(__dirname);
const express        = require("express");
const { Pool }       = require("pg");
const { v4: uuidv4 } = require("uuid");
const crypto         = require("crypto");
const jwt            = require("jsonwebtoken");
const multer         = require("multer");
const fs             = require("fs");
const { configureHttp } = require("../src/bootstrap/http");
const { registerAppRoutes } = require("../src/bootstrap/register-routes");
const { registerSupportRoutes } = require("../src/bootstrap/support-routes");

const { initDb }               = require("../db/init");
const createSigningService     = require("../src/infrastructure/signing/create-signing-service");
const createDidService         = require("../src/infrastructure/identity/create-did-service");
const createCanonicalPassportSerializer = require("../src/shared/passports/canonical-passport-serializer");
const createCacheService       = require("../src/infrastructure/cache/create-cache-service");
const createStorageService     = require("../src/infrastructure/storage/create-storage-service");
const createOauthService       = require("../src/infrastructure/oauth/create-oauth-service");
const createPasswordService    = require("../src/infrastructure/security/create-password-service");
const logger                   = require("../src/infrastructure/logging/logger");
const { createTransporter, brandedEmail, sendOtpEmail, renderInfoTable } = require("../src/infrastructure/email/email-service");
const { validatePasswordPolicy, hashSecret, hashOtpCode, generateOtpCode, PASSWORD_MIN_LENGTH, createAccessKeyMaterial, createDeviceKeyMaterial } = require("../src/infrastructure/security/security-service");
const createAuthMiddleware     = require("../middleware/auth");
const { createRateLimiters, startRateLimitMaintenance } = require("../middleware/rate-limit");
const createAssetService       = require("../src/infrastructure/assets/create-asset-service");
const createPassportService    = require("../src/infrastructure/passports/create-passport-service");
const createSemanticPassportExportService = require("../services/semantic-passport-export");
const createPassportRepresentationService = require("../src/infrastructure/passports/create-passport-representation-service");
const dppIdentity                         = require("../src/shared/identifiers/dpp-identity-service");
const createSemanticModelRegistry         = require("../src/infrastructure/semantics/create-semantic-model-registry");
const createBatteryDictionaryService      = require("../src/infrastructure/dictionary/create-battery-dictionary-service");
const createComplianceService             = require("../src/infrastructure/compliance/create-compliance-service");
const createAccessRightsService           = require("../src/infrastructure/security/create-access-rights-service");
const createProductIdentifierService      = require("../src/infrastructure/identifiers/create-product-identifier-service");
const createBackupProviderService         = require("../src/infrastructure/backup/create-backup-provider-service");
const canonicalizeJson                    = require("../src/shared/passports/json-canonicalization");
const { generateDppRecordId }             = require("../src/shared/identifiers/dpp-record-id");

global.console = logger.console;

const {
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  getTable,
  normalizeReleaseStatus, isPublicHistoryStatus, isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody, normalizeInternalAliasIdValue, generateInternalAliasIdValue, extractExplicitFacilityId,
  getWritablePassportColumns, getStoredPassportValues,
  quoteSqlIdentifier, joinQuotedSqlIdentifiers,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath, buildPreviewPassportPath,
  resolvePublicPathToSubjects,
  coerceBulkFieldValue, getHistoryFieldDefs, formatHistoryFieldValue, comparableHistoryFieldValue,
  isPlainObject, getPassportFieldValue, getAssetFieldMap, getValueAtPath, normalizeAssetHeaders,
  coerceAssetFieldValue, toDynamicStoredValue,
} = require("../src/shared/passports/passport-helpers");

// ─── DIRECTORIES ─────────────────────────────────────────────────────────────
const RUNTIME_PATHS = deriveRuntimePaths(__dirname);
const {
  localStorageDir: LOCAL_STORAGE_DIR,
  filesBaseDir: FILES_BASE_DIR,
  repoBaseDir: REPO_BASE_DIR,
  uploadsBaseDir: UPLOADS_BASE_DIR,
  globalSymbolsDir: GLOBAL_SYMBOLS_DIR,
  passportStoragePrefix: PASSPORT_STORAGE_PREFIX,
} = RUNTIME_PATHS;
ensureLocalDirectories(RUNTIME_PATHS);

// ─── EXPRESS SETUP ───────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;
const { isProduction: IS_PRODUCTION, runSchemaMigrations: RUN_SCHEMA_MIGRATIONS, allowedOriginSet, cspConnectSrc } = deriveRuntimeFlags(PORT);

// Validate required environment variables in production
assertRequiredProductionEnvironment({ isProduction: IS_PRODUCTION, logger });
configureHttp(app, {
  allowedOriginSet,
  cspConnectSrc,
  globalSymbolsDir: GLOBAL_SYMBOLS_DIR,
  isPlainRecord,
  isProduction: IS_PRODUCTION,
  normalizeIncomingDppIdentifiers,
  normalizeOutgoingDppIdentifiers,
  port: PORT,
});

// ─── DATABASE ────────────────────────────────────────────────────────────────
const pool = new Pool({
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});
pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});

// ─── SECRETS + AUTH CONSTANTS ────────────────────────────────────────────────
const JWT_SECRET             = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRY             = "7d";
const PEPPER                 = process.env.PEPPER_V1  || "change-this-pepper-in-production";
const CURRENT_PEPPER_VERSION = 1;
const SESSION_COOKIE_NAME    = process.env.SESSION_COOKIE_NAME || "dpp_session";
const COOKIE_SECURE          = IS_PRODUCTION ? process.env.COOKIE_SECURE !== "false" : process.env.COOKIE_SECURE === "true";
const COOKIE_SAME_SITE       = process.env.COOKIE_SAME_SITE || (IS_PRODUCTION ? "None" : "lax");
const COOKIE_DOMAIN          = process.env.COOKIE_DOMAIN || "";
const ASSET_SOURCE_ALLOWED_HOSTS = new Set(
  String(process.env.ASSET_SOURCE_ALLOWED_HOSTS || "")
    .split(",").map(v => v.trim().toLowerCase()).filter(Boolean)
);

const ASSET_SCHEDULER_INTERVAL_MS = 60 * 1000;
const ASSET_IGNORED_SYSTEM_COLUMNS = new Set([
  "id", "companyId", "qrCode", "createdBy", "createdAt", "updatedAt", "updatedBy",
  "deletedAt", "releaseStatus", "versionNumber", "isEditable", "fieldLabel",
  "createdByEmail", "firstName", "lastName",
]);
const ASSET_MATCH_FIELDS = new Set(["dppId", "matchDppId", "guid", "matchGuid", "internalAliasId", "matchProductId", "nextProductId"]);
const ASSET_ERP_PRESETS = [
  {
    key: "generic_rest", label: "Generic REST",
    description: "Generic JSON API returning an array or records path.",
    sourceConfig: { method: "GET", recordPath: "data.items", fieldMap: { dppId: "dppId", internal_alias_id: "internalAliasId", model_name: "modelName" } },
  },
  {
    key: "sap_s4hana_material", label: "SAP S/4HANA Material Feed",
    description: "Typical material master style mapping for SAP integrations.",
    sourceConfig: { method: "GET", recordPath: "d.results", fieldMap: { Material: "internalAliasId", ProductUUID: "dppId", ProductDescription: "modelName", Plant: "facility" } },
  },
  {
    key: "microsoft_bc_items", label: "Business Central Items",
    description: "Business Central item sync using OData-style responses.",
    sourceConfig: { method: "GET", recordPath: "value", fieldMap: { id: "dppId", number: "internalAliasId", displayName: "modelName", inventoryPostingGroup: "category" } },
  },
  {
    key: "netsuite_restlet", label: "NetSuite Restlet",
    description: "NetSuite restlet payload with items array.",
    sourceConfig: { method: "POST", recordPath: "items", fieldMap: { internalId: "dppId", itemId: "internalAliasId", displayName: "modelName", location: "facility" } },
  },
  {
    key: "siemens_teamcenter_items", label: "Siemens Teamcenter Items",
    description: "Teamcenter item feed with product ID matching and optional GUID mapping.",
    sourceConfig: { method: "GET", recordPath: "items", fieldMap: { item_id: "internalAliasId", uid: "dppId", object_name: "modelName" } },
  },
];

if (IS_PRODUCTION) {
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!process.env.PEPPER_V1)  missing.push("PEPPER_V1");
  if (missing.length) throw new Error(`[SECURITY] Missing required production secrets: ${missing.join(", ")}`);
  if (JWT_SECRET === "change-me-in-production") throw new Error("[SECURITY] JWT_SECRET is still the default value. Set a strong secret before deploying.");
  if (PEPPER === "change-this-pepper-in-production") throw new Error("[SECURITY] PEPPER_V1 is still the default value. Set a strong secret before deploying.");
} else {
  if (!process.env.JWT_SECRET) logger.warn("[SECURITY] JWT_SECRET is not set — using insecure default. Set it in .env before deploying.");
  if (!process.env.PEPPER_V1)  logger.warn("[SECURITY] PEPPER_V1 is not set — using insecure default. Set it in .env before deploying.");
}

assertProductionStorageReadiness({ isProduction: IS_PRODUCTION, logger });

// ─── AUTH HELPERS ────────────────────────────────────────────────────────────
const passwordService = createPasswordService({
  crypto,
  pepper: PEPPER,
  currentPepperVersion: CURRENT_PEPPER_VERSION,
});
const { hashPassword, verifyPassword, verifyPasswordAndUpgrade } = passwordService;
const generateToken  = (userOrId, email, companyId, role, sessionVersion = 1, extraClaims = {}) => {
  const user = typeof userOrId === "object" && userOrId !== null
    ? userOrId
    : { id: userOrId, email, companyId, role, sessionVersion };
  const payload = {
    userId: user.id || user.userId,
    email: user.email,
    companyId: user.companyId ?? null,
    role: user.role,
    sessionVersion: user.sessionVersion ?? 1,
    mfaVerifiedAt: extraClaims.mfaVerifiedAt || null,
    amr: Array.isArray(extraClaims.amr) && extraClaims.amr.length ? extraClaims.amr : ["pwd"],
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  logger.info({
    userId: payload.userId,
    payload: {
      sessionVersion: payload.sessionVersion,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      mfaVerifiedAt: payload.mfaVerifiedAt,
    },
    msg: "[TOKEN_CREATED] JWT payload for token"
  });
  return token;
};
const hashOpaqueToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const serializeCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join("; ");
};

const authCookieOptions = {
  httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAME_SITE,
  domain: COOKIE_DOMAIN || undefined, path: "/", maxAge: 7 * 24 * 60 * 60 * 1000,
};
const setAuthCookie   = (res, token) => res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, token, authCookieOptions));
const clearAuthCookie = (res) => res.setHeader(
  "Set-Cookie",
  serializeCookie(SESSION_COOKIE_NAME, "", { ...authCookieOptions, maxAge: 0, expires: new Date(0) })
);

// ─── SHARED SERVICES ────────────────────────────────────────────────────────
const cache = createCacheService();
const storageService = createStorageService({
  localStorageDir: LOCAL_STORAGE_DIR,
  filesBaseDir: FILES_BASE_DIR,
  repoBaseDir: REPO_BASE_DIR,
  uploadsBaseDir: UPLOADS_BASE_DIR,
  serverBaseUrl: process.env.SERVER_URL || `http://localhost:${PORT}`,
});
const oauthService = createOauthService({
  jwt, pool, JWT_SECRET, generateToken, setAuthCookie, cache, hashPassword,
});

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const {
  authenticateToken, isSuperAdmin, checkCompanyAccess,
  requireEditor, requireDraftEditor, checkCompanyAdmin, authenticateApiKey, requireApiKeyScope,
} = createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME });

// ─── RATE LIMITERS ───────────────────────────────────────────────────────────
const {
  authRateLimit, otpRateLimit, passwordResetRateLimit, publicReadRateLimit,
  publicHeavyRateLimit, publicUnlockRateLimit,
  apiKeyReadRateLimit, assetWriteRateLimit, assetSourceFetchRateLimit,
} = createRateLimiters(pool);
startRateLimitMaintenance(pool);

async function getCompanyAssetSettings(companyId) {
  const result = await pool.query(
    `SELECT id, company_name, is_active, asset_management_enabled, asset_management_revoked_at
     FROM companies WHERE id = $1`,
    [companyId]
  );
  return result.rows[0] || null;
}

async function assertAssetManagementEnabled(companyId) {
  const company = await getCompanyAssetSettings(companyId);
  if (!company) { const e = new Error("Company not found"); e.statusCode = 404; throw e; }
  if (company.is_active === false) { const e = new Error("Company is inactive"); e.statusCode = 403; throw e; }
  return company;
}

async function assertCompanyAssetPassportTypeAccess(companyId, passportType) {
  const normalizedType = String(passportType || "").trim();
  if (!normalizedType) { const e = new Error("passport_type is required"); e.statusCode = 400; throw e; }
  const result = await pool.query(
    `SELECT pt.id,
            pt."typeName" AS "typeName",
            pt."displayName" AS "displayName",
            pt."productCategory" AS "productCategory",
            pt."productIcon" AS "productIcon",
            pt."semanticModelKey" AS "semanticModelKey",
            pt."fieldsJson" AS "fieldsJson",
            pt."isActive" AS "isActive"
     FROM passport_types pt
     JOIN company_passport_access cpa ON cpa.passport_type_id = pt.id
     WHERE cpa.company_id = $1 AND cpa.access_revoked = false AND pt."isActive" = true AND pt."typeName" = $2
     LIMIT 1`,
    [companyId, normalizedType]
  );
  if (!result.rows.length) { const e = new Error("Passport type is not enabled for this company"); e.statusCode = 403; throw e; }
  const sections = result.rows[0]?.fieldsJson?.sections || [];
  const schemaFields = sections.flatMap(s => s.fields || []);
  return { typeName: result.rows[0].typeName, displayName: result.rows[0].displayName, schemaFields, allowedKeys: new Set(schemaFields.map(f => f.key).filter(Boolean)) };
}

// ─── FILE STORAGE ────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => file.mimetype === "application/pdf" ? cb(null, true) : cb(new Error("Only PDF files are allowed"), false),
});
const repoUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => file.mimetype === "application/pdf" ? cb(null, true) : cb(new Error("Only PDF files are allowed"), false),
});
const repoSymbolUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { const allowed = [".png",".jpg",".jpeg",".webp"]; allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error("Only PNG, JPG, and WebP files are allowed")); },
});

// ─── DID + CANONICAL SERIALIZATION SERVICES ─────────────────────────────────
const didService = createDidService({
  didDomain: process.env.DID_WEB_DOMAIN || "www.claros-dpp.online",
  publicOrigin: process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000",
  apiOrigin: process.env.SERVER_URL || `http://localhost:${PORT}`,
});
const productIdentifierService = createProductIdentifierService({ didService, pool });
const semanticModelRegistry = createSemanticModelRegistry();
const canonicalPassportSerializer = createCanonicalPassportSerializer({
  didService,
  productIdentifierService,
  semanticModelRegistry,
});
const {
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  buildExpandedDataElement,
} = canonicalPassportSerializer;

// ─── SIGNING SERVICE ─────────────────────────────────────────────────────────
const signingService = createSigningService({
  pool,
  crypto,
  canonicalizeJson,
  didService,
  buildCanonicalPassportPayload,
});
const { signPassport, verifyPassportSignature } = signingService;

// ─── PASSPORT REPRESENTATION SERVICE ────────────────────────────────────────
const { buildOperationalDppPayload } = createPassportRepresentationService({
  productIdentifierService,
  buildCanonicalPassportPayload,
});

// ─── SEMANTICS + COMPLIANCE SERVICES ─────────────────────────────────────────
const {
  buildSemanticPassportJsonExport,
  buildPassportJsonLdContext,
} = createSemanticPassportExportService({ semanticModelRegistry });
const batteryDictionaryService = createBatteryDictionaryService({ semanticModelRegistry });
const complianceService = createComplianceService({
  pool,
  batteryDictionaryService,
  semanticModelRegistry,
  buildCanonicalPassportPayload,
});
const accessRightsService = createAccessRightsService({ pool });
const backupProviderService = createBackupProviderService({
  pool,
  storageService,
  buildCanonicalPassportPayload,
});

// ─── PASSPORT SERVICE ────────────────────────────────────────────────────────
const passportService = createPassportService({
  pool,
  getTable, normalizePassportRow, normalizeReleaseStatus, isPublicHistoryStatus, isEditablePassportStatus,
  normalizeInternalAliasIdValue, generateInternalAliasIdValue, IN_REVISION_STATUS, SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns, getStoredPassportValues, toStoredPassportValue,
  quoteSqlIdentifier, joinQuotedSqlIdentifiers,
  coerceBulkFieldValue, comparableHistoryFieldValue, formatHistoryFieldValue, getHistoryFieldDefs,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath,
  productIdentifierService,
  createTransporter, brandedEmail,
});

const {
  IN_REVISION_STATUSES_SQL, EDITABLE_RELEASE_STATUSES_SQL, REVISION_BLOCKING_STATUSES_SQL,
  EDIT_SESSION_TIMEOUT_HOURS, EDIT_SESSION_TIMEOUT_SQL,
  logAudit, createNotification,
  verifyAuditLogChain,
  buildAuditLogRootSummary,
  listAuditLogAnchors,
  anchorAuditLogRoot,
  getPassportTypeSchema, findExistingPassportByInternalAliasId,
  getPassportLineageContext, getPassportVersionsByLineage,
  getCompanyNameMap, stripRestrictedFieldsForPublicView,
  fetchCompanyPassportRecord, resolveReleasedPassportByInternalAliasId,
  resolvePublicPassportByDppId, resolveCompanyPreviewPassport,
  archivePassportSnapshot, archivePassportSnapshots,
  updatePassportRowById, buildPassportVersionHistory,
  clearExpiredEditSessions, listActiveEditSessions, markOlderVersionsObsolete,
  getLatestCompanyPassports, normalizePassportTypeSchema, getTypeSchemaVersion,
  buildPassportTypeSchemaChange, passportTypeHasStoredRecords,
  createPassportTable, validatePassportTypeStorage, queryTableStats, submitPassportToWorkflow,
} = passportService;

// ─── ASSET SERVICE ───────────────────────────────────────────────────────────
const assetService = createAssetService({
  pool, getTable, logAudit,
  assertCompanyAssetPassportTypeAccess, assertAssetManagementEnabled, getLatestCompanyPassports,
  findExistingPassportByInternalAliasId, updatePassportRowById, normalizeInternalAliasIdValue,
  generateInternalAliasIdValue, generateDppRecordId, productIdentifierService, createPassportTable, archivePassportSnapshot,
  isPlainObject, getValueAtPath, normalizeAssetHeaders, coerceAssetFieldValue,
  comparableHistoryFieldValue, toDynamicStoredValue, getAssetFieldMap,
  EDITABLE_RELEASE_STATUSES_SQL, ASSET_MATCH_FIELDS, ASSET_IGNORED_SYSTEM_COLUMNS,
  ASSET_SCHEDULER_INTERVAL_MS, ASSET_SOURCE_ALLOWED_HOSTS,
});
const {
  fetchAssetSourceRecords, prepareAssetPayload, executeAssetPush,
  runAssetManagementJob, recordAssetRun, resolveAssetJobNextRunAt,
} = assetService;

// ─── PATH MIGRATION ──────────────────────────────────────────────────────────
const isPathInsideBase = (targetPath, baseDir) => {
  const nb = path.resolve(baseDir);
  const nt = path.resolve(targetPath);
  return nt === nb || nt.startsWith(`${nb}${path.sep}`);
};

// ─── STARTUP ─────────────────────────────────────────────────────────────────

async function verifySchemaReady() {
  await pool.query(`
    SELECT pr."dppId", pr."companyId", pr."passportType"
    FROM passport_registry pr
    LIMIT 1
  `);
  await pool.query(`
    SELECT legal_name, customer_trust_level, verification_status
    FROM companies
    LIMIT 1
  `);
  await pool.query(`
    SELECT id
    FROM schema_migrations
    LIMIT 1
  `);
}

const startup = pool.query("SELECT NOW()")
  .then(async () => {
    if (RUN_SCHEMA_MIGRATIONS) {
      await initDb(pool, {
        getTable,
        createPassportTable,
        IN_REVISION_STATUS,
        productIdentifierService,
      });
      logger.info("[DB] Initialized successfully");
    } else {
      await verifySchemaReady();
      logger.info("[DB] Schema migrations skipped; existing schema verified");
    }
    await signingService.loadOrGenerateSigningKey();
    assetService.startAssetManagementScheduler();
  })
  .catch(err => {
    logger.error({ err }, "[DB] Fatal startup error");
    process.exit(1);
  });

// ─── ROUTE REGISTRATIONS ─────────────────────────────────────────────────────

registerAppRoutes(app, {
  pool,
  fs,
  path,
  crypto,
  jwt,
  multer,
  JWT_SECRET,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE_NAME,
  ASSET_ERP_PRESETS,
  ASSET_MATCH_FIELDS,
  GLOBAL_SYMBOLS_DIR,
  REPO_BASE_DIR,
  FILES_BASE_DIR,
  IN_REVISION_STATUS,
  IN_REVISION_STATUSES_SQL,
  EDITABLE_RELEASE_STATUSES_SQL,
  REVISION_BLOCKING_STATUSES_SQL,
  EDIT_SESSION_TIMEOUT_HOURS,
  EDIT_SESSION_TIMEOUT_SQL,
  SYSTEM_PASSPORT_FIELDS,
  authRateLimit,
  otpRateLimit,
  passwordResetRateLimit,
  publicReadRateLimit,
  publicHeavyRateLimit,
  publicUnlockRateLimit,
  apiKeyReadRateLimit,
  assetWriteRateLimit,
  assetSourceFetchRateLimit,
  authenticateToken,
  isSuperAdmin,
  checkCompanyAccess,
  requireEditor,
  requireDraftEditor,
  checkCompanyAdmin,
  authenticateApiKey,
  requireApiKeyScope,
  hashPassword,
  verifyPassword,
  verifyPasswordAndUpgrade,
  generateToken,
  hashOpaqueToken,
  validatePasswordPolicy,
  hashOtpCode,
  generateOtpCode,
  setAuthCookie,
  clearAuthCookie,
  sendOtpEmail,
  createTransporter,
  brandedEmail,
  renderInfoTable,
  oauthService,
  backupProviderService,
  assertAssetManagementEnabled,
  assertCompanyAssetPassportTypeAccess,
  getLatestCompanyPassports,
  fetchAssetSourceRecords,
  prepareAssetPayload,
  executeAssetPush,
  runAssetManagementJob,
  recordAssetRun,
  resolveAssetJobNextRunAt,
  upload,
  repoUpload,
  repoSymbolUpload,
  hashSecret,
  createAccessKeyMaterial,
  createDeviceKeyMaterial,
  getTable,
  getPassportFieldValue,
  normalizePassportRow,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  normalizePassportRequestBody,
  extractExplicitFacilityId,
  getWritablePassportColumns,
  getStoredPassportValues,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  toStoredPassportValue,
  coerceBulkFieldValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  isPublicHistoryStatus,
  logAudit,
  getPassportTypeSchema,
  findExistingPassportByInternalAliasId,
  getPassportLineageContext,
  getPassportVersionsByLineage,
  fetchCompanyPassportRecord,
  resolveCompanyPreviewPassport,
  archivePassportSnapshot,
  archivePassportSnapshots,
  updatePassportRowById,
  buildPassportVersionHistory,
  clearExpiredEditSessions,
  listActiveEditSessions,
  markOlderVersionsObsolete,
  verifyAuditLogChain,
  buildAuditLogRootSummary,
  listAuditLogAnchors,
  anchorAuditLogRoot,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  queryTableStats,
  submitPassportToWorkflow,
  signPassport,
  signPortableDataConstruct: signingService.signPortableDataConstruct,
  buildSemanticPassportJsonExport,
  storageService,
  complianceService,
  accessRightsService,
  productIdentifierService,
  buildExpandedPassportPayload,
  createPassportTable,
  resolveReleasedPassportByInternalAliasId,
  resolvePublicPassportByDppId,
  resolvePublicPathToSubjects,
  verifyPassportSignature,
  buildJsonLdContext: buildPassportJsonLdContext,
  buildCanonicalPassportPayload,
  signingService,
  didService,
  buildOperationalDppPayload,
  buildExpandedDataElement,
  dppIdentity,
  batteryDictionaryService,
  semanticModelRegistry,
  isPathInsideBase,
  normalizePassportTypeSchema,
  getTypeSchemaVersion,
  buildPassportTypeSchemaChange,
  passportTypeHasStoredRecords,
  validatePassportTypeStorage,
  buildPassportJsonLdContext,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  createNotification,
  getAssetFieldMap,
  isPlainObject,
});
registerSupportRoutes(app, {
  express,
  pool,
  fs,
  path,
  logger,
  storageService,
  LOCAL_STORAGE_DIR,
  FILES_BASE_DIR,
  normalizeStorageRequestKey,
  isPassportStorageKey,
  publicReadRateLimit,
  createTransporter,
  brandedEmail,
  renderInfoTable,
});

startup.then(() => {
  app.listen(PORT, () => {
    logger.info(`[Server] Listening on port ${PORT}`);
  });
});

// Graceful shutdown handler
process.on("SIGTERM", () => {
  logger.info("SIGTERM received: starting graceful shutdown");
  pool.end()
    .then(() => logger.info("Database pool closed"))
    .catch((err) => logger.error({ err }, "Error closing database pool"));
});

process.on("SIGINT", () => {
  logger.info("SIGINT received: starting graceful shutdown");
  pool.end()
    .then(() => logger.info("Database pool closed"))
    .catch((err) => logger.error({ err }, "Error closing database pool"));
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
  process.exit(1);
});
