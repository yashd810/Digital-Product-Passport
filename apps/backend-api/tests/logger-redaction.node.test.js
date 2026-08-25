"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const loggerPath = path.resolve(__dirname, "../src/platform/observability/logger.js");

test("central logging redacts privileged database and backup credentials", () => {
  const values = {
    DB_ADMIN_PASSWORD: "test-admin-password-must-not-appear",
    DB_MIGRATION_PASSWORD: "test-migration-password-must-not-appear",
    POSTGRES_PASSWORD: "test-postgres-password-must-not-appear",
    DB_BACKUP_MANIFEST_HMAC_SECRET: "test-backup-manifest-key-must-not-appear",
    nested: {
      dbAdminPassword: "test-nested-admin-password-must-not-appear",
      dbBackupManifestHmacSecret: "test-nested-manifest-key-must-not-appear",
    },
  };
  const result = spawnSync(process.execPath, ["-e", `
    const logger = require(${JSON.stringify(loggerPath)});
    logger.info(${JSON.stringify(values)}, "credential-redaction-probe");
  `], {
    encoding: "utf8",
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const value of [
    values.DB_ADMIN_PASSWORD,
    values.DB_MIGRATION_PASSWORD,
    values.POSTGRES_PASSWORD,
    values.DB_BACKUP_MANIFEST_HMAC_SECRET,
    values.nested.dbAdminPassword,
    values.nested.dbBackupManifestHmacSecret,
  ]) {
    assert.doesNotMatch(output, new RegExp(value));
  }
  assert.match(output, /\[Redacted\]/);
});
