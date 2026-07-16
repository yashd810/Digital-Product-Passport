"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const { isPrivateOrReservedHostname, normalizeHostname } = require("../shared/security/network-address");
const { normalizeConfiguredOrigin } = require("../shared/security/configured-origin");

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

function normalizeIncomingJsonValue(value) {
  return normalizeJsonFriendlyValue(value);
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
const cookieDomainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function normalizeSessionCookieName(value) {
  const rawValue = value === undefined || value === null || value === ""
    ? "dppSession"
    : String(value);
  if (rawValue.trim() !== rawValue || /[\u0000-\u001F\u007F\s]/.test(rawValue) || !cookieNamePattern.test(rawValue)) {
    throw new Error("SESSION_COOKIE_NAME must be a valid cookie token");
  }
  return rawValue;
}

function normalizeCookieDomain(value, serverOrigin = process.env.SERVER_URL) {
  const rawValue = String(value || "");
  if (!rawValue) return null;
  if (rawValue.trim() !== rawValue || /[\u0000-\u001F\u007F\s\\/]/.test(rawValue)) {
    throw new Error("COOKIE_DOMAIN must be a DNS parent domain without whitespace, paths, or control characters");
  }

  const domain = (rawValue.startsWith(".") ? rawValue.slice(1) : rawValue).toLowerCase();
  if (!cookieDomainPattern.test(domain) || net.isIP(domain)) {
    throw new Error("COOKIE_DOMAIN must be a valid non-IP DNS domain");
  }

  let apiHostname;
  try {
    apiHostname = normalizeHostname(new URL(normalizeConfiguredOrigin(serverOrigin, "SERVER_URL")).hostname);
  } catch {
    throw new Error("COOKIE_DOMAIN requires a valid SERVER_URL");
  }
  if (apiHostname !== domain && !apiHostname.endsWith(`.${domain}`)) {
    throw new Error("COOKIE_DOMAIN must be the API hostname or one of its parent domains");
  }
  return domain;
}

function assertCookieConfiguration({ logger }) {
  try {
    normalizeSessionCookieName(process.env.SESSION_COOKIE_NAME);
    normalizeCookieDomain(process.env.COOKIE_DOMAIN, process.env.SERVER_URL);
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
  assertCookieConfiguration({ logger });
  if (!isProduction) return;

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
  const backupProviderEnabled = toBooleanEnv(process.env.BACKUP_PROVIDER_ENABLED, false);
  const backupProviderRequired = toBooleanEnv(process.env.BACKUP_PROVIDER_REQUIRED, false);
  const dbBackupEnabledValue = String(process.env.DB_BACKUP_ENABLED || "").trim().toLowerCase();
  const dbBackupEnabled = toBooleanEnv(process.env.DB_BACKUP_ENABLED, false);
  const missing = [];
  const dbBackupRequiredEnvVars = [
    "DB_BACKUP_S3_ENDPOINT",
    "DB_BACKUP_S3_REGION",
    "DB_BACKUP_S3_BUCKET",
    "DB_BACKUP_S3_ACCESS_KEY_ID",
    "DB_BACKUP_S3_SECRET_ACCESS_KEY",
  ];

  if (storageProvider !== "s3") {
    throw new Error("[PRODUCTION] STORAGE_PROVIDER must be s3. Local or disabled production storage is not supported.");
  }

  if (dbBackupEnabledValue && !["true", "false"].includes(dbBackupEnabledValue)) {
    logger.error({ value: dbBackupEnabledValue }, "DB_BACKUP_ENABLED must be true or false");
    throw new Error("[PRODUCTION] DB_BACKUP_ENABLED must be true or false.");
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
  if (dbBackupEnabled) {
    for (const key of dbBackupRequiredEnvVars) {
      if (!String(process.env[key] || "").trim()) missing.push(key);
    }
  }

  const placeholderCredentialNames = [
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
  ];
  if (dbBackupEnabled) {
    placeholderCredentialNames.push(...dbBackupRequiredEnvVars);
  }
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
  if (dbBackupEnabled && process.env.DB_BACKUP_S3_ENDPOINT) {
    validateProductionUrl("DB_BACKUP_S3_ENDPOINT", logger);
  }

  if (dbBackupEnabled && !missing.length) {
    const duplicatedBackupValues = [
      ["DB_BACKUP_S3_BUCKET", "STORAGE_S3_BUCKET"],
      ["DB_BACKUP_S3_ACCESS_KEY_ID", "STORAGE_S3_ACCESS_KEY_ID"],
      ["DB_BACKUP_S3_SECRET_ACCESS_KEY", "STORAGE_S3_SECRET_ACCESS_KEY"],
    ].filter(([dbBackupKey, storageKey]) => process.env[dbBackupKey] === process.env[storageKey]);
    if (duplicatedBackupValues.length) {
      const duplicatedNames = duplicatedBackupValues
        .map(([dbBackupKey, storageKey]) => `${dbBackupKey}/${storageKey}`);
      logger.error({ duplicated: duplicatedNames }, "DB backups must use a separate bucket and credential material");
      throw new Error(`[PRODUCTION] DB backups must use separate bucket and credential material: ${duplicatedNames.join(", ")}`);
    }
  }

  if (backupProviderRequired && !backupProviderEnabled) {
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
  assertCookieConfiguration,
  assertMatchingP256SigningKeys,
  assertProductionStorageReadiness,
  assertRequiredRuntimeOrigins,
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
  normalizeCookieDomain,
  normalizeSessionCookieName,
  normalizeStorageRequestKey,
  toBooleanEnv,
};
