"use strict";

const express = require("express");

const registerPassportPublicRoutes = require("../routes/passport-public");
const createDidService = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");

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

  const didService = createDidService({
    didDomain: "www.claros-dpp.online",
    publicOrigin: "https://www.claros-dpp.online",
    apiOrigin: "https://api.claros.test",
  });
  const serializer = createCanonicalPassportSerializer({ didService });

  const passport = {
    guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
    lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
    company_id: 5,
    passport_type: "battery",
    product_id: "BAT-2026-001",
    product_identifier_did: "did:web:www.claros-dpp.online:did:battery:item:c5-bat-2026-001-abcdef123456",
    release_status: "released",
    version_number: 2,
    updated_at: "2026-04-27T10:00:00.000Z",
    granularity: "item",
    battery_mass: "450",
  };

  const typeDef = {
    type_name: "battery",
    umbrella_category: "Battery Digital Passport",
    semantic_model_key: "claros_battery_dictionary_v1",
    fields_json: {
      sections: [
        {
          fields: [
            { key: "battery_mass", dataType: "number", elementId: "batteryMass" },
          ],
        },
      ],
    },
  };

  const company = {
    id: 5,
    company_name: "Acme Energy",
    did_slug: "acme-energy",
    dpp_granularity: "item",
    default_granularity: "item",
    jsonld_export_enabled: true,
    is_active: true,
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      if (String(sql).includes("FROM passport_types") && params[0] === "battery") {
        return { rows: [typeDef] };
      }
      if (String(sql).includes("FROM companies c") && params[0] === 5) {
        return { rows: [company] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };

  registerPassportPublicRoutes(app, {
    pool,
    crypto: require("crypto"),
    publicReadRateLimit: (_req, _res, next) => next(),
    publicUnlockRateLimit: (_req, _res, next) => next(),
    getTable: (passportType) => `${passportType}_passports`,
    normalizePassportRow: (row) => row,
    normalizeProductIdValue: (value) => String(value || "").trim(),
    buildCurrentPublicPassportPath: () => "/passport/acme-energy/bat-2026-001",
    buildInactivePublicPassportPath: () => "/passport/acme-energy/bat-2026-001/v/2",
    stripRestrictedFieldsForPublicView: async (row) => row,
    getCompanyNameMap: async () => new Map([["5", "Acme Energy"]]),
    resolveReleasedPassportByProductId: async () => ({ passport }),
    resolvePublicPassportByDppId: async (dppId) => {
      if (dppId !== passport.guid) return null;
      return { passport };
    },
    buildPassportVersionHistory: async () => ({ versions: [] }),
    resolvePublicPathToSubjects: async () => null,
    verifyPassportSignature: async () => ({ status: "unsigned" }),
    buildJsonLdContext: () => [],
    buildBatteryPassJsonExport: (passports) => ({
      "@context": [{}],
      "@graph": passports,
    }),
    buildCanonicalPassportPayload: serializer.buildCanonicalPassportPayload,
    buildExpandedPassportPayload: serializer.buildExpandedPassportPayload,
    signingService: {
      getSigningKey: () => null,
    },
    didService,
  });

  return { app, passport };
}

describe("passport public routes", () => {
  test("GET /api/passports/:dppId/canonical keeps compressed payloads by default", async () => {
    const { app, passport } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/passports/:dppId/canonical",
      params: { dppId: passport.guid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.fields).toEqual(
      expect.objectContaining({
        battery_mass: 450,
      })
    );
    expect(response.body.elements).toBeUndefined();
  });

  test("GET /api/passports/:dppId/canonical with representation=full returns expanded elements", async () => {
    const { app, passport } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/passports/:dppId/canonical",
      params: { dppId: passport.guid },
      query: { representation: "full" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.fields).toBeUndefined();
    expect(response.body.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "batteryMass",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-mass",
          valueDataType: "Decimal",
          value: 450,
          elements: [],
        }),
      ])
    );
  });

  test("GET /api/passports/:dppId/canonical also accepts representation=expanded", async () => {
    const { app, passport } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/passports/:dppId/canonical",
      params: { dppId: passport.guid },
      query: { representation: "expanded" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.fields).toBeUndefined();
    expect(response.body.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "batteryMass",
          objectType: "SingleValuedDataElement",
        }),
      ])
    );
  });
});
