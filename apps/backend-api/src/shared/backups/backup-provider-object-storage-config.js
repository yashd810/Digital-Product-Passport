"use strict";

const backupProviderS3EnvNames = [
  "BACKUP_PROVIDER_ENDPOINT",
  "BACKUP_PROVIDER_REGION",
  "BACKUP_PROVIDER_BUCKET",
  "BACKUP_PROVIDER_ACCESS_KEY_ID",
  "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
];

function readRequiredBackupProviderConfig(name, rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error(`Missing dedicated backup-provider S3 configuration: ${name}`);
  }
  if (/(REPLACE|CHANGE|YOUR_)/i.test(value)) {
    throw new Error(`Backup-provider S3 configuration must not use a placeholder: ${name}`);
  }
  return value;
}

function validateBackupProviderEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Backup-provider S3 endpoint must be a valid HTTPS origin");
  }

  const hasNonOriginComponents = Boolean(
    parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== "/")
    || parsed.search
    || parsed.hash
  );
  if (parsed.protocol !== "https:" || !parsed.hostname || hasNonOriginComponents) {
    throw new Error("Backup-provider S3 endpoint must be an HTTPS origin without credentials, paths, queries, or fragments");
  }
  return parsed.origin;
}

function validateBackupProviderRegion(value) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value)) {
    throw new Error("Backup-provider S3 region must be a lowercase region identifier");
  }
  return value;
}

function validateBackupProviderBucket(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value)) {
    throw new Error("Backup-provider S3 bucket must be an object-storage bucket name without paths");
  }
  return value;
}

function validateBackupProviderCredential(name, value) {
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

function readBackupProviderObjectStorageConfig({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
}) {
  const normalizedEndpoint = validateBackupProviderEndpoint(
    readRequiredBackupProviderConfig("BACKUP_PROVIDER_ENDPOINT", endpoint)
  );
  const normalizedRegion = validateBackupProviderRegion(
    readRequiredBackupProviderConfig("BACKUP_PROVIDER_REGION", region)
  );
  const normalizedBucket = validateBackupProviderBucket(
    readRequiredBackupProviderConfig("BACKUP_PROVIDER_BUCKET", bucket)
  );
  const normalizedAccessKeyId = validateBackupProviderCredential(
    "BACKUP_PROVIDER_ACCESS_KEY_ID",
    readRequiredBackupProviderConfig("BACKUP_PROVIDER_ACCESS_KEY_ID", accessKeyId)
  );
  const normalizedSecretAccessKey = validateBackupProviderCredential(
    "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
    readRequiredBackupProviderConfig("BACKUP_PROVIDER_SECRET_ACCESS_KEY", secretAccessKey)
  );

  return {
    endpoint: normalizedEndpoint,
    region: normalizedRegion,
    bucket: normalizedBucket,
    accessKeyId: normalizedAccessKeyId,
    secretAccessKey: normalizedSecretAccessKey,
    forcePathStyle: readOptionalBoolean("BACKUP_PROVIDER_FORCE_PATH_STYLE", forcePathStyle, true),
  };
}

function readBackupProviderObjectStorageConfigFromEnvironment(environment = process.env) {
  return readBackupProviderObjectStorageConfig({
    endpoint: environment.BACKUP_PROVIDER_ENDPOINT,
    region: environment.BACKUP_PROVIDER_REGION,
    bucket: environment.BACKUP_PROVIDER_BUCKET,
    accessKeyId: environment.BACKUP_PROVIDER_ACCESS_KEY_ID,
    secretAccessKey: environment.BACKUP_PROVIDER_SECRET_ACCESS_KEY,
    forcePathStyle: environment.BACKUP_PROVIDER_FORCE_PATH_STYLE,
  });
}

module.exports = {
  backupProviderS3EnvNames,
  readBackupProviderObjectStorageConfig,
  readBackupProviderObjectStorageConfigFromEnvironment,
};
