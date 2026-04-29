"use strict";

const createAccessRightsService = require("../services/access-rights-service");

describe("access rights service audience model", () => {
  test("expands public and economic operator audiences into the richer standards actor set", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async () => ({ rows: [] })),
      },
    });

    const audiences = await service.loadUserAudiences({
      userId: 9,
      companyId: 5,
      role: "company_admin",
    });

    expect(audiences).toEqual(expect.arrayContaining([
      "public",
      "consumers",
      "economic_operator",
      "manufacturer",
      "authorized_representative",
      "importer",
      "distributor",
      "dealer",
      "fulfilment_service_provider",
      "legitimate_interest",
    ]));
  });

  test("includes explicitly granted product-group-specific audiences", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async (sql) => {
          if (String(sql).includes("FROM user_access_audiences")) {
            return { rows: [{ audience: "customs_authority" }, { audience: "recycler" }] };
          }
          return { rows: [] };
        }),
      },
    });

    const audiences = await service.loadUserAudiences({
      userId: 9,
      companyId: 5,
      role: "viewer",
    });

    expect(audiences).toEqual(expect.arrayContaining([
      "customs_authority",
      "recycler",
    ]));
  });

  test("defaults restricted field confidentiality and update authority from the access audience", () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async () => ({ rows: [] })),
      },
    });

    const policy = service.buildFieldPolicy({
      fields_json: {
        sections: [{
          fields: [{
            key: "customs_document",
            access: ["customs_authority"],
          }],
        }],
      },
    }, "customs_document");

    expect(policy.confidentiality).toBe("restricted");
    expect(policy.updateAuthority).toEqual(expect.arrayContaining([
      "economic_operator",
      "customs_authority",
    ]));
  });

  test("treats consumers as a first-class readable audience for public callers", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async () => ({ rows: [] })),
      },
    });

    const decision = await service.canReadElement({
      typeDef: {
        fields_json: {
          sections: [{
            fields: [{
              key: "consumer_notice",
              access: ["consumers"],
              confidentiality: "public",
            }],
          }],
        },
      },
      elementIdPath: "consumer_notice",
      user: null,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.matchedAudience).toBe("consumers");
    expect(decision.confidentiality).toBe("public");
  });

  test("allows explicitly assigned specialist operators to update matching fields", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async () => ({ rows: [] })),
      },
    });

    const decision = await service.canWriteElement({
      typeDef: {
        fields_json: {
          sections: [{
            fields: [{
              key: "repair_protocol",
              access: ["professional_repairer"],
              confidentiality: "confidential",
              updateAuthority: ["professional_repairer"],
            }],
          }],
        },
      },
      elementIdPath: "repair_protocol",
      user: {
        userId: 11,
        companyId: 5,
        role: "viewer",
        accessAudiences: ["professional_repairer"],
      },
      passportCompanyId: 5,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.matchedAuthority).toBe("professional_repairer");
    expect(decision.confidentiality).toBe("confidential");
  });
});
