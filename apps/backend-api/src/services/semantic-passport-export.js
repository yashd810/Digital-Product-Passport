"use strict";

const createSemanticModelRegistry = require("./semantic-model-registry");
const { getPassportFieldDataTypeError } = require("../shared/passports/passport-field-data-types");
const { coercePassportScalarValue } = require("../shared/passports/passport-helpers");

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

function coerceSchemaValue(value, dataType, label = "value", objectType = "") {
  return coercePassportScalarValue({ dataType, label, objectType }, value);
}

function coerceTableValue(value, field) {
  let rows = value;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      throw new Error(`Expected JSON array for ${field?.label || field?.key || "table"}`);
    }
  }
  if (!Array.isArray(rows)) throw new Error(`Expected array for ${field?.label || field?.key || "table"}`);
  const columns = Array.isArray(field?.tableColumns) ? field.tableColumns : [];
  const columnKeys = new Set(columns.map((column) => column?.key).filter(Boolean));
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Expected row object for ${field?.label || field?.key || "table"}`);
    }
    const unknownKeys = Object.keys(row).filter((key) => !columnKeys.has(key));
    if (unknownKeys.length) {
      throw new Error(
        `Unknown table column(s) for ${field?.label || field?.key || "table"}: ${unknownKeys.join(", ")}`
      );
    }
    const typedRow = { ...row };
    for (const column of columns) {
      if (!column?.key || !Object.prototype.hasOwnProperty.call(typedRow, column.key)) continue;
      typedRow[column.key] = coerceSchemaValue(
        typedRow[column.key],
        column.dataType,
        `${field?.label || field?.key || "table"}.${column.label || column.key}`,
        column.objectType
      );
    }
    return typedRow;
  });
}

function coercePassportSchemaValues(passport, typeDef) {
  const typedPassport = {
    ...(passport || {}),
    ...(passport?.fields && typeof passport.fields === "object" && !Array.isArray(passport.fields)
      ? { fields: { ...passport.fields } }
      : {}),
  };
  const schemaFields = (getFieldsJson(typeDef).sections || [])
    .flatMap((section) => section?.fields || []);

  for (const field of schemaFields) {
    if (!field?.key) continue;
    const schemaError = getPassportFieldDataTypeError(field, { requireExplicit: true });
    if (schemaError) throw new Error(schemaError);
    const hasNestedValue = Object.prototype.hasOwnProperty.call(typedPassport.fields || {}, field.key);
    const hasTopLevelValue = Object.prototype.hasOwnProperty.call(typedPassport, field.key);
    if (!hasNestedValue && !hasTopLevelValue) continue;
    const rawValue = hasNestedValue ? typedPassport.fields[field.key] : typedPassport[field.key];
    const typedValue = field.type === "table" || field.dataType === "array"
      ? coerceTableValue(rawValue, field)
      : coerceSchemaValue(rawValue, field.dataType, field.label || field.key, field.objectType);
    if (hasNestedValue) typedPassport.fields[field.key] = typedValue;
    if (hasTopLevelValue) typedPassport[field.key] = typedValue;
  }

  return typedPassport;
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
    const addField = (fieldKey, semanticId = null, dataType = "") => {
      if (!fieldKey || knownContext[fieldKey]) return;
      const termIri = resolveDictionaryTermIri(model, fieldKey, semanticId);
      if (termIri) {
        inlineContext[fieldKey] = {
          "@id": termIri,
          ...(dataType === "array" ? { "@container": "@set" } : {}),
        };
      }
    };

    for (const section of (getFieldsJson(typeDef).sections || [])) {
      for (const field of (section.fields || [])) {
        addField(field.key, field.semanticId, field.dataType);
        if (field?.type === "table") {
          for (const column of (field.tableColumns || [])) {
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

  function sanitizePassport(passport, passportType, typeDef = null) {
    const clean = { "@type": "DigitalProductPassport" };
    const typedPassport = coercePassportSchemaValues(passport, typeDef);
    const resolvedPassportType = typedPassport?.passportType || passportType || null;

    for (const [key, value] of Object.entries(typedPassport || {})) {
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
    const contexts = [dppContext];
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
