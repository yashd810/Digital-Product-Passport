"use strict";

const createSemanticModelRegistry = require("./semantic-model-registry");
const { getPassportFieldDataTypeError } = require("../shared/passports/passport-field-data-types");
const {
  coerceSemanticGraphPropertyValue,
  flattenSchemaFieldsFromSections,
} = require("../shared/passports/passport-helpers");
const {
  getSemanticGraphClass,
  getSemanticGraphEnum,
  isManyProperty,
} = require("../shared/passports/passport-semantic-graph");

const dppContext = {
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
  fields: "dpp:fields",
  elements: "dpp:elements",
  elementId: "dpp:elementId",
  objectType: "dpp:objectType",
  dictionaryReference: { "@id": "dpp:dictionaryReference", "@type": "@id" },
  valueDataType: "dpp:valueDataType",
  value: "dpp:value",
  extensions: "dpp:extensions",
  platform: "dpp:platform",
  dppId: "dpp:dppId",
  passportType: "dpp:passportType",
  semanticModel: "dpp:semanticModel",
  modelName: "dpp:modelName",
  internalAliasId: "dpp:internalAliasId",
  releaseStatus: "dpp:releaseStatus",
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  internalId: "dpp:internalId",
  archivedAt: { "@id": "dpp:archivedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  createdAt: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  updatedAt: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
};

function readTypeValue(typeDef, camelKey) {
  if (!typeDef || typeof typeDef !== "object") return null;
  if (typeDef[camelKey] !== undefined) return typeDef[camelKey];
  return null;
}

function getFieldsJson(typeDef) {
  return readTypeValue(typeDef, "fieldsJson") || {};
}

function normalizeSemanticModelKey(modelKey) {
  return String(modelKey || "").trim();
}

function getSemanticModelKey(typeDef, options = {}) {
  return normalizeSemanticModelKey(
    options.semanticModelKey
    || readTypeValue(typeDef, "semanticModelKey")
    || getFieldsJson(typeDef)?.semanticModelKey
    || ""
  );
}

function getTypeName(typeDef) {
  return readTypeValue(typeDef, "typeName") || "";
}

function coercePassportSchemaValues(passport, typeDef) {
  const typedPassport = {
    ...(passport || {}),
    ...(passport?.fields && typeof passport.fields === "object" && !Array.isArray(passport.fields)
      ? { fields: { ...passport.fields } }
      : {}),
  };
  const schemaFields = flattenSchemaFieldsFromSections(getFieldsJson(typeDef).sections || []);
  const semanticGraph = getFieldsJson(typeDef).semanticGraph;
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }

  for (const field of schemaFields) {
    if (!field?.key) continue;
    if (!field.rangeKind) {
      throw new Error(`Field "${field.key}" is missing required semantic graph metadata.`);
    }
    const schemaError = getPassportFieldDataTypeError(field, { requireExplicit: true });
    if (schemaError) throw new Error(schemaError);
    const hasNestedValue = Object.prototype.hasOwnProperty.call(typedPassport.fields || {}, field.key);
    const hasTopLevelValue = Object.prototype.hasOwnProperty.call(typedPassport, field.key);
    if (!hasNestedValue && !hasTopLevelValue) continue;
    const rawValue = hasNestedValue ? typedPassport.fields[field.key] : typedPassport[field.key];
    const typedValue = coerceSemanticGraphPropertyValue(
      field,
      rawValue,
      semanticGraph,
      field.label || field.key
    );
    if (hasNestedValue) typedPassport.fields[field.key] = typedValue;
    if (hasTopLevelValue) typedPassport[field.key] = typedValue;
  }

  return typedPassport;
}

function decorateSemanticGraphValue(property, value, semanticGraph) {
  if (value === null || value === undefined) return value;
  const many = isManyProperty(property);
  const values = many ? value : [value];
  const decorated = values.map((entry) => {
    if (property.rangeKind === "scalar") return entry;
    if (property.rangeKind === "enum") {
      const enumDef = getSemanticGraphEnum(semanticGraph, property.rangeEnumKey);
      const enumValue = enumDef?.values?.find((candidate) => candidate.key === entry);
      return enumValue?.semanticId ? { "@id": enumValue.semanticId } : entry;
    }
    if (property.relationshipType === "reference") return entry;
    const classDef = getSemanticGraphClass(semanticGraph, property.rangeClassKey);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const output = {
      ...entry,
      "@type": classDef?.semanticId || property.rangeIri,
    };
    for (const childProperty of classDef?.properties || []) {
      if (!Object.prototype.hasOwnProperty.call(output, childProperty.key)) continue;
      output[childProperty.key] = decorateSemanticGraphValue(
        childProperty,
        output[childProperty.key],
        semanticGraph
      );
    }
    return output;
  });
  return many ? decorated : decorated[0];
}

function decoratePassportSemanticGraph(passport, typeDef) {
  const semanticGraph = getFieldsJson(typeDef).semanticGraph;
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }
  const rootClass = getSemanticGraphClass(semanticGraph, semanticGraph.rootClassKey);
  const decorated = {
    ...passport,
    ...(passport?.fields && typeof passport.fields === "object" && !Array.isArray(passport.fields)
      ? { fields: { ...passport.fields } }
      : {}),
  };
  for (const property of rootClass?.properties || []) {
    if (Object.prototype.hasOwnProperty.call(decorated, property.key)) {
      decorated[property.key] = decorateSemanticGraphValue(property, decorated[property.key], semanticGraph);
    }
    if (decorated.fields && Object.prototype.hasOwnProperty.call(decorated.fields, property.key)) {
      decorated.fields[property.key] = decorateSemanticGraphValue(
        property,
        decorated.fields[property.key],
        semanticGraph
      );
    }
  }
  return decorated;
}

function buildSemanticGraphInlineContext(semanticGraph) {
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }
  const scalarTypes = {
    decimal: "http://www.w3.org/2001/XMLSchema#decimal",
    integer: "http://www.w3.org/2001/XMLSchema#integer",
    boolean: "http://www.w3.org/2001/XMLSchema#boolean",
    date: "http://www.w3.org/2001/XMLSchema#date",
    datetime: "http://www.w3.org/2001/XMLSchema#dateTime",
    uri: "@id",
  };
  const buildClassContext = (classKey, visited = new Set()) => {
    if (visited.has(classKey)) return {};
    const classDef = getSemanticGraphClass(semanticGraph, classKey);
    if (!classDef) return {};
    const nextVisited = new Set(visited).add(classKey);
    return Object.fromEntries((classDef.properties || []).map((property) => {
      const term = { "@id": property.semanticId };
      if (isManyProperty(property)) term["@container"] = "@set";
      if (property.rangeKind === "scalar") {
        if (scalarTypes[property.dataType]) term["@type"] = scalarTypes[property.dataType];
      } else if (property.rangeKind === "enum" || property.relationshipType === "reference") {
        term["@type"] = "@id";
      } else {
        const childContext = buildClassContext(property.rangeClassKey, nextVisited);
        if (Object.keys(childContext).length) term["@context"] = childContext;
      }
      return [property.key, term];
    }));
  };
  return buildClassContext(semanticGraph.rootClassKey);
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
    void passportType;
    void options;
    return Boolean(getFieldsJson(typeDef).semanticGraph);
  }

  function buildInlineContext({ model, passports = [], typeDef = null } = {}) {
    void passports;
    const inlineContext = {};
    const knownContext = model?.context?.["@context"] || {};
    const semanticGraph = getFieldsJson(typeDef).semanticGraph;
    const graphContext = buildSemanticGraphInlineContext(semanticGraph);
    for (const [key, value] of Object.entries(graphContext)) {
      if (!knownContext[key]) inlineContext[key] = value;
    }
    return inlineContext;
  }

  function sanitizePassport(passport, passportType, typeDef = null) {
    const semanticGraph = getFieldsJson(typeDef).semanticGraph;
    if (!semanticGraph) {
      throw new Error("Semantic passport export requires a semantic class graph.");
    }
    const rootClass = getSemanticGraphClass(semanticGraph, semanticGraph.rootClassKey);
    const clean = {
      "@type": rootClass?.semanticId
        ? ["DigitalProductPassport", rootClass.semanticId]
        : "DigitalProductPassport",
    };
    const typedPassport = decoratePassportSemanticGraph(
      coercePassportSchemaValues(passport, typeDef),
      typeDef
    );
    const resolvedPassportType = typedPassport?.passportType || passportType || null;

    for (const [key, value] of Object.entries(typedPassport || {})) {
      if (value === undefined) continue;
      if (["_semanticIds", "@type", "@context"].includes(key)) continue;
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
      classesUrl: manifest.classesUrl || null,
      enumsUrl: manifest.enumsUrl || null,
      ontologyUrl: manifest.ontologyUrl || null,
      shapesUrl: manifest.shapesUrl || null,
      issuerDid: manifest.issuerDid || manifest.authority?.stewardingOrganization || null,
    };
  }

  function buildPassportJsonLdContext(typeDef, passportType = null, options = {}) {
    const resolvedType = String(passportType || getTypeName(typeDef) || "").trim();
    const model = resolveSemanticModel({ passportType: resolvedType, typeDef, options });
    const contexts = [dppContext];
    if (model) contexts.push(model.contextUrl);
    const inlineContext = buildInlineContext({ model, typeDef });
    if (Object.keys(inlineContext).length > 0) contexts.push(inlineContext);
    return contexts;
  }

  function buildPassportJsonLdExport(passports, passportType, options = {}) {
    if (!Array.isArray(passports)) return passports;

    const typeDef = options.typeDef || null;
    const resolvedType = String(passportType || passports[0]?.passportType || getTypeName(typeDef) || "").trim();
    const graph = passports.map((passport) => sanitizePassport(passport, resolvedType, typeDef));
    const model = resolveSemanticModel({ passportType: resolvedType, typeDef, options });
    const contexts = [dppContext];

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
