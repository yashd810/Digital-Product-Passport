"use strict";

const fs = require("fs");
const path = require("path");

function initEnvironment(serverDir) {
  require("dotenv").config({
    path: process.env.DOTENV_CONFIG_PATH || path.resolve(serverDir, "../../../docker/.env"),
  });
}

function deriveRuntimePaths(serverDir) {
  const appRootDir = path.resolve(serverDir, "../../..");
  const localStorageDir = path.resolve(
    process.env.LOCAL_STORAGE_DIR || path.join(appRootDir, "storage", "local-storage")
  );
  const filesBaseDir = path.resolve(
    process.env.FILES_DIR || path.join(localStorageDir, "passport-files")
  );
  const repoBaseDir = path.resolve(
    process.env.REPO_DIR || path.join(localStorageDir, "repository-files")
  );
  const uploadsBaseDir = path.resolve(
    process.env.UPLOADS_DIR || path.join(localStorageDir, "uploads")
  );
  const globalSymbolsDir = path.join(uploadsBaseDir, "symbols");

  return {
    appRootDir,
    localStorageDir,
    filesBaseDir,
    repoBaseDir,
    uploadsBaseDir,
    globalSymbolsDir,
    passportStoragePrefix: "passport-files/",
  };
}

function ensureLocalDirectories(paths) {
  const storageProvider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  if (storageProvider !== "local") return;
  [paths.localStorageDir, paths.filesBaseDir, paths.repoBaseDir, paths.globalSymbolsDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function normalizeStorageRequestKey(value) {
  const raw = String(value || "").replace(/^\/+/, "").replace(/\\/g, "/");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isPassportStorageKey(value, passportStoragePrefix = "passport-files/") {
  return normalizeStorageRequestKey(value).startsWith(passportStoragePrefix);
}

function isPlainRecord(value) {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && !(value instanceof Date)
    && (proto === Object.prototype || proto === null)
    && !Buffer.isBuffer(value);
}

function normalizeJsonFriendlyValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonFriendlyValue(entry));
  }
  if (!value || typeof value !== "object") return value;

  if (!isPlainRecord(value)) {
    if (typeof value.toJSON === "function") {
      const jsonValue = value.toJSON();
      if (jsonValue !== value) return normalizeJsonFriendlyValue(jsonValue);
    }
    if (typeof value.toISO === "function") {
      const isoValue = value.toISO();
      if (typeof isoValue === "string") return isoValue;
    }
    if (typeof value.toISOString === "function") {
      try {
        return value.toISOString();
      } catch {
        return value;
      }
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeJsonFriendlyValue(entry)])
  );
}

function normalizeIncomingDppIdentifiers(value) {
  return normalizeJsonFriendlyValue(value);
}

function normalizeOutgoingDppIdentifiers(value) {
  return normalizeJsonFriendlyValue(value);
}

function toBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "0.0.0.0"
    || host === "::1"
    || host === "[::1]";
}

function validateProductionUrl(name, logger) {
  const rawValue = process.env[name];
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    logger.error({ env: name }, "Production URL environment variable is not a valid URL");
    process.exit(1);
  }

  if (parsed.protocol !== "https:" || isLoopbackHost(parsed.hostname)) {
    logger.error({ env: name, protocol: parsed.protocol, hostname: parsed.hostname }, "Production URL must use a public HTTPS origin");
    process.exit(1);
  }
}

function assertDatabaseName({ logger }) {
  const expectedDatabaseName = "dppSystem";
  const configuredDatabaseName = String(process.env.DB_NAME || "").trim();

  if (configuredDatabaseName !== expectedDatabaseName) {
    logger.error(
      { env: "DB_NAME", expected: expectedDatabaseName, actual: configuredDatabaseName || null },
      "Invalid database name. Use the canonical camel-case app database name."
    );
    process.exit(1);
  }
}

function deriveRuntimeFlags(port) {
  const isProduction = process.env.NODE_ENV === "production";
  const runSchemaMigrations =
    String(process.env.RUN_SCHEMA_MIGRATIONS || "").trim().toLowerCase() === "true"
    || (!isProduction && String(process.env.RUN_SCHEMA_MIGRATIONS || "").trim().toLowerCase() !== "false");

  const defaultAllowedOrigins = isProduction ? [] : [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3004", "http://127.0.0.1:3004",
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:8001", "http://127.0.0.1:8001",
    "http://localhost:5173", "http://127.0.0.1:5173",
    `http://localhost:${port}`, `http://127.0.0.1:${port}`,
  ];
  const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOriginSet = new Set([...defaultAllowedOrigins, ...envAllowedOrigins]);

  return {
    isProduction,
    runSchemaMigrations,
    allowedOriginSet,
    cspConnectSrc: ["'self'", ...allowedOriginSet],
  };
}

function assertRequiredProductionEnvironment({ isProduction, logger }) {
  if (!isProduction) return;

  const requiredEnvVars = ["JWT_SECRET", "PEPPER_V1", "DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "APP_URL", "SERVER_URL"];
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    logger.error({ missing: missingEnvVars }, "Missing required environment variables in production");
    process.exit(1);
  }

  if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS.trim() === "") {
    logger.error("ALLOWED_ORIGINS must be configured in production");
    process.exit(1);
  }

  validateProductionUrl("APP_URL", logger);
  validateProductionUrl("SERVER_URL", logger);
}

function assertProductionStorageReadiness({ isProduction, logger }) {
  if (!isProduction) return;

  const storageProvider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const allowLocalStorage = toBooleanEnv(process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION, false);
  const allowMissingBackupProvider = toBooleanEnv(process.env.ALLOW_MISSING_BACKUP_PROVIDER_IN_PRODUCTION, false);
  const backupProviderEnabled = toBooleanEnv(process.env.BACKUP_PROVIDER_ENABLED, false);
  const backupProviderRequired = toBooleanEnv(process.env.BACKUP_PROVIDER_REQUIRED, false);
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

  if (backupProviderRequired && !backupProviderEnabled && !allowMissingBackupProvider) {
    missing.push("BACKUP_PROVIDER_ENABLED=true");
  }
  if (backupProviderEnabled && !process.env.BACKUP_PROVIDER_OBJECT_PREFIX) {
    missing.push("BACKUP_PROVIDER_OBJECT_PREFIX");
  }

  if (missing.length) {
    logger.error({ missing }, "Storage/DR guard failed");
    throw new Error(`[PRODUCTION] Storage/DR guard failed. Missing required production storage configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  assertDatabaseName,
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
};
