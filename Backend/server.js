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

const app  = express();
const PORT = process.env.PORT || 3001;
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Restrict CORS to known origins; defaults to localhost for development
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",").map(s => s.trim()).filter(Boolean);
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

const pool = new Pool({
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

const JWT_SECRET             = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRY             = "7d";
const PEPPER                 = process.env.PEPPER_V1  || "change-this-pepper-in-production";
const CURRENT_PEPPER_VERSION = 1;
const SESSION_COOKIE_NAME    = process.env.SESSION_COOKIE_NAME || "dpp_session";
const COOKIE_SECURE          = process.env.COOKIE_SECURE === "true";
const COOKIE_SAME_SITE       = process.env.COOKIE_SAME_SITE || "lax";
const COOKIE_DOMAIN          = process.env.COOKIE_DOMAIN || "";

if (!process.env.JWT_SECRET) console.warn("[SECURITY] JWT_SECRET is not set — using insecure default. Set it in .env before deploying.");
if (!process.env.PEPPER_V1)  console.warn("[SECURITY] PEPPER_V1 is not set — using insecure default. Set it in .env before deploying.");

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

const rateLimitBuckets = new Map();
const rateLimit = ({ key, limit, windowMs, message }) => (req, res, next) => {
  const now = Date.now();
  const bucketKey = key(req);
  const existing = rateLimitBuckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (existing.count >= limit) {
    return res.status(429).json({ error: message });
  }
  existing.count += 1;
  next();
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
      model_name     VARCHAR(255) NOT NULL,
      product_id     VARCHAR(255),
      release_status VARCHAR(50)  NOT NULL DEFAULT 'draft',
      version_number INTEGER      NOT NULL DEFAULT 1,
      color_scheme   VARCHAR(50)  DEFAULT 'mint',
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
      COUNT(CASE WHEN release_status IN ('revised', 'in_revision') THEN 1 END) AS revised,
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_registry (
      guid          UUID        PRIMARY KEY,
      company_id    INTEGER     NOT NULL,
      passport_type VARCHAR(50) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry(company_id)
  `);
  // Add access_key column to passport_registry (idempotent migration)
  await pool.query(`
    ALTER TABLE passport_registry
      ADD COLUMN IF NOT EXISTS access_key VARCHAR(36) DEFAULT gen_random_uuid()::text
  `);
  // Backfill any existing rows that have no access_key yet
  await pool.query(`
    UPDATE passport_registry SET access_key = gen_random_uuid()::text WHERE access_key IS NULL
  `);
  // Migrate passport_types table — add new columns if missing (idempotent)
  await pool.query(`
    ALTER TABLE passport_types
      ADD COLUMN IF NOT EXISTS display_name      VARCHAR(255),
      ADD COLUMN IF NOT EXISTS umbrella_category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS umbrella_icon     VARCHAR(10)  DEFAULT '📋',
      ADD COLUMN IF NOT EXISTS fields_json       JSONB        NOT NULL DEFAULT '{"sections":[]}',
      ADD COLUMN IF NOT EXISTS is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS created_by        INT REFERENCES users(id) ON DELETE SET NULL
  `);
  // Backfill display_name from label column if it exists and display_name is null
  await pool.query(`
    UPDATE passport_types SET display_name = COALESCE(
      (SELECT label FROM information_schema.columns
       WHERE table_name='passport_types' AND column_name='label' LIMIT 1),
      type_name
    ) WHERE display_name IS NULL
  `).catch(() => {});
  await pool.query(`UPDATE passport_types SET display_name = type_name WHERE display_name IS NULL`);
  await pool.query(`UPDATE passport_types SET umbrella_category = display_name WHERE umbrella_category IS NULL`);
  await pool.query(`ALTER TABLE passport_types ALTER COLUMN display_name SET NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE passport_types ALTER COLUMN umbrella_category SET NOT NULL`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_umbrella ON passport_types(umbrella_category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_active   ON passport_types(is_active)`);

  // Ensure company_passport_access exists (may be missing on older installs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_passport_access (
      id               SERIAL PRIMARY KEY,
      company_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type_id INT NOT NULL REFERENCES passport_types(id) ON DELETE CASCADE,
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

  // Two-factor authentication
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(64)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ`);

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
  // Drop the old UNIQUE constraint if it exists from a previous schema version
  await pool.query(`
    ALTER TABLE passport_dynamic_values
      DROP CONSTRAINT IF EXISTS passport_dynamic_values_passport_guid_field_key_key
  `).catch(() => {});

  // Device API key on passport_registry — lets IoT devices push dynamic value updates
  await pool.query(`
    ALTER TABLE passport_registry
      ADD COLUMN IF NOT EXISTS device_api_key VARCHAR(64) DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  `);
  // Backfill any rows that have no device_api_key yet
  await pool.query(`
    UPDATE passport_registry SET device_api_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    WHERE device_api_key IS NULL
  `);

  // Allow audit_logs.company_id to be NULL (needed for super-admin actions like CREATE_PASSPORT_TYPE)
  await pool.query(`
    ALTER TABLE audit_logs ALTER COLUMN company_id DROP NOT NULL
  `).catch(() => {});

  // Add access_revoked flag to company_passport_access so revoked types keep their passports visible
  await pool.query(`
    ALTER TABLE company_passport_access ADD COLUMN IF NOT EXISTS access_revoked BOOLEAN NOT NULL DEFAULT FALSE
  `).catch(() => {});

  // Add vc_json column to passport_signatures for W3C VC storage
  await pool.query(`
    ALTER TABLE passport_signatures ADD COLUMN IF NOT EXISTS vc_json TEXT
  `).catch(() => {});

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

  // Drop legacy per-company tables left over from the old architecture.
  // Old naming: company_{id}_{type}_passports  →  new: {type}_passports
  const legacyTables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name ~ '^company_[0-9]+_.+_passports$'
  `);
  for (const { table_name } of legacyTables.rows) {
    await pool.query(`DROP TABLE IF EXISTS "${table_name}"`);
    console.log(`[initDb] Dropped legacy table: ${table_name}`);
  }

  // Add previous_release_status column to passport_workflow (idempotent migration)
  await pool.query(`
    ALTER TABLE passport_workflow
      ADD COLUMN IF NOT EXISTS previous_release_status VARCHAR(50)
  `);

  // Migration: ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query("SELECT type_name FROM passport_types");
  for (const { type_name } of ptRows.rows) {
    await createPassportTable(type_name).catch(e =>
      console.warn(`[initDb] Could not create table for ${type_name}:`, e.message)
    );
  }
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
<style>
  body{margin:0;padding:0;background:#07131f;font-family:Arial,Helvetica,sans-serif}
  .wrapper{max-width:640px;margin:36px auto;border-radius:18px;overflow:hidden;border:1px solid rgba(13,181,176,.2);box-shadow:0 16px 50px rgba(0,0,0,.45)}
  .hdr{background:linear-gradient(135deg,#0e2234 0%,#07131f 100%);padding:34px 40px;text-align:center;border-bottom:1px solid rgba(13,181,176,.18)}
  .hdr-logo{font-size:28px;margin-bottom:6px}
  .hdr-title{color:#f0f6fa;font-size:21px;font-weight:700;margin:0}
  .hdr-sub{color:rgba(184,204,217,.82);font-size:13px;margin:6px 0 0}
  .body{background:#102132;padding:36px 40px}
  .body p{font-size:15px;color:#d5e4ee;line-height:1.75;margin:0 0 16px}
  .body strong{color:#ffffff}
  .info-box{background:rgba(13,181,176,.07);border:1px solid rgba(13,181,176,.18);border-radius:12px;padding:18px 22px;margin:20px 0}
  .info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px}
  .info-row:last-child{border-bottom:none}
  .info-label{color:#0db5b0;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.6px}
  .info-value{color:#f0f6fa;font-weight:600}
  .cta-wrap{text-align:center;margin:28px 0}
  .cta-btn{display:inline-block;background:linear-gradient(135deg,#14b8a6 0%,#0f766e 100%);color:#06131d!important;text-decoration:none;padding:14px 36px;border-radius:999px;font-size:15px;font-weight:700;letter-spacing:.3px;box-shadow:0 10px 24px rgba(13,181,176,.25)}
  .footer{background:#07131f;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,.06)}
  .footer p{font-size:12px;color:#7e97aa;margin:4px 0}
  a{color:#57d8d0}
</style></head><body>
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
app.use("/repository-files", express.static(REPO_BASE_DIR, {
  setHeaders: (res, fp) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (fp.endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
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

  // ── Legacy RSA-SHA256 verification (pre-VC passports) ─────────────────
  const reg = await pool.query(
    "SELECT passport_type FROM passport_registry WHERE guid = $1", [guid]
  );
  if (!reg.rows.length) return { status: "not_found" };
  const { passport_type } = reg.rows[0];
  const tbl = getTable(passport_type);

  const pRow = await pool.query(
    `SELECT * FROM ${tbl} WHERE guid = $1 AND version_number = $2 AND deleted_at IS NULL`,
    [guid, versionNumber]
  );
  if (!pRow.rows.length) return { status: "not_found" };

  const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passport_type]);
  const typeDef = typeRes.rows[0] || null;

  // Rebuild legacy canonical payload using stored released_at
  const legacyCanonical = canonicalJSON({
    algorithm:      "RSA-SHA256",
    company_id:     pRow.rows[0].company_id,
    fields:         (() => {
      const f = {};
      for (const s of (typeDef?.fields_json?.sections || [])) {
        for (const field of (s.fields || [])) {
          if (field.dynamic) continue;
          const v = pRow.rows[0][field.key];
          if (v !== null && v !== undefined && v !== "") f[field.key] = String(v);
        }
      }
      return f;
    })(),
    guid:           pRow.rows[0].guid,
    model_name:     pRow.rows[0].model_name  || null,
    passport_type,
    product_id:     pRow.rows[0].product_id  || null,
    released_at:    sig.released_at,
    version_number: pRow.rows[0].version_number,
  });

  if (crypto.createHash("sha256").update(legacyCanonical).digest("hex") !== sig.data_hash) {
    return { status: "tampered", signedAt: sig.signed_at, keyId: sig.signing_key_id, releasedAt: sig.released_at };
  }

  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(legacyCanonical);
    verifier.end();
    const valid = verifier.verify(publicKeyPem, sig.signature, "base64");
    return {
      status:     valid ? "valid" : "invalid",
      signedAt:   sig.signed_at,
      keyId:      sig.signing_key_id,
      dataHash:   sig.data_hash,
      releasedAt: sig.released_at,
      algorithm:  sig.algorithm,
    };
  } catch {
    return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
const logAudit = async (companyId, userId, action, tableName, passportGuid, oldData, newData) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (company_id,user_id,action,table_name,passport_guid,old_values,new_values)
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
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, company_id, role, pepper_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, company_id, role, first_name, last_name`,
      [invite.email, hash, firstName, lastName, invite.company_id, role, pepperVersion]
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
        <div style="background:#fef3c7;border:1px solid #f5d76e;border-radius:6px;padding:10px 14px;margin:16px 0;font-size:13px;color:#7a5c00">
          ⏰ This invitation expires in <strong>48 hours</strong> and can only be used <strong>once</strong>.
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
              u.two_factor_enabled, c.company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed" }); }
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
              u.is_active, u.created_at
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
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(type_name))
      return res.status(400).json({
        error: "type_name must be lowercase letters/numbers/underscores, 2–30 chars, start with a letter"
      });

    if (!Array.isArray(sections) || sections.length === 0)
      return res.status(400).json({ error: "At least one section is required" });

    // Validate section/field keys
    for (const section of sections) {
      if (!section.key || !section.label || !Array.isArray(section.fields))
        return res.status(400).json({ error: "Each section must have key, label, and fields array" });
      if (!/^[a-z][a-z0-9_]{0,29}$/.test(section.key))
        return res.status(400).json({ error: `Invalid section key: ${section.key}` });
      for (const field of section.fields) {
        if (!field.key || !field.label || !field.type)
          return res.status(400).json({ error: "Each field must have key, label, and type" });
        if (!/^[a-z][a-z0-9_]{0,49}$/.test(field.key))
          return res.status(400).json({ error: `Invalid field key: ${field.key}` });
        if (!["text","textarea","boolean","file","table"].includes(field.type))
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
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const code = `${slug}dpp${Math.floor(100000 + Math.random() * 900000)}`;
    const r = await pool.query(
      "INSERT INTO companies (company_name, company_code) VALUES ($1, $2) RETURNING *",
      [companyName, code]
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
    let inviterCompanyId = inviter.rows[0]?.company_id || req.user.companyId || null;
    if (!inviterCompanyId) {
      const fallbackCompany = await pool.query(
        "SELECT id FROM companies ORDER BY created_at ASC, id ASC LIMIT 1"
      );
      inviterCompanyId = fallbackCompany.rows[0]?.id || null;
    }
    if (!inviterCompanyId) {
      return res.status(400).json({ error: "No company exists yet to attach this invite token to. Create a company first, then try again." });
    }

    const tokenValue = uuidv4();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO invite_tokens (token, email, company_id, invited_by, expires_at, role_to_assign)
       VALUES ($1, $2, $3, $4, $5, 'super_admin')`,
      [tokenValue, inviteeEmail, inviterCompanyId, req.user.userId, expiresAt]
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
      "SELECT id, company_name, company_code FROM companies WHERE id = $1",
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
    const { passport_type, model_name, product_id, ...fields } = req.body;
    const userId = req.user.userId;

    if (!passport_type)
      return res.status(400).json({ error: "passport_type is required" });

    const tableName = getTable(passport_type);
    const guid = uuidv4();
    const normalizedModelName = (typeof model_name === "string" ? model_name.trim() : "")
      || `Untitled Passport ${guid.slice(0, 8)}`;

    const dup = await pool.query(
      `SELECT id FROM ${tableName}
       WHERE model_name = $1 AND release_status = 'draft' AND deleted_at IS NULL`,
      [normalizedModelName]
    );
    if (dup.rows.length)
      return res.status(409).json({ error: `A draft "${normalizedModelName}" already exists.` });

    const systemFields = new Set(["id","guid","company_id","created_by","created_at","passport_type",
                          "version_number","release_status","deleted_at","qr_code",
                          "created_by_email","first_name","last_name","updated_by","updated_at"]);
    const dataFields = Object.keys(fields).filter(k => !systemFields.has(k));

    const allCols = ["guid","company_id","model_name","product_id","created_by", ...dataFields];
    const allVals = [guid, companyId, normalizedModelName, product_id || null, userId, ...dataFields.map(k => fields[k])];
    const places  = allCols.map((_, i) => `$${i + 1}`).join(", ");

    const result = await pool.query(
      `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING *`,
      allVals
    );

    await pool.query(
      `INSERT INTO passport_registry (guid, company_id, passport_type)
       VALUES ($1, $2, $3) ON CONFLICT (guid) DO NOTHING`,
      [guid, companyId, passport_type]
    );

    await logAudit(companyId, userId, "CREATE", tableName, guid, null, {
      model_name: normalizedModelName,
      passport_type,
      product_id,
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
    const { passport_type, passports } = req.body;
    const userId = req.user.userId;

    if (!passport_type)           return res.status(400).json({ error: "passport_type is required" });
    if (!Array.isArray(passports) || passports.length === 0)
      return res.status(400).json({ error: "passports must be a non-empty array" });
    if (passports.length > 500)   return res.status(400).json({ error: "Maximum 500 passports per bulk request" });

    const tableName = getTable(passport_type);

    const systemFields = new Set(["id","guid","company_id","created_by","created_at","passport_type",
      "version_number","release_status","deleted_at","qr_code",
      "created_by_email","first_name","last_name","updated_by","updated_at"]);

    const results  = [];
    let created = 0, skipped = 0, failed = 0;

    for (let i = 0; i < passports.length; i++) {
      const item = passports[i];
      const { model_name, product_id, ...fields } = item;
      const guid = uuidv4();
      const normalizedModelName = (typeof model_name === "string" ? model_name.trim() : "")
        || `Untitled Passport ${guid.slice(0, 8)}`;

      try {
        // Duplicate check (existing draft with same model_name)
        const dup = await pool.query(
          `SELECT id FROM ${tableName} WHERE model_name = $1 AND release_status = 'draft' AND deleted_at IS NULL`,
          [normalizedModelName]
        );
        if (dup.rows.length) {
          results.push({ index: i, model_name: normalizedModelName, success: false, error: `A draft "${normalizedModelName}" already exists — skipped` });
          skipped++;
          continue;
        }

        const dataFields = Object.keys(fields).filter(k => !systemFields.has(k) && /^[a-z][a-z0-9_]+$/.test(k));
        const allCols  = ["guid","company_id","model_name","product_id","created_by", ...dataFields];
        const allVals  = [guid, companyId, normalizedModelName, product_id || null, userId, ...dataFields.map(k => fields[k])];
        const places   = allCols.map((_, idx) => `$${idx + 1}`).join(", ");

        const r = await pool.query(
          `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING guid, model_name, product_id`,
          allVals
        );
        await pool.query(
          `INSERT INTO passport_registry (guid, company_id, passport_type) VALUES ($1,$2,$3) ON CONFLICT (guid) DO NOTHING`,
          [guid, companyId, passport_type]
        );
        await logAudit(companyId, userId, "CREATE", tableName, guid, null, {
          model_name: normalizedModelName,
          passport_type,
          product_id,
          bulk: true,
        });

        results.push({ index: i, success: true, guid, model_name: normalizedModelName, product_id: product_id || null });
        created++;
      } catch (e) {
        results.push({ index: i, model_name: normalizedModelName, success: false, error: e.message });
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

    if (status)  { q += ` AND p.release_status = $${i++}`; params.push(status); }
    if (search)  { q += ` AND (p.model_name ILIKE $${i} OR p.product_id ILIKE $${i})`; params.push(`%${search}%`); i++; }
    q += " ORDER BY p.created_at DESC";

    const r = await pool.query(q, params);
    res.json(r.rows.map(row => ({ ...row, passport_type: passportType })));
  } catch (e) { res.status(500).json({ error: "Failed to fetch passports" }); }
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
    res.json({ ...r.rows[0], passport_type: passportType });
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
    const passport = { ...r.rows[0], passport_type };

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

    res.json({ success: true, passport: { ...r.rows[0], passport_type } });
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

// UPDATE (draft / in revision only)
app.patch("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid } = req.params;
    const { passportType, ...fields } = req.body;
    const userId = req.user.userId;

    if (!passportType) return res.status(400).json({ error: "passportType is required in body" });
    const tableName = getTable(passportType);

    const current = await pool.query(
      `SELECT id FROM ${tableName}
       WHERE guid = $1 AND release_status IN ('draft', 'revised') AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!current.rows.length)
      return res.status(404).json({ error: "Passport not found or not editable." });
    const rowId = current.rows[0].id;

    const excluded = new Set(["id","guid","company_id","created_by","created_at","passport_type",
      "version_number","release_status","deleted_at","qr_code",
      "created_by_email","first_name","last_name","updated_by","updated_at"]);
    // Only allow safe column names (lowercase, alphanumeric + underscore) to prevent SQL injection
    const updateFields = Object.keys(fields).filter(k => !excluded.has(k) && /^[a-z][a-z0-9_]+$/.test(k));
    if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });

    const sets = updateFields.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const vals = updateFields.map(k => fields[k]);
    await pool.query(
      `UPDATE ${tableName} SET ${sets}, updated_by = $${vals.length + 1}, updated_at = NOW()
       WHERE id = $${vals.length + 2}`,
      [...vals, userId, rowId]
    );

    await logAudit(companyId, userId, "UPDATE", tableName, guid, null, { fields_updated: updateFields });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to update passport" }); }
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
       WHERE guid = $1 AND release_status IN ('draft', 'revised')
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
      { release_status: "draft_or_revised" }, { release_status: "released" });
    res.json({ success: true, passport: released });
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
      `SELECT id FROM ${tableName} WHERE guid = $1 AND release_status IN ('draft', 'revised') AND deleted_at IS NULL`,
      [guid]
    );
    if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

    const src        = current.rows[0];
    const newVersion = src.version_number + 1;
    const excluded   = new Set(["id","guid","created_at","updated_at","updated_by","qr_code"]);
    const cols       = Object.keys(src).filter(k => !excluded.has(k));
    const vals       = cols.map(k => {
      if (k === "version_number") return newVersion;
      if (k === "release_status") return "revised";
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
    res.json({ success: true, newVersion });
  } catch (e) { res.status(500).json({ error: "Failed to revise passport" }); }
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
       WHERE guid = $1 AND release_status IN ('draft', 'revised') AND deleted_at IS NULL
       RETURNING guid`,
      [guid]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete a released passport" });
    await logAudit(companyId, req.user.userId, "DELETE", tableName, guid, { guid }, null);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete passport" }); }
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
    res.json({ versions: r.rows, passportType });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
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
         WHERE guid = $1 AND release_status IN ('draft', 'revised') AND deleted_at IS NULL
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
      await pool.query(
        `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at)
         VALUES ($1, $2, $3, NOW())`,
        [guid, fieldKey, value === null || value === undefined ? null : String(value)]
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
      "SELECT id, company_name, company_logo, introduction_text FROM companies WHERE id = $1",
      [req.params.companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed to fetch company profile" }); }
});

app.post("/api/companies/:companyId/profile", authenticateToken, checkCompanyAccess, async (req, res) => {
  try {
    const { company_logo, introduction_text } = req.body;
    await pool.query(
      `UPDATE companies
       SET company_logo = $1, introduction_text = COALESCE($2, introduction_text), updated_at = NOW()
       WHERE id = $3`,
      [company_logo !== undefined ? company_logo : null, introduction_text || null, req.params.companyId]
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
      // Only delete from disk if it's an actual uploaded file (has file_path)
      try { fs.unlinkSync(row.file_path); } catch {}
    }

    await pool.query("DELETE FROM company_repository WHERE id = $1", [row.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Failed to delete" }); }
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
//  WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/companies/:companyId/passports/:guid/submit-review", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
  try {
    const { companyId, guid }              = req.params;
    const { passportType, reviewerId, approverId } = req.body;
    if (!passportType) return res.status(400).json({ error: "passportType required" });

    const tableName = getTable(passportType);
    const pRes = await pool.query(
      `SELECT id, model_name, version_number, release_status FROM ${tableName}
       WHERE guid = $1 AND release_status IN ('draft', 'revised') AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!pRes.rows.length) return res.status(404).json({ error: "Editable passport not found" });
    const passport = pRes.rows[0];

    const newStatus = reviewerId ? "in_review" : "released";
    await pool.query(
      `UPDATE ${tableName} SET release_status = $1, updated_at = NOW()
       WHERE guid = $2 AND release_status IN ('draft', 'revised')`,
      [newStatus, guid]
    );

    const wfRes = await pool.query(
      `INSERT INTO passport_workflow
         (passport_guid, passport_type, company_id, submitted_by, reviewer_id, approver_id,
          review_status, approval_status, overall_status, previous_release_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9) RETURNING id`,
      [guid, passportType, companyId, req.user.userId,
       reviewerId || null, approverId || null,
       reviewerId ? "pending" : "skipped", approverId ? "pending" : "skipped",
       passport.release_status]
    );

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    if (reviewerId) {
      await createNotification(reviewerId, "workflow_review",
        `Review requested: ${passport.model_name}`,
        `v${passport.version_number} needs your review`, guid, "/dashboard/workflow");
      try {
        const reviewer  = await pool.query("SELECT email, first_name FROM users WHERE id = $1", [reviewerId]);
        const submitter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [req.user.userId]);
        if (reviewer.rows.length) {
          const rName = reviewer.rows[0].first_name || "Reviewer";
          const sName = `${submitter.rows[0]?.first_name || ""} ${submitter.rows[0]?.last_name || ""}`.trim() || submitter.rows[0]?.email || "A colleague";
          await createTransporter().sendMail({
            from: process.env.EMAIL_FROM || "noreply@example.com", to: reviewer.rows[0].email,
            subject: `[DPP] Review requested — ${passport.model_name}`,
            html: brandedEmail({ preheader: `${sName} submitted a passport for your review`, bodyHtml: `
              <p>Hi <strong>${rName}</strong>,</p>
              <p><strong>${sName}</strong> has submitted a passport for your review.</p>
              <div class="info-box">
                <div class="info-row"><span class="info-label">Passport</span><span class="info-value">${passport.model_name}</span></div>
                <div class="info-row"><span class="info-label">Version</span><span class="info-value">v${passport.version_number}</span></div>
                <div class="info-row"><span class="info-label">Type</span><span class="info-value">${passportType}</span></div>
              </div>
              <div class="cta-wrap"><a href="${appUrl}/dashboard/workflow" class="cta-btn">🔍 Review Now →</a></div>` }),
          });
        }
      } catch (e) { console.error("Review email error:", e.message); }
    }

    if (approverId && !reviewerId) {
      await createNotification(approverId, "workflow_approval",
        `Approval requested: ${passport.model_name}`,
        `v${passport.version_number} needs your approval`, guid, "/dashboard/workflow");
    }

    if (!reviewerId && !approverId) {
      await createNotification(req.user.userId, "passport_released",
        `${passport.model_name} released!`,
        `v${passport.version_number} is now live`, guid, `/passport/${guid}/introduction`);
    }

    await logAudit(companyId, req.user.userId, "SUBMIT_REVIEW", tableName, guid, null,
      { reviewerId, approverId, status: newStatus });
    res.json({ success: true, workflowId: wfRes.rows[0].id });
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
      "SELECT * FROM passport_workflow WHERE passport_guid = $1 ORDER BY created_at DESC LIMIT 1",
      [guid]
    );
    if (!wfRes.rows.length) return res.status(404).json({ error: "No workflow found" });
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

    const isReviewer = wf.reviewer_id === userId && wf.review_status === "pending";
    const isApprover = wf.approver_id === userId && wf.approval_status === "pending" && wf.review_status !== "pending";
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
          pInfo.version_number > 1 ? "revised" : "draft",
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
