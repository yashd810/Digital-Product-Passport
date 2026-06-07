"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const createSemanticModelRegistry = require("../services/semantic-model-registry");
const registerDictionaryRoutes = require("../routes/dictionary");

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

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

async function invokeRoute(app, { method = "get", path: pathToFind, params = {}, query = {} }) {
  const handlers = findRouteHandlers(app, method, pathToFind);
  const req = {
    method: method.toUpperCase(),
    params,
    query,
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
      if (nextCalled) await runHandler(index + 1);
      return;
    }

    await handler(req, res);
    if (!res.finished) await runHandler(index + 1);
  }

  await runHandler(0);
  return res;
}

function parseJsonResponse(response) {
  return typeof response.body === "string" ? JSON.parse(response.body) : response.body;
}

function createDictionaryApp({ pool = null, registry = createSemanticModelRegistry() } = {}) {
  const app = express();
  registerDictionaryRoutes(app, {
    pool,
    semanticModelRegistry: registry,
    publicReadRateLimit: (_req, _res, next) => next(),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 1, role: "company_admin" };
      next();
    },
    checkCompanyAccess: (_req, _res, next) => next(),
  });
  return app;
}

test("semantic registry loads the existing battery dictionary generically", () => {
  const registry = createSemanticModelRegistry();
  const model = registry.getModel("claros_battery_dictionary_v1");

  assert.ok(model);
  assert.equal(model.family, "battery");
  assert.equal(model.version, "v1");
  assert.equal(registry.getModelByPath("battery", "v1").semanticModelKey, "claros_battery_dictionary_v1");
  assert.ok(registry.getTerms("claros_battery_dictionary_v1").length > 0);
  assert.match(registry.resolveFieldKey("claros_battery_dictionary_v1", "dpp_granularity"), /dpp-granularity/);
});

test("semantic registry loads a new product dictionary without battery-specific code", () => {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-models-"));
  const modelDir = path.join(resourcesDir, "appliance", "v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "claros_appliance_dictionary_v3",
    name: "Claros Appliance Dictionary",
    version: "1.0.0",
    description: "Test appliance dictionary",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "energy-rating",
      label: "Energy rating",
      definition: "Energy performance rating for the product.",
      iri: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
      appFieldKeys: ["energyRating"],
    },
  ]);
  writeJson(path.join(modelDir, "field-map.json"), {
    energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
  });
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
    },
  });

  try {
    const registry = createSemanticModelRegistry({ resourcesDir });
    const [model] = registry.listModels();

    assert.equal(model.semanticModelKey, "claros_appliance_dictionary_v3");
    assert.equal(model.family, "appliance");
    assert.equal(model.version, "v3");
    assert.equal(
      registry.getTermByFieldKey("claros_appliance_dictionary_v3", "energyRating").slug,
      "energy-rating"
    );
  } finally {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
});

test("semantic registry expands compact term sources", () => {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-models-"));
  const modelDir = path.join(resourcesDir, "appliance", "v4");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "claros_appliance_dictionary_v4",
    name: "Claros Appliance Dictionary",
    version: "1.0.0",
    termsUrl: "https://example.test/dictionary/appliance/v4/terms",
  });
  writeJson(path.join(modelDir, "categories.json"), [
    { key: "performance", label: "Performance" },
  ]);
  writeJson(path.join(modelDir, "units.json"), [
    { key: "kwh_per_year", label: "Kilowatt hour per year", symbol: "kWh/year" },
  ]);
  writeJson(path.join(modelDir, "terms.json"), [
    {
      number: 1,
      id: 1,
      specRef: "APP-001",
      slug: "energy-rating",
      iri: "https://example.test/dictionary/appliance/v4/terms/energy-rating",
      termIri: "https://example.test/dictionary/appliance/v4/terms/energy-rating",
      label: "Energy rating",
      attributeName: "Energy rating",
      definition: "Energy performance rating for the product.",
      shortDefinition: "Energy rating.",
      sourceShortDefinition: "Source energy rating.",
      category: "performance",
      categoryLabel: "Performance",
      sourceCategory: "Performance",
      subcategory: "legacy-subcategory",
      sourceSubcategory: "Legacy Subcategory",
      internal_key: "energyRating",
      elementId: "energyRating",
      element_id: "energyRating",
      dataType: "string",
      rdfType: ["rdf:Property", "owl:DatatypeProperty", "skos:Concept"],
      domainClassKey: "Performance",
      semanticBinding: {
        rdfProperty: "https://example.test/dictionary/appliance/v4/terms/energy-rating",
        domain: {
          iri: "https://example.test/dictionary/appliance/v4/classes/Performance",
          curie: "exampleClass:Performance",
          label: "Performance",
          broaderClass: {
            iri: "https://example.test/dictionary/appliance/v4/classes/DigitalProductPassport",
            curie: "exampleClass:DigitalProductPassport",
            label: "Digital Product Passport",
          },
        },
        range: {
          iri: "http://www.w3.org/2001/XMLSchema#string",
          curie: "xsd:string",
          label: "String",
          jsonType: "string",
        },
      },
      conformsTo: ["https://www.w3.org/TR/vocab-dcat-3/"],
      unit: "none",
      unitDisplay: "n.a.",
    },
    {
      number: 2,
      specRef: "APP-002",
      slug: "power-consumption",
      label: "Power consumption",
      definition: "Declared annual power consumption.",
      category: "performance",
      internalKey: "powerConsumption",
      dataType: "decimal",
      unit: "kwh_per_year",
    },
  ]);
  writeJson(path.join(modelDir, "field-map.json"), {
    energyRating: "https://example.test/dictionary/appliance/v4/terms/energy-rating",
    powerConsumption: "https://example.test/dictionary/appliance/v4/terms/power-consumption",
  });
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/appliance/v4/terms/energy-rating",
      powerConsumption: {
        "@id": "https://example.test/dictionary/appliance/v4/terms/power-consumption",
        "@type": "http://www.w3.org/2001/XMLSchema#decimal",
      },
    },
  });

  try {
    const registry = createSemanticModelRegistry({ resourcesDir });
    const energyRating = registry.getTermByFieldKey("claros_appliance_dictionary_v4", "energyRating");
    const powerConsumption = registry.getTermByFieldKey("claros_appliance_dictionary_v4", "powerConsumption");

    assert.equal(energyRating.iri, "https://example.test/dictionary/appliance/v4/terms/energy-rating");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "termIri"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "attributeName"), false);
    assert.equal(energyRating.internalKey, "energyRating");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "internal_key"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "elementId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "element_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "shortDefinition"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "sourceShortDefinition"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "subcategory"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "sourceSubcategory"), false);
    assert.equal(energyRating.domain.curie, "exampleClass:Performance");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating.domain, "broaderClass"), false);
    assert.equal(energyRating.range.curie, "xsd:string");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "semanticBinding"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "sourceCategory"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "domainClassKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "rdfType"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "conformsTo"), false);
    assert.deepEqual(energyRating.appFieldKeys, ["energyRating"]);
    assert.deepEqual(energyRating.dataType, { format: "String", jsonType: "string", xsdType: "xsd:string" });
    assert.equal(energyRating.unitDisplay, "n.a.");
    assert.equal(energyRating.categoryLabel, "Performance");

    assert.equal(powerConsumption.iri, "https://example.test/dictionary/appliance/v4/terms/power-consumption");
    assert.deepEqual(powerConsumption.dataType, { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" });
    assert.equal(powerConsumption.range.iri, "http://www.w3.org/2001/XMLSchema#decimal");
    assert.equal(powerConsumption.range.curie, "xsd:decimal");
    assert.equal(powerConsumption.unitDisplay, "kWh/year");
  } finally {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
});

test("dictionary routes serve registered models and canonical artifacts", async () => {
  const app = createDictionaryApp();

  const modelList = await invokeRoute(app, { path: "/api/semantic-models" });
  const modelListBody = parseJsonResponse(modelList);
  assert.equal(modelList.statusCode, 200);
  assert.ok(modelListBody.some((model) => model.semanticModelKey === "claros_appliance_dictionary_v1"));
  assert.ok(modelListBody.some((model) => model.semanticModelKey === "claros_battery_dictionary_v1"));
  assert.ok(modelListBody.some((model) => model.semanticModelKey === "claros_textile_dictionary_v1"));

  const manifest = await invokeRoute(app, {
    path: "/dictionary/:family/:version/manifest.json",
    params: { family: "battery", version: "v1" },
  });
  assert.equal(manifest.statusCode, 200);
  assert.equal(parseJsonResponse(manifest).semanticModelKey, "claros_battery_dictionary_v1");

  const textileManifest = await invokeRoute(app, {
    path: "/dictionary/:family/:version/manifest.json",
    params: { family: "textile", version: "v1" },
  });
  assert.equal(textileManifest.statusCode, 200);
  assert.equal(parseJsonResponse(textileManifest).semanticModelKey, "claros_textile_dictionary_v1");

  const terms = await invokeRoute(app, {
    path: "/api/dictionary/:family/:version/terms",
    params: { family: "battery", version: "v1" },
    query: { search: "dpp_granularity" },
  });
  assert.equal(terms.statusCode, 200);
  assert.ok(parseJsonResponse(terms).some((term) => term.appFieldKeys?.includes("dpp_granularity")));
});

test("company semantic models are derived from company passport type access", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return {
        rows: [
          {
            semanticModelKey: "claros_battery_dictionary_v1",
            typeName: "euBatteryPassportV1",
            displayName: "EU Battery Passport v1",
            productCategory: "Battery",
          },
          {
            semanticModelKey: "claros_textile_dictionary_v1",
            typeName: "euTextilePassportV1",
            displayName: "EU Textile Passport v1",
            productCategory: "Textile",
          },
        ],
      };
    },
  };
  const app = createDictionaryApp({ pool });

  const response = await invokeRoute(app, {
    path: "/api/companies/:companyId/semantic-models",
    params: { companyId: "7" },
  });

  assert.equal(response.statusCode, 200);
  assert.ok(calls[0].sql.includes("company_passport_access"));
  assert.deepEqual(calls[0].params, ["7"]);
  assert.deepEqual(response.body.map((model) => ({
    key: model.semanticModelKey,
    registered: model.registered,
    typeName: model.passportTypes[0].typeName,
  })), [
    {
      key: "claros_battery_dictionary_v1",
      registered: true,
      typeName: "euBatteryPassportV1",
    },
    {
      key: "claros_textile_dictionary_v1",
      registered: true,
      typeName: "euTextilePassportV1",
    },
  ]);
});

test("company semantic models support arbitrary registered models and grouped passport types", async () => {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "company-semantic-models-"));
  const modelDir = path.join(resourcesDir, "medical-device", "v1");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "claros_medical_device_dictionary_v1",
    name: "Claros Medical Device Dictionary",
    version: "1.0.0",
    description: "Test medical device dictionary",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "udi",
      label: "Unique device identifier",
      iri: "https://example.test/dictionary/medical-device/v1/terms/udi",
      appFieldKeys: ["udi"],
    },
  ]);
  writeJson(path.join(modelDir, "field-map.json"), {
    udi: "https://example.test/dictionary/medical-device/v1/terms/udi",
  });
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      udi: "https://example.test/dictionary/medical-device/v1/terms/udi",
    },
  });

  const pool = {
    query: async () => ({
      rows: [
        {
          semanticModelKey: "claros_medical_device_dictionary_v1",
          typeName: "medicalDevicePassportV1",
          displayName: "Medical Device Passport v1",
          productCategory: "Medical Device",
        },
        {
          semanticModelKey: "claros_medical_device_dictionary_v1",
          typeName: "implantableDevicePassportV1",
          displayName: "Implantable Device Passport v1",
          productCategory: "Medical Device",
        },
        {
          semanticModelKey: "external_future_dictionary_v9",
          typeName: "futureProductPassportV9",
          displayName: "Future Product Passport v9",
          productCategory: "Future Product",
        },
      ],
    }),
  };

  try {
    const registry = createSemanticModelRegistry({ resourcesDir });
    const app = createDictionaryApp({ pool, registry });
    const response = await invokeRoute(app, {
      path: "/api/companies/:companyId/semantic-models",
      params: { companyId: "11" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.length, 2);
    const medicalModel = response.body.find((model) => model.semanticModelKey === "claros_medical_device_dictionary_v1");
    const externalModel = response.body.find((model) => model.semanticModelKey === "external_future_dictionary_v9");

    assert.equal(medicalModel.registered, true);
    assert.equal(medicalModel.family, "medical-device");
    assert.equal(medicalModel.passportTypes.length, 2);
    assert.deepEqual(medicalModel.passportTypes.map((type) => type.typeName), [
      "medicalDevicePassportV1",
      "implantableDevicePassportV1",
    ]);
    assert.equal(externalModel.registered, false);
    assert.equal(externalModel.passportTypes[0].typeName, "futureProductPassportV9");
  } finally {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
});
