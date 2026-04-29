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
            return {
              rows: [
                {
                  audience: "customs_authority",
                  company_id: 5,
                  grantor_role: "company_admin",
                  grantor_company_id: 5,
                  grantor_is_active: true,
                },
                {
                  audience: "recycler",
                  company_id: 5,
                  grantor_role: "company_admin",
                  grantor_company_id: 5,
                  grantor_is_active: true,
                },
              ],
            };
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

  test("applies the parent field policy to nested element paths", async () => {
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
              key: "battery_profile",
              access: ["market_surveillance"],
              confidentiality: "regulated",
            }],
          }],
        },
      },
      elementIdPath: "$.fields.battery_profile.modules[0].massKg",
      user: {
        userId: 14,
        companyId: 5,
        role: "viewer",
        accessAudiences: ["market_surveillance"],
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.matchedAudience).toBe("market_surveillance");
    expect(decision.confidentiality).toBe("regulated");
  });

  test("applies delegated passport grants only to the granted element subtree", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async (sql) => {
          if (String(sql).includes("FROM user_access_audiences")) {
            return { rows: [] };
          }
          if (String(sql).includes("FROM passport_access_grants")) {
            return {
              rows: [{
                audience: "market_surveillance",
                element_id_path: "battery_profile.chemistry",
                company_id: 5,
                grantor_role: "company_admin",
                grantor_company_id: 5,
                grantor_is_active: true,
              }],
            };
          }
          return { rows: [] };
        }),
      },
    });

    const allowed = await service.canReadElement({
      passportDppId: "dpp_1",
      typeDef: {
        fields_json: {
          sections: [{
            fields: [{
              key: "battery_profile",
              access: ["market_surveillance"],
              confidentiality: "regulated",
            }],
          }],
        },
      },
      elementIdPath: "battery_profile.chemistry.code",
      user: {
        userId: 12,
        companyId: 9,
        role: "viewer",
      },
    });

    const denied = await service.canReadElement({
      passportDppId: "dpp_1",
      typeDef: {
        fields_json: {
          sections: [{
            fields: [{
              key: "battery_profile",
              access: ["market_surveillance"],
              confidentiality: "regulated",
            }],
          }],
        },
      },
      elementIdPath: "battery_profile.modules[0].massKg",
      user: {
        userId: 12,
        companyId: 9,
        role: "viewer",
      },
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  test("ignores delegated audiences when the delegator no longer has active grant authority", async () => {
    const service = createAccessRightsService({
      pool: {
        query: jest.fn(async (sql) => {
          if (String(sql).includes("FROM user_access_audiences")) {
            return {
              rows: [{
                audience: "customs_authority",
                company_id: 5,
                grantor_role: "viewer",
                grantor_company_id: 5,
                grantor_is_active: true,
              }],
            };
          }
          return { rows: [] };
        }),
      },
    });

    const audiences = await service.loadUserAudiences({
      userId: 21,
      companyId: 5,
      role: "viewer",
    });

    expect(audiences).not.toContain("customs_authority");
  });
});
