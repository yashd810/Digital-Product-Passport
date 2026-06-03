"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const multer = require("multer");
const registerCatalogRoutes = require("../src/modules/admin/register-catalog-routes");

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
  };
}

function routePathMatches(routePath, pathToFind) {
  return Array.isArray(routePath)
    ? routePath.includes(pathToFind)
    : routePath === pathToFind;
}

function findRouteHandlers(app, method, pathToFind) {
  const layer = app._router?.stack?.find((entry) =>
    entry.route
    && routePathMatches(entry.route.path, pathToFind)
    && entry.route.methods?.[method]
  );
  if (!layer) throw new Error(`Route not found for ${method.toUpperCase()} ${pathToFind}`);
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(app, { method = "post", path, body = {}, params = {} }) {
  const handlers = findRouteHandlers(app, method, path);
  const req = {
    body,
    method: method.toUpperCase(),
    params,
    user: { userId: 99, role: "super_admin" },
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
      if (nextCalled) await runHandler(index + 1);
      return;
    }

    await handler(req, res);
    if (!res.finished) await runHandler(index + 1);
  }

  await runHandler(0);
  return res;
}

function createMockPool(calls, { registeredTypes = [] } = {}) {
  return {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("INSERT INTO passport_types")) {
        const fieldsJson = JSON.parse(params[5]);
        return {
          rows: [{
            id: 501,
            typeName: params[0],
            displayName: params[1],
            productCategory: params[2],
            productIcon: params[3],
            semanticModelKey: params[4],
            fieldsJson,
            isActive: true,
            createdAt: "2026-06-03T00:00:00.000Z",
          }],
        };
      }

      if (sql.includes("INSERT INTO product_categories")) {
        return {
          rows: [{
            id: 77,
            name: params[0],
            icon: params[1],
          }],
        };
      }

      if (sql.includes("FROM passport_types") && sql.includes('"typeName" AS "typeName"')) {
        return { rows: registeredTypes };
      }

      return { rows: [] };
    },
  };
}

function createCatalogApp({ calls, createdTables, audits, registeredTypes = [] }) {
  const app = express();
  registerCatalogRoutes(app, {
    pool: createMockPool(calls, { registeredTypes }),
    multer,
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 99, role: "super_admin" };
      next();
    },
    isSuperAdmin: (_req, _res, next) => next(),
    checkCompanyAccess: (_req, _res, next) => next(),
    verifyPassword: async () => true,
    logAudit: async (...args) => audits.push(args),
    getTable: (typeName) => `${typeName}_passports`,
    publicReadRateLimit: (_req, _res, next) => next(),
    createPassportTable: async (typeName, metadata) => createdTables.push({ typeName, metadata }),
    passportTypeHasStoredRecords: async () => false,
    buildPassportTypeSchemaChange: () => ({ changeType: "metadata_only" }),
    normalizeRequestedPassportTypeSchema: ({ sections, systemHeader, currentSchemaVersion }) => ({
      schemaVersion: currentSchemaVersion,
      systemHeader,
      sections,
    }),
    getTypeSchemaVersion: () => 1,
    findReservedPassportHeaderFieldConflicts: () => [],
    validatePassportTypeSections: () => null,
    buildPassportTypeGovernanceCheck: () => ({ issueCount: 0, issues: [] }),
    storageService: {
      saveGlobalSymbol: async () => ({ id: "symbol-1" }),
    },
  });
  return app;
}

test("admin can create passport type with a brand-new product category", async () => {
  const calls = [];
  const createdTables = [];
  const audits = [];
  const app = createCatalogApp({ calls, createdTables, audits });

  const response = await invokeRoute(app, {
    path: "/api/admin/passport-types",
    body: {
      typeName: "medicalDevicePassportV1",
      displayName: "Medical Device Passport v1",
      productCategory: "Medical Device",
      productIcon: "MD",
      semanticModelKey: "claros_medical_device_dictionary_v1",
      systemHeader: { section: { label: "Passport Header" } },
      sections: [{
        key: "deviceIdentity",
        label: "Device Identity",
        fields: [
          { key: "modelIdentifier", label: "Model Identifier", type: "text" },
        ],
      }],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.passportType.productCategory, "Medical Device");
  assert.equal(response.body.passportType.semanticModelKey, "claros_medical_device_dictionary_v1");

  const categoryInsert = calls.find((call) => call.sql.includes("INSERT INTO product_categories"));
  assert.ok(categoryInsert, "Expected category upsert when creating a passport type");
  assert.deepEqual(categoryInsert.params, ["Medical Device", "MD"]);
  assert.deepEqual(createdTables.map((entry) => entry.typeName), ["medicalDevicePassportV1"]);
  assert.equal(audits.length, 1);
});

test("admin can preview registered passport type modules before seeding", async () => {
  const app = createCatalogApp({ calls: [], createdTables: [], audits: [] });

  const response = await invokeRoute(app, {
    method: "get",
    path: "/api/admin/passport-type-modules",
  });

  assert.equal(response.statusCode, 200);
  const applianceModule = response.body.find((modulePreview) => modulePreview.moduleKey === "appliance:v1");
  assert.ok(applianceModule, "Expected appliance reference module to be listed");
  assert.equal(applianceModule.seeded, false);
  assert.equal(applianceModule.semanticModelKey, "claros_appliance_dictionary_v1");
  assert.equal(applianceModule.complianceProfileKey, "applianceDppV1");
  assert.match(applianceModule.seedCommand, /--module=appliance:v1/);
});

test("admin module preview marks modules as seeded when passport type exists", async () => {
  const app = createCatalogApp({
    calls: [],
    createdTables: [],
    audits: [],
    registeredTypes: [{
      id: 42,
      typeName: "appliancePassportV1",
      isActive: true,
    }],
  });

  const response = await invokeRoute(app, {
    method: "get",
    path: "/api/admin/passport-type-modules",
  });

  assert.equal(response.statusCode, 200);
  const applianceModule = response.body.find((modulePreview) => modulePreview.moduleKey === "appliance:v1");
  assert.equal(applianceModule.seeded, true);
  assert.equal(applianceModule.seededPassportTypeId, 42);
  assert.equal(applianceModule.seededIsActive, true);

  const textileModule = response.body.find((modulePreview) => modulePreview.moduleKey === "textile:v1");
  assert.equal(textileModule.seeded, false);
});
