"use strict";

const createBackupProviderService = require("../services/backup-provider-service");

describe("backup provider service", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("replicates a passport snapshot through the configured storage layer", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";
    process.env.BACKUP_PROVIDER_OBJECT_PREFIX = "oci-backups";

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        if (String(sql).includes("INSERT INTO passport_backup_replications")) {
          return {
            rows: [{
              backup_provider_key: params[1],
              passport_dpp_id: params[2],
              version_number: params[6],
              snapshot_scope: params[8],
              replication_status: params[9],
              storage_key: params[11],
            }],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const storageService = {
      provider: "s3",
      saveObject: jest.fn(async ({ key }) => ({
        provider: "s3",
        storageKey: key,
        url: `https://objectstorage.example/${key}`,
      })),
    };

    const service = createBackupProviderService({
      pool,
      storageService,
      buildCanonicalPassportPayload: (passport) => ({
        digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
        uniqueProductIdentifier: passport.product_identifier_did,
      }),
    });

    const result = await service.replicatePassportSnapshot({
      passport: {
        dppId: "dpp_test_1",
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        version_number: 2,
        product_identifier_did: "did:web:www.example.test:did:battery:item:c5-bat-2026-001",
      },
      typeDef: { type_name: "battery" },
      companyName: "Acme Energy",
      reason: "release",
      snapshotScope: "released_current",
    });

    expect(result.success).toBe(true);
    expect(storageService.saveObject).toHaveBeenCalledTimes(1);
    expect(storageService.saveObject.mock.calls[0][0].key).toContain("oci-backups/company-5");
    expect(result.results[0]).toMatchObject({
      backup_provider_key: "oci-primary",
      replication_status: "synced",
      snapshot_scope: "released_current",
    });
  });

  test("verifies a stored backup replication against the recorded payload hash", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";

    const storedEnvelope = {
      source: {
        passportDppId: "72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      passport: {
        digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
      },
    };
    const storedPayloadHash = require("crypto")
      .createHash("sha256")
      .update(JSON.stringify(storedEnvelope))
      .digest("hex");

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("SELECT id, passport_dpp_id, payload_hash, storage_key")) {
          return {
            rows: [{
              id: 91,
              passport_dpp_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
              payload_hash: storedPayloadHash,
              storage_key: "oci-backups/company-5/passport-72/v2/released_current.json",
            }],
          };
        }
        if (String(sql).includes("UPDATE passport_backup_replications")) {
          return {
            rows: [{
              id: params[0],
              verification_status: params[1],
              verification_error_message: params[2],
              verified_payload_hash: params[3],
            }],
          };
        }
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const storageService = {
      provider: "s3",
      fetchObject: jest.fn(async () => ({
        arrayBuffer: async () => Buffer.from(JSON.stringify(storedEnvelope), "utf8"),
      })),
    };

    const service = createBackupProviderService({
      pool,
      storageService,
      buildCanonicalPassportPayload: () => ({
        digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
      }),
    });

    const result = await service.verifyReplications({
      companyId: 5,
      passportDppId: "72b99c83-952c-4179-96f6-54a513d39dbc",
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(1);
    expect(storageService.fetchObject).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({
      verification_status: "verified",
      verified_payload_hash: storedPayloadHash,
    });
  });

  test("replicates an access-control revocation event through the configured storage layer", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";
    process.env.BACKUP_PROVIDER_OBJECT_PREFIX = "oci-backups";

    const pool = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const storageService = {
      provider: "s3",
      saveObject: jest.fn(async ({ key }) => ({
        provider: "s3",
        storageKey: key,
        url: `https://objectstorage.example/${key}`,
      })),
    };

    const service = createBackupProviderService({
      pool,
      storageService,
      buildCanonicalPassportPayload: () => ({
        digitalProductPassportId: "dpp_test_1",
      }),
    });

    const result = await service.replicateAccessControlEvent({
      companyId: 5,
      eventType: "USER_AUDIENCE_EMERGENCY_REVOKED",
      severity: "critical",
      actorUserId: 9,
      actorIdentifier: "did:web:www.example.test:did:company:5",
      affectedUserId: 42,
      revocationMode: "emergency",
      reason: "Incident response",
      metadata: { sessionsRevoked: true },
    });

    expect(result.success).toBe(true);
    expect(storageService.saveObject).toHaveBeenCalledTimes(1);
    expect(storageService.saveObject.mock.calls[0][0].key).toContain("security-events");
    expect(result.results[0]).toMatchObject({
      backup_provider_key: "oci-primary",
      event_type: "USER_AUDIENCE_EMERGENCY_REVOKED",
      severity: "critical",
      revocation_mode: "emergency",
      replication_status: "synced",
    });
  });
});
