"use strict";

const express = require("express");

const registerDppApiRoutes = require("../routes/dpp-api");
const { extractExplicitFacilityId, normalizePassportRequestBody } = require("../helpers/passport-helpers");

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

function buildActualPath(path, params) {
  return String(path).replace(/:([A-Za-z0-9_]+)/g, (_, key) => String(params[key] ?? ""));
}

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {}, headers = {} }) {
  const actualPath = buildActualPath(path, params);
  const handlers = [];
  for (const layer of app._router?.stack || []) {
    if (layer.route) {
      if (layer.route.path === path && layer.route.methods?.[method]) {
        handlers.push(...layer.route.stack.map((entry) => entry.handle));
      }
      continue;
    }
    if (["query", "expressInit", "jsonParser"].includes(layer.name)) continue;
    if (typeof layer.match === "function" && layer.match(actualPath)) {
      handlers.push(layer.handle);
    }
  }
  if (!handlers.length) {
    findRouteLayer(app, method, path);
  }
  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers,
    path: actualPath,
    originalUrl: actualPath,
    url: actualPath,
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

function expectStandardError(response, {
  httpStatus,
  statusCode,
  error,
  text,
  code,
  detail,
  extra = {},
}) {
  expect(response.statusCode).toBe(httpStatus);
  expect(response.headers["x-correlation-id"]).toEqual(expect.any(String));
  expect(response.body).toMatchObject({
    statusCode,
    error,
    ...extra,
  });
  if (detail !== undefined) {
    expect(response.body.detail).toBe(detail);
  }
  expect(Array.isArray(response.body.message)).toBe(true);
  expect(response.body.message).toHaveLength(1);
  expect(response.body.message[0]).toMatchObject({
    messageType: "Error",
    text,
    code,
    correlationId: response.headers["x-correlation-id"],
  });
  expect(response.body.message[0].timestamp).toEqual(expect.any(String));
}

function createTestApp(options = {}) {
  const app = express();
  app.use(express.json({ type: ["application/json", "application/merge-patch+json"] }));

  let releasedPassport = {
    id: 14,
    dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    dpp_id: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    lineage_id: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    company_id: 5,
    passport_type: "battery",
    product_id: "BAT-2026-001",
    product_identifier_did: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
    release_status: options.releasedStatus || "released",
    version_number: 2,
    updated_at: "2026-04-27T10:00:00.000Z",
    granularity: "item",
    manufacturer: "Acme Energy",
    battery_profile: {
      chemistry: {
        code: "LFP",
        display: "Lithium Iron Phosphate",
      },
      modules: [
        { massKg: 10, supplier: { name: "ModuleCo" } },
      ],
    },
  };
  let editablePassport = options.includeEditable === false
    ? null
    : {
        ...releasedPassport,
        id: 21,
        release_status: options.editableStatus || "draft",
        version_number: 3,
        manufacturer: "Draft Manufacturer",
      };
  const identifierLineage = [{
    id: 1,
    companyId: 5,
    lineageId: releasedPassport.lineage_id,
    previousDppId: "dpp_legacy_model",
    replacementDppId: releasedPassport.dppId,
    previousIdentifier: "did:web:www.example.test:did:battery:model:c5-bat-2026-001-abcdef123456",
    replacementIdentifier: releasedPassport.product_identifier_did,
    previousLocalProductId: "BAT-2026-001",
    replacementLocalProductId: "BAT-2026-001",
    previousGranularity: "model",
    replacementGranularity: "item",
    transitionReason: "granularity_change",
    createdAt: "2026-04-29T12:00:00.000Z",
  }];
  const backupProviderService = {
    replicatePassportSnapshot: jest.fn(async () => ({ success: true, results: [] })),
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const normalizedSql = String(sql)
        .replace(/\bpassport_dpp_id\b/g, "passport_guid")
        .replace(/\bdpp_id\b/g, "guid");

      if (normalizedSql.includes("SELECT economic_operator_identifier")) {
        return {
          rows: [{
            economic_operator_identifier: "did:web:www.example.test:did:company:5",
            economic_operator_identifier_scheme: "did",
          }],
        };
      }
      if (normalizedSql.includes("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types")) {
        return {
          rows: [{
            type_name: "battery",
            umbrella_category: "Battery Digital Passport",
            semantic_model_key: "claros_battery_dictionary_v1",
            fields_json: {
              sections: [{
                fields: [
                  { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
                  { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                  { key: "battery_profile", type: "textarea", semanticId: "urn:test:battery-profile", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                ],
              }],
            },
          }],
        };
      }
      if (normalizedSql.includes("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name")) {
        return {
          rows: [{
            type_name: "battery",
            umbrella_category: "Battery Digital Passport",
            semantic_model_key: "claros_battery_dictionary_v1",
            fields_json: {
              sections: [{
                fields: [
                  { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
                  { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                  { key: "battery_profile", type: "textarea", semanticId: "urn:test:battery-profile", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
                ],
              }],
            },
          }],
        };
      }
      if (normalizedSql.includes("INSERT INTO dpp_registry_registrations")) {
        return {
          rows: [{
            id: 1,
            passport_dpp_id: releasedPassport.dppId,
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
      if (normalizedSql.includes("INSERT INTO battery_passports")) {
        editablePassport = {
          ...editablePassport,
          dppId: params[0],
          dpp_id: params[0],
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
      if (normalizedSql.includes("INSERT INTO passport_registry")) {
        return { rows: [] };
      }
      if (normalizedSql.includes("SELECT *") && normalizedSql.includes("FROM battery_passports") && normalizedSql.includes("WHERE lineage_id = $1") && normalizedSql.includes("company_id = $2") && normalizedSql.includes("deleted_at IS NULL")) {
        return {
          rows: [releasedPassport, editablePassport].filter(Boolean),
        };
      }
      if (
        normalizedSql.includes("SET deleted_at = NOW()")
        && normalizedSql.includes("WHERE guid = $1")
        && normalizedSql.includes("release_status IN ('draft', 'in_revision', 'revised')")
      ) {
        return { rows: editablePassport ? [{ dpp_id: editablePassport.dppId }] : [] };
      }
      if (normalizedSql.includes("FROM battery_passports") && normalizedSql.includes("release_status IN ('draft', 'in_revision', 'revised')")) {
        return {
          rows: editablePassport && ["draft", "in_revision", "revised"].includes(editablePassport.release_status)
            ? [editablePassport]
            : [],
        };
      }
      if (normalizedSql.includes("INSERT INTO passport_archives")) {
        return { rows: [] };
      }
      if (normalizedSql.includes("UPDATE battery_passports")) {
        if (normalizedSql.includes("WHERE lineage_id = $1")) {
          releasedPassport = { ...releasedPassport, deleted_at: "2026-04-29T12:00:00.000Z" };
          if (editablePassport) {
            editablePassport = { ...editablePassport, deleted_at: "2026-04-29T12:00:00.000Z" };
          }
        } else if (editablePassport) {
          editablePassport = {
            ...editablePassport,
            manufacturer: params[0],
            updated_by: params[1],
          };
        }
        return { rows: [] };
      }
      if (normalizedSql.includes("FROM battery_passports") && normalizedSql.includes("release_status IN ('released', 'obsolete')")) {
        return {
          rows: releasedPassport && !releasedPassport.deleted_at ? [releasedPassport] : [],
        };
      }
      if (
        String(sql).includes("FROM battery_passports")
        && String(sql).includes("WHERE (lineage_id = $1 OR dpp_id::text = $1)")
        && String(sql).includes("release_status = 'released'")
      ) {
        const requestedId = params[0];
        return {
          rows: releasedPassport && !releasedPassport.deleted_at && (
            requestedId === releasedPassport.dppId || requestedId === releasedPassport.lineage_id
          ) ? [releasedPassport] : [],
        };
      }
      if (normalizedSql.includes("FROM passport_archives")) {
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
    resolveReleasedPassportByProductId: async (productId, { companyId = null, strictProductId = false } = {}) => {
      if (strictProductId && productId === releasedPassport.product_identifier_did) return null;
      if (productId !== "BAT-2026-001" && productId !== releasedPassport.product_identifier_did) return null;
      if (companyId !== null && Number(companyId) !== 5) return null;
      return { passport: { ...releasedPassport } };
    },
    signingService: {},
    buildOperationalDppPayload: (passport) => ({
      digitalProductPassportId: passport.dppId,
      uniqueProductIdentifier: passport.product_identifier_did || passport.product_id,
      localProductId: passport.product_id,
      product_id: passport.product_id,
    }),
    buildCanonicalPassportPayload: (passport) => ({
      digitalProductPassportId: passport.dppId,
      uniqueProductIdentifier: passport.product_identifier_did || passport.product_id,
      localProductId: passport.product_id,
      subjectDid: "did:web:www.example.test:did:battery:item:legacy",
      dppDid: "did:web:www.example.test:did:dpp:item:legacy",
      companyDid: "did:web:www.example.test:did:company:5",
      contentSpecificationIds: ["claros_battery_dictionary_v1"],
      lastUpdated: passport.updated_at || passport.created_at || "2026-04-27T10:00:00.000Z",
      extensions: {
        claros: {
          passportType: "battery",
          versionNumber: passport.version_number || 2,
          internalId: passport.dppId,
        },
      },
      fields: {
        manufacturer: passport.manufacturer || "Acme Energy",
        public_summary: passport.public_summary || "Public battery summary",
        battery_profile: passport.battery_profile || {
          chemistry: {
            code: "LFP",
            display: "Lithium Iron Phosphate",
          },
          modules: [
            { massKg: 10, supplier: { name: "ModuleCo" } },
          ],
        },
      },
    }),
    buildExpandedPassportPayload: (passport) => ({
      digitalProductPassportId: passport.dppId,
      uniqueProductIdentifier: passport.product_identifier_did || passport.product_id,
      localProductId: passport.product_id,
      subjectDid: "did:web:www.example.test:did:battery:item:legacy",
      dppDid: "did:web:www.example.test:did:dpp:item:legacy",
      companyDid: "did:web:www.example.test:did:company:5",
      contentSpecificationIds: ["claros_battery_dictionary_v1"],
      lastUpdated: passport.updated_at || passport.created_at || "2026-04-27T10:00:00.000Z",
      extensions: {
        claros: {
          passportType: "battery",
          versionNumber: passport.version_number || 2,
          internalId: passport.dppId,
        },
      },
      elements: [
        {
          elementId: "manufacturer",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "urn:test:manufacturer",
          valueDataType: "String",
          value: passport.manufacturer || "Acme Energy",
          elements: [],
        },
        {
          elementId: "public_summary",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "urn:test:public-summary",
          valueDataType: "String",
          value: passport.public_summary || "Public battery summary",
          elements: [],
        },
        {
          elementId: "battery_profile",
          objectType: "DataElementCollection",
          dictionaryReference: "urn:test:battery-profile",
          valueDataType: "Object",
          value: passport.battery_profile || {
            chemistry: {
              code: "LFP",
              display: "Lithium Iron Phosphate",
            },
            modules: [
              { massKg: 10, supplier: { name: "ModuleCo" } },
            ],
          },
          elements: [],
        },
      ],
    }),
    buildExpandedDataElement: ({ elementIdPath, value, fieldDef }) => ({
      elementId: fieldDef?.elementId || fieldDef?.key || elementIdPath,
      objectType: Array.isArray(value)
        ? "MultiValuedDataElement"
        : value && typeof value === "object"
          ? "DataElementCollection"
          : "SingleValuedDataElement",
      dictionaryReference: fieldDef?.semanticId || fieldDef?.semantic_id || null,
      valueDataType: Array.isArray(value)
        ? "Array"
        : value && typeof value === "object"
          ? "Object"
          : "String",
      value,
      elements: [],
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
        if (value === "dpp_72b99c83-952c-4179-96f6-54a513d39dbc") {
          return { type: "dpp", granularity: "item", companyId: "5", productId: "BAT-2026-001" };
        }
        return null;
      },
      didToDocumentUrl: () => null,
    },
    productIdentifierService: {
      isDidIdentifier: (value) => String(value || "").startsWith("did:"),
      normalizeProductIdentifiers: ({ rawProductId, uniqueProductIdentifier }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: uniqueProductIdentifier || `did:web:www.example.test:did:battery:item:c5-${String(rawProductId).toLowerCase()}`,
      }),
      buildLookupCandidates: ({ productId }) => [productId, releasedPassport.product_identifier_did],
      listIdentifierLineage: jest.fn(async () => identifierLineage),
    },
    archivePassportSnapshot: jest.fn(async () => {}),
    updatePassportRowById: async ({ data, includeUpdatedRow }) => {
      editablePassport = { ...editablePassport, ...data };
      if (includeUpdatedRow) {
        return {
          updateCols: Object.keys(data),
          updatedRow: { ...editablePassport },
        };
      }
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
    normalizePassportRequestBody,
    SYSTEM_PASSPORT_FIELDS: new Set([
      "company_id",
      "created_by",
      "dpp_id",
      "dppId",
      "lineage_id",
      "release_status",
      "version_number",
    ]),
    getWritablePassportColumns: (data) => Object.keys(data || {}),
    toStoredPassportValue: (value) => value,
    getPassportTypeSchema: async () => ({
      typeName: "battery",
      allowedKeys: new Set(["manufacturer", "public_summary", "battery_profile"]),
    }),
    findExistingPassportByProductId: async () => null,
    complianceService: {
      loadPassportTypeDefinition: async () => ({
        type_name: "battery",
        umbrella_category: "Battery Digital Passport",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [{
            fields: [
              { key: "manufacturer", type: "text", semanticId: "urn:test:manufacturer", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator"] },
              { key: "public_summary", type: "text", semanticId: "urn:test:public-summary", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
              { key: "battery_profile", type: "textarea", semanticId: "urn:test:battery-profile", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
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
    expect(response.body.digitalProductPassportId).toMatch(/^dpp_[0-9a-f-]{36}$/i);
    expect(response.body.dppId).toBe(response.body.digitalProductPassportId);
    expect(response.body.passport.digitalProductPassportId).toBe(response.body.digitalProductPassportId);
    expect(response.body.passport.uniqueProductIdentifier).toMatch(/^did:/);
    expect(response.body.passport.localProductId).toBe("BAT-NEW-001");
  });

  test("POST /api/v1/dpps returns expanded elements when representation=expanded is requested", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dpps",
      query: {
        representation: "expanded",
      },
      body: {
        passportType: "battery",
        productId: "BAT-NEW-002",
        public_summary: "Expanded battery passport",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.passport.fields).toBeUndefined();
    expect(response.body.passport.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "public_summary",
          objectType: "SingleValuedDataElement",
        }),
      ])
    );
  });

  test("POST /api/v1/dpps accepts explicit localProductId and uniqueProductIdentifier", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dpps",
      body: {
        passportType: "battery",
        localProductId: "BAT-NEW-003",
        uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-new-003-explicit",
        public_summary: "Explicit identifier battery passport",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.passport).toMatchObject({
      uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-new-003-explicit",
      localProductId: "BAT-NEW-003",
    });
  });

  test("POST /api/v1/dpps rejects non-DID uniqueProductIdentifier values", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dpps",
      body: {
        passportType: "battery",
        localProductId: "BAT-NEW-004",
        uniqueProductIdentifier: "BAT-NEW-004",
      },
    });

    expectStandardError(response, {
      httpStatus: 400,
      statusCode: "ClientErrorBadRequest",
      error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme",
      text: "uniqueProductIdentifier must use the configured global DID-based identifier scheme",
      code: "400",
    });
  });

  test("GET /api/v1/dppsByProductId/:productId returns the current released passport by productId", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dppsByProductId/:productId",
      params: {
        productId: "BAT-2026-001",
      },
      query: {
        representation: "expanded",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.fields).toBeUndefined();
    expect(response.body.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "manufacturer",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "urn:test:manufacturer",
          valueDataType: "String",
          value: "Acme Energy",
          elements: [],
        }),
      ])
    );
  });

  test("GET /api/v1/dppsByProductId/:productId still accepts representation=full as a backwards-compatible alias", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dppsByProductId/:productId",
      params: {
        productId: "BAT-2026-001",
      },
      query: {
        representation: "full",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.fields).toBeUndefined();
    expect(response.body.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "manufacturer",
          objectType: "SingleValuedDataElement",
        }),
      ])
    );
  });

  test("GET /api/v1/dppsByProductId/:productId only resolves raw productId values", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dppsByProductId/:productId",
      params: {
        productId: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
      },
    });

    expectStandardError(response, {
      httpStatus: 404,
      statusCode: "ClientErrorResourceNotFound",
      error: "Passport not found or not released",
      text: "Passport not found or not released",
      code: "404",
    });
  });

  test("GET /api/v1/dppsByProductIdAndDate/:productId returns the released passport version for the requested date", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dppsByProductIdAndDate/:productId",
      params: {
        productId: "BAT-2026-001",
      },
      query: {
        date: "2026-04-28T00:00:00.000Z",
        representation: "expanded",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      statusCode: "Success",
      digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
      localProductId: "BAT-2026-001",
    });
    expect(response.body.fields).toBeUndefined();
    expect(response.body.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "manufacturer",
          objectType: "SingleValuedDataElement",
          value: "Acme Energy",
        }),
      ])
    );
  });

  test("GET /api/v1/dppsByProductIdAndDate/:productId only resolves raw productId values", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dppsByProductIdAndDate/:productId",
      params: {
        productId: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
      },
      query: {
        date: "2026-04-28T00:00:00.000Z",
      },
    });

    expectStandardError(response, {
      httpStatus: 404,
      statusCode: "ClientErrorResourceNotFound",
      error: "Passport not found for the requested date",
      text: "Passport not found for the requested date",
      code: "404",
    });
  });

  test("removes the old product lookup GET routes", () => {
    const app = createTestApp();

    expect(() => findRouteLayer(app, "get", "/api/dpp/by-product/:productId")).toThrow(
      "Route not found for GET /api/dpp/by-product/:productId"
    );
    expect(() => findRouteLayer(app, "get", "/api/dpp/:companyId/:productId")).toThrow(
      "Route not found for GET /api/dpp/:companyId/:productId"
    );
    expect(() => findRouteLayer(app, "get", "/api/v1/dpps/:productIdentifier")).toThrow(
      "Route not found for GET /api/v1/dpps/:productIdentifier"
    );
    expect(findRouteLayer(app, "get", "/api/v1/dppsByProductId/:productId").length).toBeGreaterThan(0);
    expect(findRouteLayer(app, "get", "/api/v1/dppsByProductIdAndDate/:productId").length).toBeGreaterThan(0);
  });

  test("removes the old /api/v1/dppsByIdAndDate/:dppId route", () => {
    const app = createTestApp();

    expect(() => findRouteLayer(app, "get", "/api/v1/dppsByIdAndDate/:dppId")).toThrow(
      "Route not found for GET /api/v1/dppsByIdAndDate/:dppId"
    );
    expect(findRouteLayer(app, "get", "/api/v1/dppsByProductIdAndDate/:productId").length).toBeGreaterThan(0);
  });

  test("POST /api/v1/dppsByProductIds returns paged DPP identifiers for productId input", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dppsByProductIds",
      body: {
        productId: ["BAT-2026-001", "UNKNOWN-001"],
        limit: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      statusCode: "Success",
      identifiers: ["dpp_72b99c83-952c-4179-96f6-54a513d39dbc"],
      limit: 1,
      cursor: null,
      nextCursor: expect.any(String),
    });
  });

  test("POST /api/v1/dppsByProductIds supports cursor pagination", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dppsByProductIds",
      body: {
        productId: ["BAT-2026-001", "UNKNOWN-001"],
        limit: 1,
        cursor: Buffer.from(JSON.stringify({ offset: 1 }), "utf8").toString("base64url"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      statusCode: "Success",
      identifiers: [],
      limit: 1,
      nextCursor: null,
    });
  });

  test("POST /api/v1/dppsByProductIds/search returns batch lookup payload results as an extension", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dppsByProductIds/search",
      body: {
        productId: ["BAT-2026-001", "UNKNOWN-001"],
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

  test("removes the old /api/v1/dppIdsByProductIds route", () => {
    const app = createTestApp();

    expect(() => findRouteLayer(app, "post", "/api/v1/dppIdsByProductIds")).toThrow(
      "Route not found for POST /api/v1/dppIdsByProductIds"
    );
    expect(findRouteLayer(app, "post", "/api/v1/dppsByProductIds").length).toBeGreaterThan(0);
    expect(findRouteLayer(app, "post", "/api/v1/dppsByProductIds/search").length).toBeGreaterThan(0);
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
    expect(response.body.statusCode).toBe("SuccessCreated");
    expect(response.body.registrationId).toBe("local:1");
    expect(response.body.success).toBe(true);
    expect(response.body.registration).toMatchObject({
      id: 1,
      company_id: 5,
      registry_name: "local",
      status: "registered",
    });
    expect(response.body.payload).toMatchObject({
      digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
      localProductId: "BAT-2026-001",
    });
  });

  test("PATCH /api/v1/dpps/:dppId/elements/:elementIdPath updates an editable field with a simple value body", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "manufacturer",
      },
      body: {
        value: "Updated Manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "manufacturer",
      elementId: "manufacturer",
      objectType: "SingleValuedDataElement",
      dictionaryReference: "urn:test:manufacturer",
      valueDataType: "String",
      value: "Updated Manufacturer",
      elements: [],
    });
  });

  test("PATCH /api/v1/dpps/:dppId/elements/:elementIdPath accepts a DataElement-style body", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "manufacturer",
      },
      body: {
        elementId: "manufacturer",
        dictionaryReference: "urn:test:manufacturer",
        valueDataType: "String",
        value: "Structured Update",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "manufacturer",
      elementId: "manufacturer",
      objectType: "SingleValuedDataElement",
      dictionaryReference: "urn:test:manufacturer",
      valueDataType: "String",
      value: "Structured Update",
      elements: [],
    });
  });

  test("PATCH /api/v1/dpps/:dppId/elements/:elementIdPath updates a nested structured element path", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "battery_profile.modules[0].massKg",
      },
      body: {
        value: 11.5,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "battery_profile.modules[0].massKg",
      elementId: "massKg",
      objectType: "SingleValuedDataElement",
      valueDataType: "String",
      value: 11.5,
      elements: [],
    });
  });

  test("PATCH /api/v1/dpps/:dppId/elements/:elementIdPath rejects mismatched DataElement metadata", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "manufacturer",
      },
      body: {
        elementId: "batteryMass",
        dictionaryReference: "urn:test:manufacturer",
        value: "Bad Update",
      },
    });

    expectStandardError(response, {
      httpStatus: 400,
      statusCode: "ClientErrorBadRequest",
      error: "elementId does not match the target elementIdPath",
      text: "elementId does not match the target elementIdPath",
      code: "400",
    });
  });

  test("PATCH /api/v1/dpps/:dppId updates an editable passport revision", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      body: {
        manufacturer: "Whole Passport Update",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.dppId).toBe("dpp_72b99c83-952c-4179-96f6-54a513d39dbc");
    expect(response.body.digitalProductPassportId).toBe("dpp_72b99c83-952c-4179-96f6-54a513d39dbc");
    expect(response.body.updatedFields).toContain("manufacturer");
    expect(response.body.passport.fields.manufacturer).toBe("Whole Passport Update");
  });

  test("PATCH /api/v1/dpps/:dppId rejects in-place granularity changes", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      body: {
        granularity: "model",
      },
    });

    expectStandardError(response, {
      httpStatus: 409,
      statusCode: "ClientResourceConflict",
      error: "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER",
      text: "Released DPP granularity cannot be changed in place. Create a linked successor identifier instead.",
      code: "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER",
      detail: "Released DPP granularity cannot be changed in place. Create a linked successor identifier instead.",
      extra: {
        currentGranularity: "item",
        requestedGranularity: "model",
      },
    });
  });

  test("PATCH /api/v1/dpps/:dppId returns expanded elements when representation=full is requested", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      query: {
        representation: "full",
      },
      body: {
        manufacturer: "Whole Passport Update",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.passport.fields).toBeUndefined();
    expect(response.body.passport.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "manufacturer",
          objectType: "SingleValuedDataElement",
          value: "Whole Passport Update",
        }),
      ])
    );
  });

  test("PATCH /api/v1/dpps/:dppId advertises and accepts JSON Merge Patch", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      headers: {
        "content-type": "application/merge-patch+json",
      },
      body: {
        manufacturer: "Merge Patch Manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["accept-patch"]).toBe("application/merge-patch+json, application/json");
    expect(response.body.passport.fields.manufacturer).toBe("Merge Patch Manufacturer");
  });

  test("PATCH /api/v1/dpps/:dppId rejects unsupported patch content types", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
      headers: {
        "content-type": "application/xml",
      },
      body: {
        manufacturer: "Nope",
      },
    });

    expect(response.headers["accept-patch"]).toBe("application/merge-patch+json, application/json");
    expectStandardError(response, {
      httpStatus: 415,
      statusCode: "ClientErrorBadRequest",
      error: "Unsupported Media Type",
      text: "Unsupported Media Type",
      code: "415",
      extra: {
        supportedContentTypes: ["application/json", "application/merge-patch+json"],
      },
    });
  });

  test("OPTIONS /api/v1/dpps/:dppId advertises JSON Merge Patch support", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "options",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["accept-patch"]).toBe("application/merge-patch+json, application/json");
    expect(response.headers.allow).toBe("PATCH, DELETE, OPTIONS");
  });

  test("DELETE /api/v1/dpps/:dppId deletes an editable passport revision", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "delete",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    });
  });

  test("DELETE /api/v1/dpps/:dppId refuses to delete a released DPP and points clients to archive", async () => {
    const app = createTestApp({ includeEditable: false });

    const response = await invokeRoute(app, {
      method: "delete",
      path: "/api/v1/dpps/:dppId",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
    });

    expectStandardError(response, {
      httpStatus: 409,
      statusCode: "ClientResourceConflict",
      error: "RELEASED_DPP_REQUIRES_ARCHIVE",
      text: "Released DPPs must use the archive lifecycle action instead of DELETE.",
      code: "RELEASED_DPP_REQUIRES_ARCHIVE",
      detail: "Released DPPs must use the archive lifecycle action instead of DELETE.",
      extra: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        archiveEndpoint: "/api/v1/dpps/dpp_72b99c83-952c-4179-96f6-54a513d39dbc/archive",
      },
    });
  });

  test("GET /api/v1/dpps/:dppId/identifier-lineage returns linked predecessor and successor identifiers", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/identifier-lineage",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      statusCode: "Success",
      dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      uniqueProductIdentifier: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
      localProductId: "BAT-2026-001",
      granularity: "item",
      identifierLineage: [
        expect.objectContaining({
          previousGranularity: "model",
          replacementGranularity: "item",
          replacementDppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        }),
      ],
    });
  });

  test("POST /api/v1/dpps/:dppId/archive archives a released DPP lineage", async () => {
    const app = createTestApp({ includeEditable: false });

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/v1/dpps/:dppId/archive",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      lifecycleAction: "archive",
      lifecycleStatus: "Archived",
      versionsArchived: 1,
      dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
      digitalProductPassportId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    });
  });

  test("GET /api/v1/dpps/:dppId/elements/:elementIdPath blocks public reads for restricted elements", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "manufacturer",
      },
    });

    expectStandardError(response, {
      httpStatus: 403,
      statusCode: "ClientForbidden",
      error: "DATA_ELEMENT_RESTRICTED",
      text: "You are not allowed to perform this action.",
      code: "DATA_ELEMENT_RESTRICTED",
      extra: {
        audiences: ["notified_bodies"],
      },
    });
  });

  test("GET /api/v1/dpps/:dppId/elements/:elementIdPath supports a simple JSONPath-style field path", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "$.fields.public_summary",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "public_summary",
      elementId: "public_summary",
      objectType: "SingleValuedDataElement",
      dictionaryReference: "urn:test:public-summary",
      valueDataType: "String",
      value: "Public battery summary",
      elements: [],
    });
  });

  test("GET /api/v1/dpps/:dppId/elements/:elementIdPath reads a nested structured element path", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "$.fields.battery_profile.chemistry.code",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "battery_profile.chemistry.code",
      elementId: "code",
      objectType: "SingleValuedDataElement",
      valueDataType: "String",
      value: "LFP",
      elements: [],
    });
  });

  test("GET /api/v1/dpps/:dppId/elements/:elementIdPath/authorized returns restricted elements for authorized users", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath/authorized",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      elementIdPath: "manufacturer",
      elementId: "manufacturer",
      objectType: "SingleValuedDataElement",
      dictionaryReference: "urn:test:manufacturer",
      valueDataType: "String",
      value: "Acme Energy",
      elements: [],
      access: {
        audience: "notified_bodies",
        confidentiality: "regulated",
      },
    });
  });

  test("GET /api/v1/dpps/:dppId/elements/:elementIdPath rejects unsupported JSONPath features", async () => {
    const app = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/v1/dpps/:dppId/elements/:elementIdPath",
      params: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        elementIdPath: "$..manufacturer",
      },
    });

    expectStandardError(response, {
      httpStatus: 400,
      statusCode: "ClientErrorBadRequest",
      error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported",
      text: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported",
      code: "400",
    });
  });
});
