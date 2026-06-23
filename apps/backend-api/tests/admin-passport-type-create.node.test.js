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
  const stack = app._router?.stack || app.router?.stack || [];
  const layer = stack.find((entry) =>
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
    user: { userId: 99, role: "superAdmin" },
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

      if (sql.includes("INSERT INTO \"passportTypes\"")) {
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

      if (sql.includes("INSERT INTO \"productCategories\"")) {
        return {
          rows: [{
            id: 77,
            name: params[0],
            icon: params[1],
          }],
        };
      }

      if (sql.includes("FROM \"passportTypes\"") && sql.includes('"typeName" AS "typeName"')) {
        return { rows: registeredTypes };
      }

      return { rows: [] };
    },
  };
}

function createModulePreviewFixture(overrides = {}) {
  const moduleKey = overrides.moduleKey || "medical-device:v1";
  const typeName = overrides.typeName || "medicalDevicePassportV1";
  const semanticModelKey = overrides.semanticModelKey || "medicalDeviceDictionaryV1";
  const passportPolicyKey = overrides.passportPolicyKey || "medicalDeviceDppV1";

  return {
    moduleKey,
    typeName,
    displayName: overrides.displayName || "Medical Device Passport v1",
    productCategory: overrides.productCategory || "Medical Device",
    productIcon: overrides.productIcon || "MD",
    semanticModelKey,
    passportPolicy: {
      key: passportPolicyKey,
      contentSpecificationIds: [semanticModelKey],
    },
    fieldsJson: {
      sections: [{
        key: "deviceIdentity",
        fields: [{
          key: "modelIdentifier",
          label: "Model Identifier",
          type: "text",
          canonicalLocked: true,
          sourceModuleKey: moduleKey,
          sourceModuleFieldKey: "modelIdentifier",
          semanticId: "https://example.test/dictionary/medical-device/v1/terms/model-identifier",
          elementIdPath: "deviceIdentity.modelIdentifier",
          objectType: "SingleValuedDataElement",
          valueDataType: "String",
        }],
      }],
      sourceModule: moduleKey,
      identity: { businessIdentifierField: "modelIdentifier" },
      passportPolicyKey,
      passportPolicy: {
        key: passportPolicyKey,
        contentSpecificationIds: [semanticModelKey],
      },
    },
  };
}

function createCatalogApp({ calls, createdTables, audits, registeredTypes = [], moduleDefinitions = [] }) {
  const app = express();
  registerCatalogRoutes(app, {
    pool: createMockPool(calls, { registeredTypes }),
    multer,
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 99, role: "superAdmin" };
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
    buildPassportTypeSchemaChange: () => ({ changeType: "metadataOnly" }),
    normalizeRequestedPassportTypeSchema: ({ sections, systemHeader, currentSchemaVersion, sourceModule }) => ({
      schemaVersion: currentSchemaVersion,
      systemHeader,
      sourceModule,
      sections,
    }),
    getTypeSchemaVersion: () => 1,
    findReservedPassportHeaderFieldConflicts: () => [],
    validatePassportTypeSections: () => null,
    buildPassportTypeGovernanceCheck: () => ({ issueCount: 0, issues: [] }),
    getPassportTypeModules: () => moduleDefinitions,
    storageService: {
      saveGlobalSymbol: async () => ({ id: "symbol-1" }),
    },
  });
  return app;
}

test("admin cannot create manual passport type without a registered module source", async () => {
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
      semanticModelKey: "medicalDeviceDictionaryV1",
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

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Passport types must be created from a registered passport module.");
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO \"passportTypes\"")), false);
  assert.deepEqual(createdTables, []);
  assert.equal(audits.length, 0);
});

test("admin can preview registered passport type modules before seeding", async () => {
  const app = createCatalogApp({
    calls: [],
    createdTables: [],
    audits: [],
    moduleDefinitions: [createModulePreviewFixture()],
  });

  const response = await invokeRoute(app, {
    method: "get",
    path: "/api/admin/passport-type-modules",
  });

  assert.equal(response.statusCode, 200);
  const deviceModule = response.body.find((modulePreview) => modulePreview.moduleKey === "medical-device:v1");
  assert.ok(deviceModule, "Expected injected module fixture to be listed");
  assert.equal(deviceModule.seeded, false);
  assert.equal(deviceModule.semanticModelKey, "medicalDeviceDictionaryV1");
  assert.equal(deviceModule.passportPolicyKey, "medicalDeviceDppV1");
  assert.match(deviceModule.seedCommand, /--module=medical-device:v1/);
});

test("admin module preview marks modules as seeded when passport type exists", async () => {
  const deviceModule = createModulePreviewFixture();
  const sensorModule = createModulePreviewFixture({
    moduleKey: "industrial-sensor:v2",
    typeName: "industrialSensorPassportV2",
    displayName: "Industrial Sensor Passport v2",
    productCategory: "Industrial Sensor",
    semanticModelKey: "industrialSensorDictionaryV2",
    passportPolicyKey: "industrialSensorDppV2",
  });
  const app = createCatalogApp({
    calls: [],
    createdTables: [],
    audits: [],
    registeredTypes: [{
      id: 42,
      typeName: "medicalDevicePassportV1",
      isActive: true,
    }],
    moduleDefinitions: [deviceModule, sensorModule],
  });

  const response = await invokeRoute(app, {
    method: "get",
    path: "/api/admin/passport-type-modules",
  });

  assert.equal(response.statusCode, 200);
  const seededModule = response.body.find((modulePreview) => modulePreview.moduleKey === "medical-device:v1");
  assert.equal(seededModule.seeded, true);
  assert.equal(seededModule.seededPassportTypeId, 42);
  assert.equal(seededModule.seededIsActive, true);

  const unseededModule = response.body.find((modulePreview) => modulePreview.moduleKey === "industrial-sensor:v2");
  assert.equal(unseededModule.seeded, false);
});
