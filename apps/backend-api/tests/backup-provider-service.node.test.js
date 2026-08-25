"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const createBackupProviderService = require("../src/platform/backups/backup-provider-service");

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setEnvironmentForTest(t, values) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]])
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) restoreEnv(name, value);
  });
}

function createContinuityEvidenceService({ row } = {}) {
  return createBackupProviderService({
    pool: {
      async query(sql) {
        assert.match(sql, /FROM "passportBackupReplications"/);
        return { rows: [row || {}] };
      },
    },
    storageService: {},
    buildCanonicalPassportPayload: () => ({}),
  });
}

test("configured archival policy is never reported as proven OCI retention", async (t) => {
  setEnvironmentForTest(t, {
    BACKUP_PROVIDER_REQUIRED: "false",
    BACKUP_ARCHIVAL_STORAGE_MODE: "ociObjectStorage",
    BACKUP_ARCHIVAL_RETENTION_DAYS: "365",
    BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI: "oci://dpp-prod-db-backups/retention-attestation.json",
    BACKUP_RESTORE_DRILL_EVIDENCE_URI: "https://evidence.example.test/restore-drill",
    BACKUP_LAST_RESTORE_DRILL_AT: "2026-08-01T00:00:00.000Z",
  });

  const now = new Date().toISOString();
  const service = createContinuityEvidenceService({
    row: {
      replicationCount: 1,
      syncedReplicationCount: 1,
      failedReplicationCount: 0,
      verifiedReplicationCount: 1,
      failedVerificationCount: 0,
      latestReplicationAt: now,
      latestVerificationAt: now,
    },
  });

  const evidence = await service.getContinuityEvidence({ companyId: 7 });

  assert.equal(evidence.immutableArchivalEvidence.status, "notProven");
  assert.equal(evidence.immutableArchivalEvidence.evidenceSource, "operatorConfiguration");
  assert.equal(evidence.immutableArchivalEvidence.operatorConfigurationStatus, "configured");
  assert.equal(evidence.immutableArchivalEvidence.liveValidationStatus, "notAvailable");
  assert.equal(evidence.immutableArchivalEvidence.cryptographicValidationStatus, "notAvailable");
  assert.equal(evidence.immutableArchivalEvidence.mode, "ociObjectStorage");
  assert.equal(evidence.immutableArchivalEvidence.retentionDays, 365);
  assert.equal(evidence.immutableArchivalEvidence.evidenceUri, "oci://dpp-prod-db-backups/retention-attestation.json");
  assert.equal(evidence.readiness.status, "notReady");
  assert.deepEqual(evidence.readiness.missingEvidence, ["immutableArchivalValidation"]);
});

test("missing archival configuration remains not proven and identifies both missing controls", async (t) => {
  setEnvironmentForTest(t, {
    BACKUP_PROVIDER_REQUIRED: "false",
    BACKUP_ARCHIVAL_STORAGE_MODE: undefined,
    BACKUP_ARCHIVAL_RETENTION_DAYS: undefined,
    BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI: undefined,
    BACKUP_RESTORE_DRILL_EVIDENCE_URI: "https://evidence.example.test/restore-drill",
    BACKUP_LAST_RESTORE_DRILL_AT: "2026-08-01T00:00:00.000Z",
  });

  const now = new Date().toISOString();
  const service = createContinuityEvidenceService({
    row: {
      replicationCount: 1,
      syncedReplicationCount: 1,
      failedReplicationCount: 0,
      verifiedReplicationCount: 1,
      failedVerificationCount: 0,
      latestReplicationAt: now,
      latestVerificationAt: now,
    },
  });

  const evidence = await service.getContinuityEvidence({ companyId: 7 });

  assert.equal(evidence.immutableArchivalEvidence.status, "notProven");
  assert.equal(evidence.immutableArchivalEvidence.evidenceSource, "none");
  assert.equal(evidence.immutableArchivalEvidence.operatorConfigurationStatus, "notConfigured");
  assert.equal(evidence.immutableArchivalEvidence.evidenceUri, null);
  assert.equal(evidence.readiness.status, "notReady");
  assert.deepEqual(evidence.readiness.missingEvidence, [
    "immutabilityEvidence",
    "immutableArchivalValidation",
  ]);
});

test("implicit env backup provider is normalized before passport replication", async (t) => {
  const previousEnabled = process.env.BACKUP_PROVIDER_ENABLED;
  const previousKey = process.env.BACKUP_PROVIDER_KEY;
  const previousPrefix = process.env.BACKUP_PROVIDER_OBJECT_PREFIX;
  const previousSupportsPublicHandover = process.env.BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER;

  process.env.BACKUP_PROVIDER_ENABLED = "true";
  process.env.BACKUP_PROVIDER_KEY = "oci-test";
  process.env.BACKUP_PROVIDER_OBJECT_PREFIX = "custom-prefix";
  delete process.env.BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER;

  t.after(() => {
    restoreEnv("BACKUP_PROVIDER_ENABLED", previousEnabled);
    restoreEnv("BACKUP_PROVIDER_KEY", previousKey);
    restoreEnv("BACKUP_PROVIDER_OBJECT_PREFIX", previousPrefix);
    restoreEnv("BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER", previousSupportsPublicHandover);
  });

  let replicationParams = null;
  let savedObject = null;
  let savedPayload = null;
  let applicationStorageWrites = 0;
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
    provider: "s3",
    async saveObject() {
      applicationStorageWrites += 1;
      throw new Error("Application storage must never receive backup writes");
    },
  };
  const backupStorageService = {
    provider: "backup-s3",
    async saveObject(input) {
      savedObject = input;
      savedPayload = JSON.parse(input.buffer.toString("utf8"));
      return { storageKey: input.key, url: `http://files.example/${input.key}` };
    },
  };

  const service = createBackupProviderService({
    pool,
    storageService,
    backupStorageService,
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
  const [implicitProvider] = await service.listProviders({ companyId: 7 });
  assert.equal(implicitProvider.supportsPublicHandover, false);
  assert.equal(applicationStorageWrites, 0);
  assert.equal(replicationParams[1], "oci-test");
  assert.equal(replicationParams[6], "alias-1");
  assert.equal(replicationParams[10], "synced");
  assert.equal(savedObject.contentType, "application/json");
  assert.equal(savedObject.key, "custom-prefix/company-7/passport-lineage-1/v2/releasedCurrent.json");
  assert.equal(savedPayload.publicRowData.publicField, "public-value");
  assert.equal(savedPayload.publicRowData.restrictedField, undefined);
  assert.equal(savedPayload.publicRowData.unknownColumn, undefined);
});

test("backup provider queries use quoted canonical schema columns and expose no automatic handover API", async () => {
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

  await service.listProviders({ companyId: 7 });

  assert.match(queries[0], /"isBackupProvider" = true/);
  assert.match(queries[0], /"isActive" = true/);
  assert.equal(service.ensureAutomaticPublicHandover, undefined);
});

test("backup replication rejects legacy attachment symlinks that escape configured storage", async (t) => {
  const names = ["BACKUP_PROVIDER_ENABLED", "BACKUP_PROVIDER_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.BACKUP_PROVIDER_ENABLED = "true";
  process.env.BACKUP_PROVIDER_KEY = "test-backup";
  t.after(() => names.forEach((name) => restoreEnv(name, previous[name])));

  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dpp-backup-local-storage-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dpp-backup-outside-"));
  t.after(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  });
  const attachmentDir = path.join(storageRoot, "passport-files", "dpp-1");
  const symlinkPath = path.join(attachmentDir, "legacy.pdf");
  const outsideFile = path.join(outsideRoot, "outside.pdf");
  await fs.mkdir(attachmentDir, { recursive: true });
  await fs.writeFile(outsideFile, "%PDF-outside-secret", "utf8");
  await fs.symlink(outsideFile, symlinkPath);

  const writes = [];
  const service = createBackupProviderService({
    pool: {
      async query(sql, params = []) {
        if (sql.includes("FROM \"backupServiceProviders\"")) return { rows: [] };
        if (sql.includes("FROM \"passportAttachments\"")) {
          return {
            rows: [{
              id: 1,
              fieldKey: "complianceDocument",
              filePath: symlinkPath,
              storageKey: null,
              mimeType: "application/pdf",
              isPublic: false,
              sizeBytes: 19,
              createdAt: new Date().toISOString(),
            }],
          };
        }
        if (sql.includes("INSERT INTO \"passportBackupReplications\"")) {
          return { rows: [{ replicationStatus: params[10], errorMessage: params[16] }] };
        }
        return { rows: [] };
      },
    },
    storageService: { filesBaseDir: path.join(storageRoot, "passport-files") },
    backupStorageService: {
      provider: "backup-s3",
      async saveObject(input) {
        writes.push(input);
        return { storageKey: input.key, url: null };
      },
    },
    apiOrigin: "https://api.example.test",
    buildCanonicalPassportPayload: () => ({}),
  });

  const result = await service.replicatePassportSnapshot({
    passport: { dppId: "dpp-1", companyId: 7, passportType: "example", versionNumber: 1 },
    typeDef: {
      fieldsJson: { sections: [{ fields: [{ key: "complianceDocument", type: "document" }] }] },
    },
  });

  assert.equal(result.success, true);
  assert.equal(writes.length, 1, "the escaped attachment must not be copied to backup storage");
  const snapshot = JSON.parse(writes[0].buffer.toString("utf8"));
  const copy = snapshot.documentation.attachmentCopies[0].backupCopy;
  assert.equal(copy.storageKey, null);
  assert.match(copy.error, /not a regular file inside configured storage directories/);
  assert.equal(copy.error.includes(outsideRoot), false);
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

test("backup verification reads the provider-scoped backup store rather than application storage", async () => {
  const payload = {
    passport: { digitalProductPassportId: "dpp-1" },
    source: { passportDppId: "dpp-1" },
    documentation: {},
  };
  const serializedPayload = JSON.stringify(payload);
  const expectedHash = crypto.createHash("sha256").update(serializedPayload).digest("hex");
  const backupReads = [];
  const backupReadLimits = [];
  let applicationStorageReads = 0;
  let verificationUpdate = null;
  const service = createBackupProviderService({
    pool: {
      async query(sql, params = []) {
        if (sql.includes("SELECT id, \"passportDppId\", \"payloadHash\", \"storageKey\"")) {
          return {
            rows: [{
              id: 42,
              passportDppId: "dpp-1",
              payloadHash: expectedHash,
              storageKey: "backup-provider/company-7/passport-dpp-1/v1/releasedCurrent.json",
            }],
          };
        }
        if (sql.includes("UPDATE \"passportBackupReplications\"")) {
          verificationUpdate = params;
          return { rows: [{ id: params[0], verificationStatus: params[1] }] };
        }
        return { rows: [] };
      },
    },
    storageService: {
      async fetchObject() {
        applicationStorageReads += 1;
        throw new Error("Application storage must never verify backup objects");
      },
    },
    backupStorageService: {
      provider: "backup-s3",
      async fetchObject(storageKey) {
        backupReads.push(storageKey);
        return {
          arrayBuffer: async (maxBytes) => {
            backupReadLimits.push(maxBytes);
            return Buffer.from(serializedPayload, "utf8");
          },
        };
      },
    },
    buildCanonicalPassportPayload: () => ({}),
  });

  const result = await service.verifyReplications({ companyId: 7, passportDppId: "dpp-1" });

  assert.equal(result.success, true);
  assert.equal(applicationStorageReads, 0);
  assert.deepEqual(backupReads, ["backup-provider/company-7/passport-dpp-1/v1/releasedCurrent.json"]);
  assert.deepEqual(backupReadLimits, [10 * 1024 * 1024]);
  assert.deepEqual(verificationUpdate.slice(0, 2), [42, "verified"]);
});
