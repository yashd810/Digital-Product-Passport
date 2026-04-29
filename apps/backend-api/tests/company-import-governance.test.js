"use strict";

const express = require("express");

const registerCompanyRoutes = require("../routes/company");

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    finished: false,
    status(code) {
      this.statusCode = code;
      return this;
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
    setHeader() {},
  };
}

function findRouteHandlers(app, method, path) {
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

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {} }) {
  const handlers = findRouteHandlers(app, method, path);
  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers: {},
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
        Promise.resolve(handler(req, res, next)).catch(reject);
      });
      if (nextCalled) await runHandler(index + 1);
      return;
    }
    await handler(req, res);
    if (!res.finished) await runHandler(index + 1);
  }

  await runHandler(0);
  return res;
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  const noopMiddleware = (req, _res, next) => {
    req.user = req.user || { userId: 9, companyId: 5, role: "company_admin" };
    next();
  };

  registerCompanyRoutes(app, {
    pool: { query: jest.fn(async () => ({ rows: [] })) },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    requireEditor: noopMiddleware,
    publicReadRateLimit: noopMiddleware,
    getTable: (typeName) => `${typeName}_passports`,
    getPassportTypeSchema: jest.fn(async () => ({
      typeName: "battery",
      allowedKeys: new Set(["manufacturer", "model_name", "product_id"]),
      schemaFields: [
        { key: "manufacturer", label: "Manufacturer", type: "text" },
      ],
    })),
    normalizePassportRequestBody: (body) => body,
    normalizeProductIdValue: (value) => String(value || "").trim(),
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: (value) => value === "draft" || value === "in_revision",
    findExistingPassportByProductId: jest.fn(async () => null),
    updatePassportRowById: jest.fn(async () => []),
    getWritablePassportColumns: (data, excluded = new Set()) => Object.keys(data || {}).filter((key) => !excluded.has(key)),
    getStoredPassportValues: (keys, data) => keys.map((key) => data[key]),
    logAudit: jest.fn(async () => {}),
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    SYSTEM_PASSPORT_FIELDS: new Set(["dppId", "company_id"]),
    buildBatteryPassJsonExport: jest.fn(() => ({})),
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: rawProductId,
      }),
    },
    complianceService: {
      resolveProfileMetadata: () => ({
        key: "battery_dpp_v1",
        contentSpecificationIds: [],
        defaultCarrierPolicyKey: null,
      }),
    },
    accessRightsService: {},
  });

  return { app };
}

describe("company passport import governance rules", () => {
  test("POST /api/companies/:companyId/passports/upsert-csv rejects schema governance rows", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/passports/upsert-csv",
      params: { companyId: "5" },
      body: {
        passport_type: "battery",
        csv: [
          '"Field Name","Passport 1"',
          '"product_id","SKU-1"',
          '"Confidentiality","trade_secret"',
        ].join("\n"),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      governanceFields: ["Confidentiality"],
    });
    expect(String(response.body.error || "")).toContain("cannot be imported as passport row data");
  });

  test("POST /api/companies/:companyId/passports/upsert-json rejects schema governance keys per row", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/passports/upsert-json",
      params: { companyId: "5" },
      body: {
        passport_type: "battery",
        passports: [
          {
            product_id: "SKU-1",
            manufacturer: "ACME",
            confidentiality: "trade_secret",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.summary).toMatchObject({
      failed: 1,
      created: 0,
      updated: 0,
    });
    expect(response.body.details[0]).toMatchObject({
      status: "failed",
    });
    expect(String(response.body.details[0].error || "")).toContain("cannot be imported as passport row data");
  });
});
