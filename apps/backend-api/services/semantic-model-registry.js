"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RESOURCES_DIR = path.join(__dirname, "../resources/semantics");

function loadJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function normalizePathSegment(value) {
  return String(value || "").trim().toLowerCase();
}

function modelSortValue(model) {
  return `${model.family}/${model.version}/${model.semanticModelKey}`;
}

function indexTerms(terms = []) {
  const termsBySlug = new Map();
  const termsByFieldKey = new Map();
  const termsByIri = new Map();

  for (const term of terms) {
    if (term?.slug) termsBySlug.set(String(term.slug), term);
    if (term?.iri) termsByIri.set(String(term.iri), term);
    if (term?.termIri) termsByIri.set(String(term.termIri), term);
    for (const fieldKey of (term?.appFieldKeys || [])) {
      if (fieldKey) termsByFieldKey.set(String(fieldKey), term);
    }
  }

  return { termsBySlug, termsByFieldKey, termsByIri };
}

function summarizeModel(model) {
  const manifest = model.manifest || {};
  return {
    semanticModelKey: model.semanticModelKey,
    key: model.semanticModelKey,
    family: model.family,
    version: model.version,
    name: manifest.name || model.semanticModelKey,
    description: manifest.description || "",
    dictionaryVersion: manifest.versioning?.dictionaryVersion || manifest.version || null,
    sourceVersion: manifest.versioning?.sourceVersion || null,
    contextUrl: manifest.contextUrl || model.contextUrl,
    termsUrl: manifest.termsUrl || model.termsUrl,
    catalogUrl: manifest.interoperabilityProfile?.catalogUrl || model.catalogUrl,
    registered: true,
  };
}

function buildModel({ resourcesDir, family, version }) {
  const modelDir = path.join(resourcesDir, family, version);
  const manifest = loadJsonIfExists(path.join(modelDir, "manifest.json"), null);
  if (!manifest) return null;

  const semanticModelKey = normalizeKey(
    manifest.semanticModelKey
    || manifest.versioning?.semanticModelKey
    || `${family}_${version}`
  );
  if (!semanticModelKey) return null;

  const terms = loadJsonIfExists(path.join(modelDir, "terms.json"), []);
  const categories = loadJsonIfExists(path.join(modelDir, "categories.json"), []);
  const units = loadJsonIfExists(path.join(modelDir, "units.json"), []);
  const fieldMap = loadJsonIfExists(path.join(modelDir, "field-map.json"), {});
  const context = loadJsonIfExists(path.join(modelDir, "context.jsonld"), {});
  const dcatCatalog = loadJsonIfExists(path.join(modelDir, "catalog.jsonld"), null);
  const categoryRules = loadJsonIfExists(path.join(modelDir, "category-rules.json"), null);
  const indexes = indexTerms(terms);
  const basePath = `/dictionary/${family}/${version}`;
  const apiPath = `/api/dictionary/${family}/${version}`;

  return {
    semanticModelKey,
    family,
    version,
    modelDir,
    manifest,
    terms,
    categories,
    units,
    fieldMap,
    context,
    dcatCatalog,
    categoryRules,
    indexes,
    contextUrl: manifest.contextUrl || `${basePath}/context.jsonld`,
    termsUrl: manifest.termsUrl || `${basePath}/terms`,
    catalogUrl: manifest.interoperabilityProfile?.catalogUrl || `${basePath}/catalog.jsonld`,
    basePath,
    apiPath,
  };
}

module.exports = function createSemanticModelRegistry({ resourcesDir = DEFAULT_RESOURCES_DIR } = {}) {
  const modelsByKey = new Map();
  const modelsByPath = new Map();

  function loadModels() {
    modelsByKey.clear();
    modelsByPath.clear();
    if (!fs.existsSync(resourcesDir)) return;

    for (const familyEntry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
      if (!familyEntry.isDirectory()) continue;
      const family = normalizePathSegment(familyEntry.name);
      const familyDir = path.join(resourcesDir, familyEntry.name);

      for (const versionEntry of fs.readdirSync(familyDir, { withFileTypes: true })) {
        if (!versionEntry.isDirectory()) continue;
        const version = normalizePathSegment(versionEntry.name);
        const model = buildModel({ resourcesDir, family, version });
        if (!model) continue;
        modelsByKey.set(model.semanticModelKey, model);
        modelsByPath.set(`${family}/${version}`, model);
      }
    }
  }

  loadModels();

  function getModel(modelKey) {
    return modelsByKey.get(normalizeKey(modelKey)) || null;
  }

  function getModelByPath(family, version) {
    return modelsByPath.get(`${normalizePathSegment(family)}/${normalizePathSegment(version)}`) || null;
  }

  function listModels() {
    return [...modelsByKey.values()]
      .sort((left, right) => modelSortValue(left).localeCompare(modelSortValue(right)))
      .map(summarizeModel);
  }

  function getManifest(modelKey) {
    return getModel(modelKey)?.manifest || null;
  }

  function getTerms(modelKey) {
    return getModel(modelKey)?.terms || [];
  }

  function getCategories(modelKey) {
    return getModel(modelKey)?.categories || [];
  }

  function getUnits(modelKey) {
    return getModel(modelKey)?.units || [];
  }

  function getFieldMap(modelKey) {
    return getModel(modelKey)?.fieldMap || {};
  }

  function getContext(modelKey) {
    return getModel(modelKey)?.context || null;
  }

  function getDcatCatalog(modelKey) {
    return getModel(modelKey)?.dcatCatalog || null;
  }

  function getCategoryRules(modelKey) {
    return getModel(modelKey)?.categoryRules || null;
  }

  function getTermBySlug(modelKey, slug) {
    return getModel(modelKey)?.indexes.termsBySlug.get(String(slug || "")) || null;
  }

  function getTermByFieldKey(modelKey, fieldKey) {
    return getModel(modelKey)?.indexes.termsByFieldKey.get(String(fieldKey || "")) || null;
  }

  function getTermByIri(modelKey, iri) {
    return getModel(modelKey)?.indexes.termsByIri.get(String(iri || "")) || null;
  }

  function resolveFieldKey(modelKey, fieldKey) {
    const model = getModel(modelKey);
    if (!model) return null;
    return model.fieldMap[String(fieldKey || "")] || null;
  }

  function getCategoryRequirementForField(modelKey, fieldKey, category) {
    const requirements = getCategoryRules(modelKey)?.requirementsByFieldKey?.[String(fieldKey || "")]?.requirements || null;
    if (!requirements) return null;
    return requirements[String(category || "")] || null;
  }

  function buildJsonLdContext(typeDef, modelKey = null) {
    const resolvedModelKey = modelKey || typeDef?.semanticModelKey || typeDef?.fieldsJson?.semanticModelKey || null;
    const model = getModel(resolvedModelKey);
    const dppContext = {
      "@version": 1.1,
      dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
      DigitalProductPassport: "dpp:DigitalProductPassport",
      dppId: "dpp:dppId",
      passportType: "dpp:passportType",
      semanticModel: "dpp:semanticModel",
      modelName: "dpp:modelName",
      internalAliasId: "dpp:internalAliasId",
      releaseStatus: "dpp:releaseStatus",
      versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
      createdAt: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
      updatedAt: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
    };

    if (!model) return [dppContext];

    const contexts = [dppContext, model.contextUrl];
    const inlineOverrides = {};
    for (const section of (typeDef?.fieldsJson?.sections || [])) {
      for (const field of (section.fields || [])) {
        if (!field?.key) continue;
        const termIri = resolveFieldKey(model.semanticModelKey, field.key) || field.semanticId;
        if (termIri && !model.context?.["@context"]?.[field.key]) {
          inlineOverrides[field.key] = { "@id": termIri };
        }
      }
    }
    if (Object.keys(inlineOverrides).length > 0) contexts.push(inlineOverrides);
    return contexts;
  }

  return {
    reload: loadModels,
    getModel,
    getModelByPath,
    listModels,
    summarizeModel,
    getManifest,
    getTerms,
    getCategories,
    getUnits,
    getFieldMap,
    getContext,
    getDcatCatalog,
    getCategoryRules,
    getTermBySlug,
    getTermByFieldKey,
    getTermByIri,
    resolveFieldKey,
    getCategoryRequirementForField,
    buildJsonLdContext,
  };
};
