"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readDbBackupObjectStorageConfig } = require("../src/shared/backups/db-backup-object-storage-config");

const validDbBackupConfig = {
  endpoint: "https://backup-storage.example.com",
  region: "eu-frankfurt-1",
  bucket: "dpp-prod-db-backups",
  accessKeyId: "db-backup-access-key",
  secretAccessKey: "db-backup-secret-key",
  forcePathStyle: "true",
  prefix: "db-backups/postgres",
  dbName: "dppSystem",
};

test("DB backup object storage requires dedicated configuration instead of application storage fallbacks", () => {
  assert.throws(
    () => readDbBackupObjectStorageConfig({
      applicationStorageEndpoint: "https://application-storage.example.com",
      applicationStorageRegion: "eu-frankfurt-1",
      applicationStorageBucket: "dpp-prod-files",
      applicationStorageAccessKeyId: "application-storage-access-key",
      applicationStorageSecretAccessKey: "application-storage-secret-key",
    }),
    /DB_BACKUP_S3_ENDPOINT/
  );
});

test("DB backup object storage accepts only a complete dedicated configuration", () => {
  assert.deepEqual(readDbBackupObjectStorageConfig(validDbBackupConfig), {
    endpoint: "https://backup-storage.example.com",
    region: "eu-frankfurt-1",
    bucket: "dpp-prod-db-backups",
    accessKeyId: "db-backup-access-key",
    secretAccessKey: "db-backup-secret-key",
    forcePathStyle: true,
    prefix: "db-backups/postgres",
    retentionCount: 14,
    dbName: "dppSystem",
  });
});

test("DB backup object storage rejects unsafe endpoint and boolean configuration", () => {
  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    endpoint: "http://backup-storage.example.com",
  }), /must be an HTTPS origin/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    forcePathStyle: "sometimes",
  }), /DB_BACKUP_S3_FORCE_PATH_STYLE must be true or false/);
});

test("DB backup object storage defaults the dedicated prefix when it is omitted", () => {
  assert.equal(readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    prefix: undefined,
  }).prefix, "db-backups/postgres");
});
