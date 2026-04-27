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
});
