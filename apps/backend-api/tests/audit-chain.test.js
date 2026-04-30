"use strict";

const createPassportService = require("../services/passport-service");

function createService(pool) {
  return createPassportService({
    pool,
    getTable: jest.fn(),
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    isPublicHistoryStatus: () => true,
    isEditablePassportStatus: () => true,
    normalizeProductIdValue: (value) => value,
    generateProductIdValue: (value) => value,
    IN_REVISION_STATUS: "in_revision",
    SYSTEM_PASSPORT_FIELDS: new Set(),
    getWritablePassportColumns: () => [],
    getStoredPassportValues: () => [],
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (_fieldDef, value) => value,
    comparableHistoryFieldValue: (value) => value,
    formatHistoryFieldValue: (value) => value,
    getHistoryFieldDefs: () => [],
    buildCurrentPublicPassportPath: () => "/dpp/test",
    buildInactivePublicPassportPath: () => "/dpp/inactive/test",
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: rawProductId,
      }),
    },
    createTransporter: jest.fn(),
    brandedEmail: jest.fn(),
  });
}

describe("passport-service audit chain", () => {
  test("logAudit stores actor, audience, previous hash, and event hash", async () => {
    const insertCalls = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("SELECT event_hash") && text.includes("FROM audit_logs")) {
          return { rows: [{ event_hash: "prev_hash_1" }] };
        }
        if (text.includes("INSERT INTO audit_logs")) {
          insertCalls.push({ sql: text, params });
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    const service = createService(pool);

    await service.logAudit(
      5,
      9,
      "PATCH_DPP_ELEMENT",
      "battery_passports",
      "dpp_test_1",
      { before: 1 },
      { after: 2 },
      { actorIdentifier: "operator:se-123", audience: "market_surveillance" }
    );

    expect(insertCalls).toHaveLength(1);
    const params = insertCalls[0].params;
    expect(params[0]).toBe(5);
    expect(params[1]).toBe(9);
    expect(params[2]).toBe("PATCH_DPP_ELEMENT");
    expect(params[4]).toBe("dpp_test_1");
    expect(params[7]).toBe("operator:se-123");
    expect(params[8]).toBe("market_surveillance");
    expect(params[9]).toBe("prev_hash_1");
    expect(typeof params[10]).toBe("string");
    expect(params[10]).toHaveLength(64);
    expect(params[11]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params[12]).toBe(2);
  });

  test("anchorAuditLogRoot stores a chained anchor record", async () => {
    const insertCalls = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("SELECT id, company_id, user_id, action")) {
          return {
            rows: [
              {
                id: 11,
                company_id: 5,
                user_id: 9,
                action: "PATCH_DPP",
                table_name: "battery_passports",
                record_id: "dpp_test_1",
                old_values: { before: 1 },
                new_values: { after: 2 },
                actor_identifier: "operator:se-123",
                audience: "economic_operator",
                previous_event_hash: null,
                event_hash: "root_hash_11",
                created_at: "2026-04-29T12:00:00.000Z",
                hash_version: 2,
              },
            ],
          };
        }
        if (text.includes("SELECT COUNT(*)::int AS log_count")) {
          return {
            rows: [{
              log_count: 1,
              first_log_id: 11,
              latest_log_id: 11,
              latest_created_at: "2026-04-29T12:00:00.000Z",
            }],
          };
        }
        if (text.includes("SELECT anchor_hash") && text.includes("FROM audit_log_anchors")) {
          return { rows: [{ anchor_hash: "prev_anchor_hash" }] };
        }
        if (text.includes("INSERT INTO audit_log_anchors")) {
          insertCalls.push({ sql: text, params });
          return { rows: [{ id: 3, anchor_hash: params[6] }] };
        }
        return { rows: [] };
      }),
    };
    const service = createService(pool);

    const result = await service.anchorAuditLogRoot({
      companyId: 5,
      anchoredBy: 9,
      anchorType: "external_evidence",
      anchorReference: "s3://evidence/audit-root.json",
      notes: "Daily export",
      metadata: { ticket: "COMP-42" },
    });

    expect(insertCalls).toHaveLength(1);
    const params = insertCalls[0].params;
    expect(params[0]).toBe(5);
    expect(params[1]).toBe(1);
    expect(params[4]).toBe("root_hash_11");
    expect(params[5]).toBe("prev_anchor_hash");
    expect(typeof params[6]).toBe("string");
    expect(params[6]).toHaveLength(64);
    expect(params[7]).toBe("external_evidence");
    expect(params[8]).toBe("s3://evidence/audit-root.json");
    expect(params[10]).toBe(JSON.stringify({ ticket: "COMP-42" }));
    expect(params[11]).toBe(9);
    expect(result).toMatchObject({
      anchor: expect.objectContaining({
        id: 3,
      }),
      summary: expect.objectContaining({
        companyId: 5,
        latestEventHash: "root_hash_11",
      }),
    });
  });
});
