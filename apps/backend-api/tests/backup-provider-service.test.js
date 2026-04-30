"use strict";

const createBackupProviderService = require("../services/backup-provider-service");

describe("backup provider service", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns the explicit continuity policy with default RPO/RTO values", () => {
    delete process.env.BACKUP_POLICY_RPO_MINUTES;
    delete process.env.BACKUP_POLICY_RTO_HOURS;
    delete process.env.BACKUP_POLICY_VERIFICATION_FREQUENCY;
    delete process.env.BACKUP_POLICY_RESTORE_TEST_FREQUENCY;

    const service = createBackupProviderService({
      pool: { query: jest.fn() },
      storageService: {},
      buildCanonicalPassportPayload: () => ({}),
    });

    expect(service.getContinuityPolicy({ companyId: 5 })).toMatchObject({
      companyId: 5,
      rpoMinutes: 15,
      rtoHours: 4,
      verificationFrequency: "daily",
      restoreTestFrequency: "quarterly",
      replicationTriggerPolicy: {
        release: true,
        archive: true,
        controlledUpdate: true,
        standardsDelete: true,
        manualReplication: true,
      },
    });
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

  test("copies uploaded document attachments into backup storage and records them in the manifest", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";
    process.env.BACKUP_PROVIDER_OBJECT_PREFIX = "oci-backups";

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        if (String(sql).includes("FROM passport_attachments")) {
          return {
            rows: [{
              id: 12,
              public_id: "pub_doc_001",
              company_id: 5,
              passport_dpp_id: "dpp_test_1",
              field_key: "doc_url",
              storage_key: "passport-files/dpp_test_1/doc_url-1.pdf",
              file_url: "https://app.example/public-files/pub_doc_001",
              mime_type: "application/pdf",
              size_bytes: 2048,
              is_public: true,
            }],
          };
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
              payload_json: JSON.parse(params[14]),
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
      fetchObject: jest.fn(async (storageKey) => ({
        arrayBuffer: async () => Buffer.from(
          storageKey.includes("passport-files/") ? "pdf-binary" : "{}",
          "utf8"
        ),
      })),
    };

    const service = createBackupProviderService({
      pool,
      storageService,
      buildCanonicalPassportPayload: (passport) => ({
        digitalProductPassportId: passport.dppId,
        uniqueProductIdentifier: passport.product_identifier_did,
      }),
    });

    const result = await service.replicatePassportSnapshot({
      passport: {
        dppId: "dpp_test_1",
        lineage_id: "dpp_test_1",
        company_id: 5,
        passport_type: "battery",
        version_number: 2,
        product_identifier_did: "did:web:www.example.test:did:battery:item:c5-bat-2026-001",
        doc_url: "https://app.example/public-files/pub_doc_001",
      },
      typeDef: {
        type_name: "battery",
        fields_json: {
          sections: [{ fields: [{ key: "doc_url", label: "Declaration of Conformity", type: "file", required: true }] }],
        },
      },
      companyName: "Acme Energy",
      reason: "release",
      snapshotScope: "released_current",
    });

    expect(result.success).toBe(true);
    expect(storageService.saveObject).toHaveBeenCalledTimes(2);
    expect(storageService.saveObject.mock.calls[0][0].key).toContain("/documents/");
    expect(result.results[0].payload_json.documentation).toEqual(
      expect.objectContaining({
        mandatoryBackupSatisfied: true,
        mandatoryDocumentCount: 1,
        attachmentCopies: expect.arrayContaining([
          expect.objectContaining({
            fieldKey: "doc_url",
            mandatory: true,
            isPublic: true,
            backupCopyStatus: "copied",
          }),
        ]),
      })
    );
  });

  test("fails backup replication when a mandatory document exists only as an unbacked reference", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        if (String(sql).includes("FROM passport_attachments")) {
          return { rows: [] };
        }
        if (String(sql).includes("INSERT INTO passport_backup_replications")) {
          return {
            rows: [{
              backup_provider_key: params[1],
              replication_status: params[9],
              error_message: params[15],
              payload_json: JSON.parse(params[14]),
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
        digitalProductPassportId: passport.dppId,
      }),
    });

    const result = await service.replicatePassportSnapshot({
      passport: {
        dppId: "dpp_test_1",
        lineage_id: "dpp_test_1",
        company_id: 5,
        passport_type: "battery",
        version_number: 2,
        doc_url: "https://external.example/doc.pdf",
      },
      typeDef: {
        type_name: "battery",
        fields_json: {
          sections: [{ fields: [{ key: "doc_url", label: "Declaration of Conformity", type: "file", required: true }] }],
        },
      },
      companyName: "Acme Energy",
      reason: "release",
      snapshotScope: "released_current",
    });

    expect(result.success).toBe(false);
    expect(result.results[0]).toMatchObject({
      replication_status: "failed",
      error_message: expect.stringContaining("Mandatory document backup is incomplete"),
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

  test("replicates an audit-anchor evidence record through the configured storage layer", async () => {
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

    const result = await service.replicateAuditAnchorEvent({
      companyId: 5,
      actorUserId: 9,
      actorIdentifier: "did:web:www.example.test:did:company:5",
      anchor: {
        id: 4,
        root_event_hash: "root_hash_16",
      },
      summary: {
        latestEventHash: "root_hash_16",
      },
    });

    expect(result.success).toBe(true);
    expect(storageService.saveObject).toHaveBeenCalledTimes(1);
    expect(storageService.saveObject.mock.calls[0][0].key).toContain("audit-anchors");
    expect(result.results[0]).toMatchObject({
      backup_provider_key: "oci-primary",
      event_category: "audit_anchor",
      anchor_id: 4,
      root_event_hash: "root_hash_16",
      replication_status: "synced",
    });
  });

  test("activates public handover only for inactive companies with a verified replication", async () => {
    process.env.BACKUP_PROVIDER_ENABLED = "true";
    process.env.BACKUP_PROVIDER_KEY = "oci-primary";

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("SELECT id, company_name, is_active")) {
          return { rows: [{ id: 5, company_name: "Acme Energy", is_active: false }] };
        }
        if (String(sql).includes("FROM passport_backup_replications")) {
          return {
            rows: [{
              id: 91,
              backup_provider_id: null,
              backup_provider_key: "oci-primary",
              passport_dpp_id: "dpp_test_1",
              lineage_id: "dpp_test_1",
              company_id: 5,
              passport_type: "battery",
              version_number: 2,
              public_url: "https://backup.example/passports/dpp_test_1",
              storage_key: "oci-backups/company-5/passport-dpp_test_1/v2/released_current.json",
              payload_json: { passport: { digitalProductPassportId: "dpp_test_1" } },
              verification_status: "verified",
              replication_status: "synced",
            }],
          };
        }
        if (String(sql).includes("FROM backup_service_providers")) {
          return { rows: [] };
        }
        if (String(sql).includes("UPDATE backup_public_handovers")) {
          return { rows: [] };
        }
        if (String(sql).includes("INSERT INTO backup_public_handovers")) {
          return {
            rows: [{
              id: 7,
              company_id: params[0],
              passport_dpp_id: params[1],
              passport_type: params[3],
              product_id: params[4],
              version_number: params[5],
              backup_provider_key: params[7],
              source_replication_id: params[8],
              public_url: params[10],
              public_row_data: JSON.parse(params[12]),
              handover_status: "active",
            }],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const service = createBackupProviderService({
      pool,
      storageService: {},
      buildCanonicalPassportPayload: () => ({}),
    });

    const result = await service.activatePublicHandover({
      companyId: 5,
      passportDppId: "dpp_test_1",
      lineageId: "dpp_test_1",
      passportType: "battery",
      productId: "BAT-2026-001",
      versionNumber: 2,
      publicCompanyName: "Acme Energy",
      publicRowData: {
        dppId: "dpp_test_1",
        product_id: "BAT-2026-001",
      },
      activatedBy: 4,
    });

    expect(result).toMatchObject({
      passport_dpp_id: "dpp_test_1",
      backup_provider_key: "oci-primary",
      source_replication_id: 91,
      handover_status: "active",
      public_row_data: expect.objectContaining({
        dppId: "dpp_test_1",
      }),
    });
  });
});
