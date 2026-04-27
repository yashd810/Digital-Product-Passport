"use strict";

const express = require("express");

const registerDppApiRoutes = require("../routes/dpp-api");
const { extractExplicitFacilityId } = require("../helpers/passport-helpers");

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    finished: false,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    json(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    redirect(statusOrUrl, maybeUrl) {
      if (typeof maybeUrl === "undefined") {
        this.statusCode = 302;
        this.redirectedTo = statusOrUrl;
      } else {
        this.statusCode = statusOrUrl;
        this.redirectedTo = maybeUrl;
      }
      this.finished = true;
      return this;
    },
  };
}

function findRouteLayer(app, method, path) {
  const layer = app._router?.stack?.find((entry) =>
    entry.route
    && entry.route.path === path
    && entry.route.methods?.[method]
  );
  if (!layer) {
    throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {}, headers = {} }) {
  const handlers = findRouteLayer(app, method, path);
  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers,
    user: null,
  };
  const res = createMockResponse();

  async function runHandler(index) {
    if (index >= handlers.length || res.finished) return;
    const handler = handlers[index];
    if (handler.length >= 3) {
      let nextCalled = false;
      await new Promise((resolve, reject) => {
        const next = (error) => {
          if (error) return reject(error);
          nextCalled = true;
          resolve();
        };
        Promise.resolve()
          .then(() => handler(req, res, next))
          .then(() => {
            if (!nextCalled && res.finished) resolve();
          })
          .catch(reject);
      });
      if (nextCalled) {
        await runHandler(index + 1);
      }
      return;
    }

    await handler(req, res);
    if (!res.finished) {
      await runHandler(index + 1);
    }
  }

  await runHandler(0);
  return res;
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  const releasedPassport = {
    id: 14,
    guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
    company_id: 5,
    passport_type: "battery",
    product_id: "BAT-2026-001",
    product_identifier_did: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
    release_status: "released",
    version_number: 2,
    updated_at: "2026-04-27T10:00:00.000Z",
    granularity: "item",
    manufacturer: "Acme Energy",
  };
  let editablePassport = {
    ...releasedPassport,
    id: 21,
    release_status: "draft",
    version_number: 3,
    manufacturer: "Draft Manufacturer",
  };
  const backupProviderService = {
    replicatePassportSnapshot: jest.fn(async () => ({ success: true, results: [] })),
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      if (String(sql).includes("SELECT economic_operator_identifier")) {
        return {
          rows: [{
            economic_operator_identifier: "did:web:www.example.test:did:company:5",
            economic_operator_identifier_scheme: "did",
          }],
        };
      }
      if (String(sql).includes("SELECT type_name, semantic_model_key, fields_json FROM passport_types")) {
        return {
          rows: [{
            type_name: "battery",
            semantic_model_key: "claros_battery_dictionary_v1",
            fields_json: {
              sections: [{
                fields: [
                  { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
                  { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                ],
              }],
            },
          }],
        };
      }
      if (String(sql).includes("SELECT type_name, semantic_model_key, fields_json FROM passport_types ORDER BY type_name")) {
        return {
          rows: [{
            type_name: "battery",
            semantic_model_key: "claros_battery_dictionary_v1",
            fields_json: {
              sections: [{
                fields: [
                  { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
                  { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                ],
              }],
            },
          }],
        };
      }
      if (String(sql).includes("INSERT INTO dpp_registry_registrations")) {
        return {
          rows: [{
            id: 1,
            passport_guid: releasedPassport.guid,
            company_id: releasedPassport.company_id,
            product_identifier: releasedPassport.product_identifier_did,
            dpp_id: "did:web:www.example.test:did:dpp:item:legacy",
            registry_name: "local",
            status: "registered",
            registered_at: "2026-04-27T11:00:00.000Z",
            updated_at: "2026-04-27T11:00:00.000Z",
          }],
        };
      }
      if (String(sql).includes("INSERT INTO battery_passports")) {
        editablePassport = {
          ...editablePassport,
          guid: params[0],
          lineage_id: params[1],
          company_id: params[2],
          model_name: params[3],
          product_id: params[4],
          product_identifier_did: params[5],
          compliance_profile_key: params[6],
          content_specification_ids: params[7],
          carrier_policy_key: params[8],
          economic_operator_id: params[9],
          facility_id: params[10],
          granularity: params[11],
          created_by: params[12],
          public_summary: params[13] || editablePassport.public_summary,
        };
        return { rows: [editablePassport] };
      }
      if (String(sql).includes("INSERT INTO passport_registry")) {
        return { rows: [] };
      }
      if (String(sql).includes("SET deleted_at = NOW()") && String(sql).includes("FROM battery_passports") === false) {
        return { rows: [{ guid: editablePassport.guid }] };
      }
      if (String(sql).includes("FROM battery_passports") && String(sql).includes("release_status IN ('draft', 'in_revision', 'revised')")) {
        return {
          rows: [editablePassport],
        };
      }
      if (String(sql).includes("UPDATE battery_passports")) {
        editablePassport = {
          ...editablePassport,
          manufacturer: params[0],
          updated_by: params[1],
        };
        return { rows: [] };
      }
      if (String(sql).includes("FROM battery_passports") && String(sql).includes("release_status IN ('released', 'obsolete')")) {
        return {
          rows: [releasedPassport],
        };
      }
      if (String(sql).includes("FROM passport_archives")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };

  registerDppApiRoutes(app, {
    pool,
    publicReadRateLimit: (_req, _res, next) => next(),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "company_admin" };
      next();
    },
    requireEditor: (_req, _res, next) => next(),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => row,
    normalizeProductIdValue: (value) => String(value || "").trim(),
    extractExplicitFacilityId,
    stripRestrictedFieldsForPublicView: async (passport) => passport,
    getCompanyNameMap: async () => new Map([["5", "Acme Energy"]]),
    resolveReleasedPassportByProductId: async (productId, { companyId = null } = {}) => {
      if (productId !== "BAT-2026-001" && productId !== releasedPassport.product_identifier_did) return null;
      if (companyId !== null && Number(companyId) !== 5) return null;
      return { passport: { ...releasedPassport } };
    },
    signingService: {},
    buildOperationalDppPayload: (passport) => ({
      digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
      uniqueProductIdentifier: passport.product_identifier_did,
      product_id: passport.product_id,
    }),
    buildCanonicalPassportPayload: (passport) => ({
      digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
      uniqueProductIdentifier: passport.product_identifier_did,
      subjectDid: "did:web:www.example.test:did:battery:item:legacy",
      dppDid: "did:web:www.example.test:did:dpp:item:legacy",
      companyDid: "did:web:www.example.test:did:company:5",
      contentSpecificationIds: ["claros_battery_dictionary_v1"],
      passportType: "battery",
      versionNumber: passport.version_number || 2,
      fields: {
        manufacturer: passport.manufacturer || "Acme Energy",
        public_summary: passport.public_summary || "Public battery summary",
      },
    }),
    buildPassportJsonLdContext: () => ({ "@vocab": "https://example.test/terms/" }),
    didService: {
      normalizeCompanySlug: (value) => value,
      normalizeStableId: (value) => value,
      normalizeGranularity: (value) => value,
    },
    dppIdentity: {
      buildCanonicalPublicUrl: () => "https://app.example.test/dpp/acme/battery/BAT-2026-001",
      companyDid: (companyId) => `did:web:www.example.test:did:company:${companyId}`,
      productModelDid: () => "did:web:www.example.test:did:battery:model:legacy",
      dppDid: () => "did:web:www.example.test:did:dpp:item:legacy",
      facilityDid: (facilityId) => `did:web:www.example.test:did:facility:${facilityId}`,
      platformDid: () => "did:web:www.example.test",
      parseDid: (value) => {
        if (value === "did:web:www.example.test:did:dpp:item:5:BAT-2026-001") {
          return { type: "dpp", granularity: "item", companyId: "5", productId: "BAT-2026-001" };
        }
        return null;
      },
      didToDocumentUrl: () => null,
    },
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: `did:web:www.example.test:did:battery:item:c5-${String(rawProductId).toLowerCase()}`,
      }),
      buildLookupCandidates: ({ productId }) => [productId, releasedPassport.product_identifier_did],
    },
    updatePassportRowById: async ({ data }) => {
      editablePassport = { ...editablePassport, ...data };
      return Object.keys(data);
    },
    isEditablePassportStatus: (status) => ["draft", "in_revision", "revised"].includes(status),
    logAudit: jest.fn(async () => {}),
    accessRightsService: {
      canReadElement: jest.fn(async ({ user, elementIdPath }) => {
        if (elementIdPath === "manufacturer" && !user) {
          return {
            allowed: false,
            audiences: ["notified_bodies"],
            confidentiality: "regulated",
          };
        }
        return {
          allowed: true,
          matchedAudience: user ? "notified_bodies" : "public",
          audiences: elementIdPath === "manufacturer" ? ["notified_bodies"] : ["public"],
          confidentiality: elementIdPath === "manufacturer" ? "regulated" : "public",
        };
      }),
      canWriteElement: jest.fn(async () => ({
        allowed: true,
        matchedAuthority: "economic_operator",
        updateAuthority: ["economic_operator"],
        confidentiality: "regulated",
      })),
    },
    normalizePassportRequestBody: (body) => body,
    SYSTEM_PASSPORT_FIELDS: new Set([
      "company_id",
      "created_by",
      "guid",
      "lineage_id",
      "release_status",
      "version_number",
    ]),
    getWritablePassportColumns: (data) => Object.keys(data || {}),
    toStoredPassportValue: (value) => value,
    getPassportTypeSchema: async () => ({
      typeName: "battery",
      allowedKeys: new Set(["manufacturer", "public_summary"]),
    }),
    findExistingPassportByProductId: async () => null,
    complianceService: {
      loadPassportTypeDefinition: async () => ({
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [{
            fields: [
              { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
              { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
            ],
          }],
        },
      }),
      resolveProfileMetadata: () => ({
        key: "battery_dpp_v1",
        contentSpecificationIds: ["claros_battery_dictionary_v1"],
        defaultCarrierPolicyKey: "battery_qr_public_entry_v1",
      }),
    },
    backupProviderService,
  });

  return app;
}

describe("DPP standards API", () => {
  test("POST /api/v1/dpps creates an editable passport in the standards namespace", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dpps",
      body: {
        passportType: "battery",
        productId: "BAT-NEW-001",
        public_summary: "Fresh battery passport",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.passport.uniqueProductIdentifier).toContain("bat-new-001");
  });

  test("POST /api/v1/dppsByProductIds returns batch lookup results", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dppsByProductIds",
      body: {
        productIdentifiers: ["BAT-2026-001", "UNKNOWN-001"],
        representation: "compressed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0]).toMatchObject({
      productIdentifier: "BAT-2026-001",
      found: true,
    });
    expect(response.body.results[1]).toMatchObject({
      productIdentifier: "UNKNOWN-001",
      found: false,
      error: "NOT_FOUND",
    });
  });

  test("POST /api/v1/registerDPP registers an existing released passport", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/registerDPP",
      body: {
        productIdentifier: "BAT-2026-001",
        registryName: "local",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.registration).toMatchObject({
      company_id: 5,
      registry_name: "local",
      status: "registered",
    });
    expect(response.body.payload).toMatchObject({
      digitalProductPassportId: "did:web:www.example.test:did:dpp:item:legacy",
      uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
    });
  });

  test("POST /api/v1/dppIdsByProductIds returns DPP identifiers", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dppIdsByProductIds",
      body: {
        productIdentifiers: ["BAT-2026-001"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.results[0]).toMatchObject({
      productIdentifier: "BAT-2026-001",
      found: true,
      dppId: "did:web:www.example.test:did:dpp:item:legacy",
    });
  });

  test("PATCH /api/v1/dpps/:productIdentifier/elements/:elementIdPath updates an editable field", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:productIdentifier/elements/:elementIdPath",
      params: {
        productIdentifier: "BAT-2026-001",
        elementIdPath: "manufacturer",
      },
      body: {
        value: "Updated Manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "manufacturer",
      dictionaryReference: "urn:test:manufacturer",
      value: "Updated Manufacturer",
    });
  });

  test("PATCH /api/v1/dpps/:dppId updates an editable passport revision", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "did:web:www.example.test:did:dpp:item:5:BAT-2026-001",
      },
      body: {
        manufacturer: "Whole Passport Update",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.updatedFields).toContain("manufacturer");
    expect(response.body.passport.fields.manufacturer).toBe("Whole Passport Update");
  });

  test("DELETE /api/v1/dpps/:dppId deletes an editable passport revision", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "delete",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "did:web:www.example.test:did:dpp:item:5:BAT-2026-001",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      dppId: "did:web:www.example.test:did:dpp:item:5:BAT-2026-001",
    });
  });

  test("GET /api/v1/dpps/:productIdentifier/elements/:elementIdPath blocks public reads for restricted elements", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:productIdentifier/elements/:elementIdPath",
      params: {
        productIdentifier: "BAT-2026-001",
        elementIdPath: "manufacturer",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({
      error: "DATA_ELEMENT_RESTRICTED",
      audiences: ["notified_bodies"],
    });
  });

  test("GET /api/v1/dpps/:productIdentifier/elements/:elementIdPath/authorized returns restricted elements for authorized users", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:productIdentifier/elements/:elementIdPath/authorized",
      params: {
        productIdentifier: "BAT-2026-001",
        elementIdPath: "manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "manufacturer",
      value: "Acme Energy",
      access: {
        audience: "notified_bodies",
        confidentiality: "regulated",
      },
    });
  });
});
