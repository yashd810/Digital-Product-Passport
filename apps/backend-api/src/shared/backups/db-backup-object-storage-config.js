"use strict";

const {
  isPrivateOrReservedHostname,
  normalizeHostname,
} = require("../security/network-address");

function normalizeStrictPrefix(name, value, fallback) {
  const rawValue = value === undefined || value === null || value === ""
    ? String(fallback || "db-backups/postgres")
    : String(value);
  if (rawValue.trim() !== rawValue) {
    throw new Error(`${name} must not contain leading or trailing whitespace`);
  }
  const prefix = rawValue;
  if (!prefix
    || prefix.length > 512
    || prefix.startsWith("/")
    || prefix.endsWith("/")
    || prefix.includes("\\")
    || prefix.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${name} must be a relative object-storage prefix without empty, dot, or backslash segments`);
  }
  return prefix;
}

function readRequiredBackupConfig(name, rawValue) {
  const value = String(rawValue || "");
  if (!value) {
    throw new Error(`Missing dedicated DB backup S3 configuration: ${name}`);
  }
  if (value.trim() !== value) {
    throw new Error(`DB backup S3 configuration must not contain leading or trailing whitespace: ${name}`);
  }
  if (/(REPLACE|CHANGE|YOUR_)/i.test(value)) {
    throw new Error(`DB backup S3 configuration must not use a placeholder: ${name}`);
  }
  return value;
}

function validateBackupEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DB backup S3 endpoint must be a valid HTTPS origin");
  }

  const hasNonOriginComponents = Boolean(
    parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== "/")
    || parsed.search
    || parsed.hash
  );
  const hostname = normalizeHostname(parsed.hostname);
  if (parsed.protocol !== "https:" || !hostname || hasNonOriginComponents || isPrivateOrReservedHostname(hostname)) {
    throw new Error("DB backup S3 endpoint must be an HTTPS origin without credentials, paths, queries, or fragments");
  }
  parsed.hostname = hostname;
  return parsed.origin;
}

function validateBackupRegion(value) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value)) {
    throw new Error("DB backup S3 region must be a lowercase region identifier");
  }
  return value;
}

function validateBackupBucket(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value)) {
    throw new Error("DB backup S3 bucket must be an object-storage bucket name without paths");
  }
  return value;
}

function validateBackupCredential(name, value) {
  if (/\s/.test(value)) {
    throw new Error(`${name} must not contain whitespace`);
  }
  return value;
}

function validateManifestHmacSecret(value, secretAccessKey) {
  // The production generator emits 32 random bytes as lowercase hexadecimal.
  // Keeping that exact representation prevents a weak, truncated, or
  // whitespace-containing value from silently becoming the manifest root of
  // trust when the uploader is invoked outside the host backup wrapper.
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("DB_BACKUP_MANIFEST_HMAC_SECRET must be a 64-character lowercase hexadecimal secret");
  }
  if (value === secretAccessKey) {
    throw new Error("DB_BACKUP_MANIFEST_HMAC_SECRET must differ from DB_BACKUP_S3_SECRET_ACCESS_KEY");
  }
  return value;
}

function validateBackupMaxBytes(value) {
  if (!/^[1-9][0-9]{0,13}$/.test(value)) {
    throw new Error("DB_BACKUP_MAX_BYTES must be a positive integer number of bytes");
  }
  const maxBytes = Number(value);
  const minBytes = 1024 * 1024;
  const maxAllowedBytes = 100 * 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < minBytes || maxBytes > maxAllowedBytes) {
    throw new Error("DB_BACKUP_MAX_BYTES must be between 1048576 and 107374182400 bytes");
  }
  return maxBytes;
}

function validateRetentionCount(value) {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    throw new Error("DB_BACKUP_RETENTION_COUNT must be a positive integer");
  }
  const retentionCount = Number(value);
  if (!Number.isSafeInteger(retentionCount) || retentionCount > 128) {
    throw new Error("DB_BACKUP_RETENTION_COUNT must be between 1 and 128");
  }
  return retentionCount;
}

function readOptionalBoolean(name, rawValue, fallback) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readDbBackupObjectStorageConfig({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  manifestHmacSecret,
  forcePathStyle,
  prefix,
  evidencePrefix,
  maxBytes,
  retentionCount,
  dbName,
}) {
  const normalizedEndpoint = validateBackupEndpoint(
    readRequiredBackupConfig("DB_BACKUP_S3_ENDPOINT", endpoint)
  );
  const normalizedRegion = validateBackupRegion(
    readRequiredBackupConfig("DB_BACKUP_S3_REGION", region)
  );
  const normalizedBucket = validateBackupBucket(
    readRequiredBackupConfig("DB_BACKUP_S3_BUCKET", bucket)
  );
  const normalizedAccessKeyId = validateBackupCredential(
    "DB_BACKUP_S3_ACCESS_KEY_ID",
    readRequiredBackupConfig("DB_BACKUP_S3_ACCESS_KEY_ID", accessKeyId)
  );
  const normalizedSecretAccessKey = validateBackupCredential(
    "DB_BACKUP_S3_SECRET_ACCESS_KEY",
    readRequiredBackupConfig("DB_BACKUP_S3_SECRET_ACCESS_KEY", secretAccessKey)
  );
  const normalizedManifestHmacSecret = validateManifestHmacSecret(
    readRequiredBackupConfig("DB_BACKUP_MANIFEST_HMAC_SECRET", manifestHmacSecret),
    normalizedSecretAccessKey
  );
  const normalizedForcePathStyle = readOptionalBoolean(
    "DB_BACKUP_S3_FORCE_PATH_STYLE",
    forcePathStyle,
    true
  );
  const normalizedMaxBytes = validateBackupMaxBytes(
    readRequiredBackupConfig("DB_BACKUP_MAX_BYTES", maxBytes)
  );
  const normalizedRetentionCount = validateRetentionCount(
    readRequiredBackupConfig("DB_BACKUP_RETENTION_COUNT", retentionCount)
  );

  return {
    endpoint: normalizedEndpoint,
    region: normalizedRegion,
    bucket: normalizedBucket,
    accessKeyId: normalizedAccessKeyId,
    secretAccessKey: normalizedSecretAccessKey,
    manifestHmacSecret: normalizedManifestHmacSecret,
    forcePathStyle: normalizedForcePathStyle,
    prefix: normalizeStrictPrefix("DB_BACKUP_S3_PREFIX", prefix, "db-backups/postgres"),
    evidencePrefix: normalizeStrictPrefix(
      "DB_BACKUP_EVIDENCE_S3_PREFIX",
      evidencePrefix,
      "db-backups/evidence/restore-drills"
    ),
    maxBytes: normalizedMaxBytes,
    retentionCount: normalizedRetentionCount,
    dbName: dbName || "dppSystem",
  };
}

module.exports = {
  readDbBackupObjectStorageConfig,
};
