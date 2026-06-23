"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RESOURCES_DIR = path.join(__dirname, "../../resources/semantics");

const DATA_TYPE_PRESETS = {
  string: { format: "String", jsonType: "string", xsdType: "xsd:string" },
  decimal: { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" },
  number: { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" },
  integer: { format: "Integer", jsonType: "integer", xsdType: "xsd:integer" },
  boolean: { format: "Boolean", jsonType: "boolean", xsdType: "xsd:boolean" },
  date: { format: "Date", jsonType: "string", xsdType: "xsd:date" },
  datetime: { format: "DateTime", jsonType: "string", xsdType: "xsd:dateTime" },
  uri: { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
  url: { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
};

function loadJsonIfExists(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function normalizePathSegment(value) {
  return String(value || "").trim().toLowerCase();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) =>
      entryValue !== undefined
      && (!Array.isArray(entryValue) || entryValue.length > 0)
    )
  );
}

function normalizeDataType(dataType) {
  if (!dataType) return null;
  if (typeof dataType === "string") {
    const preset = DATA_TYPE_PRESETS[normalizePathSegment(dataType)];
    return preset ? { ...preset } : { format: dataType, jsonType: "string", xsdType: "xsd:string" };
  }
  if (isPlainObject(dataType)) return { ...dataType };
  return dataType;
}

function createLookupByKey(items = []) {
  const lookup = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.key) lookup.set(String(item.key), item);
  }
  return lookup;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/g, "");
}

function canonicalTermsBaseUrl(manifest, basePath) {
  const baseIri = trimTrailingSlash(manifest?.baseIri);
  if (baseIri) return `${baseIri}/terms`;

  const termsUrl = trimTrailingSlash(manifest?.termsUrl);
  if (termsUrl) return termsUrl.replace("/api/dictionary/", "/dictionary/");

  return `${basePath}/terms`;
}

function xsdIriFromCurie(value) {
  const type = String(value || "").trim();
  if (!type) return null;
  if (/^https?:\/\//i.test(type)) return type;
  if (type.startsWith("xsd:")) return `http://www.w3.org/2001/XMLSchema#${type.slice(4)}`;
  return null;
}

function rangeFromDataType(dataType) {
  if (!isPlainObject(dataType)) return null;
  return compactObject({
    iri: xsdIriFromCurie(dataType.xsdType) || undefined,
    curie: dataType.xsdType || undefined,
    label: dataType.format || dataType.jsonType || undefined,
    jsonType: dataType.jsonType || undefined,
    items: dataType.items || undefined,
  });
}

function normalizeTermsSource(termsSource, { manifest, basePath, categories, units } = {}) {
  const sourceTerms = Array.isArray(termsSource) ? termsSource : [];
  const categoriesByKey = createLookupByKey(categories);
  const unitsByKey = createLookupByKey(units);
  const termsBaseUrl = canonicalTermsBaseUrl(manifest, basePath);

  return sourceTerms.map((rawTerm, index) => {
    const term = { ...(rawTerm || {}) };
    const slug = term.slug ? String(term.slug) : "";
    const internalKey = term.internalKey
      || term.elementId
      || term.fieldKey;
    const number = term.number ?? term.id ?? index + 1;
    const iri = term.iri
      || term.termIri
      || term.semanticBinding?.rdfProperty
      || (slug && termsBaseUrl ? `${termsBaseUrl}/${slug}` : null);
    const label = term.label || term.attributeName;
    const categoryLabel = term.categoryLabel || categoriesByKey.get(String(term.category || ""))?.label;
    const rawDomain = term.domain || term.semanticBinding?.domain;
    const domain = isPlainObject(rawDomain) ? { ...rawDomain } : rawDomain;
    if (isPlainObject(domain)) {
      delete domain.broaderClass;
    }
    const dataType = normalizeDataType(term.dataType);
    const range = term.range || term.semanticBinding?.range || rangeFromDataType(dataType);
    const unit = term.unit || "none";
    const unitRecord = unitsByKey.get(String(unit));
    const unitDisplay = term.unitDisplay !== undefined
      ? term.unitDisplay
      : unit === "none"
        ? "n.a."
        : unitRecord?.display || unitRecord?.symbol || unitRecord?.label || unit;
    delete term.id;
    delete term.termIri;
    delete term.attributeName;
    delete term.sourceAttributeName;
    delete term.elementId;
    delete term.accessRights;
    delete term.staticOrDynamic;
    delete term.updateRequirement;
    delete term.granularityLevel;
    delete term.regulatoryRequirement;
    delete term.dinSpecRecommendation;
    delete term.sourceRegulationReference;
    delete term.regulationReferences;
    delete term.dinDkeSpec99100Chapter;
    delete term.componentGranularity;
    delete term.sourceWorkbookRow;
    delete term.shortDefinition;
    delete term.sourceShortDefinition;
    delete term.subcategory;
    delete term.sourceSubcategory;
    delete term.categoryLabel;
    delete term.sourceCategory;
    delete term.domainClassKey;
    delete term.rdfType;
    delete term.range;
    delete term.unitDisplay;
    delete term.semanticBinding;
    delete term.conformsTo;

    return compactObject({
      ...term,
      number,
      specRef: term.specRef,
      slug,
      iri,
      label,
      definition: term.definition,
      category: term.category,
      categoryLabel,
      internalKey,
      dataType,
      unit,
      unitDisplay,
      domain,
      range,
      categoryRequirements: term.categoryRequirements,
    });
  });
}

function modelSortValue(model) {
  return `${model.family}/${model.version}/${model.semanticModelKey}`;
}

function indexTerms(terms = []) {
  const termsBySlug = new Map();
  const termsByIri = new Map();

  for (const term of terms) {
    if (term?.slug) termsBySlug.set(String(term.slug), term);
    if (term?.iri) termsByIri.set(String(term.iri), term);
    if (term?.termIri) termsByIri.set(String(term.termIri), term);
  }

  return { termsBySlug, termsByIri };
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

  const basePath = `/dictionary/${family}/${version}`;
  const apiPath = `/api/dictionary/${family}/${version}`;
  const termsSource = loadJsonIfExists(path.join(modelDir, "terms.json"), []);
  const categories = loadJsonIfExists(path.join(modelDir, "categories.json"), []);
  const units = loadJsonIfExists(path.join(modelDir, "units.json"), []);
  const terms = normalizeTermsSource(termsSource, { manifest, basePath, categories, units });
  const context = loadJsonIfExists(path.join(modelDir, "context.jsonld"), {});
  const dcatCatalog = loadJsonIfExists(path.join(modelDir, "catalog.jsonld"), null);
  const indexes = indexTerms(terms);

  return {
    semanticModelKey,
    family,
    version,
    modelDir,
    manifest,
    terms,
    categories,
    units,
    context,
    dcatCatalog,
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

  function getContext(modelKey) {
    return getModel(modelKey)?.context || null;
  }

  function getDcatCatalog(modelKey) {
    return getModel(modelKey)?.dcatCatalog || null;
  }

  function getTermBySlug(modelKey, slug) {
    return getModel(modelKey)?.indexes.termsBySlug.get(String(slug || "")) || null;
  }

  function getTermByIri(modelKey, iri) {
    return getModel(modelKey)?.indexes.termsByIri.get(String(iri || "")) || null;
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
        const termIri = field.semanticId;
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
    getContext,
    getDcatCatalog,
    getTermBySlug,
    getTermByIri,
    buildJsonLdContext,
  };
};
