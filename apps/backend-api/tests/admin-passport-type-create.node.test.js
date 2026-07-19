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

function createMockPool(calls, { registeredTypes = [], existingTypes = [] } = {}) {
  return {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('SELECT * FROM "passportTypes" WHERE id = $1')) {
        return { rows: existingTypes };
      }

      if (sql.includes('UPDATE "passportTypes" SET')) {
        return { rows: existingTypes };
      }

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
  const moduleKey = overrides.moduleKey || "example-product:v1";
  const typeName = overrides.typeName || "exampleProductPassportV1";
  const semanticModelKey = overrides.semanticModelKey || "exampleProductDictionaryV1";
  const passportPolicyKey = overrides.passportPolicyKey || "exampleProductDppV1";

  return {
    moduleKey,
    typeName,
    displayName: overrides.displayName || "Example Product Passport v1",
    productCategory: overrides.productCategory || "Example Product",
    productIcon: overrides.productIcon || "MD",
    semanticModelKey,
    passportPolicy: {
      key: passportPolicyKey,
      contentSpecificationIds: [semanticModelKey],
    },
    fieldsJson: {
      sections: [{
        key: "deviceIdentity",
        label: "Device Identity",
        fields: [{
          key: "modelIdentifier",
          label: "Model Identifier",
          type: "text",
          canonicalLocked: true,
          sourceModuleKey: moduleKey,
          sourceModuleFieldKey: "modelIdentifier",
          semanticId: "https://example.test/dictionary/example-product/v1/terms/model-identifier",
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

function createNestedModulePreviewFixture() {
  const module = createModulePreviewFixture();
  const field = ({ key, label, sectionKey }) => ({
    key,
    label,
    type: "text",
    canonicalLocked: true,
    sourceModuleKey: module.moduleKey,
    sourceModuleFieldKey: key,
    semanticId: `https://example.test/dictionary/example-product/v1/terms/${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    elementIdPath: `${sectionKey}.${key}`,
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
  });
  module.fieldsJson.sections = [
    {
      key: "identity",
      label: "Identity",
      fields: [field({ key: "modelIdentifier", label: "Model Identifier", sectionKey: "identity" })],
    },
    {
      key: "composition",
      label: "Composition",
      fields: [],
      sections: [{
        key: "materials",
        label: "Materials",
        fields: [field({ key: "materialName", label: "Material Name", sectionKey: "composition.materials" })],
      }],
    },
  ];
  return module;
}

function createCatalogApp({
  calls,
  createdTables,
  audits,
  registeredTypes = [],
  existingTypes = [],
  moduleDefinitions = [],
}) {
  const app = express();
  registerCatalogRoutes(app, {
    pool: createMockPool(calls, { registeredTypes, existingTypes }),
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
      typeName: "exampleProductPassportV1",
      displayName: "Example Product Passport v1",
      productCategory: "Example Product",
      productIcon: "MD",
      semanticModelKey: "exampleProductDictionaryV1",
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

test("admin cannot create module passport type when field key differs from semantic term key", async () => {
  const calls = [];
  const createdTables = [];
  const audits = [];
  const moduleDefinition = createModulePreviewFixture();
  const app = createCatalogApp({
    calls,
    createdTables,
    audits,
    moduleDefinitions: [moduleDefinition],
  });
  const sections = JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections));
  sections[0].fields[0].key = "modelId";

  const response = await invokeRoute(app, {
    path: "/api/admin/passport-types",
    body: {
      typeName: moduleDefinition.typeName,
      displayName: moduleDefinition.displayName,
      productCategory: moduleDefinition.productCategory,
      productIcon: moduleDefinition.productIcon,
      semanticModelKey: moduleDefinition.semanticModelKey,
      sourceModule: moduleDefinition.moduleKey,
      identity: moduleDefinition.fieldsJson.identity,
      systemHeader: { section: { label: "Passport Header" } },
      sections,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Passport type fields must use canonical module semantics only.");
  assert.equal(response.body.fields.some((issue) => issue.code === "fieldKeyMustMatchSemanticTerm"), true);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO \"passportTypes\"")), false);
  assert.deepEqual(createdTables, []);
  assert.equal(audits.length, 0);
});

test("admin accepts an unchanged nested module schema", async () => {
  const calls = [];
  const createdTables = [];
  const audits = [];
  const moduleDefinition = createNestedModulePreviewFixture();
  const app = createCatalogApp({
    calls,
    createdTables,
    audits,
    moduleDefinitions: [moduleDefinition],
  });

  const response = await invokeRoute(app, {
    path: "/api/admin/passport-types",
    body: {
      typeName: moduleDefinition.typeName,
      displayName: moduleDefinition.displayName,
      productCategory: moduleDefinition.productCategory,
      productIcon: moduleDefinition.productIcon,
      semanticModelKey: moduleDefinition.semanticModelKey,
      sourceModule: moduleDefinition.moduleKey,
      identity: moduleDefinition.fieldsJson.identity,
      systemHeader: { section: { label: "Passport Header" } },
      sections: JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections)),
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(createdTables.length, 1);
  assert.equal(audits.length, 1);
});

test("admin rejects reparented, reordered, and renamed nested module topology", async () => {
  const moduleDefinition = createNestedModulePreviewFixture();
  const createRequest = (sections) => ({
    typeName: moduleDefinition.typeName,
    displayName: moduleDefinition.displayName,
    productCategory: moduleDefinition.productCategory,
    productIcon: moduleDefinition.productIcon,
    semanticModelKey: moduleDefinition.semanticModelKey,
    sourceModule: moduleDefinition.moduleKey,
    identity: moduleDefinition.fieldsJson.identity,
    systemHeader: { section: { label: "Passport Header" } },
    sections,
  });
  const createApp = () => createCatalogApp({
    calls: [],
    createdTables: [],
    audits: [],
    moduleDefinitions: [moduleDefinition],
  });

  const reparented = JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections));
  reparented[0].fields.push(reparented[1].sections[0].fields.pop());
  const reparentedResponse = await invokeRoute(createApp(), {
    path: "/api/admin/passport-types",
    body: createRequest(reparented),
  });
  assert.equal(reparentedResponse.statusCode, 400);
  assert.equal(
    reparentedResponse.body.fields.some((issue) => issue.code === "moduleSectionFieldCountMismatch"),
    true
  );

  const reordered = JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections)).reverse();
  const reorderedResponse = await invokeRoute(createApp(), {
    path: "/api/admin/passport-types",
    body: createRequest(reordered),
  });
  assert.equal(reorderedResponse.statusCode, 400);
  assert.equal(
    reorderedResponse.body.fields.some((issue) => issue.code === "moduleSectionKeyOrOrderMismatch"),
    true
  );

  const renamed = JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections));
  renamed[1].sections[0].label = "Recycled Materials";
  renamed[1].sections[0].fields[0].label = "Material Description";
  const renamedResponse = await invokeRoute(createApp(), {
    path: "/api/admin/passport-types",
    body: createRequest(renamed),
  });
  assert.equal(renamedResponse.statusCode, 400);
  assert.equal(
    renamedResponse.body.fields.some((issue) => issue.code === "moduleSectionLabelMismatch"),
    true
  );
  assert.equal(
    renamedResponse.body.fields.some((issue) => issue.code === "moduleFieldLabelMismatch"),
    true
  );
});

test("metadata-only edits remain compatible with earlier module-backed schemas", async () => {
  const calls = [];
  const createdTables = [];
  const audits = [];
  const moduleDefinition = createNestedModulePreviewFixture();
  const earlierSections = JSON.parse(JSON.stringify(moduleDefinition.fieldsJson.sections));
  earlierSections[1].sections[0].label = "Earlier Materials Label";
  const existingType = {
    id: 501,
    typeName: moduleDefinition.typeName,
    displayName: moduleDefinition.displayName,
    productCategory: moduleDefinition.productCategory,
    productIcon: moduleDefinition.productIcon,
    semanticModelKey: moduleDefinition.semanticModelKey,
    fieldsJson: {
      sourceModule: moduleDefinition.moduleKey,
      identity: moduleDefinition.fieldsJson.identity,
      sections: earlierSections,
    },
  };
  const app = createCatalogApp({
    calls,
    createdTables,
    audits,
    existingTypes: [existingType],
    moduleDefinitions: [moduleDefinition],
  });

  const response = await invokeRoute(app, {
    method: "patch",
    path: "/api/admin/passport-types/:id",
    params: { id: "501" },
    body: { displayName: "Updated display name" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(createdTables.length, 0);
  assert.equal(calls.some((call) => call.sql.includes('UPDATE "passportTypes" SET')), true);
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
  const deviceModule = response.body.find((modulePreview) => modulePreview.moduleKey === "example-product:v1");
  assert.ok(deviceModule, "Expected injected module fixture to be listed");
  assert.equal(deviceModule.seeded, false);
  assert.equal(deviceModule.semanticModelKey, "exampleProductDictionaryV1");
  assert.equal(deviceModule.passportPolicyKey, "exampleProductDppV1");
  assert.match(deviceModule.seedCommand, /--module=example-product:v1/);
});

test("admin module preview marks modules as seeded when passport type exists", async () => {
  const deviceModule = createModulePreviewFixture();
  const sensorModule = createModulePreviewFixture({
    moduleKey: "alternate-product:v2",
    typeName: "alternateProductPassportV2",
    displayName: "Alternate Product Passport v2",
    productCategory: "Alternate Product",
    semanticModelKey: "alternateProductDictionaryV2",
    passportPolicyKey: "alternateProductDppV2",
  });
  const app = createCatalogApp({
    calls: [],
    createdTables: [],
    audits: [],
    registeredTypes: [{
      id: 42,
      typeName: "exampleProductPassportV1",
      isActive: true,
    }],
    moduleDefinitions: [deviceModule, sensorModule],
  });

  const response = await invokeRoute(app, {
    method: "get",
    path: "/api/admin/passport-type-modules",
  });

  assert.equal(response.statusCode, 200);
  const seededModule = response.body.find((modulePreview) => modulePreview.moduleKey === "example-product:v1");
  assert.equal(seededModule.seeded, true);
  assert.equal(seededModule.seededPassportTypeId, 42);
  assert.equal(seededModule.seededIsActive, true);

  const unseededModule = response.body.find((modulePreview) => modulePreview.moduleKey === "alternate-product:v2");
  assert.equal(unseededModule.seeded, false);
});
