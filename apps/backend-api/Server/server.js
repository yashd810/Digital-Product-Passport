"use strict";
require("dotenv").config();
const express        = require("express");
const { Pool }       = require("pg");
const cors           = require("cors");
const helmet         = require("helmet");
const { v4: uuidv4 } = require("uuid");
const crypto         = require("crypto");
const jwt            = require("jsonwebtoken");
const multer         = require("multer");
const fs             = require("fs");
const path           = require("path");

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

global.console = logger.console;

const {
  IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS,
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

// ─── ROUTE REGISTRATIONS ────────────────────────────────────────────────────
const registerAssetManagementLaunchRoutes = require("../routes/asset-management-launch");
const registerRepositoryRoutes            = require("../routes/repository");
const registerNotificationRoutes          = require("../routes/notifications");
const registerMessagingRoutes             = require("../routes/messaging");
const registerWorkflowRoutes              = require("../routes/workflow");
const registerHealthRoutes                = require("../routes/health");
const registerAuthRoutes                  = require("../routes/auth");
const registerAdminRoutes                 = require("../routes/admin");
const registerAssetManagementApiRoutes    = require("../routes/asset-management-api");
const registerPassportRoutes              = require("../routes/passports");
const registerPassportPublicRoutes        = require("../routes/passport-public");
const registerCompanyRoutes               = require("../routes/company");
const registerDppApiRoutes                = require("../routes/dpp-api");
const registerDictionaryRoutes            = require("../routes/dictionary");

// ─── DIRECTORIES ─────────────────────────────────────────────────────────────
const APP_ROOT_DIR = path.resolve(__dirname, "../../..");
const ASSET_MANAGEMENT_DIR = path.resolve(
  process.env.ASSET_MANAGEMENT_DIR || path.join(APP_ROOT_DIR, "apps", "asset-management")
);
const LOCAL_STORAGE_DIR = path.resolve(
  process.env.LOCAL_STORAGE_DIR || path.join(APP_ROOT_DIR, "storage", "local-storage")
);
const FILES_BASE_DIR = path.resolve(
  process.env.FILES_DIR || path.join(LOCAL_STORAGE_DIR, "passport-files")
);
const REPO_BASE_DIR = path.resolve(
  process.env.REPO_DIR || path.join(LOCAL_STORAGE_DIR, "repository-files")
);
const UPLOADS_BASE_DIR = path.resolve(
  process.env.UPLOADS_DIR || path.join(LOCAL_STORAGE_DIR, "uploads")
);
const GLOBAL_SYMBOLS_DIR = path.join(UPLOADS_BASE_DIR, "symbols");
const PASSPORT_STORAGE_PREFIX = "passport-files/";

const normalizeStorageRequestKey = (value) => {
  const raw = String(value || "").replace(/^\/+/, "").replace(/\\/g, "/");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const isPassportStorageKey = (value) => normalizeStorageRequestKey(value)
  .startsWith(PASSPORT_STORAGE_PREFIX);

const isPlainRecord = (value) =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && !(value instanceof Date)
  && !Buffer.isBuffer(value);

const normalizeIncomingDppIdentifiers = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeIncomingDppIdentifiers(entry));
  }
  if (!isPlainRecord(value)) return value;

  const normalized = {};
  for (const [key, rawEntry] of Object.entries(value)) {
    const entry = normalizeIncomingDppIdentifiers(rawEntry);
    if (key === "dppId") normalized.dpp_id = entry;
    else if (key === "dppIds") normalized.dpp_ids = entry;
    else if (key === "dpp_id") normalized.dpp_id = entry;
    else if (key === "match_dpp_id") normalized.match_dpp_id = entry;
    else if (key === "matched_dpp_id") normalized.matched_dpp_id = entry;
    else if (key === "passportDppId") normalized.passport_dpp_id = entry;
    else if (key === "passport_dpp_id") normalized.passport_dpp_id = entry;
    else normalized[key] = entry;
  }
  return normalized;
};

const normalizeOutgoingDppIdentifiers = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOutgoingDppIdentifiers(entry));
  }
  if (!isPlainRecord(value)) return value;

  const normalized = {};
  for (const [key, rawEntry] of Object.entries(value)) {
    const entry = normalizeOutgoingDppIdentifiers(rawEntry);
    if (key === "dpp_id") normalized.dppId = entry;
    else if (key === "dppIds") normalized.dppIds = entry;
    else if (key === "passportDppId" || key === "passport_dpp_id" || key === "passport_dpp_id") normalized.passportDppId = entry;
    else normalized[key] = entry;
  }
  return normalized;
};

[LOCAL_STORAGE_DIR, FILES_BASE_DIR, REPO_BASE_DIR, GLOBAL_SYMBOLS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── EXPRESS SETUP ───────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;
app.disable("x-powered-by");
app.set("trust proxy", 1);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION) app.set("env", "production");

const defaultAllowedOrigins = IS_PRODUCTION ? [] : [
  "http://localhost:3000", "http://127.0.0.1:3000",
  "http://localhost:5173", "http://127.0.0.1:5173",
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
];
const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const allowedOriginSet = new Set([...defaultAllowedOrigins, ...envAllowedOrigins]);
const cspConnectSrc = ["'self'", ...allowedOriginSet];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOriginSet.has(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      connectSrc: cspConnectSrc,
    },
  },
  crossOriginResourcePolicy: false,
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-XSS-Protection", "1; mode=block");
  }
  next();
});

// CSRF: validate Origin on state-changing requests in production
// API key requests are exempt (machine-to-machine, no cookies)
app.use((req, res, next) => {
  if (!IS_PRODUCTION) return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (req.headers["x-api-key"] || req.headers["x-asset-key"]) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return res.status(403).json({ error: "Forbidden: missing origin header" });
  try {
    const { origin: parsedOrigin } = new URL(origin);
    if (!allowedOriginSet.has(parsedOrigin)) return res.status(403).json({ error: "Forbidden: origin not allowed" });
  } catch {
    return res.status(403).json({ error: "Forbidden: invalid origin header" });
  }
  next();
});

app.use(express.json({
  limit: "10mb",
  type: ["application/json", "application/merge-patch+json"],
}));
app.use((req, res, next) => {
  if (req.body && (Array.isArray(req.body) || isPlainRecord(req.body))) {
    req.body = normalizeIncomingDppIdentifiers(req.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeOutgoingDppIdentifiers(payload));
  next();
});
app.use("/uploads/symbols", express.static(GLOBAL_SYMBOLS_DIR));
app.use("/asset-management", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join("; "));
  next();
}, express.static(ASSET_MANAGEMENT_DIR));

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
const COOKIE_SAME_SITE       = process.env.COOKIE_SAME_SITE || (IS_PRODUCTION ? "strict" : "lax");
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
const ASSET_MATCH_FIELDS = new Set(["dppId", "match_dpp_id", "product_id", "match_product_id", "next_product_id"]);
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

function toBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function assertProductionStorageReadiness() {
  if (!IS_PRODUCTION) return;

  const storageProvider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const allowLocalStorage = toBooleanEnv(process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION, false);
  const allowMissingBackupProvider = toBooleanEnv(process.env.ALLOW_MISSING_BACKUP_PROVIDER_IN_PRODUCTION, false);
  const missing = [];

  if (storageProvider === "local" && !allowLocalStorage) {
    throw new Error("[PRODUCTION] STORAGE_PROVIDER=local is blocked in production. Configure S3-compatible object storage or explicitly set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true for a temporary exception.");
  }

  if (storageProvider === "s3") {
    for (const key of [
      "STORAGE_S3_ENDPOINT",
      "STORAGE_S3_REGION",
      "STORAGE_S3_BUCKET",
      "STORAGE_S3_ACCESS_KEY_ID",
      "STORAGE_S3_SECRET_ACCESS_KEY",
    ]) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (!toBooleanEnv(process.env.BACKUP_PROVIDER_ENABLED, false) && !allowMissingBackupProvider) {
    missing.push("BACKUP_PROVIDER_ENABLED=true");
  }
  if (toBooleanEnv(process.env.BACKUP_PROVIDER_ENABLED, false) && !process.env.BACKUP_PROVIDER_OBJECT_PREFIX) {
    missing.push("BACKUP_PROVIDER_OBJECT_PREFIX");
  }

  if (missing.length) {
    throw new Error(`[PRODUCTION] Storage/DR guard failed. Missing required production storage configuration: ${missing.join(", ")}`);
  }
}

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

assertProductionStorageReadiness();

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
  return jwt.sign({
    userId: user.id || user.userId,
    email: user.email,
    companyId: user.company_id !== undefined ? user.company_id : (user.companyId ?? null),
    role: user.role,
    sessionVersion: user.session_version !== undefined ? user.session_version : (user.sessionVersion ?? 1),
    mfaVerifiedAt: extraClaims.mfaVerifiedAt || null,
    amr: Array.isArray(extraClaims.amr) && extraClaims.amr.length ? extraClaims.amr : ["pwd"],
  }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
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
const clearAuthCookie = (res) => res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, "", { ...authCookieOptions, maxAge: 0, expires: new Date(0) }));

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
    `SELECT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.semantic_model_key, pt.fields_json, pt.is_active
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
if (storageService.isLocal) {
  app.use("/storage", (req, res, next) => {
    const storageKey = normalizeStorageRequestKey(req.path);
    if (isPassportStorageKey(storageKey)) {
      return res.status(404).json({ error: "File not found" });
    }
    next();
  }, express.static(LOCAL_STORAGE_DIR, {
    setHeaders: (res, fp) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (fp.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      } else {
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      }
    },
  }));
  // /passport-files direct static serving is intentionally removed.
  // Passport files must be served through /public-files/:publicId so the app
  // can enforce visibility rules and avoid exposing predictable bucket paths.
  // New uploads store an opaque public_id; legacy files without an attachment
  // record will 404 via /public-files and need to be re-uploaded.
  app.use("/repository-files", express.static(REPO_BASE_DIR, {
    setHeaders: (res, fp) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (fp.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.removeHeader("X-Frame-Options");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      } else {
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      }
    },
  }));
}

const repoUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => file.mimetype === "application/pdf" ? cb(null, true) : cb(new Error("Only PDF files are allowed"), false),
});
const repoSymbolUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { const allowed = [".svg",".png",".jpg",".jpeg",".webp"]; allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error("Only SVG, PNG, JPG, WebP files are allowed")); },
});

if (!storageService.isLocal && storageService.fetchObject) {
  app.get(/^\/storage\/(.+)$/, async (req, res) => {
    const storageKey = normalizeStorageRequestKey(req.params[0]);
    if (!storageKey) return res.status(400).json({ error: "Storage key required" });
    if (isPassportStorageKey(storageKey)) {
      return res.status(404).json({ error: "Stored object not found" });
    }
    try {
      const objectResponse = await storageService.fetchObject(storageKey);
      const contentType = objectResponse.headers.get("content-type");
      const contentLength = objectResponse.headers.get("content-length");
      const cacheControl = objectResponse.headers.get("cache-control");
      const etag = objectResponse.headers.get("etag");

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", storageKey.endsWith(".pdf") ? "cross-origin" : "same-site");
      if (contentType) res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (cacheControl) res.setHeader("Cache-Control", cacheControl);
      if (etag) res.setHeader("ETag", etag);
      if (storageKey.endsWith(".pdf")) {
        res.setHeader("Content-Disposition", "inline");
        res.removeHeader("X-Frame-Options");
      }

      const buffer = Buffer.from(await objectResponse.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      logger.error({ storageKey, err: error }, "[storage] Failed to proxy object");
      res.status(404).json({ error: "Stored object not found" });
    }
  });
}

// ─── DID + CANONICAL SERIALIZATION SERVICES ─────────────────────────────────
const didService = createDidService({
  didDomain: process.env.DID_WEB_DOMAIN || "www.claros-dpp.online",
  publicOrigin: process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000",
  apiOrigin: process.env.SERVER_URL || `http://localhost:${PORT}`,
});
const productIdentifierService = createProductIdentifierService({ didService });
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
  getLatestCompanyPassports, createPassportTable, queryTableStats, submitPassportToWorkflow,
} = passportService;

// ─── ASSET SERVICE ───────────────────────────────────────────────────────────
const assetService = createAssetService({
  pool, getTable, logAudit,
  assertCompanyAssetPassportTypeAccess, assertAssetManagementEnabled, getLatestCompanyPassports,
  findExistingPassportByProductId, updatePassportRowById, normalizeProductIdValue,
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

const rewritePathPrefix = (targetPath, sourceDir, destinationDir) => {
  const nt = path.resolve(targetPath);
  const ns = path.resolve(sourceDir);
  const nd = path.resolve(destinationDir);
  if (nt === ns) return nd;
  if (!nt.startsWith(`${ns}${path.sep}`)) return null;
  return path.join(nd, path.relative(ns, nt));
};

const extractLegacyPassportStorageKey = (rawUrl) => {
  const text = String(rawUrl || "").trim();
  if (!text) return null;

  const parsePathname = (value) => {
    try {
      return decodeURIComponent(new URL(value, process.env.APP_URL || `http://localhost:${PORT}`).pathname || "");
    } catch {
      return value;
    }
  };

  const pathname = parsePathname(text).replace(/\\/g, "/");
  const pathMatch = pathname.match(/(?:^|\/)(passport-files\/[^?#]+)/);
  if (pathMatch?.[1]) return normalizeStorageRequestKey(pathMatch[1]);

  const textMatch = text.replace(/\\/g, "/").match(/(?:^|\/)(passport-files\/[^?#]+)/);
  return textMatch?.[1] ? normalizeStorageRequestKey(textMatch[1]) : null;
};

const migrateRepositoryFilePaths = async () => {
  const legacyRepoDirs = [...new Set([
    path.join(APP_ROOT_DIR, "storage", "local-storage", "repository-files"),
    path.join(APP_ROOT_DIR, "Local Storage", "repository-files"),
    path.join(APP_ROOT_DIR, "backend", "repository-files"),
    path.join(APP_ROOT_DIR, "Backend", "repository-files"),
  ].map(d => path.resolve(d)).filter(d => d !== REPO_BASE_DIR))];

  const rows = await pool.query("SELECT id, file_path FROM company_repository WHERE file_path IS NOT NULL");
  let updated = 0;
  for (const row of rows.rows) {
    let nextPath = null;
    for (const legacyDir of legacyRepoDirs) {
      nextPath = rewritePathPrefix(row.file_path, legacyDir, REPO_BASE_DIR);
      if (nextPath) break;
    }
    if (!nextPath || nextPath === row.file_path) continue;
    await pool.query("UPDATE company_repository SET file_path = $1, updated_at = NOW() WHERE id = $2", [nextPath, row.id]);
    updated += 1;
  }
  if (updated) logger.info(`[storage] Migrated ${updated} company_repository file_path value(s) to ${REPO_BASE_DIR}`);
};

const backfillLegacyPassportAttachmentLinks = async () => {
  const typeRes = await pool.query("SELECT type_name, fields_json FROM passport_types ORDER BY type_name ASC");
  const appUrl = String(
    process.env.PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.SERVER_URL
    || `http://localhost:${PORT}`
  ).replace(/\/+$/, "");

  let attachmentRowsCreated = 0;
  let passportFieldsRewritten = 0;

  for (const typeRow of typeRes.rows) {
    try {
      const fileFields = (typeRow.fields_json?.sections || [])
        .flatMap((section) => section.fields || [])
        .filter((field) => field?.type === "file" && /^[a-z][a-z0-9_]+$/.test(field.key || ""))
        .map((field) => field.key);

      if (!fileFields.length) continue;

      const tableName = getTable(typeRow.type_name);
      const likeClauses = [];
      const params = [];

      for (const fieldKey of fileFields) {
        params.push("%/storage/passport-files/%", "%/passport-files/%", "%passport-files/%");
        const start = params.length - 2;
        likeClauses.push(`(${fieldKey} LIKE $${start} OR ${fieldKey} LIKE $${start + 1} OR ${fieldKey} LIKE $${start + 2})`);
      }

      const candidateRes = await pool.query(
        `SELECT id, dpp_id AS "dppId", company_id, release_status, ${fileFields.join(", ")}
         FROM ${tableName}
         WHERE deleted_at IS NULL
           AND (${likeClauses.join(" OR ")})`,
        params
      );

      for (const row of candidateRes.rows) {
        for (const fieldKey of fileFields) {
          const currentValue = row[fieldKey];
          if (typeof currentValue !== "string" || currentValue.includes("/public-files/")) continue;

          const storageKey = extractLegacyPassportStorageKey(currentValue);
          if (!isPassportStorageKey(storageKey)) continue;

          const filePath = storageService.isLocal && storageService.getLocalAbsolutePath
            ? storageService.getLocalAbsolutePath(storageKey)
            : null;

          const existingAttachmentRes = await pool.query(
            `SELECT public_id
             FROM passport_attachments
             WHERE passport_dpp_id = $1
               AND field_key = $2
               AND (
                 (storage_key IS NOT NULL AND storage_key = $3)
                 OR (file_path IS NOT NULL AND file_path = $4)
               )
             ORDER BY id DESC
             LIMIT 1`,
            [row.dppId, fieldKey, storageKey, filePath]
          );

          let publicId = existingAttachmentRes.rows[0]?.public_id || null;

          if (!publicId) {
            publicId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
            await pool.query(
              `INSERT INTO passport_attachments
                 (public_id, company_id, passport_dpp_id, field_key, file_path, storage_key, storage_provider, file_url, mime_type, is_public)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'application/pdf', $9)`,
              [
                publicId,
                row.company_id,
                row.dppId,
                fieldKey,
                filePath,
                storageKey,
                storageService.provider || null,
                currentValue,
                isPublicHistoryStatus(row.release_status),
              ]
            );
            attachmentRowsCreated += 1;
          }

          const publicFileUrl = `${appUrl}/public-files/${publicId}`;
          if (currentValue !== publicFileUrl) {
            await pool.query(
              `UPDATE ${tableName} SET ${fieldKey} = $1, updated_at = NOW() WHERE id = $2`,
              [publicFileUrl, row.id]
            );
            passportFieldsRewritten += 1;
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error, passportType: typeRow.type_name }, "[storage] Legacy passport file backfill skipped");
    }
  }

  if (attachmentRowsCreated || passportFieldsRewritten) {
    logger.info(`[storage] Backfilled ${attachmentRowsCreated} passport attachment row(s) and rewrote ${passportFieldsRewritten} passport file link(s)`);
  }
};

// ─── STARTUP ─────────────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "[Unhandled Rejection]"));

pool.query("SELECT NOW()")
  .then(async () => {
    await initDb(pool, {
      getTable,
      createPassportTable,
      IN_REVISION_STATUS,
      LEGACY_IN_REVISION_STATUS,
      productIdentifierService,
    });
    logger.info("[DB] Initialized successfully");
    await migrateRepositoryFilePaths();
    await backfillLegacyPassportAttachmentLinks();
    await signingService.loadOrGenerateSigningKey();
    assetService.startAssetManagementScheduler();
  })
  .catch(err => {
    logger.error({ err }, "[DB] Fatal startup error");
    process.exit(1);
  });

// ─── ROUTE REGISTRATIONS ─────────────────────────────────────────────────────

registerAssetManagementLaunchRoutes(app, {
  authenticateToken, checkCompanyAccess, requireEditor,
  assertAssetManagementEnabled, generateAssetLaunchToken, ASSET_SHARED_SECRET,
});

registerRepositoryRoutes(app, {
  pool, fs, path, authenticateToken, checkCompanyAccess, requireEditor, isSuperAdmin,
  repoUpload, repoSymbolUpload, REPO_BASE_DIR, isPathInsideBase, storageService,
});

registerNotificationRoutes(app, { pool, authenticateToken });

registerMessagingRoutes(app, { pool, authenticateToken });

registerWorkflowRoutes(app, {
  pool, authenticateToken, checkCompanyAccess, requireEditor,
  submitPassportToWorkflow, getTable, IN_REVISION_STATUS,
  signPassport, markOlderVersionsObsolete, logAudit, buildCurrentPublicPassportPath,
  createNotification, complianceService, archivePassportSnapshot,
});

registerAuthRoutes(app, {
  pool, jwt, JWT_SECRET, hashPassword, verifyPassword, verifyPasswordAndUpgrade, generateToken, hashOpaqueToken,
  validatePasswordPolicy, PASSWORD_MIN_LENGTH, hashOtpCode, generateOtpCode,
  SESSION_COOKIE_NAME,
  setAuthCookie, clearAuthCookie, sendOtpEmail, createTransporter, brandedEmail,
  logAudit, authRateLimit, otpRateLimit, passwordResetRateLimit, publicReadRateLimit,
  authenticateToken, checkCompanyAccess, oauthService, backupProviderService,
});

registerAdminRoutes(app, {
  pool, multer, authenticateToken, isSuperAdmin, checkCompanyAccess, verifyPassword,
  logAudit, getTable, createPassportTable, queryTableStats, publicReadRateLimit,
  GLOBAL_SYMBOLS_DIR, REPO_BASE_DIR, FILES_BASE_DIR, IN_REVISION_STATUS, IN_REVISION_STATUSES_SQL,
  createTransporter, brandedEmail, storageService,
});

registerAssetManagementApiRoutes(app, {
  pool, requireAssetManagementKey, authenticateAssetPlatform, requireAssetEditor,
  publicReadRateLimit, assetWriteRateLimit, assetSourceFetchRateLimit,
  ASSET_ERP_PRESETS, ASSET_MATCH_FIELDS, IN_REVISION_STATUS,
  assertAssetManagementEnabled, assertCompanyAssetPassportTypeAccess,
  getLatestCompanyPassports, getAssetFieldMap, isPlainObject, normalizePassportRequestBody,
  fetchAssetSourceRecords, prepareAssetPayload, executeAssetPush,
  runAssetManagementJob, recordAssetRun, resolveAssetJobNextRunAt,
});

registerPassportRoutes(app, {
  pool, fs, crypto, authenticateToken, checkCompanyAccess, checkCompanyAdmin,
  requireEditor, authenticateApiKey, requireApiKeyScope, publicReadRateLimit, publicHeavyRateLimit,
  apiKeyReadRateLimit, assetWriteRateLimit, upload,
  hashSecret, createAccessKeyMaterial, createDeviceKeyMaterial,
  IN_REVISION_STATUSES_SQL, EDITABLE_RELEASE_STATUSES_SQL, REVISION_BLOCKING_STATUSES_SQL,
  EDIT_SESSION_TIMEOUT_HOURS, EDIT_SESSION_TIMEOUT_SQL, IN_REVISION_STATUS, SYSTEM_PASSPORT_FIELDS,
  getTable, normalizePassportRow, normalizeReleaseStatus, isEditablePassportStatus,
  normalizeProductIdValue, generateProductIdValue, normalizePassportRequestBody, extractExplicitFacilityId,
  getWritablePassportColumns, getStoredPassportValues, toStoredPassportValue,
  coerceBulkFieldValue, buildCurrentPublicPassportPath, buildInactivePublicPassportPath,
  buildPreviewPassportPath, isPublicHistoryStatus,
  logAudit, getPassportTypeSchema, findExistingPassportByProductId,
  getPassportLineageContext, getPassportVersionsByLineage,
  fetchCompanyPassportRecord, resolveCompanyPreviewPassport,
  archivePassportSnapshot, archivePassportSnapshots,
  updatePassportRowById, buildPassportVersionHistory,
  clearExpiredEditSessions, listActiveEditSessions, markOlderVersionsObsolete,
  verifyAuditLogChain,
  buildAuditLogRootSummary, listAuditLogAnchors, anchorAuditLogRoot,
  stripRestrictedFieldsForPublicView, getCompanyNameMap, queryTableStats,
  submitPassportToWorkflow, signPassport, signPortableDataConstruct: signingService.signPortableDataConstruct,
  buildBatteryPassJsonExport, storageService, complianceService, accessRightsService, productIdentifierService,
  backupProviderService, buildExpandedPassportPayload,
});

registerPassportPublicRoutes(app, {
  pool, crypto, publicReadRateLimit, publicHeavyRateLimit, publicUnlockRateLimit,
  getTable, normalizePassportRow, normalizeProductIdValue,
  buildCurrentPublicPassportPath, buildInactivePublicPassportPath,
  stripRestrictedFieldsForPublicView, getCompanyNameMap,
  resolveReleasedPassportByProductId, resolvePublicPassportByDppId, buildPassportVersionHistory,
  resolvePublicPathToSubjects,
  verifyPassportSignature,
  logAudit,
  buildJsonLdContext: buildPassportJsonLdContext,
  buildBatteryPassJsonExport,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  signingService,
  didService,
});

registerCompanyRoutes(app, {
  pool, authenticateToken, checkCompanyAccess, requireEditor, publicReadRateLimit,
  getTable, getPassportTypeSchema, normalizePassportRequestBody, extractExplicitFacilityId,
  normalizeProductIdValue, normalizeReleaseStatus, isEditablePassportStatus,
  findExistingPassportByProductId, updatePassportRowById,
  getWritablePassportColumns, getStoredPassportValues,
  logAudit, EDITABLE_RELEASE_STATUSES_SQL, SYSTEM_PASSPORT_FIELDS,
  buildBatteryPassJsonExport, productIdentifierService, complianceService, accessRightsService,
});

registerDppApiRoutes(app, {
  pool, publicReadRateLimit, authenticateToken, requireEditor,
  getTable, normalizePassportRow,
  normalizeProductIdValue, extractExplicitFacilityId,
  stripRestrictedFieldsForPublicView, getCompanyNameMap,
  resolveReleasedPassportByProductId,
  signingService,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  buildExpandedDataElement,
  buildPassportJsonLdContext,
  didService,
  dppIdentity,
  productIdentifierService,
  archivePassportSnapshot,
  updatePassportRowById,
  isEditablePassportStatus,
  logAudit,
  accessRightsService,
  normalizePassportRequestBody,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  toStoredPassportValue,
  getPassportTypeSchema,
  findExistingPassportByProductId,
  complianceService,
  backupProviderService,
});

registerDictionaryRoutes(app, { publicReadRateLimit, batteryDictionaryService });

// ─── APP-MEDIATED FILE SERVING ────────────────────────────────────────────────
// Files are served through the app, not directly from storage, so:
//   - storage paths are never exposed in URLs
//   - access can be revoked without changing URLs
//   - visibility rules are enforced at serve-time
app.get("/public-files/:publicId", publicReadRateLimit, async (req, res) => {
  try {
    const { publicId } = req.params;
    if (!/^[a-zA-Z0-9_-]{8,24}$/.test(publicId)) {
      return res.status(400).json({ error: "Invalid file identifier" });
    }

    const row = await pool.query(
      "SELECT * FROM passport_attachments WHERE public_id = $1",
      [publicId]
    );
    if (!row.rows.length) return res.status(404).json({ error: "File not found" });

    const attachment = row.rows[0];

    // Only serve files that are flagged as public (i.e. belong to a released passport)
    if (!attachment.is_public) {
      return res.status(404).json({ error: "File not found" });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Cross-Origin-Resource-Policy", attachment.mime_type === "application/pdf" ? "cross-origin" : "same-site");

    if (storageService.isLocal && attachment.file_path) {
      // Prevent path traversal: resolve and verify the path is inside FILES_BASE_DIR
      const safePath = path.resolve(attachment.file_path);
      if (safePath !== FILES_BASE_DIR && !safePath.startsWith(`${FILES_BASE_DIR}${path.sep}`)) {
        return res.status(404).json({ error: "File not found" });
      }
      if (!fs.existsSync(safePath)) return res.status(404).json({ error: "File not found" });
      const mimeType = attachment.mime_type || "application/octet-stream";
      res.setHeader("Content-Type", mimeType);
      if (mimeType === "application/pdf") {
        res.setHeader("Content-Disposition", "inline");
        res.removeHeader("X-Frame-Options");
      }
      return res.sendFile(safePath);
    }

    if (!storageService.isLocal && storageService.fetchObject && isPassportStorageKey(attachment.storage_key)) {
      // Cloud: proxy stream through app (hides bucket URL from client)
      const objectResponse = await storageService.fetchObject(attachment.storage_key);
      const contentType = objectResponse.headers?.get("content-type") || attachment.mime_type;
      const contentLength = objectResponse.headers?.get("content-length");
      const etag = objectResponse.headers?.get("etag");
      if (contentType) res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (etag) res.setHeader("ETag", etag);
      if (contentType === "application/pdf") {
        res.setHeader("Content-Disposition", "inline");
        res.removeHeader("X-Frame-Options");
      }
      const buffer = Buffer.from(await objectResponse.arrayBuffer());
      return res.send(buffer);
    }

    res.status(404).json({ error: "File not available" });
  } catch (e) {
    logger.error({ err: e }, "[public-files] Failed to serve file");
    res.status(500).json({ error: "Failed to serve file" });
  }
});

registerHealthRoutes(app);

// ─── CONTACT FORM ────────────────────────────────────────────────────────────
app.post("/api/contact", publicReadRateLimit, async (req, res) => {
  try {
    const { first_name, last_name, email, company, sector, service_interest, deadline, message, how_found } = req.body || {};
    if (!first_name || !last_name || !email || !message)
      return res.status(400).json({ error: "first_name, last_name, email, and message are required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email address" });

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.warn("[Contact] ADMIN_EMAIL not set — contact form submission not forwarded");
      return res.json({ ok: true });
    }

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"ClarosDPP Contact" <${process.env.EMAIL_FROM}>`,
      to: adminEmail,
      replyTo: email,
      subject: `New Contact Form Submission — ${first_name} ${last_name}`,
      html: brandedEmail({
        heading: "New Contact Form Submission",
        body: `
          <p><strong>Name:</strong> ${first_name} ${last_name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          ${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}
          ${sector ? `<p><strong>Sector:</strong> ${sector}</p>` : ""}
          ${service_interest ? `<p><strong>Service Interest:</strong> ${service_interest}</p>` : ""}
          ${deadline ? `<p><strong>Compliance Deadline:</strong> ${deadline}</p>` : ""}
          ${how_found ? `<p><strong>How Found:</strong> ${how_found}</p>` : ""}
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        `,
      }),
    });
    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "[Contact] Failed to send contact email");
    res.status(500).json({ error: "Failed to send message. Please email us directly." });
  }
});

app.listen(PORT, () => {
  logger.info(`[Server] Listening on port ${PORT}`);
});
