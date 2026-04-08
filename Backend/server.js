"use strict";
require("dotenv").config();
const express        = require("express");
const { Pool }       = require("pg");
const cors           = require("cors");
const { v4: uuidv4 } = require("uuid");
const crypto         = require("crypto");
const bcrypt         = require("bcryptjs");
const jwt            = require("jsonwebtoken");
const multer         = require("multer");
const nodemailer     = require("nodemailer");
const fs             = require("fs");
const path           = require("path");

const emailStyles = fs.readFileSync(path.join(__dirname, "../src/email-styles.css"), "utf8");
const ASSET_MANAGEMENT_DIR = path.join(__dirname, "asset-management");

const app  = express();
const PORT = process.env.PORT || 3001;
app.disable("x-powered-by");
app.set("trust proxy", 1);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Restrict CORS to known origins; include local dev origins and the backend's own origin
const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];
const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];
const allowedOriginSet = new Set(allowedOrigins);

app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser requests (health checks, server-to-server) and listed origins
    if (!origin || allowedOriginSet.has(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use("/uploads/symbols", express.static(path.join(__dirname, "uploads", "symbols")));
app.use("/asset-management", express.static(ASSET_MANAGEMENT_DIR));

const pool = new Pool({
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

const JWT_SECRET             = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRY             = "7d";
const ASSET_LAUNCH_TOKEN_EXPIRY = process.env.ASSET_LAUNCH_TOKEN_EXPIRY || "2h";
const PEPPER                 = process.env.PEPPER_V1  || "change-this-pepper-in-production";
const CURRENT_PEPPER_VERSION = 1;
const SESSION_COOKIE_NAME    = process.env.SESSION_COOKIE_NAME || "dpp_session";
const COOKIE_SECURE          = process.env.COOKIE_SECURE === "true";
const COOKIE_SAME_SITE       = process.env.COOKIE_SAME_SITE || "lax";
const COOKIE_DOMAIN          = process.env.COOKIE_DOMAIN || "";
const ASSET_SHARED_SECRET    = process.env.ASSET_MANAGEMENT_SHARED_SECRET || "";

if (IS_PRODUCTION) {
  const missingSecrets = [];
  if (!process.env.JWT_SECRET) missingSecrets.push("JWT_SECRET");
  if (!process.env.PEPPER_V1) missingSecrets.push("PEPPER_V1");
  if (missingSecrets.length) {
    throw new Error(`[SECURITY] Missing required production secrets: ${missingSecrets.join(", ")}`);
  }
} else {
  if (!process.env.JWT_SECRET) console.warn("[SECURITY] JWT_SECRET is not set — using insecure default. Set it in .env before deploying.");
  if (!process.env.PEPPER_V1)  console.warn("[SECURITY] PEPPER_V1 is not set — using insecure default. Set it in .env before deploying.");
}

const applyPepper    = (pw) => crypto.createHmac("sha256", PEPPER).update(pw).digest("hex");
const hashPassword   = async (pt) => ({ hash: await bcrypt.hash(applyPepper(pt), 12), pepperVersion: CURRENT_PEPPER_VERSION });
const verifyPassword = (pt, hash) => bcrypt.compare(applyPepper(pt), hash);
const generateToken  = (userId, email, companyId, role) =>
  jwt.sign({ userId, email, companyId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
const hashOpaqueToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const envInt = (name, fallback) => {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const rateLimit = ({ key, limit, windowMs, message }) => async (req, res, next) => {
  const now = Date.now();
  const bucketKey = String(key(req) || "").slice(0, 255);
  if (!bucketKey) return next();

  const resetAt = new Date(now + windowMs);
  const nowDate = new Date(now);

  try {
    const result = await pool.query(
      `INSERT INTO request_rate_limits (bucket_key, count, reset_at, updated_at)
       VALUES ($1, 1, $2, NOW())
       ON CONFLICT (bucket_key) DO UPDATE
       SET count = CASE
             WHEN request_rate_limits.reset_at <= $3 THEN 1
             ELSE request_rate_limits.count + 1
           END,
           reset_at = CASE
             WHEN request_rate_limits.reset_at <= $3 THEN $2
             ELSE request_rate_limits.reset_at
           END,
           updated_at = NOW()
       RETURNING count, reset_at`,
      [bucketKey, resetAt, nowDate]
    );

    const row = result.rows[0];
    if ((row?.count || 0) > limit) {
      return res.status(429).json({ error: message });
    }
    next();
  } catch (err) {
    console.error("[rateLimit] falling back after DB error:", err.message);
    next();
  }
};

const isPathInsideBase = (targetPath, baseDir) => {
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
};

const authRateLimit = rateLimit({
  key: (req) => `auth:${req.ip}:${req.path}:${String(req.body?.email || "").trim().toLowerCase()}`,
  limit: envInt("RATE_LIMIT_AUTH_MAX", 8),
  windowMs: envInt("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000),
  message: "Too many attempts. Please wait a few minutes and try again.",
});

const otpRateLimit = rateLimit({
  key: (req) => `otp:${req.ip}:${req.path}:${String(req.body?.pre_auth_token || "").slice(0, 32)}`,
  limit: envInt("RATE_LIMIT_OTP_MAX", 8),
  windowMs: envInt("RATE_LIMIT_OTP_WINDOW_MS", 15 * 60 * 1000),
  message: "Too many verification attempts. Please log in again in a few minutes.",
});

const passwordResetRateLimit = rateLimit({
  key: (req) => `reset:${req.ip}:${req.path}:${String(req.body?.email || req.body?.token || "").slice(0, 64)}`,
  limit: envInt("RATE_LIMIT_PASSWORD_RESET_MAX", 5),
  windowMs: envInt("RATE_LIMIT_PASSWORD_RESET_WINDOW_MS", 15 * 60 * 1000),
  message: "Too many password reset attempts. Please wait a few minutes and try again.",
});

const publicReadRateLimit = rateLimit({
  key: (req) => `public-read:${req.ip}:${req.path}:${String(req.params?.guid || req.params?.companyId || req.params?.typeName || "")}`,
  limit: envInt("RATE_LIMIT_PUBLIC_READ_MAX", 120),
  windowMs: envInt("RATE_LIMIT_PUBLIC_READ_WINDOW_MS", 60 * 1000),
  message: "Too many public requests. Please slow down and try again shortly.",
});

const publicHeavyRateLimit = rateLimit({
  key: (req) => `public-heavy:${req.ip}:${req.path}:${String(req.params?.guid || "")}`,
  limit: envInt("RATE_LIMIT_PUBLIC_HEAVY_MAX", 20),
  windowMs: envInt("RATE_LIMIT_PUBLIC_HEAVY_WINDOW_MS", 5 * 60 * 1000),
  message: "Too many export requests. Please try again in a few minutes.",
});

const publicUnlockRateLimit = rateLimit({
  key: (req) => `public-unlock:${req.ip}:${req.path}:${String(req.params?.guid || "")}`,
  limit: envInt("RATE_LIMIT_PUBLIC_UNLOCK_MAX", 10),
  windowMs: envInt("RATE_LIMIT_PUBLIC_UNLOCK_WINDOW_MS", 15 * 60 * 1000),
  message: "Too many unlock attempts. Please wait before trying again.",
});

const EDIT_SESSION_TIMEOUT_HOURS = 12;
const EDIT_SESSION_TIMEOUT_SQL = `${EDIT_SESSION_TIMEOUT_HOURS} hours`;
const IN_REVISION_STATUS = "in_revision";
const LEGACY_IN_REVISION_STATUS = "revised";
const IN_REVISION_STATUSES_SQL = `('${IN_REVISION_STATUS}','${LEGACY_IN_REVISION_STATUS}')`;
const EDITABLE_RELEASE_STATUSES_SQL = `('draft','${IN_REVISION_STATUS}','${LEGACY_IN_REVISION_STATUS}')`;
const REVISION_BLOCKING_STATUSES_SQL = `('draft','${IN_REVISION_STATUS}','${LEGACY_IN_REVISION_STATUS}','in_review')`;
const ASSET_MATCH_FIELDS = new Set(["guid", "match_guid", "product_id", "match_product_id", "next_product_id"]);
const ASSET_SCHEDULER_INTERVAL_MS = 60 * 1000;
const ASSET_ERP_PRESETS = [
  {
    key: "generic_rest",
    label: "Generic REST",
    description: "Generic JSON API returning an array or records path.",
    sourceConfig: {
      method: "GET",
      recordPath: "data.items",
      fieldMap: {
        guid: "guid",
        product_id: "product_id",
        model_name: "model_name",
      },
    },
  },
  {
    key: "sap_s4hana_material",
    label: "SAP S/4HANA Material Feed",
    description: "Typical material master style mapping for SAP integrations.",
    sourceConfig: {
      method: "GET",
      recordPath: "d.results",
      fieldMap: {
        Material: "product_id",
        ProductUUID: "guid",
        ProductDescription: "model_name",
        Plant: "facility",
      },
    },
  },
  {
    key: "microsoft_bc_items",
    label: "Business Central Items",
    description: "Business Central item sync using OData-style responses.",
    sourceConfig: {
      method: "GET",
      recordPath: "value",
      fieldMap: {
        id: "guid",
        number: "product_id",
        displayName: "model_name",
        inventoryPostingGroup: "category",
      },
    },
  },
  {
    key: "netsuite_restlet",
    label: "NetSuite Restlet",
    description: "NetSuite restlet payload with items array.",
    sourceConfig: {
      method: "POST",
      recordPath: "items",
      fieldMap: {
        internalId: "guid",
        itemId: "product_id",
        displayName: "model_name",
        location: "facility",
      },
    },
  },
];

const publicScanRateLimit = rateLimit({
  key: (req) => `public-scan:${req.ip}:${String(req.params?.guid || "")}`,
  limit: envInt("RATE_LIMIT_PUBLIC_SCAN_MAX", 30),
  windowMs: envInt("RATE_LIMIT_PUBLIC_SCAN_WINDOW_MS", 60 * 1000),
  message: "Too many scan requests. Please try again shortly.",
});

const devicePushRateLimit = rateLimit({
  key: (req) => `device-push:${req.ip}:${String(req.params?.guid || "")}`,
  limit: envInt("RATE_LIMIT_DEVICE_PUSH_MAX", 120),
  windowMs: envInt("RATE_LIMIT_DEVICE_PUSH_WINDOW_MS", 60 * 1000),
  message: "Too many device updates. Please slow down and try again shortly.",
});

const apiKeyReadRateLimit = rateLimit({
  key: (req) => `api-key:${req.apiKey?.keyId || req.ip}:${req.path}`,
  limit: envInt("RATE_LIMIT_API_KEY_READ_MAX", 300),
  windowMs: envInt("RATE_LIMIT_API_KEY_READ_WINDOW_MS", 60 * 1000),
  message: "API rate limit exceeded. Please reduce request frequency.",
});

const parseCookies = (req) => {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
};

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
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  domain: COOKIE_DOMAIN || undefined,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const requireAssetManagementKey = (req, res, next) => {
  if (!ASSET_SHARED_SECRET) return next();
  const submitted = String(req.headers["x-asset-key"] || req.query.assetKey || "");
  if (!submitted) return res.status(401).json({ error: "x-asset-key header required" });

  const expectedBuf = Buffer.from(String(ASSET_SHARED_SECRET));
  const submittedBuf = Buffer.from(submitted);
  if (expectedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(expectedBuf, submittedBuf)) {
    return res.status(403).json({ error: "Invalid asset key" });
  }
  next();
};

const generateAssetLaunchToken = ({ companyId, userId, role }) =>
  jwt.sign(
    { scope: "asset_management", companyId, userId, role },
    JWT_SECRET,
    { expiresIn: ASSET_LAUNCH_TOKEN_EXPIRY }
  );

async function getCompanyAssetSettings(companyId) {
  const result = await pool.query(
    `SELECT id, company_name, is_active, asset_management_enabled, asset_management_revoked_at
     FROM companies
     WHERE id = $1`,
    [companyId]
  );
  return result.rows[0] || null;
}

async function assertAssetManagementEnabled(companyId) {
  const company = await getCompanyAssetSettings(companyId);
  if (!company) {
    const error = new Error("Company not found");
    error.statusCode = 404;
    throw error;
  }
  if (!company.asset_management_enabled) {
    const error = new Error("Asset Management is not enabled for this company");
    error.statusCode = 403;
    throw error;
  }
  return company;
}

const authenticateAssetPlatform = async (req, res, next) => {
  try {
    const token = String(req.headers["x-asset-platform-token"] || req.query.launchToken || "");
    if (!token) return res.status(401).json({ error: "x-asset-platform-token header required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.scope !== "asset_management" || !decoded.companyId) {
      return res.status(403).json({ error: "Invalid asset platform token" });
    }
    await assertAssetManagementEnabled(decoded.companyId);
    req.assetContext = {
      companyId: String(decoded.companyId),
      userId: decoded.userId || null,
      role: decoded.role || null,
    };
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Asset platform session expired. Open it again from the dashboard." });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(403).json({ error: "Invalid asset platform token" });
  }
};

const setAuthCookie = (res, token) => {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, token, authCookieOptions));
};

const clearAuthCookie = (res) => {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, "", {
    ...authCookieOptions,
    maxAge: 0,
    expires: new Date(0),
  }));
};

/**
 * Returns the shared table name for a passport type.
 * e.g. ev_battery_passports
 * type_name must be lowercase alphanumeric+underscore (validated at creation).
 */
const getTable = (typeName) => {
  if (!typeName) throw new Error("typeName is required for table lookup");
  const safe = String(typeName).replace(/[^a-z0-9_]/g, "_");
  return `${safe}_passports`;
};

const normalizeReleaseStatus = (status) =>
  status === LEGACY_IN_REVISION_STATUS ? IN_REVISION_STATUS : status;

const normalizePassportRow = (row) =>
  row ? { ...row, release_status: normalizeReleaseStatus(row.release_status) } : row;

const toStoredPassportValue = (value) =>
  (Array.isArray(value) || (typeof value === "object" && value !== null))
    ? JSON.stringify(value)
    : value;

const SYSTEM_PASSPORT_FIELDS = new Set([
  "id",
  "guid",
  "company_id",
  "created_by",
  "created_at",
  "passport_type",
  "version_number",
  "release_status",
  "deleted_at",
  "qr_code",
  "created_by_email",
  "first_name",
  "last_name",
  "updated_by",
  "updated_at",
]);

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
  return {
    typeName: typeRes.rows[0].type_name,
    displayName: typeRes.rows[0].display_name,
    schemaFields,
    allowedKeys: new Set(schemaFields.map(field => field.key).filter(Boolean)),
  };
}

function normalizePassportRequestBody(body = {}) {
  const normalized = { ...body };
  if (normalized.passport_type === undefined && normalized.passportType !== undefined) {
    normalized.passport_type = normalized.passportType;
  }
  if (normalized.model_name === undefined && normalized.modelName !== undefined) {
    normalized.model_name = normalized.modelName;
  }
  if (normalized.product_id === undefined && normalized.productId !== undefined) {
    normalized.product_id = normalized.productId;
  }
  delete normalized.passportType;
  delete normalized.modelName;
  delete normalized.productId;
  return normalized;
}

const EDITABLE_PASSPORT_STATUSES = new Set(["draft", IN_REVISION_STATUS]);

const normalizeProductIdValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const generateProductIdValue = (guid) =>
  `PID-${String(guid || "").slice(0, 8)}`;

const isEditablePassportStatus = (status) =>
  EDITABLE_PASSPORT_STATUSES.has(normalizeReleaseStatus(status));

const getWritablePassportColumns = (data, excluded = SYSTEM_PASSPORT_FIELDS) =>
  Object.keys(data).filter((key) =>
    data[key] !== undefined &&
    !excluded.has(key) &&
    /^[a-z][a-z0-9_]+$/.test(key)
  );

const getStoredPassportValues = (keys, data) =>
  keys.map((key) => toStoredPassportValue(data[key]));

async function findExistingPassportByProductId({ tableName, companyId, productId, excludeGuid = null }) {
  if (!productId) return null;
  const params = [companyId, productId];
  let exclusionSql = "";
  if (excludeGuid) {
    params.push(excludeGuid);
    exclusionSql = ` AND guid <> $${params.length}`;
  }
  const existing = await pool.query(
    `SELECT id, guid, product_id, release_status, version_number
     FROM ${tableName}
     WHERE company_id = $1
       AND product_id = $2
       AND deleted_at IS NULL${exclusionSql}
     ORDER BY version_number DESC, updated_at DESC, id DESC
     LIMIT 1`,
    params
  );
  return existing.rows[0] || null;
}

async function updatePassportRowById({ tableName, rowId, userId, data, excluded = SYSTEM_PASSPORT_FIELDS }) {
  const updateCols = getWritablePassportColumns(data, excluded);
  if (!updateCols.length) return [];

  const vals = getStoredPassportValues(updateCols, data);
  const sets = updateCols.map((col, i) => `${col} = $${i + 1}`).join(", ");
  await pool.query(
    `UPDATE ${tableName}
     SET ${sets}, updated_by = $${vals.length + 1}, updated_at = NOW()
     WHERE id = $${vals.length + 2}`,
    [...vals, userId, rowId]
  );
  return updateCols;
}

const coerceBulkFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined) return rawValue;

  if (fieldDef?.type === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }

  if (fieldDef?.type === "table" && typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return rawValue;
    try {
      return JSON.parse(trimmed);
    } catch {
      return rawValue;
    }
  }

  return rawValue;
};

const getHistoryFieldDefs = (typeRow) => {
  const baseFields = [
    { key: "model_name", label: "Model Name", type: "text" },
    { key: "product_id", label: "Serial Number", type: "text" },
  ];
  const schemaFields = (typeRow?.fields_json?.sections || [])
    .flatMap((section) => section.fields || [])
    .filter((field) => field?.key);
  const seen = new Set();
  return [...baseFields, ...schemaFields].filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
};

const formatHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";

  if (fieldDef?.type === "boolean") return rawValue ? "Yes" : "No";
  if (fieldDef?.type === "file") return "File uploaded";
  if (fieldDef?.type === "symbol") return "Symbol updated";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    if (Array.isArray(rows)) {
      const formatted = rows
        .map((row) => Array.isArray(row) ? row.filter(Boolean).join(" | ") : String(row || ""))
        .filter(Boolean)
        .join(" ; ");
      return formatted.length > 180 ? `${formatted.slice(0, 177)}...` : formatted || "—";
    }
  }

  if (typeof rawValue === "object") {
    const json = JSON.stringify(rawValue);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  }

  const text = String(rawValue);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};

const comparableHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  if (fieldDef?.type === "boolean") return rawValue ? "true" : "false";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    return Array.isArray(rows) || (typeof rows === "object" && rows !== null)
      ? JSON.stringify(rows)
      : String(rows);
  }

  return (Array.isArray(rawValue) || (typeof rawValue === "object" && rawValue !== null))
    ? JSON.stringify(rawValue)
    : String(rawValue).trim();
};

const buildPassportVersionHistory = async ({
  guid,
  passportType,
  companyId = null,
  publicOnly = false,
}) => {
  const tableName = getTable(passportType);
  const typeRes = await pool.query(
    "SELECT display_name, fields_json FROM passport_types WHERE type_name = $1",
    [passportType]
  );
  const typeRow = typeRes.rows[0] || null;
  const fieldDefs = getHistoryFieldDefs(typeRow);

  const versionParams = [guid];
  let companyFilter = "";
  if (companyId !== null && companyId !== undefined) {
    versionParams.push(companyId);
    companyFilter = ` AND company_id = $${versionParams.length}`;
  }

  const versionRes = await pool.query(
    `SELECT * FROM ${tableName}
     WHERE guid = $1
       ${companyFilter}
       AND deleted_at IS NULL
     ORDER BY version_number DESC`,
    versionParams
  );
  const versions = versionRes.rows.map(normalizePassportRow);

  const creatorIds = [...new Set(versions.map((row) => row.created_by).filter(Boolean))];
  const creatorMap = new Map();
  if (creatorIds.length) {
    const userRes = await pool.query(
      "SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::int[])",
      [creatorIds]
    );
    userRes.rows.forEach((row) => {
      creatorMap.set(
        row.id,
        `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || `User #${row.id}`
      );
    });
  }

  const visibilityRes = await pool.query(
    `SELECT version_number, is_public
     FROM passport_history_visibility
     WHERE passport_guid = $1`,
    [guid]
  );
  const visibilityMap = new Map(
    visibilityRes.rows.map((row) => [Number(row.version_number), !!row.is_public])
  );

  const ascending = [...versions].sort((a, b) => Number(a.version_number) - Number(b.version_number));
  const previousByVersion = new Map();
  ascending.forEach((version, index) => {
    previousByVersion.set(Number(version.version_number), index > 0 ? ascending[index - 1] : null);
  });

  const latestVersionNumber = versions[0]?.version_number ?? null;
  const history = versions
    .map((version) => {
      const versionNumber = Number(version.version_number);
      const previous = previousByVersion.get(versionNumber) || null;
      const normalizedStatus = normalizeReleaseStatus(version.release_status);
      const defaultPublic = normalizedStatus === "released";
      const isPublic = visibilityMap.has(versionNumber)
        ? visibilityMap.get(versionNumber)
        : defaultPublic;

      if (publicOnly && (!defaultPublic || !isPublic)) return null;

      const changedFields = previous
        ? fieldDefs.flatMap((field) => {
            const beforeComparable = comparableHistoryFieldValue(field, previous[field.key]);
            const afterComparable = comparableHistoryFieldValue(field, version[field.key]);
            if (beforeComparable === afterComparable) return [];
            return [{
              key: field.key,
              label: field.label || field.key,
              before: formatHistoryFieldValue(field, previous[field.key]),
              after: formatHistoryFieldValue(field, version[field.key]),
            }];
          })
        : [];

      return {
        version_number: versionNumber,
        release_status: normalizedStatus,
        created_at: version.created_at,
        updated_at: version.updated_at,
        created_by_name: creatorMap.get(version.created_by) || null,
        is_public: isPublic,
        changed_fields: changedFields,
        change_count: changedFields.length,
        summary: previous
          ? (changedFields.length
              ? `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed from v${previous.version_number}.`
              : `No field changes detected from v${previous.version_number}.`)
          : "Initial version.",
        is_current: versionNumber === Number(latestVersionNumber),
      };
    })
    .filter(Boolean);

  return {
    passportType,
    displayName: typeRow?.display_name || passportType,
    history,
  };
};

/**
 * Creates the shared passport table for a passport type.
 * Called once when a superadmin creates a new passport type.
 */
const createPassportTable = async (typeName) => {
  const tableName = getTable(typeName);

  const typeRes = await pool.query(
    "SELECT fields_json FROM passport_types WHERE type_name = $1",
    [typeName]
  );
  if (!typeRes.rows.length)
    throw new Error(`Passport type '${typeName}' not found in passport_types`);

  const sections = typeRes.rows[0].fields_json?.sections || [];

  // Build type-specific DDL columns from field definitions
  const ddlCols = [];
  for (const section of sections) {
    for (const field of (section.fields || [])) {
      const colType = field.type === "boolean" ? "BOOLEAN DEFAULT false" : "TEXT";
      ddlCols.push(`    ${field.key} ${colType}`);
    }
  }
  const customColsDDL = ddlCols.length ? ",\n" + ddlCols.join(",\n") : "";

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id             SERIAL       PRIMARY KEY,
      guid           UUID         NOT NULL DEFAULT gen_random_uuid(),
      company_id     INTEGER      NOT NULL,
      model_name     VARCHAR(255),
      product_id     VARCHAR(255) NOT NULL,
      release_status VARCHAR(50)  NOT NULL DEFAULT 'draft',
      version_number INTEGER      NOT NULL DEFAULT 1,
      qr_code        TEXT,
      created_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
      updated_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at     TIMESTAMPTZ${customColsDDL}
    )
  `);

  // Revisions share the same GUID across versions, so GUID itself must not be unique.
  // Keep version integrity with a composite unique index instead.
  await pool.query(`
    ALTER TABLE ${tableName}
    DROP CONSTRAINT IF EXISTS ${tableName}_guid_key
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_guid_version_unique
      ON ${tableName}(guid, version_number) WHERE deleted_at IS NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_company
      ON ${tableName}(company_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_guid
      ON ${tableName}(guid) WHERE deleted_at IS NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_status
      ON ${tableName}(release_status) WHERE deleted_at IS NULL
  `);

};

/**
 * Query analytics stats from the shared passport table for a type.
 * Optionally scoped to a single company via companyId.
 */
const queryTableStats = async (typeName, companyId = null) => {
  const tableName = getTable(typeName);
  const params = [];
  let companyFilter = "";
  if (companyId !== null && companyId !== undefined) {
    companyFilter = " AND company_id = $1";
    params.push(companyId);
  }
  const r = await pool.query(`
    SELECT
      COUNT(*)                                              AS total,
      COUNT(CASE WHEN release_status = 'draft'     THEN 1 END) AS draft,
      COUNT(CASE WHEN release_status = 'released'  THEN 1 END) AS released,
      COUNT(CASE WHEN release_status IN ${IN_REVISION_STATUSES_SQL} THEN 1 END) AS revised,
      COUNT(CASE WHEN release_status = 'in_review' THEN 1 END) AS in_review
    FROM ${tableName}
    WHERE deleted_at IS NULL${companyFilter}
  `, params);
  const row = r.rows[0];
  return {
    total:     parseInt(row.total),
    draft:     parseInt(row.draft),
    released:  parseInt(row.released),
    revised:   parseInt(row.revised),
    in_review: parseInt(row.in_review),
  };
};

// ─── DATABASE INIT ──────────────────────────────────────────────────────────
async function initDb() {
  // Core user and company management tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      email            VARCHAR(255) NOT NULL UNIQUE,
      password_hash    VARCHAR(255) NOT NULL,
      first_name       VARCHAR(100),
      last_name        VARCHAR(100),
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      role             VARCHAR(50) NOT NULL DEFAULT 'viewer',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      otp_code         VARCHAR(6),
      otp_expires_at   TIMESTAMPTZ,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
      last_login_at    TIMESTAMPTZ,
      pepper_version   INTEGER NOT NULL DEFAULT 1,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* Add missing columns to existing users table (for migrations) */
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id               SERIAL PRIMARY KEY,
      company_name     VARCHAR(255) NOT NULL UNIQUE,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      asset_management_enabled BOOLEAN NOT NULL DEFAULT false,
      asset_management_revoked_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS asset_management_enabled BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS asset_management_revoked_at TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_types (
      id               SERIAL PRIMARY KEY,
      type_name        VARCHAR(100) NOT NULL UNIQUE,
      display_name     VARCHAR(255) NOT NULL,
      umbrella_category VARCHAR(100),
      umbrella_icon    VARCHAR(10) DEFAULT '📋',
      fields_json      JSONB NOT NULL DEFAULT '{"sections":[]}',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action           VARCHAR(100) NOT NULL,
      table_name       VARCHAR(100),
      record_id        VARCHAR(100),
      old_values       JSONB,
      new_values       JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      id               SERIAL PRIMARY KEY,
      token            VARCHAR(36) NOT NULL UNIQUE,
      email            VARCHAR(255) NOT NULL,
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      invited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role_to_assign   VARCHAR(50) NOT NULL DEFAULT 'editor',
      used             BOOLEAN NOT NULL DEFAULT false,
      expires_at       TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_registry (
      guid           UUID        PRIMARY KEY,
      company_id     INTEGER     NOT NULL,
      passport_type  VARCHAR(50) NOT NULL,
      access_key     VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
      device_api_key VARCHAR(64) NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry(company_id)
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_umbrella ON passport_types(umbrella_category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_active   ON passport_types(is_active)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_passport_access (
      id               SERIAL PRIMARY KEY,
      company_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type_id INT NOT NULL REFERENCES passport_types(id) ON DELETE CASCADE,
      access_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
      granted_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, passport_type_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cpa_company ON company_passport_access(company_id)`);

  // Umbrella categories — standalone managed table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS umbrella_categories (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      icon       VARCHAR(10)  NOT NULL DEFAULT '📋',
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // Seed from existing passport_types so nothing is orphaned
  await pool.query(`
    INSERT INTO umbrella_categories (name, icon)
    SELECT DISTINCT umbrella_category, COALESCE(umbrella_icon, '📋')
    FROM passport_types
    WHERE umbrella_category IS NOT NULL
    ON CONFLICT (name) DO NOTHING
  `);

  // Company file repository
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_repository (
      id         SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      parent_id  INT REFERENCES company_repository(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      type       VARCHAR(10)  NOT NULL DEFAULT 'file',
      file_path  TEXT,
      file_url   TEXT,
      mime_type  VARCHAR(100),
      size_bytes BIGINT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_repo_company_parent
      ON company_repository(company_id, parent_id)
  `);

  // Global symbol repository (super-admin managed, visible to all users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS symbols (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      category   VARCHAR(50)  NOT NULL DEFAULT 'General',
      file_url   TEXT         NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      is_active  BOOLEAN      NOT NULL DEFAULT true
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_symbols_category ON symbols(category)`);

  // Private API keys (company-scoped, for programmatic read access via /api/v1/)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           SERIAL PRIMARY KEY,
      company_id   INT          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name         VARCHAR(100) NOT NULL,
      key_hash     VARCHAR(64)  NOT NULL UNIQUE,
      key_prefix   VARCHAR(16)  NOT NULL,
      created_by   INT REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      is_active    BOOLEAN      NOT NULL DEFAULT true
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_rate_limits (
      bucket_key VARCHAR(255) PRIMARY KEY,
      count      INTEGER NOT NULL DEFAULT 0,
      reset_at   TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_request_rate_limits_reset_at
      ON request_rate_limits(reset_at)
  `);
  await pool.query(`
    DELETE FROM request_rate_limits
    WHERE reset_at <= NOW()
  `);

  // Company-managed branding for public passport viewer and consumer pages
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  // Dynamic field values — time-series: every push appends a new row, nothing is ever overwritten
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_dynamic_values (
      id            SERIAL       PRIMARY KEY,
      passport_guid UUID         NOT NULL,
      field_key     VARCHAR(100) NOT NULL,
      value         TEXT,
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport ON passport_dynamic_values(passport_guid)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport_field
      ON passport_dynamic_values(passport_guid, field_key, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_management_jobs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type    VARCHAR(100) NOT NULL,
      name             VARCHAR(255) NOT NULL,
      source_kind      VARCHAR(40) NOT NULL DEFAULT 'manual',
      source_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
      records_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
      options_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      start_at         TIMESTAMPTZ,
      interval_minutes INTEGER,
      next_run_at      TIMESTAMPTZ,
      last_run_at      TIMESTAMPTZ,
      last_status      VARCHAR(30),
      last_summary     JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_company
      ON asset_management_jobs(company_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_due
      ON asset_management_jobs(next_run_at)
      WHERE is_active = true
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_management_runs (
      id             SERIAL PRIMARY KEY,
      job_id         INTEGER REFERENCES asset_management_jobs(id) ON DELETE SET NULL,
      company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      passport_type  VARCHAR(100),
      trigger_type   VARCHAR(40) NOT NULL,
      source_kind    VARCHAR(40),
      status         VARCHAR(30) NOT NULL,
      summary_json   JSONB,
      request_json   JSONB,
      generated_json JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_runs_company
      ON asset_management_runs(company_id, created_at DESC)
  `);
  // Digital signatures — one row per released passport version
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_signatures (
      id             SERIAL       PRIMARY KEY,
      passport_guid  UUID         NOT NULL,
      version_number INTEGER      NOT NULL DEFAULT 1,
      data_hash      TEXT         NOT NULL,
      signature      TEXT         NOT NULL,
      algorithm      VARCHAR(50)  NOT NULL DEFAULT 'RSA-SHA256',
      signing_key_id VARCHAR(64)  NOT NULL,
      released_at    TIMESTAMPTZ  NOT NULL,
      signed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      vc_json        TEXT,
      UNIQUE (passport_guid, version_number)
    )
  `);
  // Store public keys so verifiers can always look them up by key ID
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_signing_keys (
      key_id     VARCHAR(64) PRIMARY KEY,
      public_key TEXT        NOT NULL,
      algorithm  VARCHAR(50) NOT NULL DEFAULT 'RSA-SHA256',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // One in-progress draft per super-admin user
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_type_drafts (
      id          SERIAL      PRIMARY KEY,
      user_id     INTEGER     NOT NULL UNIQUE,
      draft_json  JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_edit_sessions (
      id               SERIAL PRIMARY KEY,
      passport_guid    UUID         NOT NULL,
      company_id       INTEGER      NOT NULL,
      passport_type    VARCHAR(100) NOT NULL,
      user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (passport_guid, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_passport
      ON passport_edit_sessions(passport_guid, last_activity_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_user
      ON passport_edit_sessions(user_id)
  `);

  // Notifications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id               SERIAL      PRIMARY KEY,
      user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type             VARCHAR(50) NOT NULL,
      title            VARCHAR(255) NOT NULL,
      message          TEXT,
      passport_guid    UUID,
      action_url       VARCHAR(500),
      read             BOOLEAN     DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_read
      ON notifications(user_id, read)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batches (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      passport_type     VARCHAR(100),
      requested_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scope_type        VARCHAR(50) NOT NULL DEFAULT 'selected',
      scope_meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      revision_note     TEXT,
      changes_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
      submit_to_workflow BOOLEAN NOT NULL DEFAULT false,
      reviewer_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approver_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_targeted    INTEGER NOT NULL DEFAULT 0,
      revised_count     INTEGER NOT NULL DEFAULT 0,
      skipped_count     INTEGER NOT NULL DEFAULT 0,
      failed_count      INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revision_batches_company_created
      ON passport_revision_batches(company_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batch_items (
      id                    SERIAL PRIMARY KEY,
      batch_id              INTEGER NOT NULL REFERENCES passport_revision_batches(id) ON DELETE CASCADE,
      passport_guid         UUID NOT NULL,
      passport_type         VARCHAR(100) NOT NULL,
      source_version_number INTEGER,
      new_version_number    INTEGER,
      status                VARCHAR(30) NOT NULL,
      message               TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revision_batch_items_batch
      ON passport_revision_batch_items(batch_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_history_visibility (
      passport_guid   UUID NOT NULL,
      version_number  INTEGER NOT NULL,
      is_public       BOOLEAN NOT NULL DEFAULT true,
      updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (passport_guid, version_number)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_history_visibility_guid
      ON passport_history_visibility(passport_guid, version_number DESC)
  `);

  // Ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query("SELECT type_name FROM passport_types");
  for (const { type_name } of ptRows.rows) {
    await createPassportTable(type_name).catch(e =>
      console.warn(`[initDb] Could not create table for ${type_name}:`, e.message)
    );
  }

  for (const { type_name } of ptRows.rows) {
    const tableName = getTable(type_name);
    try {
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = $1
         WHERE release_status = $2`,
        [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
      );
    } catch (e) {
      console.warn(`[initDb] Could not normalize revision status for ${type_name}:`, e.message);
    }
  }

  try {
    const legacyDinSpecCol = await pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'din_spec_99100_passports'
        AND column_name = 'carbon_footprint_performance_class'
      LIMIT 1
    `);

    if (legacyDinSpecCol.rows.length) {
      await pool.query(`
        UPDATE din_spec_99100_passports
        SET carbon_footprint_label_and_performance_class =
          COALESCE(NULLIF(TRIM(carbon_footprint_label_and_performance_class), ''), NULLIF(TRIM(carbon_footprint_performance_class), ''))
        WHERE carbon_footprint_performance_class IS NOT NULL
      `);

      await pool.query(`
        ALTER TABLE din_spec_99100_passports
        DROP COLUMN IF EXISTS carbon_footprint_performance_class
      `);
    }
  } catch (e) {
    console.warn("[initDb] Could not finalize DIN SPEC carbon footprint label/performance-class migration:", e.message);
  }

  await pool.query(
    `UPDATE passport_workflow
     SET previous_release_status = $1
     WHERE previous_release_status = $2`,
    [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
  ).catch((e) => {
    console.warn("[initDb] Could not normalize workflow revision status:", e.message);
  });
}

async function clearExpiredEditSessions() {
  await pool.query(
    `DELETE FROM passport_edit_sessions
     WHERE last_activity_at < NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'`
  );
}

async function listActiveEditSessions(passportGuid, currentUserId = null) {
  await clearExpiredEditSessions();
  const params = [passportGuid];
  let currentUserFilter = "";
  if (currentUserId) {
    params.push(currentUserId);
    currentUserFilter = ` AND pes.user_id <> $${params.length}`;
  }
  const res = await pool.query(
    `SELECT
       pes.user_id,
       pes.last_activity_at,
       u.first_name,
       u.last_name,
       u.email
     FROM passport_edit_sessions pes
     JOIN users u ON u.id = pes.user_id
     WHERE pes.passport_guid = $1
       AND pes.last_activity_at >= NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'
       ${currentUserFilter}
     ORDER BY pes.last_activity_at DESC`,
    params
  );
  return res.rows.map((row) => ({
    user_id: row.user_id,
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    email: row.email,
    last_activity_at: row.last_activity_at,
  }));
}

process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]", reason);
});

pool.query("SELECT NOW()")
  .then(async () => {
    await initDb();
    console.log("[DB] Initialized successfully");
    await loadOrGenerateSigningKey();
    startAssetManagementScheduler();
  })
  .catch(err => {
    console.error("[DB] Fatal startup error:", err.message);
    console.error(err.stack);
    process.exit(1);
  });

// ─── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME] || (req.headers["authorization"] || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(403).json({ error: "Invalid or expired token" }); }
};

const isSuperAdmin = (req, res, next) =>
  req.user.role === "super_admin" ? next()
    : res.status(403).json({ error: "Super Admin access required" });

const checkCompanyAccess = (req, res, next) => {
  if (req.user.role === "super_admin") return next();
  if (String(req.user.companyId) !== String(req.params.companyId))
    return res.status(403).json({ error: "Unauthorised access to this company" });
  next();
};

const requireEditor = (req, res, next) => {
  if (req.user?.role === "viewer")
    return res.status(403).json({ error: "Viewers do not have permission to perform this action." });
  next();
};

// Requires company_admin (or super_admin) for the requested companyId
const checkCompanyAdmin = (req, res, next) => {
  if (req.user.role === "super_admin") return next();
  if (req.user.role !== "company_admin")
    return res.status(403).json({ error: "Company admin access required" });
  if (String(req.user.companyId) !== String(req.params.companyId))
    return res.status(403).json({ error: "Unauthorised access to this company" });
  next();
};

// API-key authentication (used by /api/v1/ endpoints)
const authenticateApiKey = async (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ error: "API key required. Send it via the X-API-Key header." });
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  try {
    const r = await pool.query(
      "SELECT id, company_id FROM api_keys WHERE key_hash = $1 AND is_active = true",
      [keyHash]
    );
    if (!r.rows.length) return res.status(401).json({ error: "Invalid or revoked API key." });
    // Update last_used_at without blocking the request
    pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [r.rows[0].id]).catch(() => {});
    req.apiKey = { keyId: r.rows[0].id, companyId: String(r.rows[0].company_id) };
    next();
  } catch (e) {
    console.error("API key auth error:", e.message);
    res.status(500).json({ error: "Authentication error" });
  }
};

// ─── EMAIL ─────────────────────────────────────────────────────────────────
const createTransporter = () => nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || "smtp.sendgrid.net",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true" || false, // SendGrid uses STARTTLS
  auth:   { user: process.env.EMAIL_USER || "apikey", pass: process.env.EMAIL_PASS }, // API key as password
});

const brandedEmail = ({ preheader, bodyHtml }) => `
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${emailStyles}</style></head><body>
<div class="wrapper">
  <div class="hdr">
    <div class="hdr-logo">🌍</div>
    <h1 class="hdr-title">Digital Product Passport</h1>
    <p class="hdr-sub">${preheader}</p>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} Digital Product Passport System. All rights reserved.</p>
    <p>You received this because you are part of a DPP workflow.</p>
  </div>
</div></body></html>`;

// ─── FILE STORAGE ───────────────────────────────────────────────────────────
const FILES_BASE_DIR = process.env.FILES_DIR || path.join(__dirname, "passport-files");
if (!fs.existsSync(FILES_BASE_DIR)) fs.mkdirSync(FILES_BASE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(FILES_BASE_DIR, req.params.guid);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const key = req.body.fieldKey || "file";
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${key}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype === "application/pdf" ? cb(null, true)
      : cb(new Error("Only PDF files are allowed"), false),
});
app.use("/passport-files", express.static(FILES_BASE_DIR, {
  setHeaders: (res, fp) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (fp.endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
    }
  },
}));

// ─── REPOSITORY FILE STORAGE ────────────────────────────────────────────────
const REPO_BASE_DIR = process.env.REPO_DIR || path.join(__dirname, "repository-files");
if (!fs.existsSync(REPO_BASE_DIR)) fs.mkdirSync(REPO_BASE_DIR, { recursive: true });

const repoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(REPO_BASE_DIR, String(req.params.companyId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${uuidv4()}${ext}`);
  },
});
const repoUpload = multer({
  storage: repoStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype === "application/pdf" ? cb(null, true)
      : cb(new Error("Only PDF files are allowed"), false),
});

const repoSymbolStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(REPO_BASE_DIR, String(req.params.companyId), "symbols");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const repoSymbolUpload = multer({
  storage: repoSymbolStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Only SVG, PNG, JPG, WebP files are allowed"));
  },
});
app.use("/repository-files", express.static(REPO_BASE_DIR, {
  setHeaders: (res, fp) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (fp.endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      // Allow PDFs to be embedded in iframes from the frontend origin
      res.removeHeader("X-Frame-Options");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    } else {
      res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    }
  },
}));

// ─── AAS (Asset Administration Shell) BUILDER ───────────────────────────────
// Implements IDTA Metamodel Part 1 v3.0 — produces compliant AAS JSON-LD export

function aasIdShort(str) {
  // idShort must match [a-zA-Z][a-zA-Z0-9_]* per AAS spec
  const s = String(str || "field").replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(s) ? s : "f_" + s;
}

function aasSemanticId(iri) {
  if (!iri) return undefined;
  return { type: "ExternalReference", keys: [{ type: "GlobalReference", value: iri }] };
}

function aasFieldElement(field, value) {
  const idShort   = aasIdShort(field.key);
  const semanticId = aasSemanticId(field.semanticId);
  const base = { idShort, ...(semanticId && { semanticId }) };

  if (field.type === "boolean") {
    return { ...base, modelType: "Property", valueType: "xs:boolean",
      value: (value === true || value === "true" || value === "1") ? "true" : "false" };
  }
  if (field.type === "file") {
    const ct = (value || "").endsWith(".pdf") ? "application/pdf"
      : (value || "").match(/\.(png|jpg|jpeg|webp)$/i) ? "image/" + value.split(".").pop().toLowerCase()
      : "application/octet-stream";
    return { ...base, modelType: "File", contentType: ct, value: value || "" };
  }
  if (field.type === "table") {
    let rows = [];
    try { rows = value ? JSON.parse(value) : []; } catch {}
    const cols = field.table_columns || [];
    const elements = Array.isArray(rows) ? rows.map((row, ri) => ({
      modelType: "SubmodelElementCollection",
      idShort: `Row_${ri + 1}`,
      value: (Array.isArray(row) ? row : []).map((cell, ci) => ({
        modelType: "Property",
        idShort: aasIdShort(cols[ci] || `Col_${ci + 1}`),
        valueType: "xs:string",
        value: String(cell ?? ""),
      })),
    })) : [];
    return { ...base, modelType: "SubmodelElementCollection", value: elements };
  }
  // text / textarea / default
  return { ...base, modelType: "Property", valueType: "xs:string",
    value: value !== null && value !== undefined ? String(value) : "" };
}

function buildAasExport(passport, typeDef, dynamicValues, companyName) {
  const guid        = passport.guid;
  const slug        = (companyName || "company").toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
  const base        = `urn:dpp:${slug}`;
  const aasId       = `${base}:aas:${guid}`;
  const globalAsset = `${base}:asset:${guid}`;
  const sections    = typeDef?.fields_json?.sections || [];

  const smRefs = [];
  const submodels = [];

  // ── Nameplate submodel (always first) ────────────────────────
  const nameplateId = `${base}:sm:${guid}:nameplate`;
  smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: nameplateId }] });
  submodels.push({
    modelType: "Submodel",
    id: nameplateId,
    idShort: "Nameplate",
    semanticId: aasSemanticId("https://admin-shell.io/zvei/nameplate/2/0/Nameplate"),
    description: [{ language: "en", text: "Digital Nameplate per IDTA 02006-2-0" }],
    administration: { version: String(passport.version_number || 1), revision: "0" },
    submodelElements: [
      { modelType: "Property", idShort: "ManufacturerName",
        ...(process.env.AAS_SEM_MANUFACTURER_NAME       && { semanticId: aasSemanticId(process.env.AAS_SEM_MANUFACTURER_NAME) }),
        valueType: "xs:string", value: companyName || "" },
      { modelType: "Property", idShort: "ManufacturerProductDesignation",
        ...(process.env.AAS_SEM_PRODUCT_DESIGNATION     && { semanticId: aasSemanticId(process.env.AAS_SEM_PRODUCT_DESIGNATION) }),
        valueType: "xs:string", value: passport.model_name || "" },
      { modelType: "Property", idShort: "SerialNumber",
        ...(process.env.AAS_SEM_SERIAL_NUMBER           && { semanticId: aasSemanticId(process.env.AAS_SEM_SERIAL_NUMBER) }),
        valueType: "xs:string", value: passport.product_id || "" },
      { modelType: "Property", idShort: "PassportType",
        valueType: "xs:string", value: typeDef?.display_name || passport.passport_type || "" },
      { modelType: "Property", idShort: "ReleaseStatus",
        valueType: "xs:string", value: passport.release_status || "draft" },
      { modelType: "Property", idShort: "DateOfManufacture",
        ...(process.env.AAS_SEM_DATE_OF_MANUFACTURE     && { semanticId: aasSemanticId(process.env.AAS_SEM_DATE_OF_MANUFACTURE) }),
        valueType: "xs:string",
        value: passport.created_at ? new Date(passport.created_at).toISOString().split("T")[0] : "" },
    ],
  });

  // ── One submodel per section ──────────────────────────────────
  for (const section of sections) {
    const smId = `${base}:sm:${guid}:${section.key}`;
    smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: smId }] });
    const elements = (section.fields || []).map(field => {
      const raw = field.dynamic
        ? (dynamicValues?.[field.key]?.value ?? null)
        : (passport[field.key] ?? null);
      return aasFieldElement(field, raw);
    });
    submodels.push({
      modelType: "Submodel",
      id: smId,
      idShort: aasIdShort(section.key),
      description: [{ language: "en", text: section.label }],
      ...(section.semanticId && { semanticId: aasSemanticId(section.semanticId) }),
      administration: { version: String(passport.version_number || 1), revision: "0" },
      submodelElements: elements,
    });
  }

  // ── OperationalData submodel (IoT dynamic values) ─────────────
  const dynKeys = Object.keys(dynamicValues || {});
  if (dynKeys.length > 0) {
    const opId = `${base}:sm:${guid}:operational_data`;
    smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: opId }] });
    submodels.push({
      modelType: "Submodel",
      id: opId,
      idShort: "OperationalData",
      semanticId: aasSemanticId("https://admin-shell.io/idta/operationaldata/1/0"),
      description: [{ language: "en", text: "Live IoT device values" }],
      submodelElements: dynKeys.map(key => ({
        modelType: "Property",
        idShort: aasIdShort(key),
        valueType: "xs:string",
        value: String(dynamicValues[key]?.value ?? ""),
        description: [{ language: "en",
          text: `Last updated: ${dynamicValues[key]?.updatedAt || "unknown"}` }],
      })),
    });
  }

  return {
    assetAdministrationShells: [{
      modelType: "AssetAdministrationShell",
      id: aasId,
      idShort: aasIdShort(`Passport_${(passport.model_name || guid).replace(/\s+/g, "_")}`),
      description: [{ language: "en",
        text: `Digital Product Passport — ${passport.model_name || guid}` }],
      administration: { version: String(passport.version_number || 1), revision: "0" },
      assetInformation: {
        assetKind: "Instance",
        globalAssetId: globalAsset,
        specificAssetIds: passport.product_id ? [{
          name: "serialNumber", value: passport.product_id,
          externalSubjectId: { type: "ExternalReference",
            keys: [{ type: "GlobalReference", value: globalAsset }] },
        }] : [],
      },
      submodels: smRefs,
    }],
    submodels,
    conceptDescriptions: [],
  };
}

// ─── DIGITAL SIGNATURE ──────────────────────────────────────────────────────
// Uses RSA-SHA256 with a 2048-bit key.
// Private key: env var SIGNING_PRIVATE_KEY (PEM).  Never stored in DB.
// Public key:  stored in passport_signing_keys table and exposed via /api/signing-key.

let _signingKey = null; // { privateKey, publicKey, keyId }

async function loadOrGenerateSigningKey() {
  const privPem = process.env.SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const pubPem  = process.env.SIGNING_PUBLIC_KEY?.replace(/\\n/g, "\n");

  if (privPem && pubPem) {
    const keyId = crypto.createHash("sha256").update(pubPem).digest("hex").slice(0, 16);
    _signingKey = { privateKey: privPem, publicKey: pubPem, keyId };
    console.log("[Signing] Loaded key from environment. Key ID:", keyId);
  } else {
    console.warn("[Signing] SIGNING_PRIVATE_KEY not set — generating ephemeral key pair.");
    console.warn("[Signing] Set SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY env vars for production!");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding:  { type: "spki",  format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyId = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
    _signingKey = { privateKey, publicKey, keyId };
    console.log("[Signing] Ephemeral key generated. Key ID:", keyId);
  }

  // Persist public key to DB so it survives key rotation look-ups
  await pool.query(
    `INSERT INTO passport_signing_keys (key_id, public_key, algorithm)
     VALUES ($1, $2, 'RSA-SHA256') ON CONFLICT (key_id) DO NOTHING`,
    [_signingKey.keyId, _signingKey.publicKey]
  ).catch(() => {});
}

// Canonical, deterministic JSON — alphabetically sorted keys at all levels
function canonicalJSON(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(val).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJSON(val[k])).join(",") + "}";
}

// Derives the issuer DID from APP_URL env var
function issuerDid() {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const domain = new URL(appUrl).host;
  return `did:web:${domain}`;
}

// Builds a W3C Verifiable Credential (without proof) from passport data
function buildVC(passport, typeDef, releasedAt) {
  const appUrl  = process.env.APP_URL || "http://localhost:3001";
  const did     = issuerDid();
  const sections = typeDef?.fields_json?.sections || [];
  const fields  = {};
  for (const section of sections) {
    for (const field of (section.fields || [])) {
      if (field.dynamic) continue; // live IoT values are not part of the immutable record
      const v = passport[field.key];
      if (v !== null && v !== undefined && v !== "") fields[field.key] = String(v);
    }
  }
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id:           `${appUrl}/passport/${passport.guid}/credential/v${passport.version_number}`,
    type:         ["VerifiableCredential", "DigitalProductPassport"],
    issuer:       did,
    issuanceDate: releasedAt,
    credentialSubject: {
      id:            `${appUrl}/passport/${passport.guid}`,
      passportType:  passport.passport_type,
      modelName:     passport.model_name  || null,
      productId:     passport.product_id  || null,
      companyId:     String(passport.company_id),
      versionNumber: passport.version_number,
      ...fields,
    },
  };
}

// Creates a compact JWS (RS256) over canonical JSON of the VC (without proof).
// Returns { header, sigB64url } so callers can reassemble the JWS string.
function createJws(vcWithoutProof, privateKeyPem) {
  const header   = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload  = Buffer.from(canonicalJSON(vcWithoutProof)).toString("base64url");
  const signer   = crypto.createSign("SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const sigB64url = signer.sign(privateKeyPem, "base64url");
  return `${header}.${payload}.${sigB64url}`;
}

async function signPassport(passport, typeDef) {
  if (!_signingKey) return null;
  const releasedAt = new Date().toISOString();
  const did        = issuerDid();

  const vc       = buildVC(passport, typeDef, releasedAt);
  const dataHash = crypto.createHash("sha256").update(canonicalJSON(vc)).digest("hex");
  const jws      = createJws(vc, _signingKey.privateKey);

  const vcWithProof = {
    ...vc,
    proof: {
      type:               "JsonWebSignature2020",
      created:            releasedAt,
      verificationMethod: `${did}#key-1`,
      proofPurpose:       "assertionMethod",
      jws,
    },
  };

  return {
    dataHash,
    signature:  jws.split(".")[2],   // raw sig component for backwards-compat column
    keyId:      _signingKey.keyId,
    releasedAt,
    vcJson:     JSON.stringify(vcWithProof),
  };
}

async function verifyPassportSignature(guid, versionNumber) {
  const sigRow = await pool.query(
    "SELECT * FROM passport_signatures WHERE passport_guid = $1 AND version_number = $2",
    [guid, versionNumber]
  );
  if (!sigRow.rows.length) return { status: "unsigned" };
  const sig = sigRow.rows[0];

  // Load public key
  const keyRow = await pool.query(
    "SELECT public_key FROM passport_signing_keys WHERE key_id = $1", [sig.signing_key_id]
  );
  if (!keyRow.rows.length) return { status: "key_missing", signedAt: sig.signed_at, keyId: sig.signing_key_id };
  const publicKeyPem = keyRow.rows[0].public_key;

  // ── VC-based verification (new path) ──────────────────────────────────
  if (sig.vc_json) {
    try {
      const vcWithProof = JSON.parse(sig.vc_json);
      const { proof, ...vcWithoutProof } = vcWithProof;
      if (!proof?.jws) return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };

      // 1. Recompute hash of VC-without-proof and compare to stored hash
      const currentHash = crypto.createHash("sha256").update(canonicalJSON(vcWithoutProof)).digest("hex");
      if (currentHash !== sig.data_hash) {
        return { status: "tampered", signedAt: sig.signed_at, keyId: sig.signing_key_id, releasedAt: sig.released_at };
      }

      // 2. Verify JWS: reconstruct sigInput from stored VC and check signature
      const jwsParts = proof.jws.split(".");
      if (jwsParts.length !== 3) return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
      const [jwsHeader, jwsPayload, jwsSig] = jwsParts;

      const verifier = crypto.createVerify("SHA256");
      verifier.update(`${jwsHeader}.${jwsPayload}`);
      verifier.end();
      const valid = verifier.verify(publicKeyPem, Buffer.from(jwsSig, "base64url"));

      return {
        status:       valid ? "valid" : "invalid",
        signedAt:     sig.signed_at,
        keyId:        sig.signing_key_id,
        dataHash:     sig.data_hash,
        releasedAt:   sig.released_at,
        algorithm:    "JsonWebSignature2020",
        issuer:       vcWithoutProof.issuer,
        credentialId: vcWithoutProof.id,
      };
    } catch {
      return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
    }
  }

  return {
    status: "invalid",
    signedAt: sig.signed_at,
    keyId: sig.signing_key_id,
    releasedAt: sig.released_at,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
const logAudit = async (companyId, userId, action, tableName, passportGuid, oldData, newData) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (company_id,user_id,action,table_name,record_id,old_values,new_values)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [companyId || null, userId || null, action, tableName, passportGuid || null,
       oldData ? JSON.stringify(oldData) : null,
       newData ? JSON.stringify(newData) : null]
    );
  } catch (e) { console.error("Audit log error (non-fatal):", e.message); }
};

const createNotification = async (userId, type, title, message, passportGuid, actionUrl) => {
  if (!userId) return;
  try {
    await pool.query(
      `INSERT INTO notifications (user_id,type,title,message,passport_guid,action_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, title, message || null, passportGuid || null, actionUrl || null]
    );
  } catch (e) { console.error("Notification error (non-fatal):", e.message); }
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getAssetFieldMap = (typeSchema) => {
  const map = new Map();
  [
    { key: "guid", label: "Passport GUID", type: "text", system: true },
    { key: "product_id", label: "Serial Number", type: "text", system: true },
    { key: "model_name", label: "Model Name", type: "text", system: true },
  ].forEach((field) => map.set(field.key, field));
  (typeSchema?.schemaFields || []).forEach((field) => {
    if (field?.key) map.set(field.key, field);
  });
  return map;
};

const getValueAtPath = (value, pathExpression) => {
  if (!pathExpression) return value;
  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => {
      if (acc === undefined || acc === null) return undefined;
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, indexText] = arrayMatch;
        const next = key ? acc[key] : acc;
        return Array.isArray(next) ? next[Number(indexText)] : undefined;
      }
      return acc[part];
    }, value);
};

const normalizeAssetHeaders = (headers) => {
  if (!isPlainObject(headers)) return {};
  return Object.entries(headers).reduce((acc, [key, value]) => {
    if (!key) return acc;
    acc[String(key)] = typeof value === "string" ? value : JSON.stringify(value);
    return acc;
  }, {});
};

const coerceAssetFieldValue = (fieldDef, rawValue) => {
  if (rawValue === undefined) return { ok: false, error: "value is undefined" };
  if (rawValue === null || rawValue === "") return { ok: true, value: rawValue };

  const type = fieldDef?.type || "text";

  if (type === "boolean") {
    if (typeof rawValue === "boolean") return { ok: true, value: rawValue };
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return { ok: true, value: true };
    if (["false", "0", "no"].includes(normalized)) return { ok: true, value: false };
    return { ok: false, error: `Expected boolean for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "table") {
    if (Array.isArray(rawValue)) return { ok: true, value: rawValue };
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) return { ok: true, value: parsed };
      } catch {}
    }
    return { ok: false, error: `Expected JSON array for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "date") {
    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Expected a valid date for ${fieldDef?.label || fieldDef?.key}` };
    }
    return { ok: true, value: date.toISOString().slice(0, 10) };
  }

  if ((type === "file" || type === "symbol") && typeof rawValue === "object") {
    return { ok: false, error: `Expected a file URL string for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (Array.isArray(rawValue) || typeof rawValue === "object") {
    return { ok: false, error: `Expected a primitive value for ${fieldDef?.label || fieldDef?.key}` };
  }

  return { ok: true, value: String(rawValue) };
};

const toDynamicStoredValue = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
};

async function getLatestCompanyPassports({ companyId, passportType }) {
  const tableName = getTable(passportType);
  const result = await pool.query(
    `SELECT DISTINCT ON (guid) *
     FROM ${tableName}
     WHERE company_id = $1
       AND deleted_at IS NULL
     ORDER BY guid, version_number DESC, updated_at DESC`,
    [companyId]
  );
  return result.rows.map((row) => {
    const normalized = normalizePassportRow(row);
    return {
      ...normalized,
      is_editable: isEditablePassportStatus(normalized.release_status),
    };
  });
}

async function fetchAssetSourceRecords(sourceConfig = {}) {
  const url = String(sourceConfig.url || "").trim();
  if (!url) throw new Error("Source URL is required");

  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP(S) ERP/API endpoints are supported");
  }

  const method = String(sourceConfig.method || "GET").trim().toUpperCase();
  const headers = normalizeAssetHeaders(sourceConfig.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const requestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (!["GET", "HEAD"].includes(method) && sourceConfig.body !== undefined && sourceConfig.body !== "") {
      if (typeof sourceConfig.body === "string") {
        requestInit.body = sourceConfig.body;
      } else {
        requestInit.body = JSON.stringify(sourceConfig.body);
        if (!requestInit.headers["Content-Type"] && !requestInit.headers["content-type"]) {
          requestInit.headers["Content-Type"] = "application/json";
        }
      }
    }

    const response = await fetch(parsedUrl, requestInit);
    const text = await response.text();
    let parsedPayload = text;
    try { parsedPayload = text ? JSON.parse(text) : null; } catch {}

    if (!response.ok) {
      throw new Error(`ERP/API request failed (${response.status})`);
    }

    let extracted = sourceConfig.recordPath
      ? getValueAtPath(parsedPayload, sourceConfig.recordPath)
      : parsedPayload;

    if (!Array.isArray(extracted) && isPlainObject(extracted)) {
      extracted = extracted.items || extracted.records || extracted.rows || extracted.data;
    }

    if (!Array.isArray(extracted)) {
      throw new Error("ERP/API source must resolve to an array of records");
    }
    if (extracted.length > 1000) {
      throw new Error("ERP/API source returned more than 1000 records");
    }

    const fieldMap = isPlainObject(sourceConfig.fieldMap) ? sourceConfig.fieldMap : null;
    const defaults = isPlainObject(sourceConfig.defaults) ? sourceConfig.defaults : {};
    const records = extracted.map((item) => {
      if (!isPlainObject(item)) return {};
      if (!fieldMap) return { ...item, ...defaults };
      return Object.entries(fieldMap).reduce((acc, [sourceKey, targetKey]) => {
        if (!targetKey) return acc;
        acc[String(targetKey)] = getValueAtPath(item, sourceKey);
        return acc;
      }, { ...defaults });
    });

    return {
      count: records.length,
      records,
      sample: records.slice(0, 3),
      endpoint: parsedUrl.toString(),
      fetched_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareAssetPayload({ companyId, passportType, records, options = {} }) {
  if (!companyId) throw new Error("companyId is required");
  if (!passportType) throw new Error("passport_type is required");
  if (!Array.isArray(records) || !records.length) throw new Error("records array is required");
  if (records.length > 1000) throw new Error("Max 1000 asset rows per request");

  const typeSchema = await getPassportTypeSchema(passportType);
  if (!typeSchema) throw new Error("Passport type not found");

  const fieldMap = getAssetFieldMap(typeSchema);
  const currentRows = await getLatestCompanyPassports({
    companyId,
    passportType: typeSchema.typeName,
  });
  const currentByGuid = new Map(currentRows.map((row) => [row.guid, row]));
  const currentByProductId = new Map(
    currentRows
      .filter((row) => normalizeProductIdValue(row.product_id))
      .map((row) => [normalizeProductIdValue(row.product_id), row])
  );

  const batchTargets = new Set();
  const batchProductIds = new Map();
  const generatedRecords = [];
  const details = [];
  const summary = {
    total: records.length,
    ready: 0,
    ready_for_passport_update: 0,
    ready_for_dynamic_push: 0,
    skipped: 0,
    failed: 0,
  };

  records.forEach((rawRecord, index) => {
    if (!isPlainObject(rawRecord)) {
      details.push({ row_index: index + 1, status: "failed", error: "Each asset row must be an object" });
      summary.failed += 1;
      return;
    }

    const matchGuid = String(rawRecord.match_guid || rawRecord.guid || "").trim();
    const matchProductId = normalizeProductIdValue(
      rawRecord.match_product_id !== undefined
        ? rawRecord.match_product_id
        : (!matchGuid ? rawRecord.product_id : "")
    );

    if (!matchGuid && !matchProductId) {
      details.push({
        row_index: index + 1,
        status: "failed",
        error: "Each asset row needs guid, match_guid, product_id, or match_product_id",
      });
      summary.failed += 1;
      return;
    }

    const matchedRow = matchGuid
      ? currentByGuid.get(matchGuid)
      : currentByProductId.get(matchProductId);

    if (!matchedRow) {
      details.push({
        row_index: index + 1,
        guid: matchGuid || undefined,
        product_id: matchProductId || undefined,
        status: "skipped",
        reason: "No matching passport was found",
      });
      summary.skipped += 1;
      return;
    }

    if (batchTargets.has(matchedRow.guid)) {
      details.push({
        row_index: index + 1,
        guid: matchedRow.guid,
        status: "failed",
        error: "This passport is targeted more than once in the same asset batch",
      });
      summary.failed += 1;
      return;
    }

    const passportUpdate = {};
    const dynamicValues = {};
    const errors = [];
    const nextProductIdProvided = rawRecord.next_product_id !== undefined;

    Object.entries(rawRecord).forEach(([key, value]) => {
      if (ASSET_MATCH_FIELDS.has(key)) return;

      if (fieldMap.has(key)) {
        if (key === "product_id" && !matchGuid && !nextProductIdProvided) return;
        const coerced = coerceAssetFieldValue(fieldMap.get(key), value);
        if (!coerced.ok) {
          errors.push(coerced.error);
          return;
        }
        passportUpdate[key] = coerced.value;
        return;
      }

      errors.push(`Unknown field "${key}"`);
    });

    if (nextProductIdProvided) {
      const normalizedNextProductId = normalizeProductIdValue(rawRecord.next_product_id);
      if (!normalizedNextProductId) {
        errors.push("next_product_id cannot be blank");
      } else {
        passportUpdate.product_id = normalizedNextProductId;
      }
    }

    Object.keys(passportUpdate).forEach((key) => {
      const fieldDef = fieldMap.get(key) || { key, type: "text" };
      const nextComparable = comparableHistoryFieldValue(fieldDef, passportUpdate[key]);
      const currentComparable = comparableHistoryFieldValue(fieldDef, matchedRow[key]);
      if (nextComparable === currentComparable) {
        delete passportUpdate[key];
      }
    });

    const hasPassportUpdate = Object.keys(passportUpdate).length > 0;
    const hasDynamicValues = Object.keys(dynamicValues).length > 0;

    if (hasPassportUpdate && !matchedRow.is_editable) {
      errors.push(`Passport is ${matchedRow.release_status} and can only receive dynamic pushes right now`);
    }

    if (passportUpdate.product_id !== undefined) {
      const normalizedNextProductId = normalizeProductIdValue(passportUpdate.product_id);
      if (!normalizedNextProductId) {
        errors.push("product_id cannot be blank");
      } else {
        passportUpdate.product_id = normalizedNextProductId;
        const duplicate = currentByProductId.get(normalizedNextProductId);
        if (duplicate && duplicate.guid !== matchedRow.guid) {
          errors.push(`Serial Number "${normalizedNextProductId}" already belongs to another passport`);
        }
        const reservedGuid = batchProductIds.get(normalizedNextProductId);
        if (reservedGuid && reservedGuid !== matchedRow.guid) {
          errors.push(`Serial Number "${normalizedNextProductId}" is assigned twice in this batch`);
        } else {
          batchProductIds.set(normalizedNextProductId, matchedRow.guid);
        }
      }
    }

    if (errors.length) {
      details.push({
        row_index: index + 1,
        guid: matchedRow.guid,
        product_id: matchedRow.product_id,
        status: "failed",
        error: errors.join("; "),
      });
      summary.failed += 1;
      return;
    }

    if (!hasPassportUpdate && !hasDynamicValues) {
      details.push({
        row_index: index + 1,
        guid: matchedRow.guid,
        product_id: matchedRow.product_id,
        status: "skipped",
        reason: "No changes detected for this row",
      });
      summary.skipped += 1;
      return;
    }

    batchTargets.add(matchedRow.guid);
    generatedRecords.push({
      row_index: index + 1,
      matched_guid: matchedRow.guid,
      matched_product_id: matchedRow.product_id,
      matched_release_status: matchedRow.release_status,
      is_editable: matchedRow.is_editable,
      match: {
        guid: matchGuid || null,
        product_id: matchProductId || null,
        matched_by: matchGuid ? "guid" : "product_id",
      },
      passport_update: passportUpdate,
      dynamic_values: dynamicValues,
    });

    summary.ready += 1;
    if (hasPassportUpdate) summary.ready_for_passport_update += 1;
    if (hasDynamicValues) summary.ready_for_dynamic_push += 1;
    details.push({
      row_index: index + 1,
      guid: matchedRow.guid,
      product_id: matchedRow.product_id,
      status: "ready",
      passport_fields: Object.keys(passportUpdate),
      dynamic_fields: Object.keys(dynamicValues),
    });
  });

  return {
    company_id: Number(companyId),
    passport_type: typeSchema.typeName,
    display_name: typeSchema.displayName,
    generated_at: new Date().toISOString(),
    fields: Array.from(fieldMap.values()),
    summary,
    details,
    generated_payload: {
      company_id: Number(companyId),
      passport_type: typeSchema.typeName,
      generated_at: new Date().toISOString(),
      records: generatedRecords,
    },
  };
}

async function executeAssetPush({ companyId, generatedPayload, source = "asset_management" }) {
  const passportType = generatedPayload?.passport_type;
  const records = Array.isArray(generatedPayload?.records) ? generatedPayload.records : [];
  if (!passportType) throw new Error("generated payload is missing passport_type");
  if (!records.length) throw new Error("generated payload is empty");

  const tableName = getTable(passportType);
  const summary = {
    processed: records.length,
    passports_updated: 0,
    dynamic_fields_pushed: 0,
    skipped: 0,
    failed: 0,
  };
  const details = [];

  for (const item of records) {
    const matchedGuid = String(item.matched_guid || "").trim();
    const passportUpdate = isPlainObject(item.passport_update) ? { ...item.passport_update } : {};
    const dynamicValues = isPlainObject(item.dynamic_values) ? { ...item.dynamic_values } : {};
    const detail = {
      row_index: item.row_index,
      guid: matchedGuid || undefined,
      passport_fields: Object.keys(passportUpdate),
      dynamic_fields: Object.keys(dynamicValues),
    };

    try {
      let updatedFields = [];
      if (Object.keys(passportUpdate).length) {
        const editable = await pool.query(
          `SELECT id
           FROM ${tableName}
           WHERE guid = $1
             AND company_id = $2
             AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
             AND deleted_at IS NULL
           ORDER BY version_number DESC
           LIMIT 1`,
          [matchedGuid, companyId]
        );

        if (!editable.rows.length) {
          if (!Object.keys(dynamicValues).length) {
            summary.skipped += 1;
            details.push({ ...detail, status: "skipped", reason: "Passport is no longer editable" });
            continue;
          }
          detail.passport_status = "skipped";
          detail.passport_reason = "Passport is no longer editable";
        } else {
          if (passportUpdate.product_id !== undefined) {
            const duplicate = await findExistingPassportByProductId({
              tableName,
              companyId,
              productId: normalizeProductIdValue(passportUpdate.product_id),
              excludeGuid: matchedGuid,
            });
            if (duplicate) {
              throw new Error(`Serial Number "${passportUpdate.product_id}" already belongs to another passport`);
            }
          }

          updatedFields = await updatePassportRowById({
            tableName,
            rowId: editable.rows[0].id,
            userId: null,
            data: passportUpdate,
          });

          if (updatedFields.length) {
            await logAudit(
              companyId,
              null,
              "ASSET_UPDATE",
              tableName,
              matchedGuid,
              null,
              { source, fields_updated: updatedFields }
            );
            summary.passports_updated += 1;
            detail.passport_status = "updated";
          } else {
            detail.passport_status = "skipped";
            detail.passport_reason = "No passport field changes detected";
          }
        }
      }

      const dynamicEntries = Object.entries(dynamicValues).filter(([fieldKey]) =>
        /^[a-z][a-z0-9_]{0,99}$/.test(fieldKey)
      );

      if (dynamicEntries.length) {
        for (const [fieldKey, value] of dynamicEntries) {
          await pool.query(
            `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at)
             VALUES ($1, $2, $3, NOW())`,
            [matchedGuid, fieldKey, toDynamicStoredValue(value)]
          );
        }
        await logAudit(
          companyId,
          null,
          "ASSET_DYNAMIC_PUSH",
          "passport_dynamic_values",
          matchedGuid,
          null,
          { source, fields_updated: dynamicEntries.map(([fieldKey]) => fieldKey) }
        );
        summary.dynamic_fields_pushed += dynamicEntries.length;
        detail.dynamic_status = "pushed";
      }

      if (!updatedFields.length && !dynamicEntries.length) {
        summary.skipped += 1;
        details.push({ ...detail, status: "skipped", reason: "No actionable updates remained" });
        continue;
      }

      details.push({
        ...detail,
        status: detail.passport_status === "skipped" ? "partial" : "updated",
      });
    } catch (error) {
      summary.failed += 1;
      details.push({
        ...detail,
        status: "failed",
        error: error.message,
      });
    }
  }

  return { summary, details };
}

async function recordAssetRun({
  jobId = null,
  companyId,
  passportType,
  triggerType,
  sourceKind,
  status,
  summary,
  requestJson,
  generatedJson,
}) {
  const inserted = await pool.query(
    `INSERT INTO asset_management_runs
       (job_id, company_id, passport_type, trigger_type, source_kind, status, summary_json, request_json, generated_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, created_at`,
    [
      jobId,
      companyId,
      passportType || null,
      triggerType,
      sourceKind || null,
      status,
      summary ? JSON.stringify(summary) : null,
      requestJson ? JSON.stringify(requestJson) : null,
      generatedJson ? JSON.stringify(generatedJson) : null,
    ]
  );
  return inserted.rows[0];
}

const resolveAssetJobNextRunAt = ({ startAt, intervalMinutes, from = new Date() }) => {
  if (!startAt) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const interval = Number.parseInt(intervalMinutes, 10);
  if (!Number.isFinite(interval) || interval <= 0) {
    return start > from ? start : null;
  }
  let next = new Date(start);
  while (next <= from) {
    next = new Date(next.getTime() + interval * 60 * 1000);
  }
  return next;
};

async function resolveAssetJobRecords(job) {
  if (job.source_kind === "api") {
    const fetched = await fetchAssetSourceRecords(job.source_config || {});
    return {
      records: fetched.records,
      sourceMeta: {
        endpoint: fetched.endpoint,
        fetched_at: fetched.fetched_at,
        count: fetched.count,
      },
    };
  }

  return {
    records: Array.isArray(job.records_json) ? job.records_json : [],
    sourceMeta: {
      stored_records: Array.isArray(job.records_json) ? job.records_json.length : 0,
    },
  };
}

let assetSchedulerHandle = null;
let assetSchedulerBusy = false;

async function runAssetManagementJob(job, triggerType = "manual") {
  const options = isPlainObject(job.options_json) ? job.options_json : {};
  try {
    await assertAssetManagementEnabled(job.company_id);
    const resolved = await resolveAssetJobRecords(job);
    const prepared = await prepareAssetPayload({
      companyId: job.company_id,
      passportType: job.passport_type,
      records: resolved.records,
      options,
    });
    const pushResult = await executeAssetPush({
      companyId: job.company_id,
      generatedPayload: prepared.generated_payload,
      source: `asset_job:${job.id || "manual"}`,
    });

    const status = pushResult.summary.failed
      ? (pushResult.summary.passports_updated || pushResult.summary.dynamic_fields_pushed ? "partial" : "failed")
      : "success";
    const nextRunAt = job.is_active
      ? resolveAssetJobNextRunAt({
          startAt: job.start_at || prepared.generated_at,
          intervalMinutes: job.interval_minutes,
          from: new Date(),
        })
      : null;

    if (job.id) {
      await pool.query(
        `UPDATE asset_management_jobs
         SET last_run_at = NOW(),
             last_status = $2,
             last_summary = $3,
             next_run_at = $4,
             is_active = $5,
             updated_at = NOW()
         WHERE id = $1`,
        [
          job.id,
          status,
          JSON.stringify(pushResult.summary),
          nextRunAt,
          nextRunAt ? true : false,
        ]
      );
    }

    const run = await recordAssetRun({
      jobId: job.id || null,
      companyId: job.company_id,
      passportType: job.passport_type,
      triggerType,
      sourceKind: job.source_kind,
      status,
      summary: pushResult.summary,
      requestJson: {
        options,
        sourceMeta: resolved.sourceMeta,
      },
      generatedJson: prepared.generated_payload,
    });

    return {
      status,
      run,
      preview: prepared,
      result: pushResult,
    };
  } catch (error) {
    const nextRunAt = job.is_active
      ? resolveAssetJobNextRunAt({
          startAt: job.start_at || new Date(),
          intervalMinutes: job.interval_minutes,
          from: new Date(),
        })
      : null;

    if (job.id) {
      await pool.query(
        `UPDATE asset_management_jobs
         SET last_run_at = NOW(),
             last_status = 'failed',
             last_summary = $2,
             next_run_at = $3,
             is_active = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [
          job.id,
          JSON.stringify({ error: error.message }),
          nextRunAt,
          nextRunAt ? true : false,
        ]
      );
    }

    const run = await recordAssetRun({
      jobId: job.id || null,
      companyId: job.company_id,
      passportType: job.passport_type,
      triggerType,
      sourceKind: job.source_kind,
      status: "failed",
      summary: { error: error.message },
      requestJson: { options },
      generatedJson: null,
    });

    return {
      status: "failed",
      run,
      error,
    };
  }
}

async function processDueAssetJobs() {
  if (assetSchedulerBusy) return;
  assetSchedulerBusy = true;
  try {
    const dueJobs = await pool.query(
      `SELECT *
       FROM asset_management_jobs
       WHERE is_active = true
         AND next_run_at IS NOT NULL
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 10`
    );

    for (const job of dueJobs.rows) {
      await runAssetManagementJob(job, "scheduled");
    }
  } catch (error) {
    console.error("[AssetManagement] scheduler error:", error.message);
  } finally {
    assetSchedulerBusy = false;
  }
}

function startAssetManagementScheduler() {
  if (assetSchedulerHandle) return;
  assetSchedulerHandle = setInterval(processDueAssetJobs, ASSET_SCHEDULER_INTERVAL_MS);
  setTimeout(processDueAssetJobs, 5000);
}

const submitPassportToWorkflow = async ({
  companyId,
  guid,
  passportType,
  userId,
  reviewerId,
  approverId,
}) => {
  const tableName = getTable(passportType);
  const resolvedReviewerId = reviewerId ? parseInt(reviewerId, 10) : null;
  const resolvedApproverId = approverId ? parseInt(approverId, 10) : null;

  if (!resolvedReviewerId && !resolvedApproverId) {
    throw new Error("At least one reviewer or approver is required to submit a revision to workflow.");
  }

  const pRes = await pool.query(
    `SELECT id, model_name, product_id, version_number, release_status FROM ${tableName}
     WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
     ORDER BY version_number DESC LIMIT 1`,
    [guid]
  );
  if (!pRes.rows.length) throw new Error("Editable passport not found");
  const passport = normalizePassportRow(pRes.rows[0]);

  await pool.query(
    `UPDATE ${tableName} SET release_status = 'in_review', updated_at = NOW()
     WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`,
    [guid]
  );

  const wfRes = await pool.query(
    `INSERT INTO passport_workflow
       (passport_guid, passport_type, company_id, submitted_by, reviewer_id, approver_id,
        review_status, approval_status, overall_status, previous_release_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)
     RETURNING id`,
    [
      guid,
      passportType,
      companyId,
      userId,
      resolvedReviewerId,
      resolvedApproverId,
      resolvedReviewerId ? "pending" : "skipped",
      resolvedApproverId ? "pending" : "skipped",
      normalizeReleaseStatus(passport.release_status) || IN_REVISION_STATUS,
    ]
  );

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  if (resolvedReviewerId) {
    await createNotification(
      resolvedReviewerId,
      "workflow_review",
      `Review requested: ${passport.product_id}`,
      `v${passport.version_number} needs your review`,
      guid,
      "/dashboard/workflow"
    );
    try {
      const reviewer = await pool.query("SELECT email, first_name FROM users WHERE id = $1", [resolvedReviewerId]);
      const submitter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [userId]);
      if (reviewer.rows.length) {
        const reviewerName = reviewer.rows[0].first_name || "Reviewer";
        const submitterName =
          `${submitter.rows[0]?.first_name || ""} ${submitter.rows[0]?.last_name || ""}`.trim() ||
          submitter.rows[0]?.email ||
          "A colleague";
        await createTransporter().sendMail({
          from: process.env.EMAIL_FROM || "noreply@example.com",
          to: reviewer.rows[0].email,
          subject: `[DPP] Review requested — ${passport.product_id}`,
          html: brandedEmail({
            preheader: `${submitterName} submitted a passport for your review`,
            bodyHtml: `
              <p>Hi <strong>${reviewerName}</strong>,</p>
              <p><strong>${submitterName}</strong> has submitted a passport for your review.</p>
              <div class="info-box">
                <div class="info-row"><span class="info-label">Serial Number</span><span class="info-value">${passport.product_id}</span></div>
                ${passport.model_name ? `<div class="info-row"><span class="info-label">Model</span><span class="info-value">${passport.model_name}</span></div>` : ""}
                <div class="info-row"><span class="info-label">Version</span><span class="info-value">v${passport.version_number}</span></div>
                <div class="info-row"><span class="info-label">Type</span><span class="info-value">${passportType}</span></div>
              </div>
              <div class="cta-wrap"><a href="${appUrl}/dashboard/workflow" class="cta-btn">🔍 Review Now →</a></div>`,
          }),
        });
      }
    } catch (e) {
      console.error("Review email error:", e.message);
    }
  }

  if (resolvedApproverId && !resolvedReviewerId) {
    await createNotification(
      resolvedApproverId,
      "workflow_approval",
      `Approval requested: ${passport.product_id}`,
      `v${passport.version_number} needs your approval`,
      guid,
      "/dashboard/workflow"
    );
  }

  await logAudit(companyId, userId, "SUBMIT_REVIEW", tableName, guid, null, {
    reviewerId: resolvedReviewerId,
    approverId: resolvedApproverId,
    status: "in_review",
  });

  return { workflowId: wfRes.rows[0].id };
};

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH — REGISTER
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;
    if (!token || !firstName || !lastName || !password)
      return res.status(400).json({ error: "All fields are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const tokenRow = await pool.query(
      `SELECT it.*, c.company_name FROM invite_tokens it
       LEFT JOIN companies c ON c.id = it.company_id
       WHERE it.token = $1 AND it.used = false AND it.expires_at > NOW()`,
      [token]
    );
    if (!tokenRow.rows.length)
      return res.status(400).json({ error: "Invalid or expired invitation link. Please ask for a new invite." });
    const invite = tokenRow.rows[0];

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [invite.email]);
    if (existing.rows.length)
      return res.status(400).json({ error: "This email is already registered" });

    const { hash, pepperVersion } = await hashPassword(password);
    const role = invite.role_to_assign || "editor";
    const assignedCompanyId = role === "super_admin" ? null : invite.company_id;
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, company_id, role, pepper_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, company_id, role, first_name, last_name`,
      [invite.email, hash, firstName, lastName, assignedCompanyId, role, pepperVersion]
    );
    await pool.query("UPDATE invite_tokens SET used = true WHERE token = $1", [token]);

    const u = result.rows[0];
    const sessionToken = generateToken(u.id, u.email, u.company_id, u.role);
    setAuthCookie(res, sessionToken);
    res.status(201).json({
      success: true,
      user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
              first_name: u.first_name, last_name: u.last_name, company_name: invite.company_name || null },
    });
  } catch (e) { console.error("Register error:", e.message); res.status(500).json({ error: "Registration failed" }); }
});

app.get("/api/invite/validate", publicReadRateLimit, async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token is required" });
    const row = await pool.query(
      `SELECT it.email, it.expires_at, it.used, it.role_to_assign, c.company_name
       FROM invite_tokens it LEFT JOIN companies c ON c.id = it.company_id WHERE it.token = $1`,
      [token]
    );
    if (!row.rows.length) return res.status(404).json({ valid: false, error: "Invitation not found." });
    const invite = row.rows[0];
    if (invite.used)    return res.status(400).json({ valid: false, error: "This invitation has already been used." });
    if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ valid: false, error: "This invitation has expired." });
    res.json({
      valid: true,
      email: invite.email,
      company_name: invite.company_name || null,
      role_to_assign: invite.role_to_assign || null,
      expires_at: invite.expires_at,
    });
  } catch (e) { res.status(500).json({ valid: false, error: "Failed to validate invitation" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH — LOGIN
// ═══════════════════════════════════════════════════════════════════════════
const sendOtpEmail = async (user, otp) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@dpp-system.com",
    to: user.email,
    subject: "Your verification code — Digital Product Passport",
    html: brandedEmail({
      preheader: "Two-factor authentication code",
      bodyHtml: `
        <p>Hello ${user.first_name || "there"},</p>
        <p>Your one-time verification code is:</p>
        <div style="text-align:center;margin:28px 0">
          <span style="font-size:38px;font-weight:900;letter-spacing:14px;color:#1C3738;font-family:monospace;background:#F4FFF8;padding:14px 20px;border-radius:10px;border:2px solid #d0e4e0;display:inline-block">${otp}</span>
        </div>
        <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="font-size:13px;color:#8BAAAD">If you did not attempt to log in, you can safely ignore this email.</p>
      `,
    }),
  });
};

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const result = await pool.query(
      `SELECT u.*, c.company_name FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });
    const u  = result.rows[0];
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // If 2FA is enabled, issue OTP and a short-lived pre-auth token
    if (u.two_factor_enabled) {
      const otp     = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await pool.query(
        "UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3",
        [otpHash, expiresAt, u.id]
      );
      try { await sendOtpEmail(u, otp); }
      catch (emailErr) {
        console.error("OTP email failed:", emailErr.message);
        return res.status(500).json({ error: "Failed to send verification code. Please try again." });
      }
      // pre_auth token — only valid for the verify-otp endpoint, expires in 10 min
      const preAuthToken = jwt.sign({ userId: u.id, pre_auth: true }, JWT_SECRET, { expiresIn: "10m" });
      return res.json({ requires_2fa: true, pre_auth_token: preAuthToken });
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [u.id]).catch(() => {});
    const sessionToken = generateToken(u.id, u.email, u.company_id, u.role);
    setAuthCookie(res, sessionToken);
    res.json({
      success: true,
      token: sessionToken,
      user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
              first_name: u.first_name, last_name: u.last_name, company_name: u.company_name },
    });
  } catch (e) { console.error("Login error:", e.message); res.status(500).json({ error: "Login failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH — VERIFY OTP (2FA second step)
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/auth/verify-otp", otpRateLimit, async (req, res) => {
  try {
    const { pre_auth_token, otp } = req.body;
    if (!pre_auth_token || !otp) return res.status(400).json({ error: "Missing required fields" });

    let payload;
    try { payload = jwt.verify(pre_auth_token, JWT_SECRET); }
    catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
    if (!payload.pre_auth) return res.status(401).json({ error: "Invalid session token" });

    const result = await pool.query(
      `SELECT u.*, c.company_name FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1 AND u.is_active = true`,
      [payload.userId]
    );
    if (!result.rows.length) return res.status(401).json({ error: "User not found" });
    const u = result.rows[0];

    if (!u.otp_code || !u.otp_expires_at || new Date() > new Date(u.otp_expires_at)) {
      return res.status(401).json({ error: "Verification code has expired. Please log in again." });
    }

    const submitHash = crypto.createHash("sha256").update(String(otp).trim()).digest("hex");
    const storedBuf  = Buffer.from(u.otp_code, "hex");
    const submitBuf  = Buffer.from(submitHash, "hex");
    if (storedBuf.length !== submitBuf.length || !crypto.timingSafeEqual(storedBuf, submitBuf)) {
      return res.status(401).json({ error: "Invalid verification code" });
    }

    await pool.query(
      "UPDATE users SET otp_code = NULL, otp_expires_at = NULL, last_login_at = NOW() WHERE id = $1",
      [u.id]
    );
    const sessionToken = generateToken(u.id, u.email, u.company_id, u.role);
    setAuthCookie(res, sessionToken);
    res.json({
      success: true,
      token: sessionToken,
      user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
              first_name: u.first_name, last_name: u.last_name, company_name: u.company_name },
    });
  } catch (e) { console.error("OTP verify error:", e.message); res.status(500).json({ error: "Verification failed" }); }
});

app.post("/api/auth/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH — RESEND OTP
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/auth/resend-otp", otpRateLimit, async (req, res) => {
  try {
    const { pre_auth_token } = req.body;
    if (!pre_auth_token) return res.status(400).json({ error: "Missing token" });

    let payload;
    try { payload = jwt.verify(pre_auth_token, JWT_SECRET); }
    catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
    if (!payload.pre_auth) return res.status(401).json({ error: "Invalid session" });

    const result = await pool.query("SELECT * FROM users WHERE id = $1 AND is_active = true", [payload.userId]);
    if (!result.rows.length) return res.status(401).json({ error: "User not found" });
    const u = result.rows[0];

    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      "UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3",
      [otpHash, expiresAt, u.id]
    );
    await sendOtpEmail(u, otp);
    res.json({ success: true });
  } catch (e) { console.error("Resend OTP error:", e.message); res.status(500).json({ error: "Failed to resend code" }); }
});

// ─── AUTH — FORGOT / RESET PASSWORD ─────────────────────────────────────────
app.post("/api/auth/forgot-password", passwordResetRateLimit, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const u = await pool.query("SELECT id FROM users WHERE email = $1 AND is_active = true", [email]);
    if (!u.rows.length) return res.json({ success: true });
    const token = uuidv4();
    const tokenHash = hashOpaqueToken(token);
    const exp   = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)",
      [u.rows[0].id, tokenHash, exp]
    );
    const resetUrl = `${process.env.APP_URL || "http://localhost:3000"}/reset-password?token=${token}`;
    await createTransporter().sendMail({
      from: process.env.EMAIL_FROM || "noreply@example.com", to: email,
      subject: "Reset your Digital Product Passport password",
      html: brandedEmail({ preheader: "Password Reset Request", bodyHtml: `
        <p>We received a request to reset the password for <strong>${email}</strong>.</p>
        <div class="cta-wrap"><a href="${resetUrl}" class="cta-btn">🔐 Reset Password →</a></div>
        <p style="font-size:13px;color:#888;text-align:center">If you didn't request this, you can safely ignore this email.</p>` }),
    });
    res.json({ success: true });
  } catch (e) { console.error("Forgot password:", e.message); res.status(500).json({ error: "Failed to send email" }); }
});

app.get("/api/auth/validate-reset-token", publicReadRateLimit, async (req, res) => {
  try {
    const submittedToken = String(req.query.token || "");
    const submittedHash = hashOpaqueToken(submittedToken);
    const r = await pool.query(
      "SELECT id FROM password_reset_tokens WHERE token = ANY($1::text[]) AND used = false AND expires_at > NOW()",
      [[submittedToken, submittedHash]]
    );
    res.json({ valid: r.rows.length > 0 });
  } catch { res.status(500).json({ valid: false }); }
});

app.post("/api/auth/reset-password", passwordResetRateLimit, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Password too short" });
    const tokenHash = hashOpaqueToken(token);
    const r = await pool.query(
      "SELECT user_id FROM password_reset_tokens WHERE token = ANY($1::text[]) AND used = false AND expires_at > NOW()",
      [[token, tokenHash]]
    );
    if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired token" });
    const { hash, pepperVersion } = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1, pepper_version = $2, updated_at = NOW() WHERE id = $3",
      [hash, pepperVersion, r.rows[0].user_id]);
    await pool.query("UPDATE password_reset_tokens SET used = true WHERE token = ANY($1::text[])", [[token, tokenHash]]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Password reset failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  INVITE
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/companies/:companyId/invite", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { inviteeEmail, roleToAssign } = req.body;
    if (!inviteeEmail) return res.status(400).json({ error: "Invitee email is required" });
    if (!process.env.EMAIL_PASS) return res.status(500).json({ error: "Email not configured on server." });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [inviteeEmail]);
    if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

    await pool.query(
      `UPDATE invite_tokens SET expires_at = NOW()
       WHERE email = $1 AND company_id = $2 AND used = false AND expires_at > NOW()`,
      [inviteeEmail, companyId]
    );

    const company = await pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]);
    if (!company.rows.length) return res.status(404).json({ error: "Company not found" });
    const company_name = company.rows[0].company_name;

    const inviter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [req.user.userId]);
    const inviterName = inviter.rows.length
      ? `${inviter.rows[0].first_name || ""} ${inviter.rows[0].last_name || ""}`.trim() || inviter.rows[0].email
      : "A colleague";

    const tokenValue = uuidv4();
    const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const finalRole  = (req.user.role === "company_admin" || req.user.role === "super_admin")
      ? (roleToAssign || "editor") : "viewer";

    await pool.query(
      `INSERT INTO invite_tokens (token, email, company_id, invited_by, expires_at, role_to_assign)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tokenValue, inviteeEmail, companyId, req.user.userId, expiresAt, finalRole]
    );

    const appUrl      = process.env.APP_URL || "http://localhost:3000";
    const registerUrl = `${appUrl}/register?token=${tokenValue}`;

    await createTransporter().sendMail({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: inviteeEmail,
      subject: `${inviterName} invited you to join ${company_name} on Digital Product Passport`,
      html: brandedEmail({ preheader: `You have been invited to join ${company_name}`, bodyHtml: `
        <p><strong>${inviterName}</strong> has invited you to join <strong>${company_name}</strong>.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-label">Your Email</span><span class="info-value">${inviteeEmail}</span></div>
          <div class="info-row"><span class="info-label">Company</span><span class="info-value">${company_name}</span></div>
          <div class="info-row"><span class="info-label">Role</span><span class="info-value">${finalRole}</span></div>
        </div>
        <div style="background:rgba(245,183,50,0.12);border:1px solid rgba(245,183,50,0.4);border-radius:6px;padding:10px 14px;margin:16px 0;font-size:13px;color:#f5c842">
          ⏰ This invitation expires in <strong style="color:#fde68a">48 hours</strong> and can only be used <strong style="color:#fde68a">once</strong>.
        </div>
        <div class="cta-wrap"><a href="${registerUrl}" class="cta-btn">Accept Invitation →</a></div>` }),
    });

    res.json({ success: true, message: `Invitation sent to ${inviteeEmail}` });
  } catch (e) {
    console.error("Invite error:", e.message);
    res.status(500).json({ error: "Failed to send invitation.", detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/users/me", authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, u.avatar_url, u.phone, u.job_title, u.bio,
              u.preferred_language, u.default_reviewer_id, u.default_approver_id, u.created_at, u.last_login_at,
              u.two_factor_enabled, c.company_name, c.asset_management_enabled
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed" }); }
});

app.post("/api/users/me/token", authenticateToken, async (req, res) => {
  try {
    const freshToken = generateToken(
      req.user.userId,
      req.user.email,
      req.user.companyId,
      req.user.role
    );
    setAuthCookie(res, freshToken);
    res.json({ token: freshToken });
  } catch {
    res.status(500).json({ error: "Failed to issue bearer token" });
  }
});

app.post("/api/companies/:companyId/asset-management/launch", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await assertAssetManagementEnabled(companyId);
    const launchToken = generateAssetLaunchToken({
      companyId,
      userId: req.user.userId,
      role: req.user.role,
    });
    res.json({
      launchToken,
      company: {
        id: company.id,
        company_name: company.company_name,
      },
      assetUrl: `/asset-management?launchToken=${encodeURIComponent(launchToken)}`,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to open Asset Management" });
  }
});

app.patch("/api/users/me", authenticateToken, async (req, res) => {
  try {
    const allowed = ["first_name","last_name","phone","job_title","bio","avatar_url",
                     "default_reviewer_id","default_approver_id","preferred_language"];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const vals = fields.map(f => req.body[f] !== undefined ? req.body[f] : null);
    await pool.query(`UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $${fields.length + 1}`,
      [...vals, req.user.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to update profile" }); }
});

app.patch("/api/users/me/2fa", authenticateToken, async (req, res) => {
  try {
    const { enable, currentPassword } = req.body;
    if (typeof enable !== "boolean") return res.status(400).json({ error: "enable (boolean) required" });
    if (!currentPassword) return res.status(400).json({ error: "Current password required" });

    const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
    if (!u.rows.length) return res.status(404).json({ error: "User not found" });
    if (!await verifyPassword(currentPassword, u.rows[0].password_hash))
      return res.status(401).json({ error: "Current password is incorrect" });

    await pool.query(
      "UPDATE users SET two_factor_enabled = $1, updated_at = NOW() WHERE id = $2",
      [enable, req.user.userId]
    );
    res.json({ success: true, two_factor_enabled: enable });
  } catch (e) { console.error("2FA toggle error:", e.message); res.status(500).json({ error: "Failed to update 2FA setting" }); }
});

app.patch("/api/users/me/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Password too short" });
    const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
    if (!await verifyPassword(currentPassword, u.rows[0].password_hash))
      return res.status(401).json({ error: "Current password is incorrect" });
    const { hash, pepperVersion } = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1, pepper_version = $2, updated_at = NOW() WHERE id = $3",
      [hash, pepperVersion, req.user.userId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  COMPANY USERS (team management)
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/companies/:companyId/users", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.job_title, u.avatar_url,
              u.is_active, u.created_at,
              (SELECT COUNT(*) FROM passport_registry pr WHERE pr.company_id = u.company_id AND pr.passport_type IS NOT NULL) AS passport_count
       FROM users u
       WHERE u.company_id = $1 AND u.role != 'super_admin'
       ORDER BY u.role, u.first_name`,
      [req.params.companyId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.patch("/api/companies/:companyId/users/:userId", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    if (req.user.role !== "company_admin" && req.user.role !== "super_admin")
      return res.status(403).json({ error: "Admin only" });
    const { role } = req.body;
    if (!["company_admin","editor","viewer"].includes(role))
      return res.status(400).json({ error: "Invalid role" });
    await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3",
      [role, req.params.userId, req.params.companyId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

app.patch("/api/companies/:companyId/users/:userId/deactivate", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    if (req.user.role !== "company_admin" && req.user.role !== "super_admin")
      return res.status(403).json({ error: "Admin only" });
    await pool.query("UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND company_id = $2",
      [req.params.userId, req.params.companyId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN — UMBRELLA CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/admin/umbrella-categories", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM umbrella_categories ORDER BY name");
    res.json(r.rows);
  } catch (e) { console.error("List umbrellas error:", e.message); res.status(500).json({ error: "Failed to fetch categories" }); }
});

app.post("/api/admin/umbrella-categories", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { name, icon = "📋" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const r = await pool.query(
      "INSERT INTO umbrella_categories (name, icon) VALUES ($1, $2) RETURNING *",
      [name.trim(), icon]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Category already exists" });
    res.status(500).json({ error: "Failed to create category" });
  }
});

app.delete("/api/admin/umbrella-categories/:id", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Password is required" });

    const userRow = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
    const valid = await verifyPassword(password, userRow.rows[0].password_hash);
    if (!valid) return res.status(403).json({ error: "Incorrect password" });

    const cat = await pool.query("SELECT name FROM umbrella_categories WHERE id = $1", [req.params.id]);
    if (!cat.rows.length) return res.status(404).json({ error: "Category not found" });
    const usage = await pool.query(
      "SELECT COUNT(*) FROM passport_types WHERE umbrella_category = $1", [cat.rows[0].name]
    );
    if (parseInt(usage.rows[0].count) > 0)
      return res.status(400).json({ error: "Cannot delete — passport types are using this category" });
    await pool.query("DELETE FROM umbrella_categories WHERE id = $1", [req.params.id]);
    await logAudit(null, req.user.userId, "DELETE_PRODUCT_CATEGORY", "umbrella_categories", req.params.id, null,
      { name: cat.rows[0].name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete category" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN — PASSPORT TYPES (dynamic management by super admin)
// ═══════════════════════════════════════════════════════════════════════════

// GET all passport types (super admin)
app.get("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon,
             pt.fields_json, pt.is_active, pt.created_at,
             u.email AS created_by_email
      FROM passport_types pt
      LEFT JOIN users u ON u.id = pt.created_by
      ORDER BY pt.umbrella_category, pt.display_name
    `);
    res.json(r.rows);
  } catch (e) { console.error("List passport types error:", e.message); res.status(500).json({ error: "Failed to fetch passport types" }); }
});

// GET single passport type definition (public — used by PassportViewer and PassportForm)
app.get("/api/passport-types/:typeName", publicReadRateLimit, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, type_name, display_name, umbrella_category, umbrella_icon, fields_json
       FROM passport_types WHERE type_name = $1`,
      [req.params.typeName]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: "Failed to fetch passport type" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ASSET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

app.use("/api/asset-management", requireAssetManagementKey, authenticateAssetPlatform);

app.get("/api/asset-management/bootstrap", publicReadRateLimit, async (req, res) => {
  try {
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    const company = await assertAssetManagementEnabled(companyId);

    const types = await pool.query(
      `SELECT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.fields_json
       FROM passport_types pt
       JOIN company_passport_access cpa ON cpa.passport_type_id = pt.id
       WHERE cpa.company_id = $1
         AND pt.is_active = true
       ORDER BY pt.umbrella_category NULLS FIRST, pt.display_name ASC`,
      [companyId]
    );

    res.json({
      company,
      passport_types: types.rows,
      erp_presets: ASSET_ERP_PRESETS,
      security: {
        asset_key_required: !!ASSET_SHARED_SECRET,
        company_scoped: true,
      },
      assumptions: {
        editable_statuses: ["draft", IN_REVISION_STATUS],
        dynamic_pushes_do_not_change_passport_versions: true,
      },
    });
  } catch (error) {
    console.error("Asset bootstrap error:", error.message);
    res.status(500).json({ error: "Failed to load Asset Management bootstrap data" });
  }
});

app.get("/api/asset-management/passports", publicReadRateLimit, async (req, res) => {
  try {
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    const requestedType = String(req.query.passportType || "").trim();
    if (!requestedType) {
      return res.status(400).json({ error: "passportType query param is required" });
    }

    const typeSchema = await getPassportTypeSchema(requestedType);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

    const rows = await getLatestCompanyPassports({
      companyId,
      passportType: typeSchema.typeName,
    });

    const fields = Array.from(getAssetFieldMap(typeSchema).values());
    res.json({
      company_id: companyId,
      passport_type: typeSchema.typeName,
      display_name: typeSchema.displayName,
      fields,
      passports: rows,
      summary: {
        total: rows.length,
        editable: rows.filter((row) => row.is_editable).length,
        released_or_locked: rows.filter((row) => !row.is_editable).length,
      },
    });
  } catch (error) {
    console.error("Asset passport load error:", error.message);
    res.status(500).json({ error: "Failed to load passports for Asset Management" });
  }
});

app.post("/api/asset-management/source/fetch", async (req, res) => {
  try {
    const sourceConfig = isPlainObject(req.body?.sourceConfig) ? req.body.sourceConfig : {};
    const fetched = await fetchAssetSourceRecords(sourceConfig);
    res.json(fetched);
  } catch (error) {
    console.error("Asset source fetch error:", error.message);
    res.status(400).json({ error: error.message || "Failed to fetch ERP/API records" });
  }
});

app.post("/api/asset-management/preview", async (req, res) => {
  try {
    const normalizedBody = normalizePassportRequestBody(req.body || {});
    const payload = await prepareAssetPayload({
      companyId: Number.parseInt(req.assetContext.companyId, 10),
      passportType: normalizedBody.passport_type,
      records: normalizedBody.records,
      options: normalizedBody.options,
    });
    res.json(payload);
  } catch (error) {
    console.error("Asset preview error:", error.message);
    res.status(400).json({ error: error.message || "Failed to generate asset JSON" });
  }
});

app.post("/api/asset-management/push", async (req, res) => {
  try {
    const normalizedBody = normalizePassportRequestBody(req.body || {});
    const companyId = Number.parseInt(req.assetContext.companyId, 10);

    let preview;
    if (normalizedBody.generated_payload?.passport_type) {
      preview = {
        generated_payload: normalizedBody.generated_payload,
      };
    } else {
      preview = await prepareAssetPayload({
        companyId,
        passportType: normalizedBody.passport_type,
        records: normalizedBody.records,
        options: normalizedBody.options,
      });
    }

    const pushResult = await executeAssetPush({
      companyId,
      generatedPayload: preview.generated_payload,
    });
    const status = pushResult.summary.failed
      ? (pushResult.summary.passports_updated || pushResult.summary.dynamic_fields_pushed ? "partial" : "failed")
      : "success";
    const run = await recordAssetRun({
      companyId,
      passportType: preview.generated_payload.passport_type,
      triggerType: "manual",
      sourceKind: normalizedBody.sourceKind || "manual",
      status,
      summary: pushResult.summary,
      requestJson: {
        options: normalizedBody.options || {},
      },
      generatedJson: preview.generated_payload,
    });

    res.json({
      status,
      run,
      summary: pushResult.summary,
      details: pushResult.details,
      generated_payload: preview.generated_payload,
    });
  } catch (error) {
    console.error("Asset push error:", error.message);
    res.status(400).json({ error: error.message || "Failed to push asset payload" });
  }
});

app.get("/api/asset-management/jobs", publicReadRateLimit, async (req, res) => {
  try {
    const companyId = Number.parseInt(req.assetContext.companyId, 10);

    const jobs = await pool.query(
      `SELECT *
       FROM asset_management_jobs
       WHERE company_id = $1
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 50`,
      [companyId]
    );

    res.json({ jobs: jobs.rows });
  } catch (error) {
    console.error("Asset jobs load error:", error.message);
    res.status(500).json({ error: "Failed to load asset jobs" });
  }
});

app.post("/api/asset-management/jobs", async (req, res) => {
  try {
    const normalizedBody = normalizePassportRequestBody(req.body || {});
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    const passportType = String(normalizedBody.passport_type || "").trim();
    const name = String(normalizedBody.name || "").trim();
    const sourceKind = String(normalizedBody.sourceKind || "manual").trim().toLowerCase();
    const sourceConfig = isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {};
    const records = Array.isArray(normalizedBody.records) ? normalizedBody.records : [];
    const options = isPlainObject(normalizedBody.options) ? normalizedBody.options : {};
    const startAt = normalizedBody.startAt ? new Date(normalizedBody.startAt) : null;
    const intervalMinutes = normalizedBody.intervalMinutes === "" || normalizedBody.intervalMinutes === undefined
      ? null
      : Number.parseInt(normalizedBody.intervalMinutes, 10);
    const isActive = normalizedBody.isActive !== false;

    if (!passportType || !name) {
      return res.status(400).json({ error: "passport_type and name are required" });
    }

    const typeSchema = await getPassportTypeSchema(passportType);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

    if (sourceKind !== "api" && !records.length) {
      return res.status(400).json({ error: "records are required for non-API asset jobs" });
    }
    if (sourceKind === "api" && !String(sourceConfig.url || "").trim()) {
      return res.status(400).json({ error: "sourceConfig.url is required for API asset jobs" });
    }

    if (records.length) {
      await prepareAssetPayload({
        companyId,
        passportType: typeSchema.typeName,
        records,
        options,
      });
    }

    const nextRunAt = isActive
      ? resolveAssetJobNextRunAt({
          startAt: startAt || new Date(),
          intervalMinutes,
          from: new Date(),
        })
      : null;

    const inserted = await pool.query(
      `INSERT INTO asset_management_jobs
         (company_id, passport_type, name, source_kind, source_config, records_json, options_json, is_active, start_at, interval_minutes, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        companyId,
        typeSchema.typeName,
        name,
        sourceKind,
        JSON.stringify(sourceConfig),
        JSON.stringify(records),
        JSON.stringify(options),
        !!(isActive && nextRunAt),
        startAt,
        Number.isFinite(intervalMinutes) ? intervalMinutes : null,
        nextRunAt,
      ]
    );

    res.status(201).json({ job: inserted.rows[0] });
  } catch (error) {
    console.error("Asset job create error:", error.message);
    res.status(400).json({ error: error.message || "Failed to save asset job" });
  }
});

app.patch("/api/asset-management/jobs/:jobId", async (req, res) => {
  try {
    const jobId = Number.parseInt(req.params.jobId, 10);
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

    const existing = await pool.query("SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Asset job not found" });

    const current = existing.rows[0];
    const normalizedBody = normalizePassportRequestBody(req.body || {});
    const passportType = normalizedBody.passport_type || current.passport_type;
    const typeSchema = await getPassportTypeSchema(passportType);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

    const sourceKind = normalizedBody.sourceKind || current.source_kind;
    const sourceConfig = normalizedBody.sourceConfig !== undefined
      ? (isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {})
      : (current.source_config || {});
    const records = normalizedBody.records !== undefined
      ? (Array.isArray(normalizedBody.records) ? normalizedBody.records : [])
      : (Array.isArray(current.records_json) ? current.records_json : []);
    const options = normalizedBody.options !== undefined
      ? (isPlainObject(normalizedBody.options) ? normalizedBody.options : {})
      : (isPlainObject(current.options_json) ? current.options_json : {});
    const startAt = normalizedBody.startAt !== undefined
      ? (normalizedBody.startAt ? new Date(normalizedBody.startAt) : null)
      : current.start_at;
    const intervalMinutes = normalizedBody.intervalMinutes !== undefined
      ? (normalizedBody.intervalMinutes === "" ? null : Number.parseInt(normalizedBody.intervalMinutes, 10))
      : current.interval_minutes;
    const isActive = normalizedBody.isActive !== undefined ? normalizedBody.isActive !== false : current.is_active;
    const name = normalizedBody.name !== undefined ? String(normalizedBody.name || "").trim() : current.name;

    if (!name) return res.status(400).json({ error: "Job name cannot be blank" });
    if (sourceKind !== "api" && !records.length) {
      return res.status(400).json({ error: "records are required for non-API asset jobs" });
    }
    if (sourceKind === "api" && !String(sourceConfig.url || "").trim()) {
      return res.status(400).json({ error: "sourceConfig.url is required for API asset jobs" });
    }

    if (records.length) {
      await prepareAssetPayload({
        companyId,
        passportType: typeSchema.typeName,
        records,
        options,
      });
    }

    const nextRunAt = isActive
      ? resolveAssetJobNextRunAt({
          startAt: startAt || new Date(),
          intervalMinutes,
          from: new Date(),
        })
      : null;

    const updated = await pool.query(
      `UPDATE asset_management_jobs
       SET passport_type = $2,
           name = $3,
           source_kind = $4,
           source_config = $5,
           records_json = $6,
           options_json = $7,
           is_active = $8,
           start_at = $9,
           interval_minutes = $10,
           next_run_at = $11,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        jobId,
        typeSchema.typeName,
        name,
        sourceKind,
        JSON.stringify(sourceConfig),
        JSON.stringify(records),
        JSON.stringify(options),
        !!(isActive && nextRunAt),
        startAt,
        Number.isFinite(intervalMinutes) ? intervalMinutes : null,
        nextRunAt,
      ]
    );

    res.json({ job: updated.rows[0] });
  } catch (error) {
    console.error("Asset job update error:", error.message);
    res.status(400).json({ error: error.message || "Failed to update asset job" });
  }
});

app.post("/api/asset-management/jobs/:jobId/run", async (req, res) => {
  try {
    const jobId = Number.parseInt(req.params.jobId, 10);
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

    const job = await pool.query("SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]);
    if (!job.rows.length) return res.status(404).json({ error: "Asset job not found" });

    const result = await runAssetManagementJob(job.rows[0], "manual_job_run");
    if (result.error) {
      return res.status(400).json({ error: result.error.message, run: result.run });
    }

    res.json(result);
  } catch (error) {
    console.error("Asset job run error:", error.message);
    res.status(400).json({ error: error.message || "Failed to run asset job" });
  }
});

app.get("/api/asset-management/runs", publicReadRateLimit, async (req, res) => {
  try {
    const companyId = Number.parseInt(req.assetContext.companyId, 10);
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 25, 100);

    const runs = await pool.query(
      `SELECT *
       FROM asset_management_runs
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );

    res.json({ runs: runs.rows });
  } catch (error) {
    console.error("Asset run load error:", error.message);
    res.status(500).json({ error: "Failed to load asset run history" });
  }
});

// PATCH passport type metadata (super admin only)
// Allows updating display_name, umbrella, icon, and fields_json flags (dynamic/composition/access).
// Does NOT rename type_name or structurally alter any DB table.
app.patch("/api/admin/passport-types/:id", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { display_name, umbrella_category, umbrella_icon, sections } = req.body;
    const { id } = req.params;

    const existing = await pool.query("SELECT * FROM passport_types WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Passport type not found" });

    const updates = [];
    const vals = [];
    let idx = 1;

    if (display_name !== undefined)      { updates.push(`display_name = $${idx++}`);      vals.push(display_name); }
    if (umbrella_category !== undefined) { updates.push(`umbrella_category = $${idx++}`); vals.push(umbrella_category); }
    if (umbrella_icon !== undefined)     { updates.push(`umbrella_icon = $${idx++}`);     vals.push(umbrella_icon); }
    if (sections !== undefined) {
      // Only update field metadata flags (dynamic, composition, access) — preserve keys/types/structure
      const fields_json = { sections };
      updates.push(`fields_json = $${idx++}`);
      vals.push(JSON.stringify(fields_json));
    }

    if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

    vals.push(id);
    const r = await pool.query(
      `UPDATE passport_types SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      vals
    );

    await logAudit(null, req.user.userId, "UPDATE_PASSPORT_TYPE_METADATA", "passport_types", null, null,
      { type_name: existing.rows[0].type_name, updated_fields: updates });

    res.json({ success: true, passportType: r.rows[0] });
  } catch (e) {
    console.error("Patch passport type error:", e.message);
    res.status(500).json({ error: "Failed to update passport type" });
  }
});

// DELETE a passport type — requires admin password confirmation
app.delete("/api/admin/passport-types/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { typeId } = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required" });

    // Verify the calling admin's password
    const userRow = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
    const valid = await verifyPassword(password, userRow.rows[0].password_hash);
    if (!valid) return res.status(403).json({ error: "Incorrect password" });

    const typeRow = await pool.query(
      "SELECT type_name, display_name FROM passport_types WHERE id = $1",
      [typeId]
    );
    if (!typeRow.rows.length) return res.status(404).json({ error: "Passport type not found" });
    const { type_name, display_name } = typeRow.rows[0];

    // Delete from passport_types (cascades to company_passport_access)
    await pool.query("DELETE FROM passport_types WHERE id = $1", [typeId]);

    // Drop the shared data table for this type
    const tbl = getTable(type_name);
    await pool.query(`DROP TABLE IF EXISTS "${tbl}"`);

    await logAudit(null, req.user.userId, "DELETE_PASSPORT_TYPE", "passport_types", null, null,
      { type_name, display_name });

    res.json({ success: true });
  } catch (e) {
    console.error("Delete passport type error:", e.message);
    res.status(500).json({ error: "Failed to delete passport type" });
  }
});

// CREATE a new passport type (super admin only)
// Once created, a type is IMMUTABLE — no editing, only deactivate/activate.
// This prevents ALTER TABLE issues on existing company data tables.
app.post("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { type_name, display_name, umbrella_category, umbrella_icon, sections } = req.body;

    if (!type_name || !display_name || !umbrella_category || !sections)
      return res.status(400).json({ error: "type_name, display_name, umbrella_category, and sections are required" });

    // type_name is used directly in table names — must be safe
    if (!/^[a-z][a-z0-9_]{1,99}$/.test(type_name))
      return res.status(400).json({
        error: "type_name must be lowercase letters/numbers/underscores, 2–100 chars, start with a letter"
      });

    if (!Array.isArray(sections) || sections.length === 0)
      return res.status(400).json({ error: "At least one section is required" });

    // Validate section/field keys
    for (const section of sections) {
      if (!section.key || !section.label || !Array.isArray(section.fields))
        return res.status(400).json({ error: "Each section must have key, label, and fields array" });
      if (!/^[a-z][a-z0-9_]{0,199}$/.test(section.key))
        return res.status(400).json({ error: `Invalid section key: ${section.key}` });
      for (const field of section.fields) {
        if (!field.key || !field.label || !field.type)
          return res.status(400).json({ error: "Each field must have key, label, and type" });
        if (!/^[a-z][a-z0-9_]{0,199}$/.test(field.key))
          return res.status(400).json({ error: `Invalid field key: ${field.key}` });
        if (!["text","textarea","boolean","file","table","url","date","symbol"].includes(field.type))
          return res.status(400).json({ error: `Invalid field type: ${field.type}` });
      }
    }

    const fields_json = { sections };

    const r = await pool.query(
      `INSERT INTO passport_types (type_name, display_name, umbrella_category, umbrella_icon, fields_json, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [type_name, display_name, umbrella_category, umbrella_icon || "📋",
       JSON.stringify(fields_json), req.user.userId]
    );

    // Keep umbrella_categories in sync
    await pool.query(
      "INSERT INTO umbrella_categories (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
      [umbrella_category, umbrella_icon || "📋"]
    );

    await createPassportTable(type_name);

    await logAudit(null, req.user.userId, "CREATE_PASSPORT_TYPE", "passport_types", null, null,
      { type_name, display_name, umbrella_category });

    res.status(201).json({ success: true, passportType: r.rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "A passport type with this type_name already exists" });
    console.error("Create passport type error:", e.message);
    res.status(500).json({ error: "Failed to create passport type" });
  }
});

// ── Passport-type draft (one per super-admin user) ──────────────────────────

// GET  — fetch the current user's in-progress draft (404 if none)
app.get("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, draft_json, created_at, updated_at FROM passport_type_drafts WHERE user_id = $1",
      [req.user.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "No draft found" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch draft" });
  }
});

// PUT  — upsert (create or overwrite) the current user's draft
app.put("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { draft_json } = req.body;
    if (!draft_json || typeof draft_json !== "object")
      return res.status(400).json({ error: "draft_json object is required" });
    const r = await pool.query(
      `INSERT INTO passport_type_drafts (user_id, draft_json)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET draft_json = EXCLUDED.draft_json,
             updated_at = NOW()
       RETURNING id, updated_at`,
      [req.user.userId, JSON.stringify(draft_json)]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Failed to save draft" });
  }
});

// DELETE — discard the current user's draft
app.delete("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM passport_type_drafts WHERE user_id = $1",
      [req.user.userId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete draft" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SYMBOL REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════

// Multer config for symbol uploads (SVG / PNG / JPG / WebP, max 2 MB)
const symbolStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "symbols");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `sym_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const symbolUpload = multer({
  storage: symbolStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Only SVG, PNG, JPG, WebP files are allowed"));
  },
});

// List all active symbols — available to all authenticated users
app.get("/api/symbols", authenticateToken, async (req, res) => {
  try {
    const { category } = req.query;
    let q = "SELECT id, name, category, file_url, created_at FROM symbols WHERE is_active = true";
    const params = [];
    if (category) { q += " AND category = $1"; params.push(category); }
    q += " ORDER BY category, name";
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to fetch symbols" }); }
});

// List symbol categories — for filtering UI
app.get("/api/symbols/categories", authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT DISTINCT category FROM symbols WHERE is_active = true ORDER BY category"
    );
    res.json(r.rows.map(row => row.category));
  } catch (e) { res.status(500).json({ error: "Failed to fetch categories" }); }
});

// Upload a new symbol — super admin only
app.post("/api/admin/symbols", authenticateToken, isSuperAdmin, symbolUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { name, category = "General" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/symbols/${req.file.filename}`;

    const r = await pool.query(
      "INSERT INTO symbols (name, category, file_url, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
      [name.trim(), category.trim() || "General", fileUrl, req.user.userId]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("Symbol upload error:", e.message);
    res.status(500).json({ error: e.message || "Failed to upload symbol" });
  }
});

// Delete (soft) a symbol — super admin only
app.delete("/api/admin/symbols/:id", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE symbols SET is_active = false WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Symbol not found" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete symbol" }); }
});

// DEACTIVATE a passport type (hides from new grants, does NOT affect existing data)
app.patch("/api/admin/passport-types/:id/deactivate", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE passport_types SET is_active = false WHERE id = $1 RETURNING id, type_name, display_name, is_active",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
    res.json({ success: true, passportType: r.rows[0] });
  } catch (e) { res.status(500).json({ error: "Failed to deactivate passport type" }); }
});

// ACTIVATE a passport type
app.patch("/api/admin/passport-types/:id/activate", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE passport_types SET is_active = true WHERE id = $1 RETURNING id, type_name, display_name, is_active",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
    res.json({ success: true, passportType: r.rows[0] });
  } catch (e) { res.status(500).json({ error: "Failed to activate passport type" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN — COMPANIES
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName) return res.status(400).json({ error: "Company name required" });
    const r = await pool.query(
      "INSERT INTO companies (company_name) VALUES ($1) RETURNING *",
      [companyName]
    );
    res.status(201).json({ success: true, company: r.rows[0] });
  } catch (e) { res.status(500).json({ error: "Failed to create company" }); }
});

app.get("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*,
        COALESCE(
          ARRAY_AGG(cpa.passport_type_id) FILTER (WHERE cpa.passport_type_id IS NOT NULL),
          '{}'
        ) AS granted_types,
        COALESCE(
          ARRAY_AGG(DISTINCT pt.display_name ORDER BY pt.display_name) FILTER (WHERE pt.display_name IS NOT NULL),
          '{}'
        ) AS granted_type_names
      FROM companies c
      LEFT JOIN company_passport_access cpa ON cpa.company_id = c.id
      LEFT JOIN passport_types pt ON pt.id = cpa.passport_type_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to fetch companies" }); }
});

app.patch("/api/admin/companies/:companyId/asset-management", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false" });
    }

    const updated = await pool.query(
      `UPDATE companies
       SET asset_management_enabled = $1,
           asset_management_revoked_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, company_name, asset_management_enabled, asset_management_revoked_at`,
      [enabled, companyId]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "Company not found" });

    await logAudit(
      null,
      req.user.userId,
      enabled ? "ENABLE_ASSET_MANAGEMENT" : "REVOKE_ASSET_MANAGEMENT",
      "companies",
      companyId,
      null,
      { asset_management_enabled: enabled }
    );

    if (!enabled) {
      await pool.query(
        `UPDATE asset_management_jobs
         SET is_active = false,
             next_run_at = NULL,
             updated_at = NOW()
         WHERE company_id = $1`,
        [companyId]
      );
    }

    res.json({ success: true, company: updated.rows[0] });
  } catch (e) {
    console.error("Asset management toggle error:", e.message);
    res.status(500).json({ error: "Failed to update Asset Management access" });
  }
});

app.get("/api/admin/super-admins", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, first_name, last_name, is_active, created_at, last_login_at
       FROM users
       WHERE role = 'super_admin'
       ORDER BY is_active DESC, created_at ASC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch super admins" });
  }
});

app.post("/api/admin/super-admins/invite", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { inviteeEmail } = req.body;
    if (!inviteeEmail) return res.status(400).json({ error: "Invitee email is required" });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [inviteeEmail]);
    if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

    await pool.query(
      `UPDATE invite_tokens
       SET expires_at = NOW()
       WHERE email = $1 AND role_to_assign = 'super_admin' AND used = false AND expires_at > NOW()`,
      [inviteeEmail]
    );

    const inviter = await pool.query("SELECT first_name, last_name, email, company_id FROM users WHERE id = $1", [req.user.userId]);
    const inviterName = inviter.rows.length
      ? `${inviter.rows[0].first_name || ""} ${inviter.rows[0].last_name || ""}`.trim() || inviter.rows[0].email
      : "A colleague";
    const tokenValue = uuidv4();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO invite_tokens (token, email, company_id, invited_by, expires_at, role_to_assign)
       VALUES ($1, $2, NULL, $3, $4, 'super_admin')`,
      [tokenValue, inviteeEmail, req.user.userId, expiresAt]
    );

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const registerUrl = `${appUrl}/register?token=${tokenValue}`;

    if (!process.env.EMAIL_PASS) {
      return res.status(201).json({
        success: true,
        emailSent: false,
        registerUrl,
        warning: "Invite created, but email is not configured on the server.",
        message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`,
      });
    }

    try {
      await createTransporter().sendMail({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: inviteeEmail,
        subject: `${inviterName} invited you to become a Super Admin on Digital Product Passport`,
        html: brandedEmail({ preheader: "You have been invited as a Super Admin", bodyHtml: `
          <p><strong>${inviterName}</strong> has invited you to join <strong>Digital Product Passport</strong> as a <strong>Super Admin</strong>.</p>
          <div class="info-box">
            <div class="info-row"><span class="info-label">Access level</span><span class="info-value">Super Admin</span></div>
            <div class="info-row"><span class="info-label">Invitation expires</span><span class="info-value">${expiresAt.toLocaleString()}</span></div>
          </div>
          <div class="cta-wrap"><a href="${registerUrl}" class="cta-btn">Complete Registration →</a></div>
        ` }),
      });
    } catch (mailErr) {
      console.error("Super admin invite mail error:", mailErr.message);
      return res.status(201).json({
        success: true,
        emailSent: false,
        registerUrl,
        warning: "Invite created, but the email could not be sent.",
        detail: mailErr.message,
        message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`,
      });
    }

    res.status(201).json({
      success: true,
      emailSent: true,
      message: `Invitation sent to ${inviteeEmail}`,
    });
  } catch (e) {
    console.error("Super admin invite error:", e.message);
    res.status(500).json({ error: "Failed to send super admin invitation", detail: e.message });
  }
});

app.patch("/api/admin/super-admins/:userId/access", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { active } = req.body || {};
    if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false" });

    const targetRes = await pool.query(
      "SELECT id, email, is_active FROM users WHERE id = $1 AND role = 'super_admin'",
      [userId]
    );
    if (!targetRes.rows.length) return res.status(404).json({ error: "Super admin not found" });

    if (!active) {
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND is_active = true"
      );
      const activeCount = countRes.rows[0]?.count || 0;
      if (activeCount <= 1 && targetRes.rows[0].is_active) {
        return res.status(400).json({ error: "At least one active super admin must remain" });
      }
    }

    const updated = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND role = 'super_admin'
       RETURNING id, email, first_name, last_name, is_active, created_at, last_login_at`,
      [active, userId]
    );

    await logAudit(null, req.user.userId, active ? "RESTORE_SUPER_ADMIN_ACCESS" : "REVOKE_SUPER_ADMIN_ACCESS",
      "users", null, { user_id: userId }, { active });

    res.json({ success: true, user: updated.rows[0], revokedCurrentSessionUser: !active && Number(userId) === Number(req.user.userId) });
  } catch (e) {
    console.error("Super admin access update error:", e.message);
    res.status(500).json({ error: "Failed to update super admin access" });
  }
});

app.delete("/api/admin/companies/:companyId", authenticateToken, isSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  let passportGuids = [];

  try {
    const { companyId } = req.params;
    const { password } = req.body || {};

    if (!password) return res.status(400).json({ error: "Admin password is required" });

    const adminRes = await client.query(
      "SELECT id, password_hash FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (!adminRes.rows.length) return res.status(401).json({ error: "Admin user not found" });

    const valid = await verifyPassword(password, adminRes.rows[0].password_hash);
    if (!valid) return res.status(403).json({ error: "Incorrect admin password" });

    await client.query("BEGIN");

    const companyRes = await client.query(
      "SELECT id, company_name FROM companies WHERE id = $1",
      [companyId]
    );
    if (!companyRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Company not found" });
    }

    const company = companyRes.rows[0];
    const userRes = await client.query(
      "SELECT id FROM users WHERE company_id = $1",
      [companyId]
    );
    const userIds = userRes.rows.map((row) => row.id);

    const regRes = await client.query(
      "SELECT guid, passport_type FROM passport_registry WHERE company_id = $1",
      [companyId]
    );
    passportGuids = regRes.rows.map((row) => row.guid);
    const passportTypes = [...new Set(regRes.rows.map((row) => row.passport_type).filter(Boolean))];

    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, action, table_name, passport_guid, old_values, new_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        null,
        req.user.userId,
        "DELETE_COMPANY",
        "companies",
        null,
        JSON.stringify({ company }),
        JSON.stringify({ deleted_company_id: company.id, deleted_company_name: company.company_name }),
      ]
    );

    if (passportGuids.length) {
      await client.query("DELETE FROM passport_dynamic_values WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
      await client.query("DELETE FROM passport_signatures WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
      await client.query("DELETE FROM passport_scan_events WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
      await client.query("DELETE FROM passport_workflow WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
    }

    for (const passportType of passportTypes) {
      const tableName = getTable(passportType);
      await client.query(`DELETE FROM ${tableName} WHERE company_id = $1`, [companyId]);
    }

    await client.query("DELETE FROM passport_registry WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM invite_tokens WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM api_keys WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM company_repository WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM company_passport_access WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM passport_workflow WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM audit_logs WHERE company_id = $1", [companyId]);

    if (userIds.length) {
      await client.query("DELETE FROM notifications WHERE user_id = ANY($1::int[])", [userIds]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])", [userIds]);
    }

    await client.query("DELETE FROM users WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM companies WHERE id = $1", [companyId]);

    await client.query("COMMIT");

    const repoDir = path.join(REPO_BASE_DIR, String(companyId));
    fs.rmSync(repoDir, { recursive: true, force: true });
    passportGuids.forEach((guid) => {
      fs.rmSync(path.join(FILES_BASE_DIR, String(guid)), { recursive: true, force: true });
    });

    res.json({
      success: true,
      deletedCompany: company,
      deletedCurrentSessionUser: userIds.includes(req.user.userId),
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Delete company error:", e.message);
    res.status(500).json({ error: "Failed to delete company" });
  } finally {
    client.release();
  }
});

// ─── ADMIN: SYSTEM-WIDE ANALYTICS ──────────────────────────────────────────
app.get("/api/admin/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const companiesRes = await pool.query("SELECT id, company_name FROM companies ORDER BY company_name");
    const accessRes    = await pool.query(`
      SELECT cpa.company_id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
      FROM company_passport_access cpa
      JOIN passport_types pt ON pt.id = cpa.passport_type_id
    `);

    const overall = {
      total_companies: companiesRes.rows.length,
      total_passports: 0, draft_count: 0, released_count: 0, revised_count: 0,
    };
    const byCompany  = [];
    const byType     = [];
    const umbrellaMap = {}; // umbrella_category → aggregated data

    for (const company of companiesRes.rows) {
      const grantedTypes = accessRes.rows.filter(a => a.company_id === company.id);

      let compStats = { id: company.id, company_name: company.company_name,
                        total_passports: 0, draft_count: 0, released_count: 0, revised_count: 0 };

      for (const typeAccess of grantedTypes) {
        try {
          const stats = await queryTableStats(typeAccess.type_name, company.id);
          if (stats.total === 0) continue;

          compStats.total_passports += stats.total;
          compStats.draft_count     += stats.draft;
          compStats.released_count  += stats.released;
          compStats.revised_count   += stats.revised;

          overall.total_passports += stats.total;
          overall.draft_count     += stats.draft;
          overall.released_count  += stats.released;
          overall.revised_count   += stats.revised;

          // Umbrella grouping
          const umb = typeAccess.umbrella_category;
          if (!umbrellaMap[umb]) {
            umbrellaMap[umb] = {
              umbrella_category: umb,
              umbrella_icon: typeAccess.umbrella_icon,
              total: 0, draft: 0, released: 0, revised: 0,
              types: {},
            };
          }
          umbrellaMap[umb].total    += stats.total;
          umbrellaMap[umb].draft    += stats.draft;
          umbrellaMap[umb].released += stats.released;
          umbrellaMap[umb].revised  += stats.revised;

          const tKey = typeAccess.type_name;
          if (!umbrellaMap[umb].types[tKey]) {
            umbrellaMap[umb].types[tKey] = {
              type_name: tKey,
              display_name: typeAccess.display_name,
              total: 0, draft: 0, released: 0, revised: 0,
            };
          }
          umbrellaMap[umb].types[tKey].total    += stats.total;
          umbrellaMap[umb].types[tKey].draft    += stats.draft;
          umbrellaMap[umb].types[tKey].released += stats.released;
          umbrellaMap[umb].types[tKey].revised  += stats.revised;

          byType.push({
            company_name:     company.company_name,
            passport_type:    typeAccess.type_name,
            display_name:     typeAccess.display_name,
            umbrella_category: umb,
            total_count:      stats.total,
            draft_count:      stats.draft,
            released_count:   stats.released,
            revised_count:    stats.revised,
          });
        } catch (e) { console.error(`Analytics error for ${company.id}/${typeAccess.type_name}:`, e.message); }
      }

      byCompany.push(compStats);
    }

    // Convert umbrella map to array with types as array
    const byUmbrella = Object.values(umbrellaMap).map(u => ({
      ...u,
      types: Object.values(u.types),
    }));

    res.json({ overall, byCompany, byType, byUmbrella });
  } catch (e) { console.error("Admin analytics error:", e.message); res.status(500).json({ error: "Failed to fetch analytics" }); }
});

// ─── ADMIN: PER-COMPANY ANALYTICS ──────────────────────────────────────────
app.get("/api/admin/companies/:companyId/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { companyId } = req.params;

    const accessRes = await pool.query(`
      SELECT pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
      FROM company_passport_access cpa
      JOIN passport_types pt ON pt.id = cpa.passport_type_id
      WHERE cpa.company_id = $1
    `, [companyId]);

    let totalPassports = 0;
    const analytics    = [];
    const trendMonths = [];
    const trendStart = new Date();
    trendStart.setDate(1);
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setMonth(trendStart.getMonth() - 5);
    for (let i = 0; i < 6; i++) {
      const month = new Date(trendStart);
      month.setMonth(trendStart.getMonth() + i);
      trendMonths.push(month);
    }
    const trendSeriesMap = {};

    for (const { type_name, display_name, umbrella_category, umbrella_icon } of accessRes.rows) {
      try {
        const stats = await queryTableStats(type_name, companyId);
        if (stats.total === 0) continue;
        totalPassports += stats.total;
        analytics.push({
          passport_type:    type_name,
          display_name,
          umbrella_category,
          umbrella_icon,
          total:            stats.total,
          draft_count:      stats.draft,
          released_count:   stats.released,
          revised_count:    stats.revised,
          in_review_count:  stats.in_review,
        });

        const tableName = getTable(type_name);
        const baselineRes = await pool.query(
          `SELECT COUNT(*) AS count
           FROM ${tableName}
           WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
          [companyId, trendStart.toISOString()]
        );
        const monthlyRes = await pool.query(
          `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
           FROM ${tableName}
           WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
           GROUP BY 1
           ORDER BY 1`,
          [companyId, trendStart.toISOString()]
        );

        if (!trendSeriesMap[umbrella_category]) {
          trendSeriesMap[umbrella_category] = {
            umbrella_category,
            umbrella_icon,
            baseline: 0,
            monthlyCounts: Object.fromEntries(
              trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])
            ),
          };
        }

        trendSeriesMap[umbrella_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
        monthlyRes.rows.forEach((row) => {
          const key = new Date(row.month_bucket).toISOString().slice(0, 7);
          trendSeriesMap[umbrella_category].monthlyCounts[key] =
            (trendSeriesMap[umbrella_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
        });
      } catch (e) { console.error(`Per-company analytics error for ${companyId}/${type_name}:`, e.message); }
    }

    const scanRes = await pool.query(
      `SELECT COUNT(*) FROM passport_scan_events pse
       JOIN passport_registry pr ON pr.guid = pse.passport_guid
       WHERE pr.company_id = $1`,
      [companyId]
    );
    const scanStats = parseInt(scanRes.rows[0]?.count || 0, 10) || 0;
    const trend = {
      labels: trendMonths.map((month) =>
        month.toLocaleString("en-US", { month: "short" })
      ),
      series: Object.values(trendSeriesMap).map((series) => {
        let running = series.baseline;
        return {
          umbrella_category: series.umbrella_category,
          umbrella_icon: series.umbrella_icon,
          values: trendMonths.map((month) => {
            const key = month.toISOString().slice(0, 7);
            running += series.monthlyCounts[key] || 0;
            return running;
          }),
        };
      }),
    };

    const users = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login_at
       FROM users WHERE company_id = $1 AND role != 'super_admin' ORDER BY role, first_name`,
      [companyId]
    );
    const comp = await pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]);

    res.json({ totalPassports, analytics, scanStats, trend, users: users.rows, company: comp.rows[0] });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// ─── ADMIN: UPDATE ANY USER'S ROLE ─────────────────────────────────────────
app.patch("/api/admin/users/:userId/role", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!["company_admin","editor","viewer"].includes(role))
      return res.status(400).json({ error: "Invalid role" });
    await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [role, req.params.userId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ─── ADMIN: COMPANY ACCESS ──────────────────────────────────────────────────
// Granting access also creates the company-specific passport table
app.post("/api/admin/company-access", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { companyId, passportTypeId } = req.body;
    if (!companyId || !passportTypeId)
      return res.status(400).json({ error: "companyId and passportTypeId required" });

    const typeRes = await pool.query(
      "SELECT type_name, display_name FROM passport_types WHERE id = $1",
      [passportTypeId]
    );
    if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });
    const { type_name, display_name } = typeRes.rows[0];

    const r = await pool.query(
      `INSERT INTO company_passport_access (company_id, passport_type_id, access_revoked)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (company_id, passport_type_id) DO UPDATE SET access_revoked = FALSE
       RETURNING *`,
      [companyId, passportTypeId]
    );

    res.status(201).json({
      success: true,
      access: r.rows[0],
      table: getTable(type_name),
      display_name,
    });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Access already granted" });
    console.error("Grant access error:", e.message);
    res.status(500).json({ error: "Failed to grant access" });
  }
});

// Revoking access: soft-revoke (keeps row + data), auto-releases all draft passports of that type
app.delete("/api/admin/company-access/:companyId/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const { companyId, typeId } = req.params;

    // Soft-revoke: mark access_revoked = true instead of deleting
    const r = await pool.query(
      `UPDATE company_passport_access SET access_revoked = TRUE
       WHERE company_id = $1 AND passport_type_id = $2 RETURNING id`,
      [companyId, typeId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Access record not found" });

    // Auto-release all draft/in_review passports for this company + type
    const typeRes = await pool.query("SELECT type_name FROM passport_types WHERE id = $1", [typeId]);
    if (typeRes.rows.length) {
      const tbl = getTable(typeRes.rows[0].type_name);
      await pool.query(
        `UPDATE ${tbl} SET release_status = 'released', updated_at = NOW()
         WHERE company_id = $1 AND release_status IN ('draft', 'in_review')`,
        [companyId]
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error("Revoke access error:", e.message);
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

// ─── PASSPORT TYPES PER COMPANY ─────────────────────────────────────────────
// Returns display_name, umbrella_category, umbrella_icon for sidebar rendering
app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.fields_json,
        (NOT cpa.access_revoked) AS access_granted
      FROM passport_types pt
      JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
      WHERE cpa.company_id = $1
      ORDER BY pt.umbrella_category, pt.display_name
    `, [req.params.companyId]);

    res.json(r.rows);
  } catch (e) { console.error("passport-types fetch error:", e.message); res.status(500).json({ error: "Failed to fetch passport types" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PASSPORTS — CRUD (all use company-specific tables)
// ═══════════════════════════════════════════════════════════════════════════

// CREATE
app.post("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId }              = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const { passport_type, model_name, product_id, ...fields } = normalizedBody;
    const userId = req.user.userId;

    if (!passport_type)
      return res.status(400).json({ error: "passport_type is required" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) {
      return res.status(404).json({ error: "Passport type not found" });
    }

    const resolvedPassportType = typeSchema.typeName;
    const tableName = getTable(resolvedPassportType);
    const guid = uuidv4();
    const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(guid);
    const existingByProductId = await findExistingPassportByProductId({
      tableName,
      companyId,
      productId: normalizedProductId,
    });
    if (existingByProductId) {
      return res.status(409).json({
        error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
        existing_guid: existingByProductId.guid,
        release_status: normalizeReleaseStatus(existingByProductId.release_status),
      });
    }

    const incomingFieldKeys = Object.keys(fields);
    const invalidFieldKeys = incomingFieldKeys.filter(key =>
      !SYSTEM_PASSPORT_FIELDS.has(key) &&
      !typeSchema.allowedKeys.has(key)
    );
    if (invalidFieldKeys.length) {
      return res.status(400).json({
        error: "Unknown passport field(s) in request body",
        fields: invalidFieldKeys,
      });
    }
    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));

    // Convert array/table fields to JSON strings
    const processedFields = Object.fromEntries(
      dataFields.map((key) => [key, toStoredPassportValue(fields[key])])
    );

    const allCols = ["guid","company_id","model_name","product_id","created_by", ...dataFields];
    const allVals = [guid, companyId, model_name || null, normalizedProductId, userId, ...dataFields.map(k => processedFields[k])];
    const places  = allCols.map((_, i) => `$${i + 1}`).join(", ");

    const result = await pool.query(
      `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING *`,
      allVals
    );

    await pool.query(
      `INSERT INTO passport_registry (guid, company_id, passport_type)
       VALUES ($1, $2, $3) ON CONFLICT (guid) DO NOTHING`,
      [guid, companyId, resolvedPassportType]
    );

    await logAudit(companyId, userId, "CREATE", tableName, guid, null, {
      product_id: normalizedProductId,
      passport_type: resolvedPassportType,
      model_name,
    });
    res.status(201).json({ success: true, passport: result.rows[0] });
  } catch (e) {
    console.error("Create passport error:", e.message);
    res.status(500).json({ error: "Failed to create passport" });
  }
});

// BULK CREATE
// Body: { "passport_type": "battery", "passports": [ { "model_name": "...", ... }, ... ] }
// Returns per-item results — failures don't abort the rest.
// Max 500 records per call.
app.post("/api/companies/:companyId/passports/bulk", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const { passport_type, passports } = normalizedBody;
    const userId = req.user.userId;

    if (!passport_type)           return res.status(400).json({ error: "passport_type is required" });
    if (!Array.isArray(passports) || passports.length === 0)
      return res.status(400).json({ error: "passports must be a non-empty array" });
    if (passports.length > 500)   return res.status(400).json({ error: "Maximum 500 passports per bulk request" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) {
      return res.status(404).json({ error: "Passport type not found" });
    }

    const resolvedPassportType = typeSchema.typeName;
    const tableName = getTable(resolvedPassportType);

    const results  = [];
    let created = 0, skipped = 0, failed = 0;

    for (let i = 0; i < passports.length; i++) {
      const item = normalizePassportRequestBody(passports[i] || {});
      const { model_name, product_id, ...fields } = item;
      const guid = uuidv4();
      const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(guid);

      try {
        const existingByProductId = await findExistingPassportByProductId({
          tableName,
          companyId,
          productId: normalizedProductId,
        });
        if (existingByProductId) {
          results.push({
            index: i,
            product_id: normalizedProductId,
            success: false,
            error: `A passport with Serial Number "${normalizedProductId}" already exists — skipped`,
          });
          skipped++;
          continue;
        }

        const invalidFieldKeys = Object.keys(fields).filter(key =>
          !SYSTEM_PASSPORT_FIELDS.has(key) &&
          !typeSchema.allowedKeys.has(key)
        );
        if (invalidFieldKeys.length) {
          results.push({
            index: i,
            product_id: normalizedProductId,
            success: false,
            error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}`
          });
          failed++;
          continue;
        }

        const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));

        // Convert array/table fields to JSON strings
        const processedFields = Object.fromEntries(
          dataFields.map((key) => [key, toStoredPassportValue(fields[key])])
        );

        const allCols  = ["guid","company_id","model_name","product_id","created_by", ...dataFields];
        const allVals  = [guid, companyId, model_name || null, normalizedProductId, userId, ...dataFields.map(k => processedFields[k])];
        const places   = allCols.map((_, idx) => `$${idx + 1}`).join(", ");

        const r = await pool.query(
          `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING guid, model_name, product_id`,
          allVals
        );
        await pool.query(
          `INSERT INTO passport_registry (guid, company_id, passport_type) VALUES ($1,$2,$3) ON CONFLICT (guid) DO NOTHING`,
          [guid, companyId, resolvedPassportType]
        );
        await logAudit(companyId, userId, "CREATE", tableName, guid, null, {
          product_id: normalizedProductId,
          passport_type: resolvedPassportType,
          model_name,
          bulk: true,
        });

        results.push({ index: i, success: true, guid, product_id: normalizedProductId, model_name: model_name || null });
        created++;
      } catch (e) {
        results.push({ index: i, product_id: normalizedProductId, success: false, error: e.message });
        failed++;
      }
    }

    res.status(207).json({ summary: { total: passports.length, created, skipped, failed }, results });
  } catch (e) {
    console.error("Bulk create error:", e.message);
    res.status(500).json({ error: "Bulk create failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  API KEY MANAGEMENT  (company_admin only, JWT-authenticated)
// ═══════════════════════════════════════════════════════════════════════════

// List keys for a company (key_hash is never returned)
app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, key_prefix, created_at, last_used_at, is_active
       FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
      [req.params.companyId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to fetch API keys" }); }
});

// Generate a new API key — returns the raw key ONCE; only the hash is stored
app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });

    // Check per-company key limit (max 10 active keys)
    const count = await pool.query(
      "SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND is_active = true",
      [req.params.companyId]
    );
    if (parseInt(count.rows[0].count) >= 10)
      return res.status(400).json({ error: "Maximum of 10 active API keys per company" });

    const rawKey  = "dpp_" + crypto.randomBytes(20).toString("hex"); // 44 chars total
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.substring(0, 16);                        // "dpp_" + 12 hex chars

    const r = await pool.query(
      `INSERT INTO api_keys (company_id, name, key_hash, key_prefix, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, key_prefix, created_at`,
      [req.params.companyId, name.trim(), keyHash, keyPrefix, req.user.userId]
    );
    // Return the raw key only here — it cannot be recovered after this response
    res.status(201).json({ ...r.rows[0], key: rawKey });
  } catch (e) { console.error("Create API key error:", e.message); res.status(500).json({ error: "Failed to create API key" }); }
});

// Revoke a key
app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE api_keys SET is_active = false WHERE id = $1 AND company_id = $2 RETURNING id",
      [req.params.keyId, req.params.companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Key not found" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to revoke API key" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API  v1  —  authenticated by X-API-Key header
// ═══════════════════════════════════════════════════════════════════════════

// Open CORS for v1 — API consumers may call from any origin or server-side
app.use("/api/v1", (req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
  res.header("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// GET /api/v1/passports?type=battery&status=released&search=&limit=100&offset=0
app.get("/api/v1/passports", authenticateApiKey, apiKeyReadRateLimit, async (req, res) => {
  try {
    const { type, status, search, limit = "100", offset = "0" } = req.query;
    if (!type) return res.status(400).json({ error: "'type' query parameter is required" });

    const companyId = req.apiKey.companyId;
    const tableName = getTable(type);

    const cap = Math.min(parseInt(limit) || 100, 500);
    const off = Math.max(parseInt(offset) || 0, 0);

    let q = `SELECT * FROM ${tableName} WHERE deleted_at IS NULL AND company_id = $1`;
    const params = [companyId];
    let i = 2;
    if (status) { q += ` AND release_status = $${i++}`; params.push(status); }
    if (search) { q += ` AND (model_name ILIKE $${i} OR product_id ILIKE $${i})`; params.push(`%${search}%`); i++; }
    q += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(cap, off);

    const r = await pool.query(q, params);
    res.json({
      passport_type: type,
      count: r.rows.length,
      limit: cap,
      offset: off,
      passports: r.rows.map(p => ({ ...p, passport_type: type })),
    });
  } catch (e) { console.error("API v1 list error:", e.message); res.status(500).json({ error: "Failed to fetch passports" }); }
});

// GET /api/v1/passports/:guid
app.get("/api/v1/passports/:guid", authenticateApiKey, apiKeyReadRateLimit, async (req, res) => {
  try {
    const { guid }   = req.params;
    const companyId  = req.apiKey.companyId;

    // Resolve type from registry, enforcing company ownership
    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2",
      [guid, companyId]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    const tableName = getTable(reg.rows[0].passport_type);
    const r = await pool.query(
      `SELECT * FROM ${tableName} WHERE guid = $1 AND deleted_at IS NULL ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
    res.json({ ...r.rows[0], passport_type: reg.rows[0].passport_type });
  } catch (e) { console.error("API v1 get error:", e.message); res.status(500).json({ error: "Failed to fetch passport" }); }
});

// LIST
app.get("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId }    = req.params;
    const { passportType, search, status } = req.query;
    if (!passportType) return res.status(400).json({ error: "passportType query param is required" });

    const tableName = getTable(passportType);

    let q = `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
             FROM ${tableName} p
             LEFT JOIN users u ON u.id = p.created_by
             WHERE p.deleted_at IS NULL AND p.company_id = $1`;
    const params = [companyId]; let i = 2;

    if (status)  {
      const normalizedStatus = normalizeReleaseStatus(status);
      if (normalizedStatus === IN_REVISION_STATUS) {
        q += ` AND p.release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        q += ` AND p.release_status = $${i++}`;
        params.push(normalizedStatus);
      }
    }
    if (search)  { q += ` AND (p.model_name ILIKE $${i} OR p.product_id ILIKE $${i})`; params.push(`%${search}%`); i++; }
    q += " ORDER BY p.created_at DESC";

    const r = await pool.query(q, params);
    res.json(r.rows.map(row => ({ ...normalizePassportRow(row), passport_type: passportType })));
  } catch (e) { res.status(500).json({ error: "Failed to fetch passports" }); }
});

// BULK FETCH (retrieve multiple passports by product_id or guid — POST because GET can't have a body)
app.post("/api/companies/:companyId/passports/bulk-fetch", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;

    let passport_type, identifiers;
    if (Array.isArray(req.body)) {
      identifiers = req.body;
      passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
    } else {
      const normalizedBody = normalizePassportRequestBody(req.body);
      passport_type = normalizedBody.passport_type;
      identifiers = normalizedBody.passports || normalizedBody.identifiers;
    }
    if (!passport_type) return res.status(400).json({ error: "passport_type required" });
    if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
    if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const tableName = getTable(typeSchema.typeName);

    const results = [];

    for (const item of identifiers) {
      const raw = typeof item === "string" ? { product_id: item } : (item || {});
      const guid = raw.guid;
      const productId = normalizeProductIdValue(raw.product_id || raw.productId);

      try {
        let row = null;
        if (guid) {
          const r = await pool.query(
            `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
             FROM ${tableName} p LEFT JOIN users u ON u.id = p.created_by
             WHERE p.guid = $1 AND p.company_id = $2 AND p.deleted_at IS NULL
             ORDER BY p.version_number DESC LIMIT 1`,
            [guid, companyId]
          );
          row = r.rows[0];
        }
        if (!row && productId) {
          const r = await pool.query(
            `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
             FROM ${tableName} p LEFT JOIN users u ON u.id = p.created_by
             WHERE p.product_id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL
             ORDER BY p.version_number DESC LIMIT 1`,
            [productId, companyId]
          );
          row = r.rows[0];
        }
        if (row) {
          results.push({ ...normalizePassportRow(row), passport_type: typeSchema.typeName, _status: "found" });
        } else {
          results.push({ guid: guid || undefined, product_id: productId || undefined, _status: "not_found" });
        }
      } catch (e) {
        results.push({ guid: guid || undefined, product_id: productId || undefined, _status: "error", error: e.message });
      }
    }

    res.json({ total: identifiers.length, found: results.filter(r => r._status === "found").length, results });
  } catch (e) {
    console.error("Bulk fetch error:", e.message);
    res.status(500).json({ error: "Bulk fetch failed" });
  }
});

// ── Export passports as CSV/JSON by passport type ───────
// Query params: passportType (required), format=csv|json, status=draft|released|in_revision|all (default: draft)
app.get("/api/companies/:companyId/passports/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const passportType = req.query.passportType;
    const fmt = (req.query.format || "csv").toLowerCase();
    const statusFilter = (req.query.status || "draft").toLowerCase();

    if (!passportType) return res.status(400).json({ error: "passportType is required" });

    const typeRes = await pool.query(
      "SELECT fields_json FROM passport_types WHERE type_name=$1",
      [passportType]
    );
    if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });

    const sections = typeRes.rows[0]?.fields_json?.sections || [];
    const schemaFields = sections.flatMap(s => s.fields || []);

    const tableName = getTable(passportType);
    const cols = ["guid", "model_name", "product_id", "release_status", ...schemaFields.map(f => f.key)];
    const safeColsSql = cols.map(c => /^[a-z][a-z0-9_]*$/.test(c) ? c : null).filter(Boolean);

    let statusSql;
    if (statusFilter === "all") {
      statusSql = "";
    } else if (statusFilter === "released") {
      statusSql = ` AND release_status = 'released'`;
    } else if (statusFilter === "in_revision" || statusFilter === "revised") {
      statusSql = ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
    } else {
      statusSql = ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
    }

    const passRes = await pool.query(
      `SELECT ${safeColsSql.join(", ")} FROM ${tableName}
       WHERE company_id=$1${statusSql} AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [companyId]
    );
    const rows = passRes.rows;

    if (fmt === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.json"`);
      return res.json(rows);
    }

    const escCell = (v) => {
      const str = (Array.isArray(v) || (typeof v === "object" && v !== null))
        ? JSON.stringify(v) : String(v ?? "");
      return `"${str.replace(/"/g, '""')}"`;
    };
    const fieldRows = [
      ["guid",           ...rows.map(r => r.guid)],
      ["model_name",     ...rows.map(r => r.model_name || "")],
      ["product_id",     ...rows.map(r => r.product_id || "")],
      ["release_status", ...rows.map(r => r.release_status || "")],
      ...schemaFields.map(f => [f.label || f.key, ...rows.map(r => r[f.key] ?? "")]),
    ];
    const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
    const csvLines = [headerRow, ...fieldRows].map(row => row.map(escCell).join(","));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.csv"`);
    res.send(csvLines.join("\n"));
  } catch (e) {
    console.error("Export by type error:", e.message);
    res.status(500).json({ error: "Export failed" });
  }
});

// GET SINGLE — company-scoped (for dashboard)
app.get("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType }    = req.query;
    if (!passportType) return res.status(400).json({ error: "passportType query param required" });

    const tableName = getTable(passportType);

    const r = await pool.query(
      `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
       FROM ${tableName} p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.guid = $1 AND p.company_id = $2 AND p.deleted_at IS NULL
       ORDER BY p.version_number DESC LIMIT 1`,
      [guid, companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
    res.json({ ...normalizePassportRow(r.rows[0]), passport_type: passportType });
  } catch (e) { res.status(500).json({ error: "Failed to fetch passport" }); }
});

app.get("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const editors = await listActiveEditSessions(req.params.guid, req.user.userId);
    res.json({
      editors,
      timeoutHours: EDIT_SESSION_TIMEOUT_HOURS,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch edit session" });
  }
});

app.post("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType } = req.body;

    if (!passportType) return res.status(400).json({ error: "passportType required" });

    await clearExpiredEditSessions();
    await pool.query(
      `INSERT INTO passport_edit_sessions (passport_guid, company_id, passport_type, user_id, last_activity_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (passport_guid, user_id)
       DO UPDATE SET
         company_id = EXCLUDED.company_id,
         passport_type = EXCLUDED.passport_type,
         last_activity_at = NOW(),
         updated_at = NOW()`,
      [guid, companyId, passportType, req.user.userId]
    );

    const editors = await listActiveEditSessions(guid, req.user.userId);
    res.json({
      success: true,
      editors,
      timeoutHours: EDIT_SESSION_TIMEOUT_HOURS,
      lastActivityAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to update edit session" });
  }
});

app.delete("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM passport_edit_sessions WHERE passport_guid = $1 AND user_id = $2",
      [req.params.guid, req.user.userId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to clear edit session" });
  }
});

// GET SINGLE — public viewer (uses registry to find the right table)
// Non-public fields are stripped from the response; use the /unlock endpoint to access them.
app.get("/api/passports/:guid", publicReadRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1",
      [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    const { passport_type } = reg.rows[0];
    const tableName = getTable(passport_type);

    const r = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE guid = $1 AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
    const passport = { ...normalizePassportRow(r.rows[0]), passport_type };

    // Strip any fields whose access level is not "public"
    // (fetch type definition to know which fields are restricted)
    try {
      const typeRes = await pool.query(
        "SELECT fields_json FROM passport_types WHERE type_name = $1",
        [passport_type]
      );
      if (typeRes.rows.length) {
        const sections = typeRes.rows[0].fields_json?.sections || [];
        for (const section of sections) {
          for (const field of (section.fields || [])) {
            const access = field.access || ["public"];
            if (!access.includes("public")) {
              delete passport[field.key]; // remove restricted field value
            }
          }
        }
      }
    } catch { /* non-fatal — serve whatever we have */ }

    res.json(passport);
  } catch (e) { res.status(500).json({ error: "Failed to fetch passport" }); }
});

app.get("/api/passports/:guid/history", publicReadRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1",
      [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    const passportType = reg.rows[0].passport_type;
    const historyPayload = await buildPassportVersionHistory({
      guid,
      passportType,
      publicOnly: true,
    });

    res.json(historyPayload);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch passport history" });
  }
});

// ── AAS export — public (released passports only) ────────────────────────────
app.get("/api/passports/:guid/export/aas", publicHeavyRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const reg = await pool.query(
      "SELECT company_id, passport_type FROM passport_registry WHERE guid = $1", [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
    const { company_id, passport_type } = reg.rows[0];
    const tbl = getTable(passport_type);

    const r = await pool.query(
      `SELECT * FROM ${tbl} WHERE guid = $1 AND deleted_at IS NULL AND release_status = 'released'
       ORDER BY version_number DESC LIMIT 1`, [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found or not released" });

    const [typeRes, companyRes, dynRes] = await Promise.all([
      pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passport_type]),
      pool.query("SELECT company_name FROM companies WHERE id = $1", [company_id]),
      pool.query(
        `SELECT DISTINCT ON (field_key) field_key, value, updated_at
         FROM passport_dynamic_values WHERE passport_guid = $1
         ORDER BY field_key, updated_at DESC`, [guid]
      ),
    ]);

    const typeDef = typeRes.rows[0] || null;
    const companyName = companyRes.rows[0]?.company_name || "";
    const dynamicValues = Object.fromEntries(
      dynRes.rows.map(r => [r.field_key, { value: r.value, updatedAt: r.updated_at }])
    );

    const aas = buildAasExport({ ...r.rows[0], passport_type }, typeDef, dynamicValues, companyName);

    res.setHeader("Content-Disposition", `attachment; filename="passport-${guid}.aas.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json(aas);
  } catch (e) {
    console.error("AAS export error:", e.message);
    res.status(500).json({ error: "Failed to generate AAS export" });
  }
});

// ── AAS export — authenticated (any status) ───────────────────────────────────
app.get("/api/companies/:companyId/passports/:guid/export/aas",
  authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2",
      [guid, companyId]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
    const { passport_type } = reg.rows[0];
    const tbl = getTable(passport_type);

    const r = await pool.query(
      `SELECT * FROM ${tbl} WHERE guid = $1 AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`, [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });

    const [typeRes, companyRes, dynRes] = await Promise.all([
      pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passport_type]),
      pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]),
      pool.query(
        `SELECT DISTINCT ON (field_key) field_key, value, updated_at
         FROM passport_dynamic_values WHERE passport_guid = $1
         ORDER BY field_key, updated_at DESC`, [guid]
      ),
    ]);

    const typeDef = typeRes.rows[0] || null;
    const companyName = companyRes.rows[0]?.company_name || "";
    const dynamicValues = Object.fromEntries(
      dynRes.rows.map(r => [r.field_key, { value: r.value, updatedAt: r.updated_at }])
    );

    const aas = buildAasExport({ ...r.rows[0], passport_type }, typeDef, dynamicValues, companyName);

    res.setHeader("Content-Disposition", `attachment; filename="passport-${guid}.aas.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json(aas);
  } catch (e) {
    console.error("AAS export error:", e.message);
    res.status(500).json({ error: "Failed to generate AAS export" });
  }
});

// SIGNATURE — public verification endpoint
app.get("/api/passports/:guid/signature", publicReadRateLimit, async (req, res) => {
  try {
    const { guid }   = req.params;
    const versionNum = req.query.version ? parseInt(req.query.version, 10) : null;

    // Find latest released version if not specified
    let version = versionNum;
    if (!version) {
      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (reg.rows.length) {
        const tbl = getTable(reg.rows[0].passport_type);
        const vRes = await pool.query(
          `SELECT version_number FROM ${tbl} WHERE guid = $1 AND release_status = 'released'
           ORDER BY version_number DESC LIMIT 1`, [guid]
        );
        version = vRes.rows[0]?.version_number || 1;
      }
      version = version || 1;
    }

    const verifyResult = await verifyPassportSignature(guid, version);

    // Include the full Verifiable Credential so any verifier can independently check it
    let credential = null;
    if (verifyResult.status !== "unsigned" && verifyResult.status !== "not_found") {
      const vcRow = await pool.query(
        "SELECT vc_json FROM passport_signatures WHERE passport_guid = $1 AND version_number = $2",
        [guid, version]
      );
      if (vcRow.rows[0]?.vc_json) {
        credential = JSON.parse(vcRow.rows[0].vc_json);
      }
    }

    res.json({ ...verifyResult, ...(credential ? { credential } : {}) });
  } catch (e) {
    console.error("Signature verify error:", e.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// PUBLIC KEY — returns active signing public key
app.get("/api/signing-key", publicReadRateLimit, async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT key_id, public_key, algorithm, created_at FROM passport_signing_keys ORDER BY created_at DESC LIMIT 1"
    );
    if (!r.rows.length) return res.status(404).json({ error: "No signing key found" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Failed to retrieve signing key" });
  }
});

// DID DOCUMENT — resolves did:web:<domain> to this server's public key
// Any external verifier fetches this URL to obtain the public key used to verify VC signatures.
app.get("/.well-known/did.json", async (_req, res) => {
  try {
    if (!_signingKey) return res.status(503).json({ error: "Signing key not loaded" });
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const domain = new URL(appUrl).host;
    const did    = `did:web:${domain}`;

    // Export public key as JWK — standard format for DID documents
    const pubKey = crypto.createPublicKey(_signingKey.publicKey);
    const jwk    = pubKey.export({ format: "jwk" });

    const didDocument = {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/jws-2020/v1",
      ],
      id: did,
      verificationMethod: [{
        id:           `${did}#key-1`,
        type:         "JsonWebKey2020",
        controller:   did,
        publicKeyJwk: { ...jwk, kid: _signingKey.keyId },
      }],
      authentication:  [`${did}#key-1`],
      assertionMethod: [`${did}#key-1`],
    };

    res.setHeader("Content-Type", "application/did+ld+json");
    res.json(didDocument);
  } catch (e) {
    console.error("DID document error:", e.message);
    res.status(500).json({ error: "Failed to generate DID document" });
  }
});

// UNLOCK — validate access key and return full passport data including restricted fields
app.post("/api/passports/:guid/unlock", publicUnlockRateLimit, async (req, res) => {
  try {
    const { guid }      = req.params;
    const { accessKey } = req.body;
    if (!accessKey) return res.status(400).json({ error: "accessKey is required" });

    const reg = await pool.query(
      "SELECT passport_type, access_key FROM passport_registry WHERE guid = $1",
      [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    // Use timing-safe comparison to prevent timing-based enumeration of access keys
    const storedKey = reg.rows[0].access_key || "";
    const suppliedKey = String(accessKey);
    const keysMatch = storedKey.length === suppliedKey.length &&
      crypto.timingSafeEqual(Buffer.from(storedKey), Buffer.from(suppliedKey));
    if (!keysMatch)
      return res.status(401).json({ error: "Invalid access key" });

    const { passport_type } = reg.rows[0];
    const tableName = getTable(passport_type);

    const r = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE guid = $1 AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });

    res.json({ success: true, passport: { ...normalizePassportRow(r.rows[0]), passport_type } });
  } catch (e) { res.status(500).json({ error: "Failed to unlock passport" }); }
});

// ACCESS KEY — let company users retrieve the access key so they can share it
app.get("/api/companies/:companyId/passports/:guid/access-key",
  authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT access_key FROM passport_registry WHERE guid = $1 AND company_id = $2",
        [req.params.guid, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ accessKey: r.rows[0].access_key });
    } catch (e) { res.status(500).json({ error: "Failed to get access key" }); }
  }
);

// BULK UPDATE ALL — update every matching passport with the same field values
// Body: { passport_type, filter: { status }, update: { field: value, ... } }
app.patch("/api/companies/:companyId/passports/bulk-update-all", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.userId;
    const { passport_type, passportType, filter, update } = normalizePassportRequestBody(req.body);

    const requestedType = passport_type || passportType;
    if (!requestedType) return res.status(400).json({ error: "passport_type required" });
    if (!update || typeof update !== "object" || !Object.keys(update).length)
      return res.status(400).json({ error: "update object with at least one field is required" });

    const typeSchema = await getPassportTypeSchema(requestedType);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const tableName = getTable(typeSchema.typeName);

    // Validate update fields against schema
    const invalidKeys = Object.keys(update).filter((key) =>
      !typeSchema.allowedKeys.has(key) && key !== "model_name" && key !== "product_id"
    );
    if (invalidKeys.length)
      return res.status(400).json({ error: `Unknown field(s): ${invalidKeys.join(", ")}` });

    // Cannot bulk-set product_id (it must be unique per passport)
    if (update.product_id !== undefined)
      return res.status(400).json({ error: "Cannot bulk-update product_id — it must be unique per passport. Use PATCH /passports instead." });

    // Build WHERE clause from filter
    const params = [companyId];
    let filterSql = "";
    const filterObj = filter || {};

    // Status filter — default to editable statuses only
    const statusFilter = (filterObj.status || "editable").toLowerCase();
    if (statusFilter === "all_editable" || statusFilter === "editable" || statusFilter === "draft") {
      filterSql += ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
    } else if (statusFilter === "draft_only") {
      filterSql += ` AND release_status = 'draft'`;
    } else if (statusFilter === "in_revision") {
      filterSql += ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
    } else {
      return res.status(400).json({ error: `Invalid status filter "${statusFilter}". Use: editable, draft_only, in_revision` });
    }

    // Optional product_id pattern filter (ILIKE)
    if (filterObj.product_id_like) {
      params.push(`%${filterObj.product_id_like}%`);
      filterSql += ` AND product_id ILIKE $${params.length}`;
    }

    // Optional model_name pattern filter
    if (filterObj.model_name_like) {
      params.push(`%${filterObj.model_name_like}%`);
      filterSql += ` AND model_name ILIKE $${params.length}`;
    }

    // Optional created_after / created_before date filters
    if (filterObj.created_after) {
      params.push(filterObj.created_after);
      filterSql += ` AND created_at >= $${params.length}`;
    }
    if (filterObj.created_before) {
      params.push(filterObj.created_before);
      filterSql += ` AND created_at <= $${params.length}`;
    }

    // First, count how many will be affected (dry run safety check)
    const countRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE company_id = $1${filterSql} AND deleted_at IS NULL`,
      params
    );
    const matchCount = parseInt(countRes.rows[0].cnt, 10);

    if (matchCount === 0)
      return res.json({ summary: { matched: 0, updated: 0 }, message: "No passports matched the filter" });

    // Safety: if more than 1000, require explicit confirmation
    if (matchCount > 1000 && !req.body.confirm_large_update)
      return res.status(400).json({
        error: `This will update ${matchCount} passports. Send confirm_large_update: true to proceed.`,
        matched: matchCount,
      });

    // Build SET clause from update fields
    const updateKeys = getWritablePassportColumns(update);
    if (!updateKeys.length)
      return res.status(400).json({ error: "No valid fields to update" });

    const updateVals = getStoredPassportValues(updateKeys, update);
    const setOffset = params.length;
    const sets = updateKeys.map((col, i) => `${col} = $${setOffset + i + 1}`).join(", ");
    const allParams = [...params, ...updateVals, userId];
    const updatedByIdx = allParams.length;

    const updateRes = await pool.query(
      `UPDATE ${tableName}
       SET ${sets}, updated_by = $${updatedByIdx}, updated_at = NOW()
       WHERE company_id = $1${filterSql} AND deleted_at IS NULL
       RETURNING guid`,
      allParams
    );

    const updatedGuids = updateRes.rows.map(r => r.guid);

    // Audit log for bulk operation
    await logAudit(companyId, userId, "BULK_UPDATE_ALL", tableName, null, null, {
      filter: filterObj,
      fields_updated: updateKeys,
      count: updatedGuids.length,
    });

    res.json({
      summary: { matched: matchCount, updated: updatedGuids.length, fields_updated: updateKeys },
      guids: updatedGuids,
    });
  } catch (e) {
    console.error("Bulk update all error:", e.message, e.stack);
    res.status(500).json({ error: "Bulk update all failed", detail: e.message });
  }
});

// UPDATE (draft / in revision only)
app.patch("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const { passport_type, passportType, ...fields } = normalizedBody;
    const userId = req.user.userId;

    const requestedPassportType = passport_type || passportType;
    if (!requestedPassportType) return res.status(400).json({ error: "passportType is required in body" });
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const tableName = getTable(typeSchema.typeName);

    const current = await pool.query(
      `SELECT id, product_id FROM ${tableName}
       WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!current.rows.length)
      return res.status(404).json({ error: "Passport not found or not editable." });
    const rowId = current.rows[0].id;

    if (fields.product_id !== undefined) {
      const normalizedProductId = normalizeProductIdValue(fields.product_id);
      if (!normalizedProductId) {
        return res.status(400).json({ error: "product_id cannot be blank" });
      }
      const existingByProductId = await findExistingPassportByProductId({
        tableName,
        companyId,
        productId: normalizedProductId,
        excludeGuid: guid,
      });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
          existing_guid: existingByProductId.guid,
          release_status: normalizeReleaseStatus(existingByProductId.release_status),
        });
      }
      fields.product_id = normalizedProductId;
    }

    const updateFields = await updatePassportRowById({ tableName, rowId, userId, data: fields });
    if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });

    await logAudit(companyId, userId, "UPDATE", tableName, guid, null, { fields_updated: updateFields });
    res.json({ success: true });
  } catch (e) {
    console.error("PATCH /passports/:guid error:", e.message, e.stack);
    res.status(500).json({ error: "Failed to update passport", detail: e.message });
  }
});

// BULK UPDATE (update-only, no creates — match by product_id or guid in body)
app.patch("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.userId;

    let passport_type, passports;
    if (Array.isArray(req.body)) {
      passports = req.body;
      passport_type = passports[0]?.passport_type || passports[0]?.passportType;
    } else {
      const normalizedBody = normalizePassportRequestBody(req.body);
      passport_type = normalizedBody.passport_type;
      passports = normalizedBody.passports;
    }
    if (!passport_type) return res.status(400).json({ error: "passport_type required" });
    if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
    if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const tableName = getTable(typeSchema.typeName);

    let updated = 0, skipped = 0, failed = 0;
    const details = [];

    for (const item of passports) {
      const normalizedItem = normalizePassportRequestBody(item || {});
      const { guid: incomingGuid, passport_type: _pt, passportType: _pt2, ...fields } = normalizedItem;
      const normalizedProductId = normalizeProductIdValue(fields.product_id);

      try {
        // Must have at least one identifier
        if (!incomingGuid && !normalizedProductId) {
          details.push({ status: "failed", error: "Each item needs a guid or product_id to match against" });
          failed++; continue;
        }

        // Validate field names against schema
        const builtInCols = new Set(["product_id", "model_name"]);
        const invalidKeys = Object.keys(fields).filter((key) =>
          !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key) && !builtInCols.has(key)
        );
        if (invalidKeys.length) {
          details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: `Unknown field(s): ${invalidKeys.join(", ")}` });
          failed++; continue;
        }

        // Find existing passport — by guid first, then by product_id
        let rowId, matchedGuid;
        if (incomingGuid) {
          const byGuid = await pool.query(
            `SELECT id, guid FROM ${tableName} WHERE guid=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
            [incomingGuid, companyId]
          );
          if (byGuid.rows.length) { rowId = byGuid.rows[0].id; matchedGuid = byGuid.rows[0].guid; }
        }
        if (!rowId && normalizedProductId) {
          const byProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
          if (byProductId && isEditablePassportStatus(normalizeReleaseStatus(byProductId.release_status))) {
            rowId = byProductId.id; matchedGuid = byProductId.guid;
          }
        }

        if (!rowId) {
          details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No matching editable passport found" });
          skipped++; continue;
        }

        // product_id uniqueness check if changing it
        if (fields.product_id !== undefined) {
          if (!normalizedProductId) {
            details.push({ guid: matchedGuid, status: "failed", error: "product_id cannot be blank" });
            failed++; continue;
          }
          const dup = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId, excludeGuid: matchedGuid });
          if (dup) {
            details.push({ guid: matchedGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
            failed++; continue;
          }
          fields.product_id = normalizedProductId;
        }

        const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: fields });
        if (!updateCols.length) {
          details.push({ guid: matchedGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No changes detected" });
          skipped++; continue;
        }

        await logAudit(companyId, userId, "UPDATE", tableName, matchedGuid, null, { source: "bulk_patch", fields_updated: updateCols });
        details.push({ guid: matchedGuid, product_id: normalizedProductId || undefined, status: "updated", fields_updated: updateCols });
        updated++;
      } catch (e) {
        console.error("Bulk PATCH item error:", e.message);
        details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: e.message });
        failed++;
      }
    }

    res.json({ summary: { updated, skipped, failed, total: passports.length }, details });
  } catch (e) {
    console.error("Bulk PATCH error:", e.message, e.stack);
    res.status(500).json({ error: "Bulk update failed", detail: e.message });
  }
});

// RELEASE
app.patch("/api/companies/:companyId/passports/:guid/release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType }    = req.body;
    if (!passportType) return res.status(400).json({ error: "passportType required in body" });

    const tableName = getTable(passportType);
    const r = await pool.query(
      `UPDATE ${tableName}
       SET release_status = 'released', updated_at = NOW()
       WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
       RETURNING *`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found or already released" });
    const released = r.rows[0];

    // Sign the released passport
    const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passportType]);
    const sigData = await signPassport({ ...released, passport_type: passportType }, typeRes.rows[0] || null);
    if (sigData) {
      await pool.query(
        `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, signing_key_id, released_at, vc_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
        [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
      );
    }

    await logAudit(companyId, req.user.userId, "RELEASE", tableName, guid,
      { release_status: "draft_or_in_revision" }, { release_status: "released" });
    res.json({ success: true, passport: normalizePassportRow(released) });
  } catch (e) { res.status(500).json({ error: "Failed to release passport" }); }
});

// REVISE
app.post("/api/companies/:companyId/passports/:guid/revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType }    = req.body;
    const userId = req.user.userId;

    if (!passportType) return res.status(400).json({ error: "passportType required in body" });
    const tableName = getTable(passportType);

    const current = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE guid = $1 AND release_status = 'released'
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

    const dup = await pool.query(
      `SELECT id FROM ${tableName} WHERE guid = $1 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL`,
      [guid]
    );
    if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

    const src        = current.rows[0];
    const newVersion = src.version_number + 1;
    const excluded   = new Set(["id","guid","created_at","updated_at","updated_by","qr_code"]);
    const cols       = Object.keys(src).filter(k => !excluded.has(k));
    const vals       = cols.map(k => {
      if (k === "version_number") return newVersion;
      if (k === "release_status") return IN_REVISION_STATUS;
      if (k === "created_by")     return userId;
      if (k === "deleted_at")     return null;
      return src[k];
    });

    const allCols = ["guid", ...cols];
    const allVals = [guid, ...vals];
    const places  = allCols.map((_, i) => `$${i + 1}`).join(", ");
    await pool.query(`INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places})`, allVals);

    await logAudit(companyId, userId, "REVISE", tableName, guid,
      { version_number: src.version_number }, { version_number: newVersion });
    res.json({ success: true, newVersion, release_status: IN_REVISION_STATUS });
  } catch (e) { res.status(500).json({ error: "Failed to revise passport" }); }
});

// BULK REVISE
app.post("/api/companies/:companyId/passports/bulk-revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.userId;
    const {
      items,
      changes,
      revisionNote = "",
      submitToWorkflow = false,
      reviewerId = null,
      approverId = null,
      scopeType = "selected",
      scopeMeta = {},
    } = req.body || {};

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }
    if (items.length > 500) {
      return res.status(400).json({ error: "Maximum 500 passports per bulk revise request" });
    }
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
      return res.status(400).json({ error: "changes must be a non-empty object" });
    }
    if (submitToWorkflow && !reviewerId && !approverId) {
      return res.status(400).json({ error: "Select at least one reviewer or approver to auto-submit revisions to workflow." });
    }
    if (reviewerId && approverId && String(reviewerId) === String(approverId)) {
      return res.status(400).json({ error: "Reviewer and approver must be different users." });
    }

    const uniqueGuids = [...new Set(items.map(item => String(item?.guid || "").trim()).filter(Boolean))];
    if (!uniqueGuids.length) {
      return res.status(400).json({ error: "No valid passport GUIDs were provided." });
    }

    const registryRes = await pool.query(
      `SELECT guid, passport_type
       FROM passport_registry
       WHERE company_id = $1 AND guid = ANY($2::uuid[])`,
      [companyId, uniqueGuids]
    );

    const registryByGuid = new Map(registryRes.rows.map(row => [row.guid, row.passport_type]));
    const resolvedItems = uniqueGuids
      .map(guid => ({ guid, passport_type: registryByGuid.get(guid) || null }))
      .filter(item => item.passport_type);

    if (!resolvedItems.length) {
      return res.status(404).json({ error: "No matching passports were found for this company." });
    }

    const passportTypes = [...new Set(resolvedItems.map(item => item.passport_type))];
    const batchPassportType = passportTypes.length === 1 ? passportTypes[0] : null;

    const batchRes = await pool.query(
      `INSERT INTO passport_revision_batches
         (company_id, passport_type, requested_by, scope_type, scope_meta, revision_note, changes_json,
          submit_to_workflow, reviewer_id, approver_id, total_targeted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at`,
      [
        companyId,
        batchPassportType,
        userId,
        scopeType,
        JSON.stringify(scopeMeta || {}),
        revisionNote || null,
        JSON.stringify(changes),
        !!submitToWorkflow,
        reviewerId ? parseInt(reviewerId, 10) : null,
        approverId ? parseInt(approverId, 10) : null,
        resolvedItems.length,
      ]
    );
    const batch = batchRes.rows[0];

    const details = [];
    let revised = 0;
    let skipped = 0;
    let failed = 0;

    const groupedItems = resolvedItems.reduce((acc, item) => {
      if (!acc[item.passport_type]) acc[item.passport_type] = [];
      acc[item.passport_type].push(item.guid);
      return acc;
    }, {});

    for (const [passportType, guids] of Object.entries(groupedItems)) {
      const tableName = getTable(passportType);
      const typeRes = await pool.query(
        "SELECT fields_json, display_name FROM passport_types WHERE type_name = $1",
        [passportType]
      );
      const sections = typeRes.rows[0]?.fields_json?.sections || [];
      const fieldMap = new Map(
        sections.flatMap(section => section.fields || []).map(field => [field.key, field])
      );
      fieldMap.set("model_name", { key: "model_name", label: "Model Name", type: "text" });
      fieldMap.set("product_id", { key: "product_id", label: "Serial Number", type: "text" });

      const applicableChanges = Object.entries(changes).filter(([key]) =>
        fieldMap.has(key) && /^[a-z][a-z0-9_]+$/.test(key)
      );

      const releasedRes = await pool.query(
        `SELECT DISTINCT ON (guid) *
         FROM ${tableName}
         WHERE company_id = $1
           AND guid = ANY($2::uuid[])
           AND release_status = 'released'
           AND deleted_at IS NULL
         ORDER BY guid, version_number DESC`,
        [companyId, guids]
      );
      const releasedByGuid = new Map(releasedRes.rows.map(row => [row.guid, row]));

      const blockingRes = await pool.query(
        `SELECT DISTINCT ON (guid) guid, version_number, release_status
         FROM ${tableName}
         WHERE company_id = $1
           AND guid = ANY($2::uuid[])
           AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL}
           AND deleted_at IS NULL
         ORDER BY guid, version_number DESC`,
        [companyId, guids]
      );
      const blockingByGuid = new Map(blockingRes.rows.map(row => [row.guid, row]));

      for (const guid of guids) {
        const insertBatchItem = async (status, message, sourceVersion = null, newVersion = null) => {
          await pool.query(
            `INSERT INTO passport_revision_batch_items
               (batch_id, passport_guid, passport_type, source_version_number, new_version_number, status, message)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [batch.id, guid, passportType, sourceVersion, newVersion, status, message || null]
          );
        };

        const source = releasedByGuid.get(guid);
        const blocker = blockingByGuid.get(guid);

        if (!source) {
          const message = "No released passport version was found for this GUID.";
          details.push({ guid, passport_type: passportType, status: "skipped", message });
          skipped++;
          await insertBatchItem("skipped", message);
          continue;
        }

        if (blocker) {
          const blockerStatus = normalizeReleaseStatus(blocker.release_status);
          const message = blockerStatus === "in_review"
            ? "A revision is already in workflow for this passport."
            : "An editable revision already exists for this passport.";
          details.push({
            guid,
            passport_type: passportType,
            status: "skipped",
            source_version_number: source.version_number,
            message,
          });
          skipped++;
          await insertBatchItem("skipped", message, source.version_number, blocker.version_number || null);
          continue;
        }

        if (!applicableChanges.length) {
          const message = "None of the requested change fields apply to this passport type.";
          details.push({
            guid,
            passport_type: passportType,
            status: "skipped",
            source_version_number: source.version_number,
            message,
          });
          skipped++;
          await insertBatchItem("skipped", message, source.version_number, null);
          continue;
        }

        try {
          const sourceVersion = parseInt(source.version_number, 10) || 1;
          const newVersion = sourceVersion + 1;
          const excluded = new Set(["id", "guid", "created_at", "updated_at", "updated_by", "qr_code"]);
          const columns = Object.keys(source).filter(key => !excluded.has(key));
          const mappedChanges = Object.fromEntries(
            applicableChanges.map(([key, value]) => [key, coerceBulkFieldValue(fieldMap.get(key), value)])
          );

          const values = columns.map((key) => {
            if (key === "version_number") return newVersion;
            if (key === "release_status") return IN_REVISION_STATUS;
            if (key === "created_by") return userId;
            if (key === "deleted_at") return null;
            if (Object.prototype.hasOwnProperty.call(mappedChanges, key)) {
              return toStoredPassportValue(mappedChanges[key]);
            }
            return source[key];
          });

          const allColumns = ["guid", ...columns];
          const allValues = [guid, ...values];
          const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");
          await pool.query(
            `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders})`,
            allValues
          );

          let detailStatus = submitToWorkflow ? "submitted" : "revised";
          let detailMessage = revisionNote || null;

          if (submitToWorkflow) {
            try {
              await submitPassportToWorkflow({
                companyId,
                guid,
                passportType,
                userId,
                reviewerId,
                approverId,
              });
              detailMessage = detailMessage
                ? `${detailMessage} Submitted to workflow.`
                : "Revision created and submitted to workflow.";
            } catch (workflowError) {
              detailStatus = "revised";
              detailMessage = detailMessage
                ? `${detailMessage} Workflow submission failed: ${workflowError.message}`
                : `Revision created, but workflow submission failed: ${workflowError.message}`;
            }
          }

          await logAudit(companyId, userId, "BULK_REVISE", tableName, guid,
            { version_number: sourceVersion, release_status: source.release_status },
            {
              version_number: newVersion,
              release_status: submitToWorkflow ? "in_review" : IN_REVISION_STATUS,
              batch_id: batch.id,
              revision_note: revisionNote || null,
              fields_updated: Object.keys(mappedChanges),
            }
          );

          details.push({
            guid,
            passport_type: passportType,
            status: detailStatus,
            source_version_number: sourceVersion,
            new_version_number: newVersion,
            message: detailMessage,
          });
          revised++;
          await insertBatchItem(detailStatus, detailMessage, sourceVersion, newVersion);
        } catch (e) {
          const message = e.message || "Bulk revise failed for this passport.";
          details.push({
            guid,
            passport_type: passportType,
            status: "failed",
            source_version_number: source.version_number || null,
            message,
          });
          failed++;
          await insertBatchItem("failed", message, source.version_number || null, null);
        }
      }
    }

    await pool.query(
      `UPDATE passport_revision_batches
       SET revised_count = $1,
           skipped_count = $2,
           failed_count = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [revised, skipped, failed, batch.id]
    );

    res.json({
      success: true,
      batch: {
        id: batch.id,
        created_at: batch.created_at,
        passport_type: batchPassportType,
        scope_type: scopeType,
      },
      summary: {
        targeted: resolvedItems.length,
        revised,
        skipped,
        failed,
      },
      details,
    });
  } catch (e) {
    console.error("Bulk revise error:", e.message);
    res.status(500).json({ error: "Bulk revise failed" });
  }
});

// DELETE (soft)
app.delete("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType }    = req.body;
    if (!passportType) return res.status(400).json({ error: "passportType required in body" });

    const tableName = getTable(passportType);
    const r = await pool.query(
      `UPDATE ${tableName} SET deleted_at = NOW()
       WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
       RETURNING guid`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete a released passport" });
    await logAudit(companyId, req.user.userId, "DELETE", tableName, guid, { guid }, null);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete passport" }); }
});

// BULK DELETE (soft-delete multiple passports by product_id or guid)
app.delete("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.userId;

    let passport_type, identifiers;
    if (Array.isArray(req.body)) {
      identifiers = req.body;
      passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
    } else {
      const normalizedBody = normalizePassportRequestBody(req.body);
      passport_type = normalizedBody.passport_type;
      identifiers = normalizedBody.passports || normalizedBody.identifiers;
    }
    if (!passport_type) return res.status(400).json({ error: "passport_type required" });
    if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
    if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const tableName = getTable(typeSchema.typeName);

    let deleted = 0, skipped = 0, failed = 0;
    const details = [];

    for (const item of identifiers) {
      const raw = typeof item === "string" ? { product_id: item } : (item || {});
      const guid = raw.guid;
      const productId = normalizeProductIdValue(raw.product_id || raw.productId);

      try {
        if (!guid && !productId) {
          details.push({ status: "failed", error: "Each item needs a guid or product_id" });
          failed++; continue;
        }

        let matchedGuid = null;

        if (guid) {
          const r = await pool.query(
            `UPDATE ${tableName} SET deleted_at = NOW()
             WHERE guid = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
             RETURNING guid`,
            [guid, companyId]
          );
          if (r.rows.length) matchedGuid = r.rows[0].guid;
        }

        if (!matchedGuid && productId) {
          const existing = await findExistingPassportByProductId({ tableName, companyId, productId });
          if (existing && isEditablePassportStatus(normalizeReleaseStatus(existing.release_status))) {
            const r = await pool.query(
              `UPDATE ${tableName} SET deleted_at = NOW()
               WHERE id = $1 AND deleted_at IS NULL
               RETURNING guid`,
              [existing.id]
            );
            if (r.rows.length) matchedGuid = r.rows[0].guid;
          }
        }

        if (!matchedGuid) {
          details.push({ guid: guid || undefined, product_id: productId || undefined, status: "skipped", reason: "Not found or not deletable (released passports cannot be deleted)" });
          skipped++; continue;
        }

        await logAudit(companyId, userId, "DELETE", tableName, matchedGuid, { guid: matchedGuid }, null);
        details.push({ guid: matchedGuid, product_id: productId || undefined, status: "deleted" });
        deleted++;
      } catch (e) {
        console.error("Bulk DELETE item error:", e.message);
        details.push({ guid: guid || undefined, product_id: productId || undefined, status: "failed", error: e.message });
        failed++;
      }
    }

    res.json({ summary: { deleted, skipped, failed, total: identifiers.length }, details });
  } catch (e) {
    console.error("Bulk DELETE error:", e.message, e.stack);
    res.status(500).json({ error: "Bulk delete failed", detail: e.message });
  }
});

// VERSION DIFF
app.get("/api/companies/:companyId/passports/:guid/diff", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { guid } = req.params;
    const { passportType } = req.query;
    if (!passportType) return res.status(400).json({ error: "passportType required" });

    const tableName = getTable(passportType);

    const r = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE guid = $1 AND deleted_at IS NULL
       ORDER BY version_number ASC`,
      [guid]
    );
    res.json({ versions: r.rows.map(normalizePassportRow), passportType });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/api/companies/:companyId/passports/:guid/history", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const reg = await pool.query(
      `SELECT passport_type
       FROM passport_registry
       WHERE guid = $1 AND company_id = $2`,
      [guid, companyId]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    const passportType = reg.rows[0].passport_type;
    const historyPayload = await buildPassportVersionHistory({
      guid,
      passportType,
      companyId,
      publicOnly: false,
    });

    res.json(historyPayload);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch passport history" });
  }
});

app.patch("/api/companies/:companyId/passports/:guid/history/:versionNumber", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid, versionNumber } = req.params;
    const { isPublic } = req.body || {};
    const parsedVersion = parseInt(versionNumber, 10);

    if (!Number.isFinite(parsedVersion) || parsedVersion < 1) {
      return res.status(400).json({ error: "A valid version number is required." });
    }
    if (typeof isPublic !== "boolean") {
      return res.status(400).json({ error: "isPublic must be true or false." });
    }

    const reg = await pool.query(
      `SELECT passport_type
       FROM passport_registry
       WHERE guid = $1 AND company_id = $2`,
      [guid, companyId]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);
    const versionRes = await pool.query(
      `SELECT version_number, release_status
       FROM ${tableName}
       WHERE guid = $1 AND company_id = $2 AND version_number = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [guid, companyId, parsedVersion]
    );
    if (!versionRes.rows.length) return res.status(404).json({ error: "Passport version not found" });

    const versionRow = normalizePassportRow(versionRes.rows[0]);
    if (versionRow.release_status !== "released" && isPublic) {
      return res.status(400).json({ error: "Only released versions can be shown publicly." });
    }

    const existingVisibilityRes = await pool.query(
      `SELECT is_public
       FROM passport_history_visibility
       WHERE passport_guid = $1 AND version_number = $2`,
      [guid, parsedVersion]
    );
    const previousVisibility = existingVisibilityRes.rows.length
      ? !!existingVisibilityRes.rows[0].is_public
      : versionRow.release_status === "released";

    await pool.query(
      `INSERT INTO passport_history_visibility
         (passport_guid, version_number, is_public, updated_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT (passport_guid, version_number)
       DO UPDATE SET
         is_public = EXCLUDED.is_public,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [guid, parsedVersion, isPublic, req.user.userId]
    );

    await logAudit(companyId, req.user.userId, "UPDATE_HISTORY_VISIBILITY", tableName, guid,
      { version_number: parsedVersion, is_public: previousVisibility },
      { version_number: parsedVersion, is_public: isPublic }
    );

    res.json({ success: true, version_number: parsedVersion, is_public: isPublic });
  } catch (e) {
    res.status(500).json({ error: "Failed to update history visibility" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════════════
app.post(
  "/api/companies/:companyId/passports/:guid/upload",
  authenticateToken, checkCompanyAccess, requireEditor, upload.single("file"),
  async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { fieldKey, passportType } = req.body;
      if (!req.file) return res.status(400).json({ error: "No file received" });
      if (!fieldKey || !passportType) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "fieldKey and passportType required" });
      }
      // Prevent SQL injection: fieldKey is used as a column name in a dynamic query
      if (!/^[a-z][a-z0-9_]+$/.test(fieldKey)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid fieldKey" });
      }

      const tableName  = getTable(passportType);
      const serverBase = process.env.SERVER_URL || "http://localhost:3001";
      const fileUrl    = `${serverBase}/passport-files/${guid}/${req.file.filename}`;

      const row = await pool.query(
        `SELECT id FROM ${tableName}
         WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         ORDER BY version_number DESC LIMIT 1`,
        [guid]
      );
      if (!row.rows.length) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: "Editable passport not found" });
      }

      await pool.query(
        `UPDATE ${tableName} SET ${fieldKey} = $1, updated_at = NOW() WHERE id = $2`,
        [fileUrl, row.rows[0].id]
      );
      await logAudit(companyId, req.user.userId, "UPLOAD", tableName, guid, null, { fieldKey, fileUrl });
      res.json({ success: true, url: fileUrl, fieldKey });
    } catch (e) {
      if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 20 MB." });
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  COMPANY-LEVEL ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/companies/:companyId/analytics", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;

    const accessRes = await pool.query(`
      SELECT pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
      FROM company_passport_access cpa
      JOIN passport_types pt ON pt.id = cpa.passport_type_id
      WHERE cpa.company_id = $1
    `, [companyId]);

    let totalPassports = 0;
    const analytics    = [];
    const trendMonths = [];
    const trendStart = new Date();
    trendStart.setDate(1);
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setMonth(trendStart.getMonth() - 5);
    for (let i = 0; i < 6; i++) {
      const month = new Date(trendStart);
      month.setMonth(trendStart.getMonth() + i);
      trendMonths.push(month);
    }
    const trendSeriesMap = {};

    for (const { type_name, display_name, umbrella_category, umbrella_icon } of accessRes.rows) {
      try {
        const stats = await queryTableStats(type_name, companyId);
        if (stats.total === 0) continue;
        totalPassports += stats.total;
        analytics.push({
          passport_type:    type_name,
          display_name,
          umbrella_category,
          umbrella_icon,
          draft_count:      stats.draft,
          released_count:   stats.released,
          revised_count:    stats.revised,
          in_review_count:  stats.in_review,
        });

        const tableName = getTable(type_name);
        const baselineRes = await pool.query(
          `SELECT COUNT(*) AS count
           FROM ${tableName}
           WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
          [companyId, trendStart.toISOString()]
        );
        const monthlyRes = await pool.query(
          `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
           FROM ${tableName}
           WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
           GROUP BY 1
           ORDER BY 1`,
          [companyId, trendStart.toISOString()]
        );

        if (!trendSeriesMap[umbrella_category]) {
          trendSeriesMap[umbrella_category] = {
            umbrella_category,
            umbrella_icon,
            baseline: 0,
            monthlyCounts: Object.fromEntries(
              trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])
            ),
          };
        }

        trendSeriesMap[umbrella_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
        monthlyRes.rows.forEach((row) => {
          const key = new Date(row.month_bucket).toISOString().slice(0, 7);
          trendSeriesMap[umbrella_category].monthlyCounts[key] =
            (trendSeriesMap[umbrella_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
        });
      } catch (e) { console.error(`Analytics error for ${companyId}/${type_name}:`, e.message); }
    }

    const scanRes = await pool.query(
      `SELECT COUNT(*) FROM passport_scan_events pse
       JOIN passport_registry pr ON pr.guid = pse.passport_guid
       WHERE pr.company_id = $1`,
      [companyId]
    );
    const scanStats = parseInt(scanRes.rows[0].count) || 0;
    const trend = {
      labels: trendMonths.map((month) =>
        month.toLocaleString("en-US", { month: "short" })
      ),
      series: Object.values(trendSeriesMap).map((series) => {
        let running = series.baseline;
        return {
          umbrella_category: series.umbrella_category,
          umbrella_icon: series.umbrella_icon,
          values: trendMonths.map((month) => {
            const key = month.toISOString().slice(0, 7);
            running += series.monthlyCounts[key] || 0;
            return running;
          }),
        };
      }),
    };

    res.json({ totalPassports, analytics, scanStats, trend });
  } catch (e) { res.status(500).json({ error: "Failed to fetch analytics" }); }
});

// ─── ACTIVITY FEED ──────────────────────────────────────────────────────────
app.get("/api/companies/:companyId/activity", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const r = await pool.query(
      `SELECT al.*, u.email AS user_email FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC LIMIT $2`,
      [req.params.companyId, limit]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/companies/:companyId/audit-logs", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 200, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const r = await pool.query(
      `SELECT al.*, u.email AS user_email FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
      [req.params.companyId, limit, offset]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Failed to fetch audit logs" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  QR CODE
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/passports/:guid/qrcode", authenticateToken, async (req, res) => {
  try {
    const { qrCode, passportType } = req.body;
    if (!qrCode || !passportType) return res.status(400).json({ error: "qrCode and passportType required" });

    const reg = await pool.query(
      "SELECT company_id FROM passport_registry WHERE guid = $1", [req.params.guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found in registry" });

    const tableName = getTable(passportType);
    await pool.query(
      `UPDATE ${tableName} SET qr_code = $1, updated_at = NOW() WHERE guid = $2`,
      [qrCode, req.params.guid]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to save QR code" }); }
});

app.get("/api/passports/:guid/qrcode", publicReadRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1", [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "QR code not found" });

    const { passport_type } = reg.rows[0];
    const tableName = getTable(passport_type);
    const r = await pool.query(
      `SELECT qr_code FROM ${tableName} WHERE guid = $1 AND deleted_at IS NULL LIMIT 1`,
      [guid]
    );
    if (!r.rows.length || !r.rows[0].qr_code)
      return res.status(404).json({ error: "QR code not found" });

    res.json({ qrCode: r.rows[0].qr_code });
  } catch { res.status(500).json({ error: "Failed to fetch QR code" }); }
});

app.post("/api/passports/:guid/scan", publicScanRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const { userAgent, referrer } = req.body;

    // Only record scans for released passports
    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1",
      [guid]
    );
    if (!reg.rows.length) return res.json({ success: true });

    const tbl = getTable(reg.rows[0].passport_type);
    const check = await pool.query(
      `SELECT 1 FROM ${tbl} WHERE guid = $1 AND release_status = 'released' AND deleted_at IS NULL`,
      [guid]
    );
    if (!check.rows.length) return res.json({ success: true });

    await pool.query(
      "INSERT INTO passport_scan_events (passport_guid, user_agent, referrer) VALUES ($1,$2,$3)",
      [guid, userAgent || null, referrer || null]
    );
    res.json({ success: true });
  } catch { res.json({ success: true }); }
});

app.get("/api/passports/:guid/scan-stats", publicReadRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const total = await pool.query(
      "SELECT COUNT(*) FROM passport_scan_events WHERE passport_guid = $1", [guid]
    );
    const byDay = await pool.query(
      `SELECT DATE(scanned_at) AS day, COUNT(*) AS count
       FROM passport_scan_events WHERE passport_guid = $1
       GROUP BY DATE(scanned_at) ORDER BY day DESC LIMIT 30`,
      [guid]
    );
    res.json({ total: parseInt(total.rows[0].count), byDay: byDay.rows });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  DYNAMIC FIELD VALUES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/passports/:guid/dynamic-values — public, returns LATEST value per field
app.get("/api/passports/:guid/dynamic-values", publicReadRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    // DISTINCT ON picks the most-recent row per field_key
    const r = await pool.query(
      `SELECT DISTINCT ON (field_key)
         field_key, value, updated_at
       FROM passport_dynamic_values
       WHERE passport_guid = $1
       ORDER BY field_key, updated_at DESC`,
      [guid]
    );
    const values = {};
    for (const row of r.rows) {
      values[row.field_key] = { value: row.value, updatedAt: row.updated_at };
    }
    res.json({ values });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch dynamic values" });
  }
});

// GET /api/passports/:guid/dynamic-values/:fieldKey/history — full time-series, public
app.get("/api/passports/:guid/dynamic-values/:fieldKey/history", publicReadRateLimit, async (req, res) => {
  try {
    const { guid, fieldKey } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const r = await pool.query(
      `SELECT value, updated_at
       FROM passport_dynamic_values
       WHERE passport_guid = $1 AND field_key = $2
       ORDER BY updated_at ASC
       LIMIT $3`,
      [guid, fieldKey, limit]
    );
    res.json({
      history: r.rows.map(row => ({ value: row.value, updatedAt: row.updated_at })),
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// POST /api/passports/:guid/dynamic-values — device pushes live updates
// Requires header: x-device-key: <device_api_key>
app.post("/api/passports/:guid/dynamic-values", devicePushRateLimit, async (req, res) => {
  try {
    const { guid } = req.params;
    const deviceKey = req.headers["x-device-key"];
    if (!deviceKey) return res.status(401).json({ error: "x-device-key header required" });

    // Validate device key
    const reg = await pool.query(
      "SELECT device_api_key FROM passport_registry WHERE guid = $1",
      [guid]
    );
    if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
    const storedKey = String(reg.rows[0].device_api_key || "");
    const submittedKey = String(deviceKey || "");
    const storedBuf = Buffer.from(storedKey);
    const submittedBuf = Buffer.from(submittedKey);
    if (storedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(storedBuf, submittedBuf))
      return res.status(403).json({ error: "Invalid device key" });

    const updates = req.body; // { fieldKey: value, ... }
    if (!updates || typeof updates !== "object" || Array.isArray(updates))
      return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

    const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
    if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

    for (const [fieldKey, value] of entries) {
      // Convert arrays/objects to JSON strings
      let storedValue = value;
      if (value !== null && value !== undefined) {
        if (Array.isArray(value) || typeof value === "object") {
          storedValue = JSON.stringify(value);
        } else {
          storedValue = String(value);
        }
      }
      await pool.query(
        `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at)
         VALUES ($1, $2, $3, NOW())`,
        [guid, fieldKey, storedValue]
      );
    }

    res.json({ success: true, updated: entries.map(([k]) => k) });
  } catch (e) {
    res.status(500).json({ error: "Failed to update dynamic values" });
  }
});

// GET /api/companies/:companyId/passports/:guid/device-key — company users read device key
app.get("/api/companies/:companyId/passports/:guid/device-key",
  authenticateToken, checkCompanyAccess,
  async (req, res) => {
    try {
      const { guid } = req.params;
      const r = await pool.query(
        "SELECT device_api_key FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ deviceKey: r.rows[0].device_api_key });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch device key" });
    }
  }
);

// POST /api/companies/:companyId/passports/:guid/device-key/regenerate — regenerate key
app.post("/api/companies/:companyId/passports/:guid/device-key/regenerate",
  authenticateToken, checkCompanyAccess, requireEditor,
  async (req, res) => {
    try {
      const { guid } = req.params;
      const r = await pool.query(
        `UPDATE passport_registry
         SET device_api_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
         WHERE guid = $1
         RETURNING device_api_key`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ deviceKey: r.rows[0].device_api_key });
    } catch (e) {
      res.status(500).json({ error: "Failed to regenerate device key" });
    }
  }
);

// PATCH /api/companies/:companyId/passports/:guid/dynamic-values — manual override by user
app.patch("/api/companies/:companyId/passports/:guid/dynamic-values",
  authenticateToken, checkCompanyAccess, requireEditor,
  async (req, res) => {
    try {
      const { guid } = req.params;
      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
        return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

      const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        await pool.query(
          `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at)
           VALUES ($1, $2, $3, NOW())`,
          [guid, fieldKey, value === null || value === undefined ? null : String(value)]
        );
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to update dynamic values" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  COMPANY PROFILE
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/companies/:companyId/profile", publicReadRateLimit, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, company_name, company_logo, introduction_text, branding_json FROM companies WHERE id = $1",
      [req.params.companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed to fetch company profile" }); }
});

app.post("/api/companies/:companyId/profile", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { company_logo, introduction_text, branding_json } = req.body;
    await pool.query(
      `UPDATE companies
       SET company_logo = $1,
           introduction_text = COALESCE($2, introduction_text),
           branding_json = COALESCE($3::jsonb, branding_json),
           updated_at = NOW()
       WHERE id = $4`,
      [
        company_logo !== undefined ? company_logo : null,
        introduction_text || null,
        branding_json ? JSON.stringify(branding_json) : null,
        req.params.companyId,
      ]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to save company profile" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  COMPANY FILE REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════

// LIST items (flat list filtered by parentId; null = root)
app.get("/api/companies/:companyId/repository", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const parentId = req.query.parentId ? parseInt(req.query.parentId) : null;
    const r = await pool.query(
      `SELECT id, parent_id, name, type, file_url, mime_type, size_bytes, created_at
       FROM company_repository
       WHERE company_id = $1 AND parent_id IS NOT DISTINCT FROM $2
       ORDER BY type DESC, name ASC`,
      [companyId, parentId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to list repository" }); }
});

// GET full tree (for RepositoryPicker breadcrumb path resolution)
app.get("/api/companies/:companyId/repository/tree", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, parent_id, name, type FROM company_repository
       WHERE company_id = $1 ORDER BY type DESC, name ASC`,
      [req.params.companyId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to fetch tree" }); }
});

// CREATE FOLDER
app.post("/api/companies/:companyId/repository/folder", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Folder name required" });
    // Check for duplicate name in same parent
    const dup = await pool.query(
      `SELECT id FROM company_repository
       WHERE company_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3`,
      [req.params.companyId, parentId || null, name.trim()]
    );
    if (dup.rows.length) return res.status(409).json({ error: "A folder with that name already exists here" });
    const r = await pool.query(
      `INSERT INTO company_repository (company_id, parent_id, name, type, created_by)
       VALUES ($1, $2, $3, 'folder', $4) RETURNING *`,
      [req.params.companyId, parentId || null, name.trim(), req.user.userId]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: "Failed to create folder" }); }
});

// UPLOAD FILE to repository
app.post(
  "/api/companies/:companyId/repository/upload",
  authenticateToken, checkCompanyAccess, requireEditor, repoUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file received" });
      const { parentId, displayName } = req.body;
      const { companyId } = req.params;
      const serverBase = process.env.SERVER_URL || "http://localhost:3001";
      const fileUrl = `${serverBase}/repository-files/${companyId}/${req.file.filename}`;
      const name = (displayName?.trim()) || req.file.originalname;

      const r = await pool.query(
        `INSERT INTO company_repository
           (company_id, parent_id, name, type, file_path, file_url, mime_type, size_bytes, created_by)
         VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8) RETURNING *`,
        [companyId, parentId || null, name, req.file.path, fileUrl,
         req.file.mimetype, req.file.size, req.user.userId]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 50 MB." });
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// COPY a passport-uploaded file URL into the repository (no file duplication — just registers the link)
app.post("/api/companies/:companyId/repository/copy", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { sourceUrl, name, parentId } = req.body;
    if (!sourceUrl || !name?.trim()) return res.status(400).json({ error: "sourceUrl and name required" });
    const r = await pool.query(
      `INSERT INTO company_repository
         (company_id, parent_id, name, type, file_url, mime_type, created_by)
       VALUES ($1, $2, $3, 'file', $4, 'application/pdf', $5) RETURNING *`,
      [req.params.companyId, parentId || null, name.trim(), sourceUrl, req.user.userId]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: "Failed to copy to repository" }); }
});

// RENAME file or folder
app.patch("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name required" });
    const r = await pool.query(
      `UPDATE company_repository SET name = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 RETURNING *`,
      [name.trim(), req.params.itemId, req.params.companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Item not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: "Failed to rename" }); }
});

// DELETE file or folder (folders must be empty)
app.delete("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const item = await pool.query(
      "SELECT * FROM company_repository WHERE id = $1 AND company_id = $2",
      [req.params.itemId, req.params.companyId]
    );
    if (!item.rows.length) return res.status(404).json({ error: "Item not found" });
    const row = item.rows[0];

    if (row.type === "folder") {
      const children = await pool.query(
        "SELECT id FROM company_repository WHERE parent_id = $1", [row.id]
      );
      if (children.rows.length) return res.status(409).json({ error: "Folder must be empty before deleting" });
    } else if (row.file_path && fs.existsSync(row.file_path)) {
      const safeFilePath = path.resolve(row.file_path);
      if (!isPathInsideBase(safeFilePath, REPO_BASE_DIR)) {
        console.error("[repository-delete] Refusing to delete file outside repository root:", safeFilePath);
        return res.status(400).json({ error: "Stored file path is invalid" });
      }
      try { fs.unlinkSync(safeFilePath); } catch {}
    }

    await pool.query("DELETE FROM company_repository WHERE id = $1", [row.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete" }); }
});

// LIST company symbols (images only)
app.get("/api/companies/:companyId/repository/symbols", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, mime_type, file_url, size_bytes, created_at
       FROM company_repository
       WHERE company_id = $1 AND type = 'file' AND mime_type LIKE 'image/%'
       ORDER BY name ASC`,
      [req.params.companyId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed to fetch symbols" }); }
});

// UPLOAD company symbol (image file)
app.post(
  "/api/companies/:companyId/repository/symbols/upload",
  authenticateToken, checkCompanyAccess, requireEditor, repoSymbolUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const { companyId } = req.params;
      const displayName = req.body.name?.trim() || req.file.originalname.replace(/\.[^.]+$/, "");
      const serverBase = process.env.SERVER_URL || "http://localhost:3001";
      const fileUrl = `${serverBase}/repository-files/${companyId}/symbols/${req.file.filename}`;
      const r = await pool.query(
        `INSERT INTO company_repository
           (company_id, parent_id, name, type, file_path, file_url, mime_type, size_bytes, created_by)
         VALUES ($1, NULL, $2, 'file', $3, $4, $5, $6, $7) RETURNING *`,
        [companyId, displayName, req.file.path, fileUrl, req.file.mimetype, req.file.size, req.user.userId]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error("Company symbol upload error:", e.message);
      res.status(500).json({ error: e.message || "Upload failed" });
    }
  }
);

// MIGRATE global symbols into every company's repository (idempotent, super-admin only)
app.post("/api/admin/migrate-symbols", authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const [symsRes, companiesRes] = await Promise.all([
      pool.query("SELECT id, name, file_url FROM symbols WHERE is_active = true"),
      pool.query("SELECT id FROM companies"),
    ]);
    const symbols   = symsRes.rows;
    const companies = companiesRes.rows;
    const extMime   = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

    let inserted = 0, skipped = 0;
    for (const company of companies) {
      for (const sym of symbols) {
        const exists = await pool.query(
          "SELECT id FROM company_repository WHERE company_id = $1 AND file_url = $2",
          [company.id, sym.file_url]
        );
        if (exists.rows.length) { skipped++; continue; }
        const ext      = path.extname(sym.file_url).toLowerCase();
        const mimeType = extMime[ext] || "image/png";
        await pool.query(
          `INSERT INTO company_repository (company_id, parent_id, name, type, file_url, mime_type, created_by)
           VALUES ($1, NULL, $2, 'file', $3, $4, $5)`,
          [company.id, sym.name, sym.file_url, mimeType, req.user.userId]
        );
        inserted++;
      }
    }
    res.json({ success: true, inserted, skipped, symbols: symbols.length, companies: companies.length });
  } catch (e) {
    console.error("Symbol migration error:", e.message);
    res.status(500).json({ error: "Migration failed: " + e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/users/me/notifications", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const r = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [req.user.userId, limit]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Failed" }); }
});

// Full notifications page — joins workflow details (comments, reviewer/approver names, timestamps)
app.get("/api/users/me/notifications/full", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 200);
    const r = await pool.query(
      `SELECT
         n.*,
         pw.reviewer_id,
         pw.approver_id,
         pw.review_status,
         pw.approval_status,
         pw.overall_status,
         pw.reviewer_comment,
         pw.approver_comment,
         pw.reviewed_at,
         pw.approved_at,
         pw.rejected_at,
         pw.created_at  AS workflow_submitted_at,
         CONCAT(ur.first_name, ' ', ur.last_name) AS reviewer_name,
         ur.email                                  AS reviewer_email,
         CONCAT(ua.first_name, ' ', ua.last_name) AS approver_name,
         ua.email                                  AS approver_email,
         CONCAT(us.first_name, ' ', us.last_name) AS submitter_name,
         us.email                                  AS submitter_email
       FROM notifications n
       LEFT JOIN passport_workflow pw
         ON pw.passport_guid = n.passport_guid
         AND pw.created_at = (
           SELECT MAX(pw2.created_at) FROM passport_workflow pw2
           WHERE pw2.passport_guid = n.passport_guid
         )
       LEFT JOIN users ur ON ur.id = pw.reviewer_id
       LEFT JOIN users ua ON ua.id = pw.approver_id
       LEFT JOIN users us ON us.id = pw.submitted_by
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [req.user.userId, limit]
    );
    res.json(r.rows);
  } catch (e) { console.error("Full notifications error:", e.message); res.status(500).json({ error: "Failed" }); }
});

app.patch("/api/users/me/notifications/read-all", authenticateToken, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read = true WHERE user_id = $1", [req.user.userId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

app.patch("/api/users/me/notifications/:id/read", authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PASSPORT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

pool.query(`
  CREATE TABLE IF NOT EXISTS passport_templates (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL,
    passport_type VARCHAR(100) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    description   TEXT,
    created_by    INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS passport_template_fields (
    id           SERIAL PRIMARY KEY,
    template_id  INTEGER NOT NULL REFERENCES passport_templates(id) ON DELETE CASCADE,
    field_key    VARCHAR(200) NOT NULL,
    field_value  TEXT,
    is_model_data BOOLEAN DEFAULT FALSE,
    UNIQUE(template_id, field_key)
  );
`).catch(e => console.error("Template table init error:", e.message));

// List templates for a company (optionally filter by passport_type)
app.get("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { passport_type } = req.query;
    let q = `SELECT t.*, u.first_name, u.last_name,
               (SELECT COUNT(*) FROM passport_template_fields WHERE template_id = t.id AND is_model_data = true) AS model_field_count
             FROM passport_templates t
             LEFT JOIN users u ON u.id = t.created_by
             WHERE t.company_id = $1`;
    const params = [companyId];
    if (passport_type) { q += ` AND t.passport_type = $2`; params.push(passport_type); }
    q += ` ORDER BY t.passport_type, t.name`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Failed" }); }
});

// Get a single template with all fields
app.get("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId, id } = req.params;
    const t = await pool.query(
      "SELECT * FROM passport_templates WHERE id=$1 AND company_id=$2",
      [id, companyId]
    );
    if (!t.rows.length) return res.status(404).json({ error: "Not found" });
    const fields = await pool.query(
      "SELECT field_key, field_value, is_model_data FROM passport_template_fields WHERE template_id=$1",
      [id]
    );
    res.json({ ...t.rows[0], fields: fields.rows });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// Create template
app.post("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { passport_type, name, description, fields } = req.body;
    if (!passport_type || !name?.trim()) return res.status(400).json({ error: "passport_type and name required" });

    const t = await pool.query(
      `INSERT INTO passport_templates (company_id, passport_type, name, description, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [companyId, passport_type, name.trim(), description || null, req.user.userId]
    );
    const tmplId = t.rows[0].id;

    if (Array.isArray(fields) && fields.length) {
      for (const f of fields) {
        if (!f.field_key) continue;
        await pool.query(
          `INSERT INTO passport_template_fields (template_id, field_key, field_value, is_model_data)
           VALUES ($1,$2,$3,$4) ON CONFLICT (template_id, field_key) DO UPDATE
           SET field_value=$3, is_model_data=$4`,
          [tmplId, f.field_key, f.field_value ?? null, !!f.is_model_data]
        );
      }
    }
    res.json(t.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Failed" }); }
});

// Update template
app.put("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, id } = req.params;
    const { name, description, fields } = req.body;

    const existing = await pool.query(
      "SELECT id FROM passport_templates WHERE id=$1 AND company_id=$2", [id, companyId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "Not found" });

    await pool.query(
      `UPDATE passport_templates SET name=$1, description=$2, updated_at=NOW() WHERE id=$3`,
      [name?.trim() || "Untitled", description || null, id]
    );

    if (Array.isArray(fields)) {
      await pool.query("DELETE FROM passport_template_fields WHERE template_id=$1", [id]);
      for (const f of fields) {
        if (!f.field_key) continue;
        await pool.query(
          `INSERT INTO passport_template_fields (template_id, field_key, field_value, is_model_data)
           VALUES ($1,$2,$3,$4)`,
          [id, f.field_key, f.field_value ?? null, !!f.is_model_data]
        );
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// Delete template
app.delete("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, id } = req.params;
    await pool.query("DELETE FROM passport_templates WHERE id=$1 AND company_id=$2", [id, companyId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// ── Export drafts as CSV/JSON for a template ────────────────────────────────
// Returns all draft/in-revision passports of this template's type, with GUID +
// all schema fields so the user can fill them in a spreadsheet then re-import.
app.get("/api/companies/:companyId/templates/:templateId/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId, templateId } = req.params;
    const fmt = (req.query.format || "csv").toLowerCase(); // "csv" | "json"

    // Get template
    const tmplRes = await pool.query(
      "SELECT * FROM passport_templates WHERE id=$1 AND company_id=$2",
      [templateId, companyId]
    );
    if (!tmplRes.rows.length) return res.status(404).json({ error: "Template not found" });
    const tmpl = tmplRes.rows[0];

    const fieldRes = await pool.query(
      "SELECT field_key, field_value, is_model_data FROM passport_template_fields WHERE template_id=$1",
      [templateId]
    );
    const templateFields = Object.fromEntries(fieldRes.rows.map(f => [f.field_key, f.field_value]));

    // Get passport type schema
    const typeRes = await pool.query(
      "SELECT fields_json FROM passport_types WHERE type_name=$1",
      [tmpl.passport_type]
    );
    const sections = typeRes.rows[0]?.fields_json?.sections || [];
    const schemaFields = sections.flatMap(s => s.fields || [])
      .filter(f => f.type !== "file" && f.type !== "table");

    // Get all draft/in-revision passports of this type for the company
    const tableName = getTable(tmpl.passport_type);
    const cols = ["guid", "model_name", "product_id", ...schemaFields.map(f => f.key)];
    const safeColsSql = cols.map(c => /^[a-z][a-z0-9_]*$/.test(c) ? c : null).filter(Boolean);

    const passRes = await pool.query(
      `SELECT ${safeColsSql.join(", ")} FROM ${tableName}
       WHERE company_id=$1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [companyId]
    );
    const rows = passRes.rows;

    if (fmt === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passport_type}_drafts.json"`);
      return res.json(rows);
    }

    // CSV: column-oriented (Field Name | Passport 1 | Passport 2 …)
    // Row 0: header
    // Row 1: guid
    // Row 2: model_name
    // Row 3..N: schema fields
    const escCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const fieldRows = [
      ["guid",       ...rows.map(r => r.guid)],
      ["model_name", ...rows.map(r => r.model_name || "")],
      ["product_id", ...rows.map(r => r.product_id || "")],
      ...schemaFields.map(f => [
        f.label,
        ...rows.map(r => r[f.key] ?? templateFields[f.key] ?? ""),
      ]),
    ];
    const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
    const csvLines = [headerRow, ...fieldRows].map(row => row.map(escCell).join(","));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passport_type}_drafts.csv"`);
    res.send(csvLines.join("\n"));
  } catch (e) {
    console.error("Export drafts error:", e.message);
    res.status(500).json({ error: "Export failed" });
  }
});

// ── Upsert passports via CSV (GUID → PATCH existing, no GUID → POST new) ───
app.post("/api/companies/:companyId/passports/upsert-csv", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const { passport_type, csv } = normalizedBody;
    if (!passport_type || !csv) return res.status(400).json({ error: "passport_type and csv required" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const resolvedPassportType = typeSchema.typeName;

    // Fetch schema for label→key mapping
    const allFields = typeSchema.schemaFields;

    // Parse column-oriented CSV
    const parseRow = (line) => {
      line = line.replace(/\r$/, "");
      const cells = []; let cur = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
        else if (c===',' && !inQ) { cells.push(cur); cur=""; }
        else cur+=c;
      }
      cells.push(cur);
      return cells;
    };
    const rows = csv.split("\n").map(l => l.trim()).filter(Boolean).map(parseRow);
    if (rows.length < 2) return res.status(400).json({ error: "CSV too short" });

    const numPassports = rows[0].length - 1;
    const fieldRows = rows.slice(1); // skip header row

    const tableName = getTable(resolvedPassportType);
    const userId = req.user.userId;
    const excluded = new Set(["id","guid","company_id","created_by","created_at","passport_type",
      "version_number","release_status","deleted_at","qr_code",
      "created_by_email","first_name","last_name","updated_by","updated_at"]);

    let created=0, updated=0, skipped=0, failed=0;
    const details = [];

    for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
      const passport = {};
      fieldRows.forEach(row => {
        const rawLabel = (row[0] || "").trim();
        if (!rawLabel) return;
        const normalized = rawLabel.toLowerCase();
        const value = (row[colIdx] || "").trim();

        const field =
          allFields.find(f => f.label?.trim().toLowerCase() === normalized) ||
          allFields.find(f => f.key?.toLowerCase() === normalized) ||
          (normalized === "model_name" ? { key: "model_name" } : null) ||
          (normalized === "product_id" ? { key: "product_id" } : null) ||
          (normalized === "guid"       ? { key: "guid" }       : null);

        if (field && value) {
          passport[field.key] = field.type === "boolean"
            ? (value.toLowerCase() === "true" || value === "1")
            : value;
        }
      });

      const { guid: incomingGuid, model_name, product_id, ...fields } = passport;
      const normalizedProductId = normalizeProductIdValue(product_id);

      try {
        if (incomingGuid) {
          // PATCH existing
          const existing = await pool.query(
            `SELECT id FROM ${tableName} WHERE guid=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
            [incomingGuid, companyId]
          );
          if (!existing.rows.length) {
            details.push({ guid: incomingGuid, status: "skipped", reason: "not found or not editable" });
            skipped++; continue;
          }
          const rowId = existing.rows[0].id;
          if (product_id !== undefined) {
            if (!normalizedProductId) {
              details.push({ guid: incomingGuid, status: "failed", error: "product_id cannot be blank" });
              failed++; continue;
            }
            const existingByProductId = await findExistingPassportByProductId({
              tableName,
              companyId,
              productId: normalizedProductId,
              excludeGuid: incomingGuid,
            });
            if (existingByProductId) {
              details.push({ guid: incomingGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
              failed++; continue;
            }
          }
          const updateData = { model_name, ...fields };
          if (product_id !== undefined) updateData.product_id = normalizedProductId;
          const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: updateData, excluded });
          if (!updateCols.length) { skipped++; continue; }
          await logAudit(companyId, userId, "UPDATE", tableName, incomingGuid, null, { source: "csv_upsert" });
          details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "updated" });
          updated++;
        } else {
          if (!normalizedProductId) {
            details.push({ status: "skipped", reason: "Serial Number is required to create a new passport" });
            skipped++; continue;
          }
          const existingByProductId = await findExistingPassportByProductId({
            tableName,
            companyId,
            productId: normalizedProductId,
          });
          if (existingByProductId) {
            const existingStatus = normalizeReleaseStatus(existingByProductId.release_status);
            if (isEditablePassportStatus(existingStatus)) {
              const updateData = { model_name, product_id: normalizedProductId, ...fields };
              const updateCols = await updatePassportRowById({
                tableName,
                rowId: existingByProductId.id,
                userId,
                data: updateData,
                excluded,
              });
              if (!updateCols.length) {
                details.push({ guid: existingByProductId.guid, product_id: normalizedProductId, status: "skipped", reason: "no changes detected" });
                skipped++; continue;
              }
              await logAudit(companyId, userId, "UPDATE", tableName, existingByProductId.guid, null, { source: "csv_upsert", matched_by: "product_id" });
              details.push({ guid: existingByProductId.guid, product_id: normalizedProductId, status: "updated" });
              updated++; continue;
            }
            details.push({
              guid: existingByProductId.guid,
              product_id: normalizedProductId,
              status: "skipped",
              reason: existingStatus === "in_review"
                ? "matching passport is in review and cannot be edited"
                : "matching passport already exists; revise it before importing changes",
            });
            skipped++; continue;
          }

          const newGuid = uuidv4();
          const dataFields = getWritablePassportColumns(fields, excluded);
          const allCols = ["guid","company_id","model_name","product_id","created_by", ...dataFields];
          const allVals = [newGuid, companyId, model_name || null, normalizedProductId, userId, ...getStoredPassportValues(dataFields, fields)];
          await pool.query(
            `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_,i)=>`$${i+1}`).join(",")})`,
            allVals
          );
          await pool.query(
            `INSERT INTO passport_registry (guid,company_id,passport_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [newGuid, companyId, resolvedPassportType]
          );
          details.push({ guid: newGuid, product_id: normalizedProductId, model_name, status: "created" });
          created++;
        }
      } catch (e) {
        console.error("Upsert CSV row error:", e.message);
        details.push({ status: "failed", error: e.message });
        failed++;
      }
    }

    res.json({ summary: { created, updated, skipped, failed }, details });
  } catch (e) {
    console.error("Upsert CSV error:", e.message);
    res.status(500).json({ error: "Import failed" });
  }
});

// ── Upsert passports via JSON array (GUID → PATCH, no GUID → POST new) ──────
app.post("/api/companies/:companyId/passports/upsert-json", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId } = req.params;
    // Accept either: { passport_type, passports: [...] }
    // or a raw array: [{ passport_type, ... }, ...]
    let passport_type, passports;
    if (Array.isArray(req.body)) {
      passports = req.body;
      passport_type = passports[0]?.passport_type || passports[0]?.passportType;
    } else {
      const normalizedBody = normalizePassportRequestBody(req.body);
      passport_type = normalizedBody.passport_type;
      passports = normalizedBody.passports;
    }
    if (!passport_type) return res.status(400).json({ error: "passport_type required" });
    if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
    if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

    const typeSchema = await getPassportTypeSchema(passport_type);
    if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
    const resolvedPassportType = typeSchema.typeName;
    const tableName = getTable(resolvedPassportType);
    const userId = req.user.userId;
    const excluded = new Set(["id","company_id","created_by","created_at","passport_type",
      "version_number","release_status","deleted_at","qr_code",
      "created_by_email","first_name","last_name","updated_by","updated_at"]);

    let created=0, updated=0, skipped=0, failed=0;
    const details = [];

    for (const item of passports) {
      const normalizedItem = normalizePassportRequestBody(item || {});
      const { guid: incomingGuid, model_name, product_id, ...fields } = normalizedItem;
      const normalizedProductId = normalizeProductIdValue(product_id);
      const invalidFieldKeys = Object.keys(fields).filter((key) =>
        !SYSTEM_PASSPORT_FIELDS.has(key) &&
        !typeSchema.allowedKeys.has(key)
      );
      try {
        if (invalidFieldKeys.length) {
          details.push({
            guid: incomingGuid || undefined,
            product_id: normalizedProductId || undefined,
            status: "failed",
            error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}`,
          });
          failed++;
          continue;
        }
        if (incomingGuid) {
          const existing = await pool.query(
            `SELECT id FROM ${tableName} WHERE guid=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
            [incomingGuid, companyId]
          );
          if (!existing.rows.length) {
            details.push({ guid: incomingGuid, status: "skipped", reason: "not found or not editable" });
            skipped++; continue;
          }
          const rowId = existing.rows[0].id;
          if (product_id !== undefined) {
            if (!normalizedProductId) {
              details.push({ guid: incomingGuid, status: "failed", error: "product_id cannot be blank" });
              failed++; continue;
            }
            const existingByProductId = await findExistingPassportByProductId({
              tableName,
              companyId,
              productId: normalizedProductId,
              excludeGuid: incomingGuid,
            });
            if (existingByProductId) {
              details.push({ guid: incomingGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
              failed++; continue;
            }
          }
          const allData = { model_name, ...fields };
          if (product_id !== undefined) allData.product_id = normalizedProductId;
          const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: allData, excluded });
          if (!updateCols.length) { skipped++; continue; }
          await logAudit(companyId, userId, "UPDATE", tableName, incomingGuid, null, { source: "json_upsert" });
          details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "updated" });
          updated++;
        } else {
          if (!normalizedProductId) {
            details.push({ status: "skipped", reason: "Serial Number is required to create a new passport" });
            skipped++; continue;
          }
          const existingByProductId = await findExistingPassportByProductId({
            tableName,
            companyId,
            productId: normalizedProductId,
          });
          if (existingByProductId) {
            const existingStatus = normalizeReleaseStatus(existingByProductId.release_status);
            if (isEditablePassportStatus(existingStatus)) {
              const allData = { model_name, product_id: normalizedProductId, ...fields };
              const updateCols = await updatePassportRowById({
                tableName,
                rowId: existingByProductId.id,
                userId,
                data: allData,
                excluded,
              });
              if (!updateCols.length) {
                details.push({ guid: existingByProductId.guid, product_id: normalizedProductId, status: "skipped", reason: "no changes detected" });
                skipped++; continue;
              }
              await logAudit(companyId, userId, "UPDATE", tableName, existingByProductId.guid, null, { source: "json_upsert", matched_by: "product_id" });
              details.push({ guid: existingByProductId.guid, product_id: normalizedProductId, status: "updated" });
              updated++; continue;
            }
            details.push({
              guid: existingByProductId.guid,
              product_id: normalizedProductId,
              status: "skipped",
              reason: existingStatus === "in_review"
                ? "matching passport is in review and cannot be edited"
                : "matching passport already exists; revise it before importing changes",
            });
            skipped++; continue;
          }
          const newGuid = uuidv4();
          const dataFields = getWritablePassportColumns(fields, excluded);
          const allCols = ["guid","company_id","model_name","product_id","created_by",...dataFields];
          const allVals = [newGuid, companyId, model_name || null, normalizedProductId, userId, ...getStoredPassportValues(dataFields, fields)];
          await pool.query(
            `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_,i)=>`$${i+1}`).join(",")})`,
            allVals
          );
          await pool.query(
            `INSERT INTO passport_registry (guid,company_id,passport_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [newGuid, companyId, resolvedPassportType]
          );
          details.push({ guid: newGuid, product_id: normalizedProductId, model_name, status: "created" });
          created++;
        }
      } catch (e) {
        console.error("Upsert JSON item error:", e.message);
        details.push({ guid: incomingGuid, status: "failed", error: e.message });
        failed++;
      }
    }

    res.json({ summary: { created, updated, skipped, failed }, details });
  } catch (e) {
    console.error("Upsert JSON error:", e.message);
    res.status(500).json({ error: "Import failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MESSAGING
// ═══════════════════════════════════════════════════════════════════════════

// Ensure tables exist on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    last_read_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(e => console.error("Messaging table init error:", e.message));

// List conversations for current user (with last message + unread count)
app.get("/api/messaging/conversations", authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        c.id,
        c.company_id,
        -- other participant info
        u.id       AS other_id,
        u.first_name,
        u.last_name,
        u.email,
        -- last message
        lm.body    AS last_message,
        lm.created_at AS last_message_at,
        ls.sender_id  AS last_sender_id,
        -- unread count
        (SELECT COUNT(*) FROM messages m2
         WHERE m2.conversation_id = c.id
           AND m2.created_at > COALESCE(cm_me.last_read_at, '1970-01-01')
           AND m2.sender_id != $1
        ) AS unread
      FROM conversations c
      JOIN conversation_members cm_me  ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
      JOIN conversation_members cm_other ON cm_other.conversation_id = c.id AND cm_other.user_id != $1
      JOIN users u ON u.id = cm_other.user_id
      LEFT JOIN LATERAL (
        SELECT m.body, m.created_at, m.sender_id FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1
      ) lm ON true
      LEFT JOIN messages ls ON ls.id = (
        SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE c.company_id = (SELECT company_id FROM users WHERE id = $1)
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC
    `, [req.user.userId]);
    res.json(r.rows);
  } catch (e) { console.error("List conversations error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// Get or create a direct conversation with another user
app.post("/api/messaging/conversations", authenticateToken, async (req, res) => {
  try {
    const { otherUserId } = req.body;
    if (!otherUserId) return res.status(400).json({ error: "otherUserId required" });
    const meId = req.user.userId;
    if (parseInt(otherUserId) === meId) return res.status(400).json({ error: "Cannot message yourself" });

    // Check same company
    const meRes = await pool.query("SELECT company_id FROM users WHERE id = $1", [meId]);
    const otherRes = await pool.query("SELECT company_id, first_name, last_name, email FROM users WHERE id = $1", [otherUserId]);
    if (!otherRes.rows.length) return res.status(404).json({ error: "User not found" });
    if (meRes.rows[0].company_id !== otherRes.rows[0].company_id) return res.status(403).json({ error: "Different company" });

    // Find existing 1:1 conversation
    const existing = await pool.query(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
      WHERE c.company_id = $3 LIMIT 1
    `, [meId, otherUserId, meRes.rows[0].company_id]);

    let convId;
    if (existing.rows.length) {
      convId = existing.rows[0].id;
    } else {
      const newConv = await pool.query(
        "INSERT INTO conversations (company_id) VALUES ($1) RETURNING id",
        [meRes.rows[0].company_id]
      );
      convId = newConv.rows[0].id;
      await pool.query(
        "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)",
        [convId, meId, otherUserId]
      );
    }
    res.json({ id: convId });
  } catch (e) { console.error("Create conversation error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// Get messages in a conversation
app.get("/api/messaging/conversations/:convId/messages", authenticateToken, async (req, res) => {
  try {
    const convId = parseInt(req.params.convId);
    // Check membership
    const mem = await pool.query(
      "SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
      [convId, req.user.userId]
    );
    if (!mem.rows.length) return res.status(403).json({ error: "Forbidden" });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before; // cursor-based pagination
    let q, params;
    if (before) {
      q = `SELECT m.id, m.body, m.created_at, m.sender_id,
                  u.first_name, u.last_name, u.email
           FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id=$1 AND m.id < $2
           ORDER BY m.id DESC LIMIT $3`;
      params = [convId, before, limit];
    } else {
      q = `SELECT m.id, m.body, m.created_at, m.sender_id,
                  u.first_name, u.last_name, u.email
           FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id=$1
           ORDER BY m.id DESC LIMIT $2`;
      params = [convId, limit];
    }
    const r = await pool.query(q, params);
    // Mark as read
    await pool.query(
      "UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2",
      [convId, req.user.userId]
    );
    res.json(r.rows.reverse());
  } catch (e) { console.error("Get messages error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// Send a message
app.post("/api/messaging/conversations/:convId/messages", authenticateToken, async (req, res) => {
  try {
    const convId = parseInt(req.params.convId);
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: "Message body required" });

    const mem = await pool.query(
      "SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
      [convId, req.user.userId]
    );
    if (!mem.rows.length) return res.status(403).json({ error: "Forbidden" });

    const r = await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *",
      [convId, req.user.userId, body.trim()]
    );
    // Update sender's last_read_at too
    await pool.query(
      "UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2",
      [convId, req.user.userId]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error("Send message error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// List company users to start new conversations with
app.get("/api/messaging/users", authenticateToken, async (req, res) => {
  try {
    const meRes = await pool.query("SELECT company_id FROM users WHERE id=$1", [req.user.userId]);
    const companyId = meRes.rows[0]?.company_id;
    if (!companyId) return res.json([]);
    const r = await pool.query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE company_id=$1 AND id != $2 AND is_active=true ORDER BY first_name, last_name`,
      [companyId, req.user.userId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// Unread message count (for badge)
app.get("/api/messaging/unread", authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) AS count FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
      WHERE m.sender_id != $1 AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
    `, [req.user.userId]);
    res.json({ count: parseInt(r.rows[0].count) });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/companies/:companyId/passports/:guid/submit-review", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid }              = req.params;
    const { passportType, reviewerId, approverId } = req.body;
    if (!passportType) return res.status(400).json({ error: "passportType required" });
    if (!reviewerId && !approverId) {
      return res.status(400).json({ error: "Select at least one reviewer or approver for workflow submission." });
    }

    const result = await submitPassportToWorkflow({
      companyId,
      guid,
      passportType,
      userId: req.user.userId,
      reviewerId,
      approverId,
    });
    res.json({ success: true, workflowId: result.workflowId });
  } catch (e) { console.error("Submit review error:", e.message); res.status(500).json({ error: "Failed" }); }
});

app.delete("/api/passports/:guid/workflow", authenticateToken, async (req, res) => {
  try {
    const { guid } = req.params;
    const userId = req.user.userId;

    const wfRes = await pool.query(
      "SELECT * FROM passport_workflow WHERE passport_guid = $1 ORDER BY created_at DESC LIMIT 1",
      [guid]
    );
    if (!wfRes.rows.length) return res.status(404).json({ error: "No workflow found" });
    const wf = wfRes.rows[0];

    // Only the creator or admins can remove
    const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
    const userRole = userRes.rows[0]?.role;
    const isCreator = wf.submitted_by === userId;
    const isAdmin = ["company_admin", "super_admin"].includes(userRole);
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: "Only the creator or admin can remove workflow" });
    }

    // Get the passport type to update its status
    const regRes = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
      [guid]
    );
    const passportType = regRes.rows[0]?.passport_type || wf.passport_type;

    if (passportType) {
      const tableName = getTable(passportType);
      // Revert to the original status (stored when workflow was submitted)
      const originalStatus = wf.previous_release_status || "in_revision";
      await pool.query(
        `UPDATE ${tableName} SET release_status=$1, updated_at=NOW() WHERE guid=$2`,
        [originalStatus, guid]
      );
    }

    // Delete the workflow entry
    await pool.query("DELETE FROM passport_workflow WHERE id = $1", [wf.id]);
    res.json({ success: true, message: "Workflow removed and passport reverted to revision" });
  } catch (e) { console.error("Remove workflow error:", e.message); res.status(500).json({ error: "Failed to remove workflow" }); }
});

app.post("/api/passports/:guid/workflow/:action", authenticateToken, async (req, res) => {
  try {
    const { guid, action }        = req.params;
    const { comment, passportType } = req.body;
    const userId = req.user.userId;

    if (!["approve","reject"].includes(action)) return res.status(400).json({ error: "Invalid action" });

    const wfRes = await pool.query(
      "SELECT * FROM passport_workflow WHERE passport_guid = $1 AND overall_status = 'in_progress' ORDER BY created_at DESC LIMIT 1",
      [guid]
    );
    if (!wfRes.rows.length) return res.status(404).json({ error: "No active workflow found for this passport" });
    const wf = wfRes.rows[0];

    const regRes = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
      [guid]
    );

    // passport_registry is the authoritative source — always prefer it over
    // the value stored on the workflow row (which may be stale) or the body
    const resolvedPassportType =
      regRes.rows[0]?.passport_type ||
      wf.passport_type ||
      passportType;

    if (!resolvedPassportType) {
      return res.status(400).json({ error: "passportType required" });
    }

    const uid = parseInt(userId, 10);
    const isReviewer = parseInt(wf.reviewer_id, 10) === uid && wf.review_status === "pending";
    const isApprover = parseInt(wf.approver_id, 10) === uid && wf.approval_status === "pending" && wf.review_status !== "pending";
    if (!isReviewer && !isApprover)
      return res.status(403).json({ error: "You are not the reviewer or approver for this passport" });

    const tableName = getTable(resolvedPassportType);
    const pRes = await pool.query(
      `SELECT model_name, version_number FROM ${tableName} WHERE guid = $1 ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    const pInfo = pRes.rows[0] || { model_name: guid.substring(0, 8), version_number: 1 };
    const appUrl = process.env.APP_URL || "http://localhost:3000";

    if (action === "reject") {
      const col = isReviewer ? "review_status" : "approval_status";
      const commentCol = isReviewer ? "reviewer_comment" : "approver_comment";
      await pool.query(
        `UPDATE passport_workflow SET ${col}='rejected', ${commentCol}=$1, rejected_at=NOW(), overall_status='rejected', updated_at=NOW() WHERE id=$2`,
        [comment || null, wf.id]
      );
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = $2, updated_at = NOW()
         WHERE guid=$1 AND release_status='in_review'`,
        [
          guid,
          pInfo.version_number > 1 ? IN_REVISION_STATUS : "draft",
        ]
      );
      if (wf.submitted_by) {
        const actor = await pool.query("SELECT first_name, last_name FROM users WHERE id=$1", [userId]);
        const actorName = `${actor.rows[0]?.first_name || ""} ${actor.rows[0]?.last_name || ""}`.trim() || "Reviewer";
        await createNotification(wf.submitted_by, "workflow_rejected",
          `❌ ${pInfo.model_name} was rejected`,
          `${isReviewer ? "Review" : "Approval"} rejected by ${actorName}${comment ? ` — ${comment.substring(0, 80)}` : ""}`,
          guid, `/dashboard/passports/${resolvedPassportType}`);
      }
      return res.json({ success: true, status: "rejected" });
    }

    if (isReviewer) {
      await pool.query(
        `UPDATE passport_workflow SET review_status='approved', reviewer_comment=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2`,
        [comment || null, wf.id]
      );
      if (!wf.approver_id || wf.approval_status === "skipped") {
        const relRes = await pool.query(
          `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE guid=$1 AND release_status='in_review' RETURNING *`,
          [guid]
        );
        if (relRes.rows.length) {
          const released = relRes.rows[0];
          const typeRes  = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [resolvedPassportType]);
          const sigData  = await signPassport({ ...released, passport_type: resolvedPassportType }, typeRes.rows[0] || null);
          if (sigData) {
            await pool.query(
              `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, signing_key_id, released_at, vc_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
              [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
            );
          }
          await logAudit(wf.company_id, userId, "RELEASE", tableName, guid,
            { release_status: "in_review" }, { release_status: "released", via: "workflow_review" });
        }
        await pool.query("UPDATE passport_workflow SET overall_status='approved', updated_at=NOW() WHERE id=$1", [wf.id]);
        if (wf.submitted_by) {
          await createNotification(wf.submitted_by, "workflow_approved",
            `✅ ${pInfo.model_name} reviewed and released!`, null, guid, `/passport/${guid}/introduction`);
        }
      } else {
        await createNotification(wf.approver_id, "workflow_approval",
          `Approval needed: ${pInfo.model_name}`, "Review passed — your approval is required", guid, "/dashboard/workflow");
      }
    } else if (isApprover) {
      await pool.query(
        `UPDATE passport_workflow SET approval_status='approved', approver_comment=$1, approved_at=NOW(), overall_status='approved', updated_at=NOW() WHERE id=$2`,
        [comment || null, wf.id]
      );
      const relRes = await pool.query(
        `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE guid=$1 AND release_status='in_review' RETURNING *`,
        [guid]
      );
      if (relRes.rows.length) {
        const released = relRes.rows[0];
        const typeRes  = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [resolvedPassportType]);
        const sigData  = await signPassport({ ...released, passport_type: resolvedPassportType }, typeRes.rows[0] || null);
        if (sigData) {
          await pool.query(
            `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, signing_key_id, released_at, vc_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
            [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
          );
        }
        await logAudit(wf.company_id, userId, "RELEASE", tableName, guid,
          { release_status: "in_review" }, { release_status: "released", via: "workflow_approval" });
      }
      if (wf.submitted_by) {
        await createNotification(wf.submitted_by, "workflow_approved",
          `🚀 ${pInfo.model_name} approved and released!`, null, guid, `/passport/${guid}/introduction`);
      }
    }

    res.json({ success: true, status: "approved" });
  } catch (e) { console.error("Workflow action error:", e.message); res.status(500).json({ error: "Failed" }); }
});

app.get("/api/companies/:companyId/workflow", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const userId        = req.user.userId;

    const inProgress = await pool.query(
      `SELECT pw.*,
         CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
         CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
       FROM passport_workflow pw
       LEFT JOIN users ur ON ur.id = pw.reviewer_id
       LEFT JOIN users ua ON ua.id = pw.approver_id
       WHERE pw.company_id = $1 AND pw.overall_status = 'in_progress' AND pw.submitted_by = $2
       ORDER BY pw.created_at DESC`,
      [companyId, userId]
    );
    const history = await pool.query(
      `SELECT pw.*,
         CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
         CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
       FROM passport_workflow pw
       LEFT JOIN users ur ON ur.id = pw.reviewer_id
       LEFT JOIN users ua ON ua.id = pw.approver_id
       WHERE pw.company_id = $1 AND pw.overall_status != 'in_progress' AND pw.submitted_by = $2
       ORDER BY pw.updated_at DESC LIMIT 50`,
      [companyId, userId]
    );

    const enrichRows = async (rows) => {
      const out = [];
      for (const row of rows) {
        let info = { model_name: row.passport_guid?.substring(0, 8) || "?", version_number: 1 };
        try {
          // Use passport_registry as authoritative type source
          const regRow = await pool.query(
            "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
            [row.passport_guid]
          );
          const actualType = regRow.rows[0]?.passport_type || row.passport_type;
          const t = getTable(actualType);
          const r = await pool.query(
            `SELECT model_name, version_number FROM ${t} WHERE guid = $1 ORDER BY version_number DESC LIMIT 1`,
            [row.passport_guid]
          );
          if (r.rows.length) info = r.rows[0];
        } catch {}
        out.push({ ...row, ...info });
      }
      return out;
    };

    res.json({ inProgress: await enrichRows(inProgress.rows), history: await enrichRows(history.rows) });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/api/users/me/backlog", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const r = await pool.query(
      `SELECT pw.*,
         CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
         CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
       FROM passport_workflow pw
       LEFT JOIN users ur ON ur.id = pw.reviewer_id
       LEFT JOIN users ua ON ua.id = pw.approver_id
       WHERE pw.overall_status = 'in_progress'
         AND (
           (pw.reviewer_id = $1 AND pw.review_status = 'pending') OR
           (pw.approver_id = $1 AND pw.approval_status = 'pending' AND pw.review_status != 'pending')
         )
       ORDER BY pw.created_at ASC`,
      [userId]
    );

    const enriched = [];
    for (const row of r.rows) {
      let info = { model_name: row.passport_guid?.substring(0, 8) || "?", version_number: 1 };
      try {
        const regRow = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
          [row.passport_guid]
        );
        const actualType = regRow.rows[0]?.passport_type || row.passport_type;
        const t = getTable(actualType);
        const p = await pool.query(
          `SELECT model_name, version_number FROM ${t} WHERE guid = $1 ORDER BY version_number DESC LIMIT 1`,
          [row.passport_guid]
        );
        if (p.rows.length) info = p.rows[0];
      } catch {}
      enriched.push({ ...row, ...info });
    }
    res.json({ backlog: enriched });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════════════════════════════════════
app.get("/health", (_, res) => res.json({ status: "OK", architecture: "dynamic-per-company-tables" }));

app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
