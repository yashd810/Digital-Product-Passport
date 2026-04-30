"use strict";

const createDidService = require("../services/did-service");
const createProductIdentifierService = require("../services/product-identifier-service");

describe("product identifier service", () => {
  const didService = createDidService({
    didDomain: "www.example.test",
    publicOrigin: "https://app.example.test",
    apiOrigin: "https://api.example.test",
  });
  const service = createProductIdentifierService({ didService });

  test("builds deterministic product DIDs from raw input", () => {
    const first = service.buildCanonicalProductDid({
      companyId: 12,
      passportType: "battery",
      rawProductId: "SN-001 A",
      granularity: "item",
    });
    const second = service.buildCanonicalProductDid({
      companyId: 12,
      passportType: "battery",
      rawProductId: "SN-001 A",
      granularity: "item",
    });

    expect(first).toBe(second);
    expect(first).toContain("did:web:www.example.test:did:battery:item:");
  });

  test("lookup candidates include raw input and canonical did when company-scoped", () => {
    const candidates = service.buildLookupCandidates({
      companyId: 4,
      passportType: "battery",
      productId: "BAT-7788",
      granularity: "item",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe("BAT-7788");
    expect(candidates[1]).toContain("did:web:www.example.test:did:battery:item:");
  });

  test("existing did input stays untouched", () => {
    const existingDid = "did:web:www.example.test:did:battery:item:c4-bat-7788-abcdef123456";
    const normalized = service.normalizeProductIdentifiers({
      companyId: 4,
      passportType: "battery",
      rawProductId: existingDid,
      granularity: "item",
    });

    expect(normalized.productIdInput).toBe(existingDid);
    expect(normalized.productIdentifierDid).toBe(existingDid);
  });

  test("exposes the identifier persistence policy", () => {
    const policy = service.getIdentifierPersistencePolicy({ companyId: 4 });

    expect(policy).toMatchObject({
      companyId: 4,
      selectedGlobalIdentifierScheme: "did_web_product_identifier",
      uniqueProductIdentifierField: "product_identifier_did",
      localProductIdField: "product_id",
      lineageIdentifierField: "lineage_id",
      rules: expect.objectContaining({
        identifiersNeverReused: true,
        oldIdentifiersRemainResolvable: true,
        backupProviderContinuationSupported: true,
        granularityChangesRequireLinkedNewIdentifier: true,
      }),
      granularityChangePolicy: expect.objectContaining({
        mode: "linked_new_identifier_required",
        linkageField: "lineage_id",
      }),
    });
  });

  test("preserves batch granularity in canonical identifier generation", () => {
    const did = service.buildCanonicalProductDid({
      companyId: 8,
      passportType: "battery",
      rawProductId: "BATCH-001",
      granularity: "batch",
    });

    expect(service.normalizeGranularity("batch")).toBe("batch");
    expect(did).toContain("did:web:www.example.test:did:battery:item:");
  });

  test("records and lists identifier lineage links", async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes("INSERT INTO product_identifier_lineage")) {
          return {
            rows: [{
              id: 11,
              company_id: 4,
              lineage_id: "dpp_lineage_001",
              previous_passport_dpp_id: "dpp_old",
              replacement_passport_dpp_id: "dpp_new",
              previous_identifier: "did:web:www.example.test:did:battery:model:old",
              replacement_identifier: "did:web:www.example.test:did:battery:item:new",
              previous_local_product_id: "BAT-MODEL-01",
              replacement_local_product_id: "BAT-ITEM-01",
              previous_granularity: "model",
              replacement_granularity: "item",
              transition_reason: "granularity_change",
              created_by: 9,
              created_at: "2026-04-30T10:00:00.000Z",
            }],
          };
        }
        if (String(sql).includes("FROM product_identifier_lineage")) {
          return {
            rows: [{
              id: 11,
              company_id: 4,
              lineage_id: "dpp_lineage_001",
              previous_passport_dpp_id: "dpp_old",
              replacement_passport_dpp_id: "dpp_new",
              previous_identifier: "did:web:www.example.test:did:battery:model:old",
              replacement_identifier: "did:web:www.example.test:did:battery:item:new",
              previous_local_product_id: "BAT-MODEL-01",
              replacement_local_product_id: "BAT-ITEM-01",
              previous_granularity: "model",
              replacement_granularity: "item",
              transition_reason: "granularity_change",
              created_by: 9,
              created_at: "2026-04-30T10:00:00.000Z",
            }],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };
    const dbBackedService = createProductIdentifierService({ didService, pool });

    const created = await dbBackedService.recordGranularityTransition({
      companyId: 4,
      lineageId: "dpp_lineage_001",
      previousPassportDppId: "dpp_old",
      replacementPassportDppId: "dpp_new",
      previousIdentifier: "did:web:www.example.test:did:battery:model:old",
      replacementIdentifier: "did:web:www.example.test:did:battery:item:new",
      previousGranularity: "model",
      replacementGranularity: "item",
      transitionReason: "granularity_change",
      createdBy: 9,
    });
    const listed = await dbBackedService.listIdentifierLineage({
      companyId: 4,
      lineageId: "dpp_lineage_001",
    });

    expect(created).toMatchObject({
      previousGranularity: "model",
      replacementGranularity: "item",
      replacementDppId: "dpp_new",
    });
    expect(listed).toEqual([
      expect.objectContaining({
        lineageId: "dpp_lineage_001",
        previousDppId: "dpp_old",
        replacementDppId: "dpp_new",
      }),
    ]);
  });
});
