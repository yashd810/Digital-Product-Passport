"use strict";
const path           = require("path");
const {
  assertDatabaseName,
  assertProductionStorageReadiness,
  assertRequiredProductionEnvironment,
  deriveRuntimeFlags,
  deriveRuntimePaths,
  ensureLocalDirectories,
  initEnvironment,
  isPassportStorageKey,
  isPlainRecord,
  normalizeIncomingJsonValue,
  normalizeOutgoingJsonValue,
  normalizeCookieDomain,
  normalizeSessionCookieName,
  normalizeStorageRequestKey,
  toBooleanEnv,
} = require("./bootstrap/runtime-config");
initEnvironment(__dirname);
const express        = require("express");
const { Pool }       = require("pg");
const crypto         = require("crypto");
const jwt            = require("jsonwebtoken");
const multer         = require("multer");
const fs             = require("fs");
const { configureHttp } = require("./bootstrap/http");
const { registerAppRoutes } = require("./bootstrap/register-routes");
const { registerSupportRoutes } = require("./bootstrap/support-routes");

const { initDb }               = require("./db/init");
const createSigningService     = require("./services/signing-service");
const createDidService         = require("./services/did-service");
const createCanonicalPassportSerializer = require("./services/canonicalPassportSerializer");
const createCacheService       = require("./services/cache-service");
const createStorageService     = require("./services/storage-service");
const createOauthService       = require("./services/oauth-service");
const createPasswordService    = require("./services/password-service");
const logger                   = require("./services/logger");
const { createTransporter, brandedEmail, sendOtpEmail, renderInfoTable } = require("./services/email");
const { validatePasswordPolicy, hashSecret, hashOtpCode, generateOtpCode, passwordMinLength, createDeviceKeyMaterial } = require("./services/security-service");
const createAuthMiddleware     = require("./http/middleware/auth");
const { createRateLimiters, startRateLimitMaintenance } = require("./http/middleware/rate-limit");
const createAssetService       = require("./services/asset-management");
const { assertAssetManagementEntitlement } = require("./shared/assets/asset-management-entitlement");
const createPassportService    = require("./services/passport-service");
const createSemanticPassportExportService = require("./services/semantic-passport-export");
const createSemanticModelRegistry         = require("./services/semantic-model-registry");
const createComplianceService             = require("./services/required-fields-service");
const createProductIdentifierService      = require("./services/product-identifier-service");
const createBackupProviderService         = require("./services/backup-provider-service");
const canonicalizeJson                    = require("./services/json-canonicalization");
const { generateDppRecordId }             = require("./services/dpp-record-id");
const { parseAssetSourceCredentials }     = require("./shared/assets/asset-source-config");
const { getApiOrigin, getPublicViewerOrigin } = require("./shared/security/configured-origin");

global.console = logger.console;

const {
  inRevisionStatus,
  systemPassportFields,
  getTable,
  normalizeReleaseStatus, isPublicHistoryStatus, isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody, normalizeInternalAliasIdValue, generateInternalAliasIdValue, extractExplicitFacilityId,
  getWritablePassportColumns, getStoredPassportValues,
  quoteSqlIdentifier, joinQuotedSqlIdentifiers,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath, buildPreviewPassportPath,
  coerceBulkFieldValue, getHistoryFieldDefs, formatHistoryFieldValue, comparableHistoryFieldValue,
  isPlainObject, getPassportFieldValue, getAssetFieldMap, getValueAtPath, normalizeAssetHeaders,
  coerceAssetFieldValue, toDynamicStoredValue, flattenSchemaFieldsFromSections,
} = require("./shared/passports/passport-helpers");

// ─── DIRECTORIES ─────────────────────────────────────────────────────────────
const runtimePaths = deriveRuntimePaths(__dirname);
const {
  localStorageDir: localStorageDir,
  filesBaseDir: filesBaseDir,
  repoBaseDir: repoBaseDir,
  uploadsBaseDir: uploadsBaseDir,
  globalSymbolsDir: globalSymbolsDir,
  passportStoragePrefix: passportStoragePrefix,
} = runtimePaths;
ensureLocalDirectories(runtimePaths);

// ─── EXPRESS SETUP ───────────────────────────────────────────────────────────
const port = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === "production";

assertRequiredProductionEnvironment({ isProduction: isProduction, logger });
assertDatabaseName({ logger });
const { runSchemaMigrations, allowedOriginSet, credentialedOriginSet, cspConnectSrc } = deriveRuntimeFlags();
const runtimeApiOrigin = getApiOrigin();
const runtimePublicViewerOrigin = getPublicViewerOrigin();
// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage -- configureHttp installs a fail-closed origin/referrer CSRF guard for browser-cookie mutations and all production mutations.
const app  = express();
configureHttp(app, {
  allowedOriginSet,
  credentialedOriginSet,
  cspConnectSrc,
  isPlainRecord,
  isProduction: isProduction,
  normalizeIncomingJsonValue,
  normalizeOutgoingJsonValue,
  port: port,
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
const jwtSecret             = process.env.JWT_SECRET;
const jwtExpiry             = "7d";
const pepper                 = process.env.PEPPER_V1;
const currentPepperVersion = 1;
const sessionCookieName    = normalizeSessionCookieName(process.env.SESSION_COOKIE_NAME);
const cookieSecure          = isProduction || process.env.COOKIE_SECURE === "true";
const cookieSameSite       = String(process.env.COOKIE_SAME_SITE || "lax").trim().toLowerCase();
const cookieDomain          = normalizeCookieDomain(process.env.COOKIE_DOMAIN, runtimeApiOrigin);
const assetSourceAllowedHosts = new Set(
  String(process.env.ASSET_SOURCE_ALLOWED_HOSTS || "")
    .split(",").map(v => v.trim().toLowerCase()).filter(Boolean)
);

const assetSchedulerIntervalMs = 60 * 1000;
const assetIgnoredSystemColumns = new Set([
  "id", "companyId", "qrCode", "createdBy", "createdAt", "updatedAt", "updatedBy",
  "deletedAt", "releaseStatus", "versionNumber", "isEditable", "fieldLabel",
  "createdByEmail", "firstName", "lastName",
]);
const assetMatchFields = new Set(["dppId", "matchDppId", "guid", "matchGuid", "internalAliasId", "matchProductId", "nextProductId"]);
const assetErpPresets = [
  {
    key: "genericRest", label: "Generic REST",
    description: "Generic JSON API returning an array or records path.",
    sourceConfig: { method: "GET", recordPath: "data.items", fieldMap: { dppId: "dppId", internalAliasId: "internalAliasId", modelName: "modelName" } },
  },
  {
    key: "sapS4hanaMaterial", label: "SAP S/4HANA Material Feed",
    description: "Typical material master style mapping for SAP integrations.",
    sourceConfig: { method: "GET", recordPath: "d.results", fieldMap: { Material: "internalAliasId", ProductUUID: "dppId", ProductDescription: "modelName", Plant: "facility" } },
  },
  {
    key: "microsoftBcItems", label: "Business Central Items",
    description: "Business Central item sync using OData-style responses.",
    sourceConfig: { method: "GET", recordPath: "value", fieldMap: { id: "dppId", number: "internalAliasId", displayName: "modelName", inventoryPostingGroup: "category" } },
  },
  {
    key: "netsuiteRestlet", label: "NetSuite Restlet",
    description: "NetSuite restlet payload with items array.",
    sourceConfig: { method: "POST", recordPath: "items", fieldMap: { internalId: "dppId", itemId: "internalAliasId", displayName: "modelName", location: "facility" } },
  },
  {
    key: "siemensTeamcenterItems", label: "Siemens Teamcenter Items",
    description: "Teamcenter item feed with product ID matching and optional GUID mapping.",
    sourceConfig: { method: "GET", recordPath: "items", fieldMap: { itemId: "internalAliasId", uid: "dppId", objectName: "modelName" } },
  },
];

if (!["strict", "lax", "none"].includes(cookieSameSite)) {
  throw new Error("[SECURITY] COOKIE_SAME_SITE must be strict, lax, or none.");
}
if (cookieSameSite === "none" && !cookieSecure) {
  throw new Error("[SECURITY] COOKIE_SAME_SITE=none requires secure cookies.");
}

assertProductionStorageReadiness({ isProduction: isProduction, logger });

// ─── AUTH HELPERS ────────────────────────────────────────────────────────────
const passwordService = createPasswordService({
  crypto,
  pepper: pepper,
  currentPepperVersion: currentPepperVersion,
});
const { hashPassword, verifyPassword } = passwordService;
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
  const token = jwt.sign(payload, jwtSecret, {
    algorithm: "HS256",
    expiresIn: jwtExpiry,
    issuer: "dpp-api",
    audience: "dpp-app",
  });
  logger.debug({
    userId: payload.userId,
    sessionVersion: payload.sessionVersion,
    authenticationMethods: payload.amr,
  }, "JWT session token created");
  return token;
};
const hashOpaqueToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const generateOneTimeToken = () => crypto.randomBytes(32).toString("base64url");

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
  httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite,
  domain: cookieDomain || undefined, path: "/", maxAge: 7 * 24 * 60 * 60 * 1000,
};
const setAuthCookie   = (res, token) => res.setHeader("Set-Cookie", serializeCookie(sessionCookieName, token, authCookieOptions));
const clearAuthCookie = (res) => res.setHeader(
  "Set-Cookie",
  serializeCookie(sessionCookieName, "", { ...authCookieOptions, maxAge: 0, expires: new Date(0) })
);

// ─── SHARED SERVICES ────────────────────────────────────────────────────────
const cache = createCacheService();
const storageService = createStorageService({
  localStorageDir: localStorageDir,
  filesBaseDir: filesBaseDir,
  repoBaseDir: repoBaseDir,
  uploadsBaseDir: uploadsBaseDir,
  serverBaseUrl: runtimeApiOrigin,
});
const oauthService = createOauthService({
  jwt, pool, jwtSecret, generateToken, setAuthCookie, cache, hashPassword,
});

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const {
  authenticateToken, isSuperAdmin, checkCompanyAccess,
  requireBearerToken, requireEditor, checkCompanyAdmin,
} = createAuthMiddleware({ jwt, pool, jwtSecret, sessionCookieName });

// ─── RATE LIMITERS ───────────────────────────────────────────────────────────
const {
  authRateLimit, otpRateLimit, passwordResetRateLimit, publicReadRateLimit,
  publicHeavyRateLimit, publicUnlockRateLimit,
  integrationWriteRateLimit, assetWriteRateLimit, assetSourceFetchRateLimit,
} = createRateLimiters(pool);
const rateLimitMaintenanceTimer = startRateLimitMaintenance(pool);

async function getCompanyAssetSettings(companyId) {
  const result = await pool.query(
    `SELECT id, "companyName", "isActive", "assetManagementEnabled", "assetManagementRevokedAt"
     FROM companies WHERE id = $1`,
    [companyId]
  );
  return result.rows[0] || null;
}

async function assertAssetManagementEnabled(companyId) {
  const company = await getCompanyAssetSettings(companyId);
  return assertAssetManagementEntitlement(company);
}

async function assertCompanyAssetPassportTypeAccess(companyId, passportType) {
  const normalizedType = String(passportType || "").trim();
  if (!normalizedType) { const e = new Error("passportType is required"); e.statusCode = 400; throw e; }
  const result = await pool.query(
    `SELECT pt.id,
            pt."typeName" AS "typeName",
            pt."displayName" AS "displayName",
            pt."productCategory" AS "productCategory",
            pt."productIcon" AS "productIcon",
            pt."semanticModelKey" AS "semanticModelKey",
            pt."fieldsJson" AS "fieldsJson",
            pt."isActive" AS "isActive"
     FROM "passportTypes" pt
     JOIN "companyPassportAccess" cpa ON cpa."passportTypeId" = pt.id
     WHERE cpa."companyId" = $1 AND cpa."accessRevoked" = false AND pt."isActive" = true AND pt."typeName" = $2
     LIMIT 1`,
    [companyId, normalizedType]
  );
  if (!result.rows.length) { const e = new Error("Passport type is not enabled for this company"); e.statusCode = 403; throw e; }
  const sections = result.rows[0]?.fieldsJson?.sections || [];
  const schemaFields = flattenSchemaFieldsFromSections(sections);
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
const bufferStartsWith = (buffer, bytes, offset = 0) =>
  Buffer.isBuffer(buffer) && bytes.every((byte, index) => buffer[offset + index] === byte);
const isPdfBuffer = (buffer) => bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
const isPngBuffer = (buffer) => bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpegBuffer = (buffer) => bufferStartsWith(buffer, [0xff, 0xd8, 0xff]);
const isWebpBuffer = (buffer) =>
  bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && bufferStartsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8);
const createUploadSignatureValidator = (predicate, message) => (req, res, next) => {
  if (!req.file) return next();
  if (predicate(req.file.buffer)) return next();
  return res.status(400).json({ error: message });
};
const validatePdfUpload = createUploadSignatureValidator(isPdfBuffer, "Uploaded file is not a valid PDF.");
const validateSymbolUpload = createUploadSignatureValidator(
  (buffer) => isPngBuffer(buffer) || isJpegBuffer(buffer) || isWebpBuffer(buffer),
  "Uploaded symbol is not a valid PNG, JPG, or WebP image."
);

// ─── DID + CANONICAL SERIALIZATION SERVICES ─────────────────────────────────
const didService = createDidService({
  publicOrigin: runtimePublicViewerOrigin,
  apiOrigin: runtimeApiOrigin,
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

// ─── SEMANTICS + COMPLIANCE SERVICES ─────────────────────────────────────────
const {
  buildSemanticPassportJsonExport,
} = createSemanticPassportExportService({ semanticModelRegistry });
const complianceService = createComplianceService({
  pool,
  semanticModelRegistry,
  buildCanonicalPassportPayload,
});
const backupProviderService = createBackupProviderService({
  pool,
  storageService,
  buildCanonicalPassportPayload,
  apiOrigin: runtimeApiOrigin,
});

// ─── PASSPORT SERVICE ────────────────────────────────────────────────────────
const passportService = createPassportService({
  pool,
  getTable, normalizePassportRow, normalizeReleaseStatus, isPublicHistoryStatus, isEditablePassportStatus,
  generateInternalAliasIdValue, inRevisionStatus, systemPassportFields,
  getWritablePassportColumns, getStoredPassportValues, toStoredPassportValue,
  quoteSqlIdentifier, joinQuotedSqlIdentifiers,
  coerceBulkFieldValue, comparableHistoryFieldValue, formatHistoryFieldValue, getHistoryFieldDefs,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath, flattenSchemaFieldsFromSections,
  createTransporter, brandedEmail, renderInfoTable,
});

const {
  inRevisionStatusesSql, editableReleaseStatusesSql, revisionBlockingStatusesSql,
  editSessionTimeoutHours, editSessionTimeoutSql,
  logAudit, createNotification,
  verifyAuditLogChain,
  buildAuditLogRootSummary,
  listAuditLogAnchors,
  anchorAuditLogRoot,
  getPassportTypeSchema, findExistingPassportByInternalAliasId,
  getPassportLineageContext, getPassportVersionsByLineage,
  getCompanyNameMap, stripRestrictedFieldsForPublicView,
  fetchCompanyPassportRecord,
  resolvePublicPassportByDppId, resolveCompanyPreviewPassport,
  archivePassportSnapshot, archivePassportSnapshots,
  updatePassportRowById, buildPassportVersionHistory,
  clearExpiredEditSessions, listActiveEditSessions, markOlderVersionsObsolete,
  getLatestCompanyPassports, normalizePassportTypeSchema, getTypeSchemaVersion,
  buildPassportTypeSchemaChange, passportTypeHasStoredRecords,
  createPassportTable, assertPassportTypeStorageReady, validatePassportTypeStorage, queryTableStats, submitPassportToWorkflow,
} = passportService;

// ─── ASSET SERVICE ───────────────────────────────────────────────────────────
const assetSourceCredentials = parseAssetSourceCredentials(process.env.ASSET_SOURCE_CREDENTIALS_JSON);
const assetService = createAssetService({
  pool, getTable, logAudit,
  assertCompanyAssetPassportTypeAccess, assertAssetManagementEnabled, getLatestCompanyPassports,
  findExistingPassportByInternalAliasId, updatePassportRowById, normalizeInternalAliasIdValue,
  generateInternalAliasIdValue, generateDppRecordId, productIdentifierService, assertPassportTypeStorageReady, archivePassportSnapshot,
  isPlainObject, getValueAtPath, normalizeAssetHeaders, coerceAssetFieldValue,
  comparableHistoryFieldValue, toDynamicStoredValue, getAssetFieldMap,
  editableReleaseStatusesSql, assetMatchFields, assetIgnoredSystemColumns,
  assetSchedulerIntervalMs, assetSourceAllowedHosts, assetSourceCredentials,
});
const {
  fetchAssetSourceRecords, prepareAssetPayload, executeAssetPush,
  runAssetManagementJob, recordAssetRun, resolveAssetJobNextRunAt,
} = assetService;

// ─── PATH SAFETY ─────────────────────────────────────────────────────────────
const isPathInsideBase = (targetPath, baseDir) => {
  const nb = path.resolve(baseDir);
  const nt = path.resolve(targetPath);
  return nt === nb || nt.startsWith(`${nb}${path.sep}`);
};

// ─── STARTUP ─────────────────────────────────────────────────────────────────

async function verifySchemaReady() {
  await pool.query(`
    SELECT pr."dppId", pr."companyId", pr."passportType"
    FROM "passportRegistry" pr
    LIMIT 1
  `);
  await pool.query(`
    SELECT "legalName", "customerTrustLevel", "verificationStatus"
    FROM companies
    LIMIT 1
  `);
  const storageValidation = await validatePassportTypeStorage({ repair: false });
  const unavailableStorage = storageValidation.results.filter((result) =>
    result.issues.some((issue) => issue.type !== "extraColumn")
  );
  if (unavailableStorage.length) {
    const typeNames = unavailableStorage.map((result) => result.typeName).join(", ");
    throw new Error(`Passport storage is not ready for registered type(s): ${typeNames}`);
  }
}

const startup = pool.query("SELECT NOW()")
  .then(async () => {
    if (runSchemaMigrations) {
      await initDb(pool, {
        getTable,
        createPassportTable,
        inRevisionStatus,
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
  jwtSecret,
  passwordMinLength,
  sessionCookieName,
  assetErpPresets,
  assetMatchFields,
  repoBaseDir,
  filesBaseDir,
  inRevisionStatus,
  inRevisionStatusesSql,
  editableReleaseStatusesSql,
  revisionBlockingStatusesSql,
  editSessionTimeoutHours,
  editSessionTimeoutSql,
  systemPassportFields,
  authRateLimit,
  otpRateLimit,
  passwordResetRateLimit,
  publicReadRateLimit,
  publicHeavyRateLimit,
  publicUnlockRateLimit,
  integrationWriteRateLimit,
  assetWriteRateLimit,
  assetSourceFetchRateLimit,
  authenticateToken,
  requireBearerToken,
  isSuperAdmin,
  checkCompanyAccess,
  requireEditor,
  checkCompanyAdmin,
  hashPassword,
  verifyPassword,
  generateToken,
  hashOpaqueToken,
  generateOneTimeToken,
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
  validatePdfUpload,
  repoUpload,
  repoSymbolUpload,
  validateRepositoryPdfUpload: validatePdfUpload,
  validateRepositorySymbolUpload: validateSymbolUpload,
  hashSecret,
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
  productIdentifierService,
  buildExpandedPassportPayload,
  createPassportTable,
  resolvePublicPassportByDppId,
  verifyPassportSignature,
  buildCanonicalPassportPayload,
  signingService,
  didService,
  semanticModelRegistry,
  isPathInsideBase,
  normalizePassportTypeSchema,
  getTypeSchemaVersion,
  buildPassportTypeSchemaChange,
  passportTypeHasStoredRecords,
  assertPassportTypeStorageReady,
  validatePassportTypeStorage,
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
  localStorageDir,
  filesBaseDir,
  normalizeStorageRequestKey,
  isPassportStorageKey,
  publicReadRateLimit,
  createTransporter,
  brandedEmail,
  renderInfoTable,
});

let httpServer = null;
let isShuttingDown = false;
const shutdownTimeoutMs = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "10000", 10);

startup.then(() => {
  httpServer = app.listen(port, () => {
    logger.info(`[Server] Listening on port ${port}`);
  });
});

async function closeHttpServer() {
  if (!httpServer) return;
  if (typeof httpServer.closeIdleConnections === "function") {
    httpServer.closeIdleConnections();
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    timeout = setTimeout(() => {
      logger.warn({ timeoutMs: shutdownTimeoutMs }, "Forcing HTTP connections closed during shutdown");
      if (typeof httpServer.closeAllConnections === "function") {
        httpServer.closeAllConnections();
      }
      finish();
    }, shutdownTimeoutMs);
    timeout.unref?.();
    httpServer.close(finish);
  }).finally(() => {
    if (typeof httpServer.closeIdleConnections === "function") {
      httpServer.closeIdleConnections();
    }
  });
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received: starting graceful shutdown`);
  if (rateLimitMaintenanceTimer) clearInterval(rateLimitMaintenanceTimer);
  assetService.stopAssetManagementScheduler?.();
  try {
    await closeHttpServer();
    logger.info("HTTP server closed");
    await pool.end();
    logger.info("Database pool closed");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
  process.exit(1);
});
