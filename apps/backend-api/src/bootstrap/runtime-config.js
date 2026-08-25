"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isPrivateOrReservedHostname, normalizeHostname } = require("../shared/security/network-address");
const { normalizeConfiguredOrigin } = require("../shared/security/configured-origin");
const {
  backupProviderS3EnvNames,
  readBackupProviderObjectStorageConfigFromEnvironment,
  validateBackupProviderObjectPrefix,
} = require("../shared/backups/backup-provider-object-storage-config");

const requiredSecurityEnvVars = [
  "JWT_SECRET",
  "PEPPER_V1",
  "OTP_HMAC_SECRET",
  "REPOSITORY_FILE_LINK_SECRET",
  "SIGNING_PRIVATE_KEY",
  "SIGNING_PUBLIC_KEY",
  "DB_PASSWORD",
];
const secretValueEnvVars = [
  "JWT_SECRET",
  "PEPPER_V1",
  "OTP_HMAC_SECRET",
  "REPOSITORY_FILE_LINK_SECRET",
  "DB_PASSWORD",
];
// These capabilities belong only to controlled migration / backup jobs. A
// production API process must fail closed if a broad host env file leaks them
// into the long-running web container.
const runtimeForbiddenProductionEnvPatterns = [
  /^DB_ADMIN_/,
  /^DB_MIGRATION_/,
  /^POSTGRES_/,
  // DB_BACKUP_ENABLED is intentionally a non-secret policy bit used by the
  // API's production readiness check. Every other current or future
  // DB_BACKUP_* capability belongs only to the isolated backup job.
  /^DB_BACKUP_(?!ENABLED$)/,
];

function normalizePemEnvironmentValue(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function assertMatchingP256SigningKeys() {
  const privateKey = crypto.createPrivateKey(normalizePemEnvironmentValue(process.env.SIGNING_PRIVATE_KEY));
  const publicKey = crypto.createPublicKey(normalizePemEnvironmentValue(process.env.SIGNING_PUBLIC_KEY));
  const derivedPublicKey = crypto.createPublicKey(privateKey);
  const configuredPublicJwk = publicKey.export({ format: "jwk" });
  const derivedPublicJwk = derivedPublicKey.export({ format: "jwk" });
  const matchingPublicKeys = Buffer.compare(
    derivedPublicKey.export({ format: "der", type: "spki" }),
    publicKey.export({ format: "der", type: "spki" })
  ) === 0;
  if (privateKey.asymmetricKeyType !== "ec"
    || publicKey.asymmetricKeyType !== "ec"
    || configuredPublicJwk.crv !== "P-256"
    || derivedPublicJwk.crv !== "P-256"
    || !matchingPublicKeys) {
    throw new Error("signing keys must be a matching P-256 pair");
  }
}

function assertRequiredSecurityEnvironment({ logger }) {
  const missingEnvVars = requiredSecurityEnvVars.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    logger.error({ missing: missingEnvVars }, "Missing required security environment variables");
    process.exit(1);
    return;
  }

  const weakSecrets = secretValueEnvVars
    .filter((name) => String(process.env[name] || "").length < 32);
  if (weakSecrets.length) {
    logger.error({ weak: weakSecrets }, "Security secrets must contain at least 32 characters");
    process.exit(1);
    return;
  }

  const placeholderValues = requiredSecurityEnvVars.filter((name) =>
    /^(REPLACE|CHANGE|YOUR_)/i.test(String(process.env[name] || "").trim())
  );
  if (placeholderValues.length) {
    logger.error({ placeholders: placeholderValues }, "Security environment variables must not use placeholders");
    process.exit(1);
    return;
  }

  const reusedSecrets = secretValueEnvVars.filter((name, index) =>
    secretValueEnvVars.slice(0, index).some((previousName) =>
      process.env[previousName] === process.env[name]
    )
  );
  if (reusedSecrets.length) {
    logger.error({ reused: reusedSecrets }, "Security secrets must use distinct values");
    process.exit(1);
    return;
  }

  try {
    assertMatchingP256SigningKeys();
  } catch {
    logger.error("SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY must be a matching P-256 keypair");
    process.exit(1);
  }
}

function initEnvironment(serverDir) {
  const explicitPath = process.env.DOTENV_CONFIG_PATH || process.env.DPP_ENV_FILE;
  if (process.env.NODE_ENV === "production" && !explicitPath) return;
  require("dotenv").config({
    path: explicitPath || path.resolve(serverDir, "../../../../../env/local-compose.env"),
    quiet: true,
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

function normalizeJsonFriendlyValue(value, {
  depth = 0,
  maxDepth = 128,
  maxNodes = 250_000,
  state = { nodes: 0, ancestors: new WeakSet() },
  errorCode = "jsonOutputTooComplex",
} = {}) {
  state.nodes += 1;
  if (depth > maxDepth || state.nodes > maxNodes) {
    const error = new Error("JSON value exceeds structural limits");
    error.code = errorCode;
    error.statusCode = errorCode === "jsonInputTooComplex" ? 413 : 500;
    throw error;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) {
      const error = new Error("Circular JSON value is not supported");
      error.code = errorCode;
      error.statusCode = errorCode === "jsonInputTooComplex" ? 413 : 500;
      throw error;
    }
    state.ancestors.add(value);
    try {
      return value.map((entry) => normalizeJsonFriendlyValue(entry, {
        depth: depth + 1, maxDepth, maxNodes, state, errorCode,
      }));
    } finally {
      state.ancestors.delete(value);
    }
  }
  if (!value || typeof value !== "object") return value;

  if (!isPlainRecord(value)) {
    if (typeof value.toJSON === "function") {
      const jsonValue = value.toJSON();
      if (jsonValue !== value) return normalizeJsonFriendlyValue(jsonValue, {
        depth: depth + 1, maxDepth, maxNodes, state, errorCode,
      });
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

  if (state.ancestors.has(value)) {
    const error = new Error("Circular JSON value is not supported");
    error.code = errorCode;
    error.statusCode = errorCode === "jsonInputTooComplex" ? 413 : 500;
    throw error;
  }
  state.ancestors.add(value);
  try {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonFriendlyValue(entry, {
        depth: depth + 1, maxDepth, maxNodes, state, errorCode,
      })])
    );
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeIncomingJsonValue(value) {
  return normalizeJsonFriendlyValue(value, {
    maxDepth: 64,
    maxNodes: 100_000,
    errorCode: "jsonInputTooComplex",
  });
}

function normalizeOutgoingJsonValue(value) {
  return normalizeJsonFriendlyValue(value);
}

function toBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function isLoopbackHost(hostname) {
  return isPrivateOrReservedHostname(hostname);
}

const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const productionSessionCookieName = "__Host-dppSession";

function normalizeSessionCookieName(value, { isProduction = process.env.NODE_ENV === "production" } = {}) {
  const configuredValue = value === undefined || value === null ? "" : String(value);
  const rawValue = configuredValue || (isProduction ? productionSessionCookieName : "dppSession");
  if (rawValue.trim() !== rawValue || /[\u0000-\u001F\u007F\s]/.test(rawValue) || !cookieNamePattern.test(rawValue)) {
    throw new Error("SESSION_COOKIE_NAME must be a valid cookie token");
  }
  if (isProduction && configuredValue && configuredValue !== productionSessionCookieName) {
    throw new Error(`SESSION_COOKIE_NAME is fixed to ${productionSessionCookieName} in production`);
  }
  if (isProduction) return productionSessionCookieName;
  return rawValue;
}

function assertCookieConfiguration({ logger, isProduction = process.env.NODE_ENV === "production" }) {
  try {
    normalizeSessionCookieName(process.env.SESSION_COOKIE_NAME, { isProduction });
    if (process.env.COOKIE_DOMAIN !== undefined && process.env.COOKIE_DOMAIN !== "") {
      throw new Error("COOKIE_DOMAIN is unsupported; session cookies are always host-only");
    }
  } catch (error) {
    logger.error({ err: error }, "Invalid session-cookie configuration");
    process.exit(1);
  }
}

function validateRuntimeOrigin(name, logger, { isProduction = false } = {}) {
  let parsed;
  try {
    parsed = new URL(normalizeConfiguredOrigin(process.env[name], name));
  } catch {
    logger.error({ env: name }, "Runtime URL environment variable must be a valid HTTP(S) origin");
    process.exit(1);
    return null;
  }

  if (isProduction && (parsed.protocol !== "https:" || isLoopbackHost(parsed.hostname))) {
    logger.error({ env: name, protocol: parsed.protocol, hostname: parsed.hostname }, "Production URL must use a public HTTPS origin");
    process.exit(1);
    return null;
  }
  return parsed.origin;
}

function validateProductionUrl(name, logger) {
  return validateRuntimeOrigin(name, logger, { isProduction: true });
}

function assertRequiredRuntimeOrigins({ isProduction, logger }) {
  const requiredEnvVars = ["APP_URL", "SERVER_URL", "VITE_PUBLIC_VIEWER_URL", "ALLOWED_ORIGINS"];
  const missingEnvVars = requiredEnvVars.filter((key) => !String(process.env[key] || "").trim());
  if (missingEnvVars.length > 0) {
    logger.error({ missing: missingEnvVars }, "Missing required runtime origin environment variables");
    process.exit(1);
    return null;
  }

  const appOrigin = validateRuntimeOrigin("APP_URL", logger, { isProduction });
  validateRuntimeOrigin("SERVER_URL", logger, { isProduction });
  const publicViewerOrigin = validateRuntimeOrigin("VITE_PUBLIC_VIEWER_URL", logger, { isProduction });
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    .split(",")
    .filter(Boolean);
  const normalizedAllowedOrigins = [];
  for (const [index, origin] of allowedOrigins.entries()) {
    const envName = `ALLOWED_ORIGINS[${index}]`;
    try {
      const normalizedOrigin = normalizeConfiguredOrigin(origin, envName);
      const parsedOrigin = new URL(normalizedOrigin);
      if (isProduction && (parsedOrigin.protocol !== "https:" || isLoopbackHost(parsedOrigin.hostname))) {
        throw new Error("must be a public HTTPS origin");
      }
      normalizedAllowedOrigins.push(normalizedOrigin);
    } catch {
      logger.error({ env: envName }, "Allowed origin must be a valid runtime HTTP(S) origin");
      process.exit(1);
      return null;
    }
  }

  if (!normalizedAllowedOrigins.includes(appOrigin)) {
    logger.error("ALLOWED_ORIGINS must include APP_URL");
    process.exit(1);
    return null;
  }
  if (!normalizedAllowedOrigins.includes(publicViewerOrigin)) {
    logger.error("ALLOWED_ORIGINS must include VITE_PUBLIC_VIEWER_URL");
    process.exit(1);
    return null;
  }
  return appOrigin;
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

function assertRuntimeCredentialBoundary({ isProduction, logger }) {
  if (!isProduction) return;
  const forbidden = Object.keys(process.env)
    .filter((name) => runtimeForbiddenProductionEnvPatterns.some((pattern) => pattern.test(name)))
    .filter((name) => String(process.env[name] || "").trim())
    .sort();
  if (forbidden.length) {
    logger.error({ forbidden }, "Privileged database or DB-backup credentials must not be present in the backend runtime environment");
    process.exit(1);
  }
}

function assertRuntimeDatabaseRole({ logger }) {
  const runtimeRole = String(process.env.DB_USER || "").trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole) || runtimeRole === "postgres") {
    logger.error(
      { env: "DB_USER" },
      "Production DB_USER must be a dedicated lowercase non-superuser application role"
    );
    process.exit(1);
  }
}

function deriveRuntimeFlags() {
  const isProduction = process.env.NODE_ENV === "production";
  const runSchemaMigrations =
    !isProduction
    && String(process.env.RUN_SCHEMA_MIGRATIONS || "").trim().toLowerCase() !== "false";

  const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean)
    .map((value, index) => normalizeConfiguredOrigin(value, `ALLOWED_ORIGINS[${index}]`));
  const allowedOriginSet = new Set(envAllowedOrigins);
  // The public passport viewer needs CORS for anonymous/API-key reads, but it
  // must never become a second cookie-authenticated dashboard origin.
  const credentialedOriginSet = new Set([
    normalizeConfiguredOrigin(process.env.APP_URL, "APP_URL"),
  ]);

  return {
    isProduction,
    runSchemaMigrations,
    allowedOriginSet,
    credentialedOriginSet,
    cspConnectSrc: ["'self'", ...allowedOriginSet],
  };
}

function assertRequiredProductionEnvironment({ isProduction, logger }) {
  assertRequiredSecurityEnvironment({ logger });
  assertRequiredRuntimeOrigins({ isProduction, logger });
  assertCookieConfiguration({ logger, isProduction });
  if (!isProduction) return;

  assertRuntimeCredentialBoundary({ isProduction, logger });

  if (String(process.env.RUN_SCHEMA_MIGRATIONS || "false").trim().toLowerCase() !== "false") {
    logger.error(
      { env: "RUN_SCHEMA_MIGRATIONS" },
      "Production startup migrations are disabled; run the explicit db:migrate command during a controlled deployment."
    );
    process.exit(1);
  }

  const requiredEnvVars = [
    "DB_HOST",
    "DB_USER",
    "DB_NAME",
  ];
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    logger.error({ missing: missingEnvVars }, "Missing required environment variables in production");
    process.exit(1);
  }

  assertRuntimeDatabaseRole({ logger });

  if (String(process.env.OAUTH_ALLOW_INSECURE_HTTP || "").trim().toLowerCase() === "true") {
    logger.error("OAUTH_ALLOW_INSECURE_HTTP cannot be enabled in production");
    process.exit(1);
  }

  const assetHosts = String(process.env.ASSET_SOURCE_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (assetHosts.some((host) => !/^[a-z0-9.-]+$/.test(host) || isLoopbackHost(host))) {
    logger.error("ASSET_SOURCE_ALLOWED_HOSTS must contain public hostnames without schemes, ports, or paths");
    process.exit(1);
  }
}

function assertProductionStorageReadiness({ isProduction, logger }) {
  if (!isProduction) return;

  const storageProvider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const backupProviderEnabledValue = String(process.env.BACKUP_PROVIDER_ENABLED || "").trim().toLowerCase();
  const backupProviderRequiredValue = String(process.env.BACKUP_PROVIDER_REQUIRED || "").trim().toLowerCase();
  const backupProviderEnabled = toBooleanEnv(process.env.BACKUP_PROVIDER_ENABLED, false);
  const backupProviderRequired = toBooleanEnv(process.env.BACKUP_PROVIDER_REQUIRED, false);
  const dbBackupEnabledValue = String(process.env.DB_BACKUP_ENABLED || "").trim().toLowerCase();
  const missing = [];

  if (storageProvider !== "s3") {
    throw new Error("[PRODUCTION] STORAGE_PROVIDER must be s3. Local or disabled production storage is not supported.");
  }

  if (dbBackupEnabledValue && !["true", "false"].includes(dbBackupEnabledValue)) {
    logger.error({ value: dbBackupEnabledValue }, "DB_BACKUP_ENABLED must be true or false");
    throw new Error("[PRODUCTION] DB_BACKUP_ENABLED must be true or false.");
  }
  for (const [name, value] of [
    ["BACKUP_PROVIDER_ENABLED", backupProviderEnabledValue],
    ["BACKUP_PROVIDER_REQUIRED", backupProviderRequiredValue],
  ]) {
    if (value && !["true", "false"].includes(value)) {
      logger.error({ env: name }, "Backup-provider enablement flags must be true or false");
      throw new Error(`[PRODUCTION] ${name} must be true or false.`);
    }
  }
  if (dbBackupEnabledValue !== "true") {
    throw new Error("[PRODUCTION] DB_BACKUP_ENABLED must be true; production database recovery cannot be optional.");
  }
  if (backupProviderEnabledValue !== "true" || backupProviderRequiredValue !== "true") {
    throw new Error("[PRODUCTION] BACKUP_PROVIDER_ENABLED and BACKUP_PROVIDER_REQUIRED must both be true; production passport recovery cannot be optional.");
  }

  for (const key of [
    "STORAGE_S3_ENDPOINT",
    "STORAGE_S3_REGION",
    "STORAGE_S3_BUCKET",
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
  ]) {
    if (!process.env[key]) missing.push(key);
  }
  const placeholderCredentialNames = [
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
  ];
  const placeholderValues = placeholderCredentialNames.filter((key) => {
    const value = String(process.env[key] || "").trim();
    return value && /(REPLACE|CHANGE|YOUR_)/i.test(value);
  });
  if (placeholderValues.length) {
    logger.error({ placeholders: placeholderValues }, "Storage/DR credentials must not use placeholders");
    throw new Error(`[PRODUCTION] Storage/DR credentials must not use placeholders: ${placeholderValues.join(", ")}`);
  }

  if (process.env.STORAGE_S3_ENDPOINT) {
    validateProductionUrl("STORAGE_S3_ENDPOINT", logger);
  }
  if (backupProviderEnabled && process.env.BACKUP_PROVIDER_ENDPOINT) {
    validateProductionUrl("BACKUP_PROVIDER_ENDPOINT", logger);
  }

  if (backupProviderRequired && !backupProviderEnabled) {
    missing.push("BACKUP_PROVIDER_ENABLED=true");
  }
  if (backupProviderEnabled) {
    for (const key of [
      ...backupProviderS3EnvNames,
      "BACKUP_PROVIDER_KEY",
      "BACKUP_PROVIDER_OBJECT_PREFIX",
    ]) {
      if (!String(process.env[key] || "").trim()) missing.push(key);
    }
  }

  if (backupProviderEnabled && !missing.length) {
    let backupProviderStorage;
    try {
      backupProviderStorage = readBackupProviderObjectStorageConfigFromEnvironment();
      validateBackupProviderObjectPrefix(process.env.BACKUP_PROVIDER_OBJECT_PREFIX);
    } catch (error) {
      logger.error({ env: "BACKUP_PROVIDER_*" }, "Backup-provider S3 configuration is invalid");
      throw new Error(`[PRODUCTION] ${error.message}`);
    }

    const duplicatedBackupProviderValues = [
      ["BACKUP_PROVIDER_BUCKET", "STORAGE_S3_BUCKET", backupProviderStorage.bucket],
      ["BACKUP_PROVIDER_ACCESS_KEY_ID", "STORAGE_S3_ACCESS_KEY_ID", backupProviderStorage.accessKeyId],
      ["BACKUP_PROVIDER_SECRET_ACCESS_KEY", "STORAGE_S3_SECRET_ACCESS_KEY", backupProviderStorage.secretAccessKey],
    ].filter(([, storageKey, backupValue]) => backupValue === String(process.env[storageKey] || "").trim());
    if (duplicatedBackupProviderValues.length) {
      const duplicatedNames = duplicatedBackupProviderValues
        .map(([backupKey, storageKey]) => `${backupKey}/${storageKey}`);
      logger.error({ duplicated: duplicatedNames }, "Backup-provider storage must use a separate bucket and credential material");
      throw new Error(`[PRODUCTION] Backup-provider storage must use separate bucket and credential material: ${duplicatedNames.join(", ")}`);
    }


  }

  if (missing.length) {
    logger.error({ missing }, "Storage/DR guard failed");
    throw new Error(`[PRODUCTION] Storage/DR guard failed. Missing required production storage configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  assertDatabaseName,
  assertCookieConfiguration,
  assertMatchingP256SigningKeys,
  assertProductionStorageReadiness,
  assertRequiredRuntimeOrigins,
  assertRuntimeCredentialBoundary,
  assertRequiredSecurityEnvironment,
  assertRequiredProductionEnvironment,
  deriveRuntimeFlags,
  deriveRuntimePaths,
  ensureLocalDirectories,
  initEnvironment,
  isPassportStorageKey,
  isPlainRecord,
  normalizeIncomingJsonValue,
  normalizeOutgoingJsonValue,
  normalizeSessionCookieName,
  normalizeStorageRequestKey,
  toBooleanEnv,
};
