"use strict";

const express = require("express");

const registerAdminRoutes = require("../routes/admin");

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    finished: false,
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

  const pool = {
    query: jest.fn(async () => ({ rows: [] })),
  };
  const multer = Object.assign(
    () => ({
      single: () => (_req, _res, next) => next(),
      array: () => (_req, _res, next) => next(),
      fields: () => (_req, _res, next) => next(),
    }),
    {
      memoryStorage: () => ({}),
    }
  );

  registerAdminRoutes(app, {
    pool,
    multer,
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 1, role: "super_admin" };
      next();
    },
    isSuperAdmin: (_req, _res, next) => next(),
    checkCompanyAccess: (_req, _res, next) => next(),
    verifyPassword: jest.fn(async () => true),
    logAudit: jest.fn(async () => {}),
    getTable: (typeName) => `${typeName}_passports`,
    createPassportTable: jest.fn(async () => {}),
    queryTableStats: jest.fn(async () => ({})),
    publicReadRateLimit: (_req, _res, next) => next(),
    GLOBAL_SYMBOLS_DIR: "/tmp",
    REPO_BASE_DIR: "/tmp",
    FILES_BASE_DIR: "/tmp",
    IN_REVISION_STATUS: "in_revision",
    IN_REVISION_STATUSES_SQL: "('in_revision')",
    createTransporter: jest.fn(),
    brandedEmail: jest.fn(),
    storageService: {
      saveRepositoryFile: jest.fn(),
    },
  });

  return { app, pool };
}

describe("admin passport type validation", () => {
  test("rejects field keys that duplicate reserved passport registry/header fields", async () => {
    const { app, pool } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/admin/passport-types",
      body: {
        type_name: "battery_custom",
        display_name: "Battery Custom",
        umbrella_category: "Battery Digital Passport",
        semantic_model_key: "claros_battery_dictionary_v1",
        sections: [
          {
            key: "overview",
            label: "Overview",
            fields: [
              {
                key: "digitalProductPassportId",
                label: "DPP Record ID",
                type: "text",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/reserved passport registry\/header fields/i);
    expect(response.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "digitalProductPassportId",
          conflictType: "key",
          reservedField: "digitalProductPassportId",
        }),
      ])
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects reserved passport header semantic ids on custom fields", async () => {
    const { app, pool } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/admin/passport-types",
      body: {
        type_name: "battery_custom_semantic",
        display_name: "Battery Custom Semantic",
        umbrella_category: "Battery Digital Passport",
        semantic_model_key: "claros_battery_dictionary_v1",
        sections: [
          {
            key: "overview",
            label: "Overview",
            fields: [
              {
                key: "custom_dpp_id_copy",
                label: "Custom DPP ID Copy",
                type: "text",
                semanticId: "dpp:digitalProductPassportId",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "custom_dpp_id_copy",
          conflictType: "semanticId",
          reservedField: "dpp:digitalProductPassportId",
        }),
      ])
    );
    expect(pool.query).not.toHaveBeenCalled();
  });
});
