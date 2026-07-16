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
  let savedPayload = null;
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM \"backupServiceProviders\"")) return { rows: [] };
      if (sql.includes("FROM \"passportAttachments\"")) return { rows: [] };
      if (sql.includes("INSERT INTO \"passportBackupReplications\"")) {
        replicationParams = params;
        return {
          rows: [{
            backupProviderKey: params[1],
            replicationStatus: params[10],
            storageKey: params[12],
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
      savedPayload = JSON.parse(input.buffer.toString("utf8"));
      return { storageKey: input.key, url: `http://files.example/${input.key}` };
    },
  };

  const service = createBackupProviderService({
    pool,
    storageService,
    apiOrigin: "https://api.example.test",
    buildCanonicalPassportPayload: (passport) => ({
      digitalProductPassportId: passport.dppId,
    }),
  });

  const result = await service.replicatePassportSnapshot({
    passport: {
      dppId: "dpp-1",
      companyId: 7,
      lineageId: "lineage-1",
      passportType: "exampleProductPassportV1",
      internalAliasId: "alias-1",
      versionNumber: 2,
      publicField: "public-value",
      restrictedField: "restricted-value",
      unknownColumn: "unknown-value",
    },
    typeDef: {
      typeName: "exampleProductPassportV1",
      fieldsJson: {
        sections: [{
          fields: [
            { key: "publicField", confidentiality: "public" },
            { key: "restrictedField", confidentiality: "restricted" },
          ],
        }],
      },
    },
    snapshotScope: "releasedCurrent",
  });

  assert.equal(result.success, true);
  assert.equal(replicationParams[1], "oci-test");
  assert.equal(replicationParams[6], "alias-1");
  assert.equal(replicationParams[10], "synced");
  assert.equal(savedObject.contentType, "application/json");
  assert.equal(savedObject.key, "custom-prefix/company-7/passport-lineage-1/v2/releasedCurrent.json");
  assert.equal(savedPayload.publicRowData.publicField, "public-value");
  assert.equal(savedPayload.publicRowData.restrictedField, undefined);
  assert.equal(savedPayload.publicRowData.unknownColumn, undefined);
});

test("backup provider queries use quoted canonical schema columns", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };
  const service = createBackupProviderService({
    pool,
    storageService: {},
    buildCanonicalPassportPayload: () => ({}),
  });

  const previousAutoHandover = process.env.BACKUP_PUBLIC_HANDOVER_AUTO_ENABLE;
  process.env.BACKUP_PUBLIC_HANDOVER_AUTO_ENABLE = "true";
  try {
    await service.listProviders({ companyId: 7 });
    await service.ensureAutomaticPublicHandover({ passportDppId: "dpp-1", internalAliasId: "alias-1" });
  } finally {
    restoreEnv("BACKUP_PUBLIC_HANDOVER_AUTO_ENABLE", previousAutoHandover);
  }

  assert.match(queries[0], /"isBackupProvider" = true/);
  assert.match(queries[0], /"isActive" = true/);
  assert.match(queries[1], /"replicationStatus" = 'synced'/);
  assert.match(queries[1], /"verificationStatus" = 'verified'/);
  assert.match(queries[1], /"internalAliasId" AS "internalAliasId"/);
});

test("public handover rows expose camelCase fields expected by callers", async () => {
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM "backupPublicHandovers"/);
      return {
        rows: [{
          id: 12,
          companyId: 7,
          passportDppId: "dpp-1",
          lineageId: "lineage-1",
          passportType: "exampleProductPassportV1",
          internalAliasId: "alias-1",
          versionNumber: 3,
          backupProviderKey: "oci-test",
          sourceReplicationId: 99,
          publicUrl: "https://backup.example/dpp-1.json",
          publicRowData: JSON.stringify({ dppId: "dpp-1" }),
          handoverStatus: "active",
          verificationStatus: "verified",
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
  assert.equal(handover.passportType, "exampleProductPassportV1");
  assert.equal(handover.internalAliasId, "alias-1");
  assert.equal(handover.versionNumber, 3);
  assert.equal(handover.backupProviderKey, "oci-test");
  assert.equal(handover.sourceReplicationId, 99);
  assert.equal(handover.publicUrl, "https://backup.example/dpp-1.json");
  assert.equal(handover.handoverStatus, "active");
  assert.equal(handover.verificationStatus, "verified");
  assert.deepEqual(handover.publicRowData, { dppId: "dpp-1" });
});
