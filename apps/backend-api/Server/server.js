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
const createSigningService     = require("../services/signing-service");
const createDidService         = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");
const createCacheService       = require("../services/cache-service");
const createStorageService     = require("../services/storage-service");
const createOauthService       = require("../services/oauth-service");
const createPasswordService    = require("../services/password-service");
const logger                   = require("../services/logger");
const { createTransporter, brandedEmail, sendOtpEmail } = require("../services/email");
const { validatePasswordPolicy, hashSecret, hashOtpCode, generateOtpCode, PASSWORD_MIN_LENGTH, createAccessKeyMaterial, createDeviceKeyMaterial } = require("../services/security-service");
const createAuthMiddleware     = require("../middleware/auth");
const { createRateLimiters, startRateLimitMaintenance } = require("../middleware/rate-limit");
const createAssetService       = require("../services/asset-management");
const createPassportService    = require("../services/passport-service");
const { buildBatteryPassJsonExport, buildPassportJsonLdContext } = require("../services/battery-pass-export");
const createPassportRepresentationService = require("../services/passport-representation-service");
const dppIdentity                         = require("../services/dpp-identity-service");
const createBatteryDictionaryService      = require("../services/battery-dictionary-service");
const createComplianceService             = require("../services/compliance-service");
const createAccessRightsService           = require("../services/access-rights-service");
const createProductIdentifierService      = require("../services/product-identifier-service");
const createBackupProviderService         = require("../services/backup-provider-service");
const canonicalizeJson                    = require("../services/json-canonicalization");
const { generateDppRecordId }             = require("../services/dpp-record-id");

global.console = logger.console;

const {
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  getTable,
  normalizeReleaseStatus, isPublicHistoryStatus, isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody, normalizeProductIdValue, generateProductIdValue, extractExplicitFacilityId,
  getWritablePassportColumns, getStoredPassportValues,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath, buildPreviewPassportPath,
  resolvePublicPathToSubjects,
  coerceBulkFieldValue, getHistoryFieldDefs, formatHistoryFieldValue, comparableHistoryFieldValue,
  isPlainObject, getAssetFieldMap, getValueAtPath, normalizeAssetHeaders,
  coerceAssetFieldValue, toDynamicStoredValue,
} = require("../helpers/passport-helpers");

// ─── DIRECTORIES ─────────────────────────────────────────────────────────────
const RUNTIME_PATHS = deriveRuntimePaths(__dirname);
const {
  assetManagementDir: ASSET_MANAGEMENT_DIR,
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
  assetManagementDir: ASSET_MANAGEMENT_DIR,
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
const ASSET_LAUNCH_TOKEN_EXPIRY = process.env.ASSET_LAUNCH_TOKEN_EXPIRY || "2h";
const PEPPER                 = process.env.PEPPER_V1  || "change-this-pepper-in-production";
const CURRENT_PEPPER_VERSION = 1;
const SESSION_COOKIE_NAME    = process.env.SESSION_COOKIE_NAME || "dpp_session";
const COOKIE_SECURE          = IS_PRODUCTION ? process.env.COOKIE_SECURE !== "false" : process.env.COOKIE_SECURE === "true";
const COOKIE_SAME_SITE       = process.env.COOKIE_SAME_SITE || (IS_PRODUCTION ? "None" : "lax");
const COOKIE_DOMAIN          = process.env.COOKIE_DOMAIN || "";
const ASSET_SHARED_SECRET    = process.env.ASSET_MANAGEMENT_SHARED_SECRET || "";
const ASSET_SOURCE_ALLOWED_HOSTS = new Set(
  String(process.env.ASSET_SOURCE_ALLOWED_HOSTS || "")
    .split(",").map(v => v.trim().toLowerCase()).filter(Boolean)
);

const ASSET_SCHEDULER_INTERVAL_MS = 60 * 1000;
const ASSET_IGNORED_SYSTEM_COLUMNS = new Set([
  "id", "company_id", "qr_code", "created_by", "created_at", "updated_at", "updated_by",
  "deleted_at", "release_status", "version_number", "is_editable", "field_label",
  "created_by_email", "first_name", "last_name",
]);
const ASSET_MATCH_FIELDS = new Set(["dppId", "dpp_id", "match_dpp_id", "guid", "match_guid", "product_id", "match_product_id", "next_product_id"]);
const ASSET_ERP_PRESETS = [
  {
    key: "generic_rest", label: "Generic REST",
    description: "Generic JSON API returning an array or records path.",
    sourceConfig: { method: "GET", recordPath: "data.items", fieldMap: { dppId: "dppId", product_id: "product_id", model_name: "model_name" } },
  },
  {
    key: "sap_s4hana_material", label: "SAP S/4HANA Material Feed",
    description: "Typical material master style mapping for SAP integrations.",
    sourceConfig: { method: "GET", recordPath: "d.results", fieldMap: { Material: "product_id", ProductUUID: "dppId", ProductDescription: "model_name", Plant: "facility" } },
  },
  {
    key: "microsoft_bc_items", label: "Business Central Items",
    description: "Business Central item sync using OData-style responses.",
    sourceConfig: { method: "GET", recordPath: "value", fieldMap: { id: "dppId", number: "product_id", displayName: "model_name", inventoryPostingGroup: "category" } },
  },
  {
    key: "netsuite_restlet", label: "NetSuite Restlet",
    description: "NetSuite restlet payload with items array.",
    sourceConfig: { method: "POST", recordPath: "items", fieldMap: { internalId: "dppId", itemId: "product_id", displayName: "model_name", location: "facility" } },
  },
  {
    key: "siemens_teamcenter_items", label: "Siemens Teamcenter Items",
    description: "Teamcenter item feed with product ID matching and optional GUID mapping.",
    sourceConfig: { method: "GET", recordPath: "items", fieldMap: { item_id: "product_id", uid: "dppId", object_name: "model_name" } },
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
    : { id: userOrId, email, company_id: companyId, role, session_version: sessionVersion };
  const payload = {
    userId: user.id || user.userId,
    email: user.email,
    companyId: user.company_id !== undefined ? user.company_id : (user.companyId ?? null),
    role: user.role,
    sessionVersion: user.session_version !== undefined ? user.session_version : (user.sessionVersion ?? 1),
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
  requireEditor, checkCompanyAdmin, authenticateApiKey, requireApiKeyScope,
} = createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME });

// ─── RATE LIMITERS ───────────────────────────────────────────────────────────
const {
  authRateLimit, otpRateLimit, passwordResetRateLimit, publicReadRateLimit,
  publicHeavyRateLimit, publicUnlockRateLimit,
  apiKeyReadRateLimit, assetWriteRateLimit, assetSourceFetchRateLimit,
} = createRateLimiters(pool);
startRateLimitMaintenance(pool);

// ─── ASSET MANAGEMENT AUTH MIDDLEWARE ────────────────────────────────────────
const requireAssetManagementKey = (req, res, next) => {
  if (!ASSET_SHARED_SECRET) {
    logger.error("[asset-management] ASSET_MANAGEMENT_SHARED_SECRET is not configured");
    return res.status(503).json({ error: "Asset management integration is unavailable" });
  }
  const submitted = String(req.headers["x-asset-key"] || "");
  if (!submitted) return res.status(401).json({ error: "x-asset-key header required" });
  const expectedBuf = Buffer.from(String(ASSET_SHARED_SECRET));
  const submittedBuf = Buffer.from(submitted);
  if (expectedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(expectedBuf, submittedBuf)) {
    return res.status(403).json({ error: "Invalid asset key" });
  }
  next();
};

const generateAssetLaunchToken = ({ companyId, userId, role }) =>
  jwt.sign({ scope: "asset_management", companyId, userId, role }, JWT_SECRET, { expiresIn: ASSET_LAUNCH_TOKEN_EXPIRY });

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
  if (!company.asset_management_enabled) { const e = new Error("Asset Management is not enabled for this company"); e.statusCode = 403; throw e; }
  return company;
}

async function getCurrentAssetSessionUser(userId) {
  if (!userId) return null;
  const result = await pool.query(
    "SELECT id, company_id, role, is_active FROM users WHERE id = $1", [userId]
  );
  return result.rows[0] || null;
}

async function assertCompanyAssetPassportTypeAccess(companyId, passportType) {
  const normalizedType = String(passportType || "").trim();
  if (!normalizedType) { const e = new Error("passport_type is required"); e.statusCode = 400; throw e; }
  const result = await pool.query(
    `SELECT pt.id, pt.type_name, pt.display_name, pt.product_category, pt.product_icon, pt.semantic_model_key, pt.fields_json, pt.is_active
     FROM passport_types pt
     JOIN company_passport_access cpa ON cpa.passport_type_id = pt.id
     WHERE cpa.company_id = $1 AND cpa.access_revoked = false AND pt.is_active = true AND pt.type_name = $2
     LIMIT 1`,
    [companyId, normalizedType]
  );
  if (!result.rows.length) { const e = new Error("Passport type is not enabled for this company"); e.statusCode = 403; throw e; }
  const sections = result.rows[0]?.fields_json?.sections || [];
  const schemaFields = sections.flatMap(s => s.fields || []);
  return { typeName: result.rows[0].type_name, displayName: result.rows[0].display_name, schemaFields, allowedKeys: new Set(schemaFields.map(f => f.key).filter(Boolean)) };
}

const authenticateAssetPlatform = async (req, res, next) => {
  try {
    const token = String(req.headers["x-asset-platform-token"] || "");
    if (!token) return res.status(401).json({ error: "x-asset-platform-token header required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.scope !== "asset_management" || !decoded.companyId || !decoded.userId) {
      return res.status(403).json({ error: "Invalid asset platform token" });
    }
    await assertAssetManagementEnabled(decoded.companyId);
    const currentUser = await getCurrentAssetSessionUser(decoded.userId);
    if (!currentUser || !currentUser.is_active) return res.status(403).json({ error: "Asset platform user is no longer active" });
    if (currentUser.role !== "super_admin" && String(currentUser.company_id) !== String(decoded.companyId)) {
      return res.status(403).json({ error: "Asset platform session no longer matches this company" });
    }
    if (currentUser.role === "viewer") return res.status(403).json({ error: "Viewers do not have permission to access Asset Management." });
    req.assetContext = { companyId: String(decoded.companyId), userId: currentUser.id, role: currentUser.role };
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") return res.status(401).json({ error: "Asset platform session expired. Open it again from the dashboard." });
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    return res.status(403).json({ error: "Invalid asset platform token" });
  }
};

const requireAssetEditor = (req, res, next) => {
  if (!req.assetContext?.userId || req.assetContext.role === "viewer") {
    return res.status(403).json({ error: "Editor access is required for Asset Management." });
  }
  next();
};

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
  fileFilter: (_, file, cb) => { const allowed = [".svg",".png",".jpg",".jpeg",".webp"]; allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error("Only SVG, PNG, JPG, WebP files are allowed")); },
});

// ─── DID + CANONICAL SERIALIZATION SERVICES ─────────────────────────────────
const didService = createDidService({
  didDomain: process.env.DID_WEB_DOMAIN || "www.claros-dpp.online",
  publicOrigin: process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000",
  apiOrigin: process.env.SERVER_URL || `http://localhost:${PORT}`,
});
const productIdentifierService = createProductIdentifierService({ didService, pool });
const canonicalPassportSerializer = createCanonicalPassportSerializer({ didService, productIdentifierService });
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

// ─── BATTERY DICTIONARY SERVICE ──────────────────────────────────────────────
const batteryDictionaryService = createBatteryDictionaryService();
const complianceService = createComplianceService({ pool, batteryDictionaryService, buildCanonicalPassportPayload });
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
  normalizeProductIdValue, generateProductIdValue, IN_REVISION_STATUS, SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns, getStoredPassportValues, toStoredPassportValue,
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
  getPassportTypeSchema, findExistingPassportByProductId,
  getPassportLineageContext, getPassportVersionsByLineage,
  getCompanyNameMap, stripRestrictedFieldsForPublicView,
  fetchCompanyPassportRecord, resolveReleasedPassportByProductId,
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
  findExistingPassportByProductId, updatePassportRowById, normalizeProductIdValue,
  generateProductIdValue, generateDppRecordId, productIdentifierService, createPassportTable, archivePassportSnapshot,
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
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "[Unhandled Rejection]"));

async function verifySchemaReady() {
  await pool.query(`
    SELECT pr.dpp_id
    FROM passport_registry pr
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
  ASSET_SHARED_SECRET,
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
  oauthService,
  backupProviderService,
  requireAssetManagementKey,
  authenticateAssetPlatform,
  requireAssetEditor,
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
  normalizePassportRow,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  normalizeProductIdValue,
  generateProductIdValue,
  normalizePassportRequestBody,
  extractExplicitFacilityId,
  getWritablePassportColumns,
  getStoredPassportValues,
  toStoredPassportValue,
  coerceBulkFieldValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  isPublicHistoryStatus,
  logAudit,
  getPassportTypeSchema,
  findExistingPassportByProductId,
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
  buildBatteryPassJsonExport,
  storageService,
  complianceService,
  accessRightsService,
  productIdentifierService,
  buildExpandedPassportPayload,
  createPassportTable,
  resolveReleasedPassportByProductId,
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
  generateAssetLaunchToken,
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
