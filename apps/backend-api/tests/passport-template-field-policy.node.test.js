"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerCompanyRoutes = require("../src/http/routes/company");
const {
  buildTemplateFieldPolicy,
  filterStoredTemplateFields,
  normalizeTemplateFieldsForStorage,
} = require("../src/modules/passports/template-field-policy");

const noop = () => {};

const typeSchema = {
  typeName: "batteryPassportV1",
  schemaFields: [
    {
      key: "modelName",
      sectionPath: [{ key: "generalInformation" }],
    },
    {
      key: "mass",
      sectionPath: [{ key: "generalInformation" }, { key: "technicalData" }],
    },
    {
      key: "generalInformation",
      sectionPath: [{ key: "semanticRelationships" }],
      presentation: "semanticTree",
      relationshipType: "composition",
    },
  ],
};

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

function createResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function registerRoutes(pool) {
  const { app, routes } = createRouteApp();
  registerCompanyRoutes(app, {
    pool,
    authenticateToken: noop,
    checkCompanyAccess: noop,
    checkCompanyAdmin: noop,
    requireEditor: noop,
    getTable: noop,
    getPassportFieldValue: noop,
    getPassportTypeSchema: async () => typeSchema,
    normalizePassportRequestBody: noop,
    extractExplicitFacilityId: noop,
    normalizeInternalAliasIdValue: noop,
    normalizeReleaseStatus: noop,
    isEditablePassportStatus: noop,
    findExistingPassportByInternalAliasId: noop,
    updatePassportRowById: noop,
    getWritablePassportColumns: noop,
    getStoredPassportValues: noop,
    logAudit: noop,
    editableReleaseStatusesSql: "('draft')",
    systemPassportFields: new Set(),
    buildSemanticPassportJsonExport: noop,
    buildExpandedPassportPayload: noop,
    productIdentifierService: {},
    complianceService: {},
  });
  return routes;
}

test("template field policy separates user fields from generated semantic relationships", () => {
  const policy = buildTemplateFieldPolicy(typeSchema);

  assert.deepEqual([...policy.allowedFieldKeys], ["modelName", "mass"]);
  assert.deepEqual([...policy.semanticRelationshipFieldKeys], ["generalInformation"]);
  assert.deepEqual(filterStoredTemplateFields([
    { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
    { fieldKey: "mass", fieldValue: " ", isModelData: false },
    { fieldKey: "generalInformation", fieldValue: "{}", isModelData: false },
    { fieldKey: "unknown", fieldValue: "injected", isModelData: false },
  ], policy), [
    { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
  ]);
});

test("template storage accepts only populated canonical user fields", () => {
  const policy = buildTemplateFieldPolicy(typeSchema);

  assert.deepEqual(normalizeTemplateFieldsForStorage([
    { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
    { fieldKey: "mass", fieldValue: "  ", isModelData: true },
  ], policy), [
    { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
  ]);

  assert.throws(
    () => normalizeTemplateFieldsForStorage([
      { fieldKey: "generalInformation", fieldValue: { injected: true } },
    ], policy),
    (error) => error.statusCode === 400 && error.code === "semanticRelationshipTemplateOverride"
  );
  assert.throws(
    () => normalizeTemplateFieldsForStorage([
      { fieldKey: "notInSchema", fieldValue: "injected" },
    ], policy),
    (error) => error.statusCode === 400 && error.code === "unknownTemplateField"
  );
});

test("template create and edit APIs reject semantic relationship overrides before storing them", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT id, "passportType" AS "passportType"')) {
        return { rows: [{ id: 9, passportType: "batteryPassportV1" }] };
      }
      return { rows: [] };
    },
  };
  const routes = registerRoutes(pool);
  const createRoute = routes.find((route) =>
    route.method === "post" && route.routePath === "/api/companies/:companyId/templates"
  );
  const editRoute = routes.find((route) =>
    route.method === "put" && route.routePath === "/api/companies/:companyId/templates/:id"
  );
  assert.ok(createRoute);
  assert.ok(editRoute);

  const createResult = createResponse();
  await createRoute.handlers.at(-1)({
    params: { companyId: "7" },
    user: { userId: 4 },
    body: {
      passportType: "batteryPassportV1",
      name: "Unsafe template",
      fields: [{ fieldKey: "generalInformation", fieldValue: "override" }],
    },
  }, createResult);
  assert.equal(createResult.statusCode, 400);
  assert.equal(createResult.body.code, "semanticRelationshipTemplateOverride");
  assert.equal(queries.length, 0);

  const editResponse = createResponse();
  await editRoute.handlers.at(-1)({
    params: { companyId: "7", id: "9" },
    body: {
      name: "Unsafe edit",
      fields: [{ fieldKey: "generalInformation", fieldValue: "override" }],
    },
  }, editResponse);
  assert.equal(editResponse.statusCode, 400);
  assert.equal(editResponse.body.code, "semanticRelationshipTemplateOverride");
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].sql, /UPDATE "passportTemplates"/);
});

test("template detail API hides legacy semantic and unknown stored fields", async () => {
  let queryIndex = 0;
  const pool = {
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return { rows: [{
          id: 9,
          companyId: 7,
          passportType: "batteryPassportV1",
          name: "Legacy template",
        }] };
      }
      return { rows: [
        { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
        { fieldKey: "generalInformation", fieldValue: "override", isModelData: true },
        { fieldKey: "unknown", fieldValue: "injected", isModelData: false },
      ] };
    },
  };
  const routes = registerRoutes(pool);
  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/companies/:companyId/templates/:id"
  );
  const response = createResponse();

  await route.handlers.at(-1)({ params: { companyId: "7", id: "9" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.fields, [
    { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
  ]);
});

test("template list model-field counts exclude semantic relationship metadata", async () => {
  let queryIndex = 0;
  const pool = {
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return { rows: [{
          id: 9,
          companyId: 7,
          passportType: "batteryPassportV1",
          name: "Battery template",
        }] };
      }
      return { rows: [
        { templateId: 9, fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
        { templateId: 9, fieldKey: "generalInformation", fieldValue: "override", isModelData: true },
      ] };
    },
  };
  const routes = registerRoutes(pool);
  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/companies/:companyId/templates"
  );
  const response = createResponse();

  await route.handlers.at(-1)({ params: { companyId: "7" }, query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body[0].modelFieldCount, 1);
});
