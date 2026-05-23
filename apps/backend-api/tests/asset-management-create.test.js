"use strict";

const assert = require("assert");

const createAssetService = require("../services/asset-management");

let passed = 0;
let failed = 0;

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  PASS  ${name}`);
      passed += 1;
    })
    .catch((error) => {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${error.message}`);
      failed += 1;
    });
}

function buildService(overrides = {}) {
  const pool = overrides.pool || {
    async query(sql) {
      if (String(sql).includes("FROM companies c")) {
        return {
          rows: [{
            id: 7,
            default_granularity: "item",
            allow_granularity_override: false,
            mint_model_dids: true,
            mint_item_dids: true,
          }],
        };
      }
      throw new Error(`Unexpected pool.query: ${sql}`);
    },
    async connect() {
      return {
        async query() { return { rows: [] }; },
        release() {},
      };
    },
  };

  return createAssetService({
    pool,
    getTable: () => "battery_passports",
    logAudit: overrides.logAudit || (async () => {}),
    assertCompanyAssetPassportTypeAccess: async () => ({
      typeName: "battery_passport",
      displayName: "Battery Passport",
      schemaFields: [{ key: "modelName", label: "Model Name", type: "text" }],
    }),
    assertAssetManagementEnabled: async () => ({ id: 7 }),
    getLatestCompanyPassports: async () => [],
    findExistingPassportByInternalAliasId: overrides.findExistingPassportByInternalAliasId || (async () => null),
    updatePassportRowById: async () => [],
    normalizeInternalAliasIdValue: (value) => typeof value === "string" ? value.trim() : "",
    generateInternalAliasIdValue: (dppId) => `PID-${String(dppId).slice(-6)}`,
    generateDppRecordId: overrides.generateDppRecordId || (() => "dpp_new_001"),
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        internalAliasIdInput: String(rawProductId || "").trim(),
        productIdentifierDid: `did:web:test:product:${String(rawProductId || "").trim().toLowerCase()}`,
      }),
    },
    createPassportTable: overrides.createPassportTable || (async () => {}),
    archivePassportSnapshot: overrides.archivePassportSnapshot || (async () => {}),
    isPlainObject: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
    getValueAtPath: (value, key) => value?.[key],
    normalizeAssetHeaders: (headers) => headers || {},
    coerceAssetFieldValue: (fieldDef, rawValue) => ({ ok: true, value: rawValue }),
    comparableHistoryFieldValue: (_fieldDef, rawValue) => String(rawValue ?? ""),
    toDynamicStoredValue: (value) => value,
    getAssetFieldMap: () => new Map([
      ["dppId", { key: "dppId", label: "Passport DPP ID", type: "text", system: true }],
      ["internalAliasId", { key: "internalAliasId", label: "Serial Number", type: "text", system: true }],
      ["modelName", { key: "modelName", label: "Model Name", type: "text", system: true }],
    ]),
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    ASSET_MATCH_FIELDS: new Set(["dppId", "dppId", "match_dpp_id", "guid", "match_guid", "internalAliasId", "match_product_id", "next_product_id"]),
    ASSET_IGNORED_SYSTEM_COLUMNS: new Set(["id", "company_id"]),
    ASSET_SCHEDULER_INTERVAL_MS: 60000,
    ASSET_SOURCE_ALLOWED_HOSTS: new Set(),
  });
}

console.log("\nasset management create flow");

test("prepareAssetPayload generates a new dppId for unmatched product rows", async () => {
  const service = buildService();
  const payload = await service.prepareAssetPayload({
    companyId: 7,
    passportType: "battery-passport",
    records: [{ internalAliasId: "BAT-001", modelName: "Model A" }],
  });

  assert.strictEqual(payload.summary.ready, 1);
  assert.strictEqual(payload.summary.ready_for_passport_create, 1);
  assert.strictEqual(payload.generated_payload.records[0].action, "create");
  assert.strictEqual(payload.generated_payload.records[0].generated_dpp_id, "dpp_new_001");
  assert.strictEqual(payload.generated_payload.records[0].internalAliasId, "BAT-001");
});

test("prepareAssetPayload ignores blank unknown columns on create rows", async () => {
  const service = buildService();
  const payload = await service.prepareAssetPayload({
    companyId: 7,
    passportType: "battery-passport",
    records: [{ internalAliasId: "BAT-001", modelName: "Model A", serial_number: "" }],
  });

  assert.strictEqual(payload.summary.failed, 0);
  assert.strictEqual(payload.summary.ready_for_passport_create, 1);
  assert.strictEqual(payload.generated_payload.records[0].action, "create");
});

test("executeAssetPush persists created passports and reports passports_created", async () => {
  const insertedRows = [];
  const registryRows = [];
  const archived = [];
  const auditEvents = [];

  const service = buildService({
    pool: {
      async query(sql) {
        if (String(sql).includes("FROM companies c")) {
          return {
            rows: [{
              id: 7,
              default_granularity: "item",
              allow_granularity_override: false,
              mint_model_dids: true,
              mint_item_dids: true,
            }],
          };
        }
        throw new Error(`Unexpected pool.query: ${sql}`);
      },
      async connect() {
        return {
          async query(sql, params) {
            const text = String(sql);
            if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
            if (text.includes("INSERT INTO battery_passports")) {
              insertedRows.push({ sql: text, params });
              return {
                rows: [{
                  dppId: params[0],
                  lineageId: params[1],
                  company_id: params[2],
                  modelName: params[3],
                  internalAliasId: params[4],
                  uniqueProductIdentifier: params[5],
                  granularity: params[6],
                  releaseStatus: "draft",
                  versionNumber: 1,
                }],
              };
            }
            if (text.includes("INSERT INTO passport_registry")) {
              registryRows.push({ sql: text, params });
              return { rows: [] };
            }
            throw new Error(`Unexpected client.query: ${sql}`);
          },
          release() {},
        };
      },
    },
    logAudit: async (...args) => auditEvents.push(args),
    archivePassportSnapshot: async (payload) => archived.push(payload),
  });

  const result = await service.executeAssetPush({
    companyId: 7,
    generatedPayload: {
      passportType: "battery_passport",
      records: [{
        row_index: 1,
        action: "create",
        generated_dpp_id: "dpp_new_002",
        generated_lineage_id: "dpp_new_002",
        generated_granularity: "item",
        internalAliasId: "BAT-002",
        uniqueProductIdentifier: "did:web:test:product:bat-002",
        passport_create: {
          internalAliasId: "BAT-002",
          modelName: "Model B",
        },
      }],
    },
    userId: 42,
  });

  assert.strictEqual(result.summary.passports_created, 1);
  assert.strictEqual(result.details[0].status, "created");
  assert.strictEqual(insertedRows.length, 1);
  assert.strictEqual(registryRows.length, 1);
  assert.strictEqual(archived.length, 1);
  assert.strictEqual(auditEvents.length, 1);
});

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 50);
