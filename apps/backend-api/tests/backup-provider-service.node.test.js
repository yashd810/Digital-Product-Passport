"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const createBackupProviderService = require("../src/services/backup-provider-service");

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("implicit env backup provider is normalized before passport replication", async (t) => {
  const previousEnabled = process.env.BACKUP_PROVIDER_ENABLED;
  const previousKey = process.env.BACKUP_PROVIDER_KEY;
  const previousPrefix = process.env.BACKUP_PROVIDER_OBJECT_PREFIX;

  process.env.BACKUP_PROVIDER_ENABLED = "true";
  process.env.BACKUP_PROVIDER_KEY = "oci-test";
  process.env.BACKUP_PROVIDER_OBJECT_PREFIX = "custom-prefix";

  t.after(() => {
    restoreEnv("BACKUP_PROVIDER_ENABLED", previousEnabled);
    restoreEnv("BACKUP_PROVIDER_KEY", previousKey);
    restoreEnv("BACKUP_PROVIDER_OBJECT_PREFIX", previousPrefix);
  });

  let replicationParams = null;
  let savedObject = null;
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM backup_service_providers")) return { rows: [] };
      if (sql.includes("FROM passport_attachments")) return { rows: [] };
      if (sql.includes("INSERT INTO passport_backup_replications")) {
        replicationParams = params;
        return {
          rows: [{
            backup_provider_key: params[1],
            replication_status: params[9],
            storage_key: params[11],
          }],
        };
      }
      return { rows: [] };
    },
  };
  const storageService = {
    provider: "local",
    async saveObject(input) {
      savedObject = input;
      return { storageKey: input.key, url: `http://files.example/${input.key}` };
    },
  };

  const service = createBackupProviderService({
    pool,
    storageService,
    buildCanonicalPassportPayload: (passport) => ({
      digitalProductPassportId: passport.dppId,
    }),
  });

  const result = await service.replicatePassportSnapshot({
    passport: {
      dppId: "dpp-1",
      companyId: 7,
      lineageId: "lineage-1",
      passportType: "electronicsPassportV1",
      versionNumber: 2,
    },
    typeDef: { typeName: "electronicsPassportV1", fieldsJson: { sections: [] } },
    snapshotScope: "released_current",
  });

  assert.equal(result.success, true);
  assert.equal(replicationParams[1], "oci-test");
  assert.equal(replicationParams[9], "synced");
  assert.equal(savedObject.contentType, "application/json");
  assert.equal(savedObject.key, "custom-prefix/company-7/passport-lineage-1/v2/released_current.json");
});

test("public handover rows expose camelCase fields expected by callers", async () => {
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM backup_public_handovers/);
      return {
        rows: [{
          id: 12,
          company_id: 7,
          passport_dpp_id: "dpp-1",
          lineage_id: "lineage-1",
          passport_type: "electronicsPassportV1",
          internal_alias_id: "alias-1",
          version_number: 3,
          backup_provider_key: "oci-test",
          source_replication_id: 99,
          public_url: "https://backup.example/dpp-1.json",
          public_row_data: JSON.stringify({ dppId: "dpp-1" }),
          handover_status: "active",
          verification_status: "verified",
        }],
      };
    },
  };

  const service = createBackupProviderService({
    pool,
    storageService: {},
    buildCanonicalPassportPayload: () => ({}),
  });

  const handover = await service.getActivePublicHandover({ passportDppId: "dpp-1" });

  assert.equal(handover.passportDppId, "dpp-1");
  assert.equal(handover.companyId, 7);
  assert.equal(handover.lineageId, "lineage-1");
  assert.equal(handover.passportType, "electronicsPassportV1");
  assert.equal(handover.internalAliasId, "alias-1");
  assert.equal(handover.versionNumber, 3);
  assert.equal(handover.backupProviderKey, "oci-test");
  assert.equal(handover.sourceReplicationId, 99);
  assert.equal(handover.publicUrl, "https://backup.example/dpp-1.json");
  assert.equal(handover.handoverStatus, "active");
  assert.equal(handover.verificationStatus, "verified");
  assert.deepEqual(handover.publicRowData, { dppId: "dpp-1" });
});
