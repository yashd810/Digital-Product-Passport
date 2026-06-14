"use strict";

const createSemanticModelRegistry = require("../infrastructure/semantics/create-semantic-model-registry");

const DPP_CONTEXT = {
  "@version": 1.1,
  dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
  DigitalProductPassport: "dpp:DigitalProductPassport",
  digitalProductPassportId: "dpp:digitalProductPassportId",
  uniqueProductIdentifier: "dpp:uniqueProductIdentifier",
  granularity: "dpp:granularity",
  dppSchemaVersion: "dpp:dppSchemaVersion",
  dppStatus: "dpp:dppStatus",
  lastUpdate: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  economicOperatorId: "dpp:economicOperatorId",
  facilityId: "dpp:facilityId",
  contentSpecificationIds: "dpp:contentSpecificationIds",
  subjectDid: "dpp:subjectDid",
  dppDid: "dpp:dppDid",
  companyDid: "dpp:companyDid",
  dppId: "dpp:dppId",
  passportType: "dpp:passportType",
  semanticModel: "dpp:semanticModel",
  modelName: "dpp:modelName",
  internalAliasId: "dpp:internalAliasId",
  releaseStatus: "dpp:releaseStatus",
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  archivedAt: { "@id": "dpp:archivedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  createdAt: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  updatedAt: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
};

function readTypeValue(typeDef, camelKey, snakeKey = null) {
  if (!typeDef || typeof typeDef !== "object") return null;
  if (typeDef[camelKey] !== undefined) return typeDef[camelKey];
  if (snakeKey && typeDef[snakeKey] !== undefined) return typeDef[snakeKey];
  return null;
}

function getFieldsJson(typeDef) {
  return readTypeValue(typeDef, "fieldsJson", "fields_json") || {};
}

function normalizeSemanticModelKey(modelKey) {
  return String(modelKey || "").trim().toLowerCase();
}

function getSemanticModelKey(typeDef, options = {}) {
  return normalizeSemanticModelKey(
    options.semanticModelKey
    || readTypeValue(typeDef, "semanticModelKey", "semantic_model_key")
    || getFieldsJson(typeDef)?.semanticModelKey
    || ""
  );
}

function getTypeName(typeDef) {
  return readTypeValue(typeDef, "typeName", "type_name") || "";
}

function createSemanticPassportExportService({
  semanticModelRegistry = createSemanticModelRegistry(),
} = {}) {
  function getModelByKey(modelKey) {
    return semanticModelRegistry.getModel(modelKey) || null;
  }

  function resolveSemanticModel({ passportType = null, typeDef = null, options = {} } = {}) {
    const explicitModelKey = getSemanticModelKey(typeDef, options);
    const explicitModel = explicitModelKey ? getModelByKey(explicitModelKey) : null;
    if (explicitModel) return explicitModel;

    return null;
  }

  function isSemanticModelExportType(passportType, options = {}, typeDef = null) {
    return Boolean(resolveSemanticModel({ passportType, typeDef, options }));
  }

  function resolveDictionaryTermIri(model, fieldKey, semanticId = null) {
    if (semanticId) return semanticId;
    return null;
  }

  function buildInlineContext({ model, passports = [], typeDef = null } = {}) {
    const inlineContext = {};
    if (!model) return inlineContext;

    const knownContext = model.context?.["@context"] || {};
    const addField = (fieldKey, semanticId = null) => {
      if (!fieldKey || knownContext[fieldKey]) return;
      const termIri = resolveDictionaryTermIri(model, fieldKey, semanticId);
      if (termIri) inlineContext[fieldKey] = { "@id": termIri };
    };

    for (const section of (getFieldsJson(typeDef).sections || [])) {
      for (const field of (section.fields || [])) {
        addField(field.key, field.semanticId);
        if (field?.type === "table") {
          for (const column of (field.table_columns || [])) {
            addField(column?.key, column?.semanticId);
          }
        }
      }
    }

    for (const passport of passports || []) {
      const semanticIds = passport?._semanticIds || {};
      for (const [key, value] of Object.entries(passport || {})) {
        if (value === undefined || key === "_semanticIds") continue;
        addField(key, semanticIds[key]);
      }
    }

    return inlineContext;
  }

  function sanitizePassport(passport, passportType) {
    const clean = { "@type": "DigitalProductPassport" };
    const resolvedPassportType = passport?.passportType || passportType || null;

    for (const [key, value] of Object.entries(passport || {})) {
      if (value === undefined) continue;
      if (key === "_semanticIds") continue;
      clean[key] = value;
    }

    if (resolvedPassportType && !clean.passportType) {
      clean.passportType = resolvedPassportType;
    }

    return clean;
  }

  function buildSemanticModelMetadata(model) {
    if (!model) return null;
    const manifest = model.manifest || {};
    return {
      semanticModelKey: model.semanticModelKey,
      name: manifest.name || model.semanticModelKey,
      dictionaryVersion: manifest.versioning?.dictionaryVersion || manifest.version || null,
      contextUrl: manifest.contextUrl || model.contextUrl,
      termsUrl: manifest.termsUrl || model.termsUrl,
      catalogUrl: manifest.interoperabilityProfile?.catalogUrl || model.catalogUrl,
      issuerDid: manifest.issuerDid || manifest.authority?.stewardingOrganization || null,
    };
  }

  function buildPassportJsonLdContext(typeDef, passportType = null, options = {}) {
    const resolvedType = String(passportType || getTypeName(typeDef) || "").trim();
    const model = resolveSemanticModel({ passportType: resolvedType, typeDef, options });
    const contexts = [DPP_CONTEXT];
    if (!model) return contexts;

    contexts.push(model.contextUrl);
    const inlineContext = buildInlineContext({ model, typeDef });
    if (Object.keys(inlineContext).length > 0) contexts.push(inlineContext);
    return contexts;
  }

  function buildPassportJsonLdExport(passports, passportType, options = {}) {
    if (!Array.isArray(passports)) return passports;

    const typeDef = options.typeDef || null;
    const resolvedType = String(passportType || passports[0]?.passportType || getTypeName(typeDef) || "").trim();
    const graph = passports.map((passport) => sanitizePassport(passport, resolvedType));
    const model = resolveSemanticModel({ passportType: resolvedType, typeDef, options });
    const contexts = [DPP_CONTEXT];

    if (model) {
      contexts.push(model.contextUrl);
    }

    const inlineContext = buildInlineContext({ model, passports: graph, typeDef });
    if (Object.keys(inlineContext).length > 0) contexts.push(inlineContext);

    const metadata = buildSemanticModelMetadata(model);
    return {
      "@context": contexts,
      "@graph": graph,
      ...(metadata
        ? {
            passportType: resolvedType || graph[0]?.passportType || null,
            semanticModel: metadata,
            semantic_model: metadata,
          }
        : {}),
    };
  }

  return {
    buildPassportJsonLdContext,
    buildPassportJsonLdExport,
    buildSemanticPassportJsonExport: buildPassportJsonLdExport,
    isSemanticModelExportType,
    resolveSemanticModel,
  };
}

module.exports = createSemanticPassportExportService;
