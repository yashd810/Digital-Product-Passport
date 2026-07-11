"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const createSemanticModelRegistry = require("../src/services/semantic-model-registry");
const registerDictionaryRoutes = require("../src/http/routes/dictionary");

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeModuleStub(modelDir, { family, version, semanticModelKey }) {
  const familyCamel = family.replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
  const versionSuffix = version.charAt(0).toUpperCase() + version.slice(1);
  fs.writeFileSync(
    path.join(modelDir, "module.js"),
    `"use strict";\n\nmodule.exports = ${JSON.stringify({
      moduleKey: `${family}:${version}`,
      typeName: `${familyCamel}Passport${versionSuffix}`,
      semanticModelKey,
    }, null, 2)};\n`
  );
}

function writeSemanticFixture(packagesDir, {
  family = "example-product",
  version = "v1",
  semanticModelKey = "exampleProductDictionaryV1",
  name = "Example Product Dictionary",
  termSlug = "udi",
  termLabel = "Unique device identifier",
} = {}) {
  const modelDir = path.join(packagesDir, `${family}-${version}`);
  fs.mkdirSync(modelDir, { recursive: true });
  const baseIri = `https://example.test/dictionary/${family}/${version}`;
  const internalKey = termSlug.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
  const rootClassIri = `${baseIri}/classes/ExampleProductPassport`;

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey,
    name,
    version: "1.0.0",
    description: `${name} fixture`,
    baseIri,
    contextUrl: `${baseIri}/context.jsonld`,
    termsUrl: `${baseIri}/terms`,
    catalogUrl: `${baseIri}/catalog.jsonld`,
  });
  writeModuleStub(modelDir, { family, version, semanticModelKey });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: termSlug,
      label: termLabel,
      definition: `${termLabel} for the product.`,
      iri: `${baseIri}/terms/${termSlug}`,
      internalKey,
      dataType: "string",
      unit: "none",
      rangeKind: "scalar",
      domain: {
        key: "exampleProductPassport",
        iri: rootClassIri,
        label: "Example Product Passport",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#string",
        curie: "xsd:string",
        label: "String",
        jsonType: "string",
      },
    },
  ]);
  writeJson(path.join(modelDir, "classes.json"), [
    {
      key: "exampleProductPassport",
      label: "Example Product Passport",
      iri: rootClassIri,
      root: true,
    },
  ]);
  writeJson(path.join(modelDir, "units.json"), [
    { key: "none", label: "No unit", display: "n.a." },
  ]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      [termSlug.replace(/-([a-z])/g, (_match, char) => char.toUpperCase())]: `${baseIri}/terms/${termSlug}`,
    },
  });
  writeJson(path.join(modelDir, "catalog.jsonld"), {
    "@context": { dcat: "http://www.w3.org/ns/dcat#" },
    "@id": `${baseIri}/catalog`,
    "@type": "dcat:Catalog",
  });

  return { modelDir, semanticModelKey };
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
  const stack = app._router?.stack || app.router?.stack || [];
  const layer = stack.find((entry) =>
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
      req.user = { userId: 1, role: "companyAdmin" };
      next();
    },
    checkCompanyAccess: (_req, _res, next) => next(),
  });
  return app;
}

test("semantic registry supports an empty resources directory", () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-semantic-models-"));

  try {
    const registry = createSemanticModelRegistry({ packagesDir });

    assert.deepEqual(registry.listModels(), []);
    assert.equal(registry.getModel("missingDictionaryV1"), null);
    assert.equal(registry.getModelByPath("missing", "v1"), null);
    assert.deepEqual(registry.getTerms("missingDictionaryV1"), []);
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});

test("semantic registry loads a new product dictionary without category-specific code", () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-models-"));
  const modelDir = path.join(packagesDir, "custom-product-v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "customProductDictionaryV3",
    name: "Custom Product Dictionary",
    version: "1.0.0",
    description: "Test custom product dictionary",
  });
  writeModuleStub(modelDir, {
    family: "custom-product",
    version: "v3",
    semanticModelKey: "customProductDictionaryV3",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "energy-rating",
      label: "Energy rating",
      definition: "Energy performance rating for the product.",
      iri: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
      internalKey: "energyRating",
      dataType: "string",
      domain: {
        key: "customProductPassport",
        iri: "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport",
        label: "Custom Product Passport",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#string",
        curie: "xsd:string",
        label: "String",
        jsonType: "string",
      },
    },
  ]);
  writeJson(path.join(modelDir, "classes.json"), [{
    key: "customProductPassport",
    label: "Custom Product Passport",
    iri: "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport",
    root: true,
  }]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
    },
  });

  try {
    const registry = createSemanticModelRegistry({ packagesDir });
    const [model] = registry.listModels();

    assert.equal(model.semanticModelKey, "customProductDictionaryV3");
    assert.equal(model.family, "custom-product");
    assert.equal(model.version, "v3");
    assert.equal(
      registry.getTermBySlug("customProductDictionaryV3", "energy-rating").slug,
      "energy-rating"
    );
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});

test("semantic registry normalizes graph-native term sources", () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-models-"));
  const modelDir = path.join(packagesDir, "custom-product-v4");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "customProductDictionaryV4",
    name: "Custom Product Dictionary",
    version: "1.0.0",
    termsUrl: "https://example.test/dictionary/custom-product/v4/terms",
  });
  writeModuleStub(modelDir, {
    family: "custom-product",
    version: "v4",
    semanticModelKey: "customProductDictionaryV4",
  });
  writeJson(path.join(modelDir, "units.json"), [
    { key: "kwhPerYear", label: "Kilowatt hour per year", symbol: "kWh/year" },
  ]);
  writeJson(path.join(modelDir, "terms.json"), [
    {
      number: 1,
      id: 1,
      specRef: "APP-001",
      slug: "energy-rating",
      iri: "https://example.test/dictionary/custom-product/v4/terms/energy-rating",
      termIri: "https://example.test/dictionary/custom-product/v4/terms/energy-rating",
      label: "Energy rating",
      attributeName: "Energy rating",
      definition: "Energy performance rating for the product.",
      shortDefinition: "Energy rating.",
      sourceShortDefinition: "Source energy rating.",
      subcategory: "legacy-subcategory",
      sourceSubcategory: "Legacy Subcategory",
      internalKey: "energyRating",
      dataType: "string",
      rdfType: ["rdf:Property", "owl:DatatypeProperty", "skos:Concept"],
      domainClassKey: "Performance",
      domain: {
        key: "performance",
        iri: "https://example.test/dictionary/custom-product/v4/classes/Performance",
        curie: "exampleClass:Performance",
        label: "Performance",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#string",
        curie: "xsd:string",
        label: "String",
        jsonType: "string",
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
      internalKey: "powerConsumption",
      dataType: "decimal",
      unit: "kwhPerYear",
      domain: {
        key: "performance",
        iri: "https://example.test/dictionary/custom-product/v4/classes/Performance",
        curie: "exampleClass:Performance",
        label: "Performance",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#decimal",
        curie: "xsd:decimal",
        label: "Decimal",
        jsonType: "decimal",
      },
    },
  ]);
  writeJson(path.join(modelDir, "classes.json"), [{
    key: "performance",
    label: "Performance",
    iri: "https://example.test/dictionary/custom-product/v4/classes/Performance",
    root: true,
  }]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/custom-product/v4/terms/energy-rating",
      powerConsumption: {
        "@id": "https://example.test/dictionary/custom-product/v4/terms/power-consumption",
        "@type": "http://www.w3.org/2001/XMLSchema#decimal",
      },
    },
  });

  try {
    const registry = createSemanticModelRegistry({ packagesDir });
    const energyRating = registry.getTermBySlug("customProductDictionaryV4", "energy-rating");
    const powerConsumption = registry.getTermBySlug("customProductDictionaryV4", "power-consumption");

    assert.equal(energyRating.iri, "https://example.test/dictionary/custom-product/v4/terms/energy-rating");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "termIri"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "attributeName"), false);
    assert.equal(energyRating.internalKey, "energyRating");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "shortDefinition"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "sourceShortDefinition"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "subcategory"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "sourceSubcategory"), false);
    assert.equal(energyRating.domain.curie, "exampleClass:Performance");
    assert.equal(energyRating.range.curie, "xsd:string");
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "domainClassKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "rdfType"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(energyRating, "conformsTo"), false);
    assert.deepEqual(
      Object.keys(energyRating).filter((key) => key.endsWith("Keys")),
      []
    );
    assert.deepEqual(energyRating.dataType, { format: "String", jsonType: "string", xsdType: "xsd:string" });
    assert.equal(energyRating.unitDisplay, "n.a.");
    assert.equal(energyRating.domain.label, "Performance");

    assert.equal(powerConsumption.iri, "https://example.test/dictionary/custom-product/v4/terms/power-consumption");
    assert.deepEqual(powerConsumption.dataType, { format: "Decimal", jsonType: "decimal", xsdType: "xsd:decimal" });
    assert.equal(powerConsumption.range.iri, "http://www.w3.org/2001/XMLSchema#decimal");
    assert.equal(powerConsumption.range.curie, "xsd:decimal");
    assert.equal(powerConsumption.range.jsonType, "decimal");
    assert.equal(powerConsumption.unitDisplay, "kWh/year");
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});

test("dictionary routes serve registered models and canonical artifacts", async () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-route-models-"));
  writeSemanticFixture(packagesDir);
  writeSemanticFixture(packagesDir, {
    family: "alternate-product",
    version: "v2",
    semanticModelKey: "alternateProductDictionaryV2",
    name: "Alternate Product Dictionary",
    termSlug: "serial-number",
    termLabel: "Serial number",
  });

  try {
    const app = createDictionaryApp({
      registry: createSemanticModelRegistry({ packagesDir }),
    });

    const modelList = await invokeRoute(app, { path: "/api/semantic-models" });
    const modelListBody = parseJsonResponse(modelList);
    assert.equal(modelList.statusCode, 200);
    assert.ok(modelListBody.some((model) => model.semanticModelKey === "exampleProductDictionaryV1"));
    assert.ok(modelListBody.some((model) => model.semanticModelKey === "alternateProductDictionaryV2"));

    const manifest = await invokeRoute(app, {
      path: "/dictionary/:family/:version/manifest.json",
      params: { family: "example-product", version: "v1" },
    });
    assert.equal(manifest.statusCode, 200);
    assert.equal(parseJsonResponse(manifest).semanticModelKey, "exampleProductDictionaryV1");

    const terms = await invokeRoute(app, {
      path: "/api/dictionary/:family/:version/terms",
      params: { family: "alternate-product", version: "v2" },
      query: { search: "serial" },
    });
    assert.equal(terms.statusCode, 200);
    assert.ok(parseJsonResponse(terms).some((term) => term.slug === "serial-number"));
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});

test("company semantic models are derived from company passport type access", async () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "company-access-models-"));
  writeSemanticFixture(packagesDir);
  writeSemanticFixture(packagesDir, {
    family: "alternate-product",
    version: "v2",
    semanticModelKey: "alternateProductDictionaryV2",
    name: "Alternate Product Dictionary",
    termSlug: "serial-number",
    termLabel: "Serial number",
  });
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return {
        rows: [
          {
            semanticModelKey: "exampleProductDictionaryV1",
            typeName: "exampleProductPassportV1",
            displayName: "Example Product Passport v1",
            productCategory: "Example Product",
          },
          {
            semanticModelKey: "alternateProductDictionaryV2",
            typeName: "alternateProductPassportV2",
            displayName: "Alternate Product Passport v2",
            productCategory: "Alternate Product",
          },
        ],
      };
    },
  };

  try {
    const app = createDictionaryApp({
      pool,
      registry: createSemanticModelRegistry({ packagesDir }),
    });

    const response = await invokeRoute(app, {
      path: "/api/companies/:companyId/semantic-models",
      params: { companyId: "7" },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(calls[0].sql.includes("companyPassportAccess"));
    assert.deepEqual(calls[0].params, ["7"]);
    assert.deepEqual(response.body.map((model) => ({
      key: model.semanticModelKey,
      registered: model.registered,
      typeName: model.passportTypes[0].typeName,
    })), [
      {
        key: "exampleProductDictionaryV1",
        registered: true,
        typeName: "exampleProductPassportV1",
      },
      {
        key: "alternateProductDictionaryV2",
        registered: true,
        typeName: "alternateProductPassportV2",
      },
    ]);
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});

test("company semantic models support arbitrary registered models and grouped passport types", async () => {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "company-semantic-models-"));
  const modelDir = path.join(packagesDir, "example-product-v1");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "exampleProductDictionaryV1",
    name: "Example Product Dictionary",
    version: "1.0.0",
    description: "Test example product dictionary",
  });
  writeModuleStub(modelDir, {
    family: "example-product",
    version: "v1",
    semanticModelKey: "exampleProductDictionaryV1",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "udi",
      label: "Unique device identifier",
      iri: "https://example.test/dictionary/example-product/v1/terms/udi",
      internalKey: "udi",
      dataType: "string",
      domain: {
        key: "exampleProductPassport",
        iri: "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport",
        label: "Example Product Passport",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#string",
        curie: "xsd:string",
        label: "String",
        jsonType: "string",
      },
    },
  ]);
  writeJson(path.join(modelDir, "classes.json"), [{
    key: "exampleProductPassport",
    label: "Example Product Passport",
    iri: "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport",
    root: true,
  }]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      udi: "https://example.test/dictionary/example-product/v1/terms/udi",
    },
  });

  const pool = {
    query: async () => ({
      rows: [
        {
          semanticModelKey: "exampleProductDictionaryV1",
          typeName: "exampleProductPassportV1",
          displayName: "Example Product Passport v1",
          productCategory: "Example Product",
        },
        {
          semanticModelKey: "exampleProductDictionaryV1",
          typeName: "implantableDevicePassportV1",
          displayName: "Implantable Device Passport v1",
          productCategory: "Example Product",
        },
        {
          semanticModelKey: "externalFutureDictionaryV9",
          typeName: "futureProductPassportV9",
          displayName: "Future Product Passport v9",
          productCategory: "Future Product",
        },
      ],
    }),
  };

  try {
    const registry = createSemanticModelRegistry({ packagesDir });
    const app = createDictionaryApp({ pool, registry });
    const response = await invokeRoute(app, {
      path: "/api/companies/:companyId/semantic-models",
      params: { companyId: "11" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.length, 2);
    const exampleModel = response.body.find((model) => model.semanticModelKey === "exampleProductDictionaryV1");
    const externalModel = response.body.find((model) => model.semanticModelKey === "externalFutureDictionaryV9");

    assert.equal(exampleModel.registered, true);
    assert.equal(exampleModel.family, "example-product");
    assert.equal(exampleModel.passportTypes.length, 2);
    assert.deepEqual(exampleModel.passportTypes.map((type) => type.typeName), [
      "exampleProductPassportV1",
      "implantableDevicePassportV1",
    ]);
    assert.equal(externalModel.registered, false);
    assert.equal(externalModel.passportTypes[0].typeName, "futureProductPassportV9");
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
});
