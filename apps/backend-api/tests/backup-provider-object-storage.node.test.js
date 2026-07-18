"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  readBackupProviderObjectStorageConfig,
} = require("../src/shared/backups/backup-provider-object-storage-config");

const validBackupProviderConfig = {
  endpoint: "https://backup-storage.example.com",
  region: "eu-frankfurt-1",
  bucket: "dpp-prod-backups",
  accessKeyId: "backup-provider-access-key",
  secretAccessKey: "backup-provider-secret-key",
  forcePathStyle: "true",
};

test("backup provider object storage never falls back to application storage credentials", () => {
  assert.throws(
    () => readBackupProviderObjectStorageConfig({
      applicationStorageEndpoint: "https://application-storage.example.com",
      applicationStorageRegion: "eu-frankfurt-1",
      applicationStorageBucket: "dpp-prod-files",
      applicationStorageAccessKeyId: "application-storage-access-key",
      applicationStorageSecretAccessKey: "application-storage-secret-key",
    }),
    /BACKUP_PROVIDER_ENDPOINT/
  );
});

test("backup provider object storage accepts only a complete scoped configuration", () => {
  assert.deepEqual(readBackupProviderObjectStorageConfig(validBackupProviderConfig), {
    endpoint: "https://backup-storage.example.com",
    region: "eu-frankfurt-1",
    bucket: "dpp-prod-backups",
    accessKeyId: "backup-provider-access-key",
    secretAccessKey: "backup-provider-secret-key",
    forcePathStyle: true,
  });
});

test("backup provider object storage rejects unsafe endpoint, placeholders, and invalid booleans", () => {
  assert.throws(() => readBackupProviderObjectStorageConfig({
    ...validBackupProviderConfig,
    endpoint: "http://backup-storage.example.com",
  }), /must be an HTTPS origin/);

  assert.throws(() => readBackupProviderObjectStorageConfig({
    ...validBackupProviderConfig,
    accessKeyId: ["REPLACE", "WITH", "BACKUP", "ACCESS", "KEY"].join("_"),
  }), /must not use a placeholder/);

  assert.throws(() => readBackupProviderObjectStorageConfig({
    ...validBackupProviderConfig,
    forcePathStyle: "sometimes",
  }), /BACKUP_PROVIDER_FORCE_PATH_STYLE must be true or false/);
});
