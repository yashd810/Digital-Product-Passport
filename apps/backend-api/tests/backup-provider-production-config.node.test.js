"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const productionTemplatePath = path.join(repoRoot, "infra/oracle/oci.env.example");
const productionDeployScriptPath = path.join(repoRoot, "infra/oracle/deploy-prod.sh");
const dbInitPath = path.join(repoRoot, "apps/backend-api/src/db/init.js");

function parseEnvLines(content) {
  return new Map(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

test("production template documents a disabled-by-default isolated backup-provider store", () => {
  const values = parseEnvLines(fs.readFileSync(productionTemplatePath, "utf8"));
  for (const name of [
    "BACKUP_PROVIDER_ENABLED",
    "BACKUP_PROVIDER_REQUIRED",
    "BACKUP_PROVIDER_ENDPOINT",
    "BACKUP_PROVIDER_REGION",
    "BACKUP_PROVIDER_BUCKET",
    "BACKUP_PROVIDER_ACCESS_KEY_ID",
    "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
    "BACKUP_PROVIDER_FORCE_PATH_STYLE",
  ]) {
    assert.equal(values.has(name), true, `missing ${name} from production template`);
  }
  assert.equal(values.get("BACKUP_PROVIDER_ENABLED"), "false");
  assert.equal(values.get("BACKUP_PROVIDER_REQUIRED"), "false");
  assert.match(values.get("BACKUP_PROVIDER_ENDPOINT"), /^https:\/\/YOUR_/);
  assert.match(values.get("BACKUP_PROVIDER_ACCESS_KEY_ID"), /^REPLACE_/);
  assert.match(values.get("BACKUP_PROVIDER_SECRET_ACCESS_KEY"), /^REPLACE_/);
});

test("production deploy guard requires scoped backup-provider storage before enablement", () => {
  const deployScript = fs.readFileSync(productionDeployScriptPath, "utf8");
  for (const name of [
    "BACKUP_PROVIDER_ENABLED",
    "BACKUP_PROVIDER_REQUIRED",
    "BACKUP_PROVIDER_BUCKET",
    "BACKUP_PROVIDER_ACCESS_KEY_ID",
    "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
  ]) {
    assert.match(deployScript, new RegExp(`require_(?:boolean_env_var|non_placeholder_env_var|secret_env_var) \"${name}\"`));
  }
  assert.match(deployScript, /require_distinct_env_vars "BACKUP_PROVIDER_BUCKET" "STORAGE_S3_BUCKET"/);
  assert.match(deployScript, /require_distinct_env_vars "BACKUP_PROVIDER_ACCESS_KEY_ID" "STORAGE_S3_ACCESS_KEY_ID"/);
  assert.match(deployScript, /require_distinct_env_vars "BACKUP_PROVIDER_SECRET_ACCESS_KEY" "STORAGE_S3_SECRET_ACCESS_KEY"/);
});

test("controlled schema migration deactivates only legacy automatic public handovers", () => {
  const dbInit = fs.readFileSync(dbInitPath, "utf8");
  assert.match(dbInit, /UPDATE "backupPublicHandovers"/);
  assert.match(dbInit, /SET "handoverStatus" = 'inactive'/);
  assert.match(dbInit, /"deactivatedAt" = NOW\(\)/);
  assert.match(dbInit, /WHERE "handoverStatus" = 'active'/);
  assert.match(dbInit, /AND "activatedBy" IS NULL/);
  assert.match(
    dbInit,
    /AND notes = 'Automatically activated from verified backup replication because the economic operator is inactive.'/
  );
});
