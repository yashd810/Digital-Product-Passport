import {
  buildSemanticGraphInlineContext,
  coerceSemanticGraphPropertyValue,
  decorateSemanticGraphPropertyValue,
  getRootSemanticProperty,
  getSemanticGraphClass,
} from "../passports/semanticGraphUtils";
import { flattenSchemaFieldsFromSections } from "../passports/passportSchemaUtils";

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
  passportType: "dpp:passportType",
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  internalId: "dpp:internalId",
  dppId: "dpp:dppId",
  semanticModel: "dpp:semanticModel",
  modelName: "dpp:modelName",
  internalAliasId: "dpp:internalAliasId",
  releaseStatus: "dpp:releaseStatus",
  archivedAt: { "@id": "dpp:archivedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  createdAt: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  updatedAt: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
};

function normalizeSemanticModel(options = {}) {
  const semanticModel = options.semanticModel && typeof options.semanticModel === "object"
    ? options.semanticModel
    : {};
  const semanticModelKey = semanticModel.semanticModelKey || semanticModel.key || options.semanticModelKey || "";
  const contextUrl = semanticModel.contextUrl || options.contextUrl || "";

  if (!semanticModelKey && !contextUrl) return null;

  return {
    semanticModelKey: semanticModelKey || null,
    contextUrl: contextUrl || null,
    family: semanticModel.family || null,
    version: semanticModel.version || null,
    name: semanticModel.name || null,
  };
}

function getTypeDefSections(typeDef = {}) {
  return typeDef?.fieldsJson?.sections || typeDef?.sections || [];
}

function getTypeDefSemanticGraph(typeDef = {}) {
  return typeDef?.fieldsJson?.semanticGraph || null;
}

function coercePassportSchemaValues(passport, typeDef) {
  const typedPassport = {
    ...(passport || {}),
    ...(passport?.fields && typeof passport.fields === "object" && !Array.isArray(passport.fields)
      ? { fields: { ...passport.fields } }
      : {}),
  };
  const schemaFields = flattenSchemaFieldsFromSections(getTypeDefSections(typeDef));
  const semanticGraph = getTypeDefSemanticGraph(typeDef);
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }

  for (const field of schemaFields) {
    if (!field?.key) continue;
    const semanticProperty = field.rangeKind
      ? (getRootSemanticProperty(semanticGraph, field.key) || field)
      : null;
    if (!semanticProperty) {
      throw new Error(`Field "${field.key}" is missing required semantic graph metadata.`);
    }
    const hasNestedValue = Object.prototype.hasOwnProperty.call(typedPassport.fields || {}, field.key);
    const hasTopLevelValue = Object.prototype.hasOwnProperty.call(typedPassport, field.key);
    if (!hasNestedValue && !hasTopLevelValue) continue;
    const rawValue = hasNestedValue ? typedPassport.fields[field.key] : typedPassport[field.key];
    const typedValue = coerceSemanticGraphPropertyValue(
      semanticProperty,
      rawValue,
      semanticGraph,
      field.label || field.key
    );
    if (hasNestedValue) typedPassport.fields[field.key] = typedValue;
    if (hasTopLevelValue) typedPassport[field.key] = typedValue;
  }

  return typedPassport;
}

function buildInlineContext(typeDef = null) {
  const semanticGraph = getTypeDefSemanticGraph(typeDef);
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }
  return buildSemanticGraphInlineContext(semanticGraph);
}

function sanitizePassport(passport, passportType, typeDef = null) {
  const semanticGraph = getTypeDefSemanticGraph(typeDef);
  if (!semanticGraph) {
    throw new Error("Semantic passport export requires a semantic class graph.");
  }
  const rootClass = getSemanticGraphClass(semanticGraph, semanticGraph.rootClassKey);
  const clean = {
    "@type": rootClass?.semanticId
      ? ["DigitalProductPassport", rootClass.semanticId]
      : "DigitalProductPassport",
  };
  const typedPassport = coercePassportSchemaValues(passport, typeDef);
  const resolvedPassportType = typedPassport.passportType || passportType || null;

  Object.entries(typedPassport || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (["_semanticIds", "@type", "@context"].includes(key)) return;
    clean[key] = value;
  });

  if (resolvedPassportType && !clean.passportType) {
    clean.passportType = resolvedPassportType;
  }

  for (const section of getTypeDefSections(typeDef)) {
    for (const field of section?.fields || []) {
      const property = field?.rangeKind
        ? (getRootSemanticProperty(semanticGraph, field.key) || field)
        : null;
      if (!property) {
        throw new Error(`Field "${field?.key || "unknown"}" is missing required semantic graph metadata.`);
      }
      if (Object.prototype.hasOwnProperty.call(clean, field.key)) {
        clean[field.key] = decorateSemanticGraphPropertyValue(property, clean[field.key], semanticGraph);
      }
      if (clean.fields && Object.prototype.hasOwnProperty.call(clean.fields, field.key)) {
        clean.fields[field.key] = decorateSemanticGraphPropertyValue(
          property,
          clean.fields[field.key],
          semanticGraph
        );
      }
    }
  }

  return clean;
}

export function buildPassportJsonLdExport(passports, passportType, options = {}) {
  if (!Array.isArray(passports)) return passports;

  const resolvedType = String(passportType || passports[0]?.passportType || "").trim();
  const typeDef = options.typeDef || null;
  const graph = passports.map((passport) => sanitizePassport(passport, resolvedType, typeDef));
  const semanticModel = normalizeSemanticModel(options);
  const contexts = [dppContext];

  if (semanticModel?.contextUrl && !contexts.includes(semanticModel.contextUrl)) {
    contexts.push(semanticModel.contextUrl);
  }
  const inlineContext = buildInlineContext(typeDef);
  if (Object.keys(inlineContext).length > 0) {
    contexts.push(inlineContext);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(semanticModel
      ? {
          passportType: resolvedType || graph[0]?.passportType || null,
          semanticModel,
        }
      : {}),
  };
}
