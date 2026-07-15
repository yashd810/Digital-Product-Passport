"use strict";

function normalizePrefix(value, fallback) {
  return String(value || fallback || "db-backups/postgres")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function readRequiredBackupConfig(name, rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error(`Missing dedicated DB backup S3 configuration: ${name}`);
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
  if (parsed.protocol !== "https:" || !parsed.hostname || hasNonOriginComponents) {
    throw new Error("DB backup S3 endpoint must be an HTTPS origin without credentials, paths, queries, or fragments");
  }
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
  forcePathStyle,
  prefix,
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
  const normalizedForcePathStyle = readOptionalBoolean(
    "DB_BACKUP_S3_FORCE_PATH_STYLE",
    forcePathStyle,
    true
  );
  const normalizedRetentionCount = Number.parseInt(retentionCount || "14", 10);

  return {
    endpoint: normalizedEndpoint,
    region: normalizedRegion,
    bucket: normalizedBucket,
    accessKeyId: normalizedAccessKeyId,
    secretAccessKey: normalizedSecretAccessKey,
    forcePathStyle: normalizedForcePathStyle,
    prefix: normalizePrefix(prefix, "db-backups/postgres"),
    retentionCount: Number.isFinite(normalizedRetentionCount) && normalizedRetentionCount > 0
      ? normalizedRetentionCount
      : 14,
    dbName: dbName || "dppSystem",
  };
}

module.exports = {
  readDbBackupObjectStorageConfig,
};
