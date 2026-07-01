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

const semanticExportDataTypes = new Set(["string", "decimal", "integer", "boolean", "date", "datetime", "uri", "array"]);
const semanticExportColumnDataTypes = new Set([...semanticExportDataTypes].filter((dataType) => dataType !== "array"));
const semanticExportValueDataTypeByDataType = {
  string: "String",
  decimal: "Decimal",
  integer: "Integer",
  boolean: "Boolean",
  date: "Date",
  datetime: "DateTime",
  uri: "URI",
};

function validateSemanticExportField(field) {
  const fieldLabel = field?.key || field?.label || "unknown";
  const dataType = String(field?.dataType || "").trim().toLowerCase();
  if (!semanticExportDataTypes.has(dataType)) {
    throw new Error(`Field "${fieldLabel}" must declare a supported dataType.`);
  }
  if (!field?.objectType || !field?.valueDataType) {
    throw new Error(`Field "${fieldLabel}" must declare objectType and valueDataType.`);
  }
  const requiredDataTypeByFieldType = {
    boolean: "boolean",
    date: "date",
    file: "string",
    symbol: "uri",
    url: "uri",
  };
  const requiredDataType = requiredDataTypeByFieldType[field.type];
  if (requiredDataType && dataType !== requiredDataType) {
    throw new Error(`Field "${fieldLabel}" type "${field.type}" requires dataType "${requiredDataType}".`);
  }
  if (field.type !== "table") {
    if (dataType === "array") throw new Error(`Field "${fieldLabel}" dataType "array" requires type "table".`);
    if (Array.isArray(field.tableColumns) && field.tableColumns.length) {
      throw new Error(`Field "${fieldLabel}" defines tableColumns but is not a table field.`);
    }
    const expectedValueDataType = field.type === "file"
      ? "Binary"
      : (field.type === "url" || field.type === "symbol"
        ? "URI"
        : semanticExportValueDataTypeByDataType[dataType]);
    if (field.valueDataType !== expectedValueDataType) {
      throw new Error(
        `Field "${fieldLabel}" dataType "${dataType}" requires valueDataType "${expectedValueDataType}".`
      );
    }
    return;
  }
  if (dataType !== "array" || field.objectType !== "DataElementCollection" || field.valueDataType !== "Array") {
    throw new Error(`Table field "${fieldLabel}" must use array collection metadata.`);
  }
  const columns = Array.isArray(field.tableColumns) ? field.tableColumns : [];
  if (!columns.length) throw new Error(`Table field "${fieldLabel}" must define table columns.`);
  const seenKeys = new Set();
  for (const column of columns) {
    const columnDataType = String(column?.dataType || "").trim().toLowerCase();
    if (!column?.key || seenKeys.has(column.key)) {
      throw new Error(`Table field "${fieldLabel}" contains a missing or duplicate column key.`);
    }
    seenKeys.add(column.key);
    if (!semanticExportColumnDataTypes.has(columnDataType)) {
      throw new Error(`Table column "${fieldLabel}.${column.key}" must use a scalar dataType.`);
    }
    if (column.objectType !== "SingleValuedDataElement"
      || column.valueDataType !== semanticExportValueDataTypeByDataType[columnDataType]) {
      throw new Error(`Table column "${fieldLabel}.${column.key}" has inconsistent runtime metadata.`);
    }
  }
}

function coerceSchemaValue(value, dataType, label = "value", objectType = "") {
  const normalizedDataType = String(dataType || "").trim().toLowerCase();
  if (value === null || value === undefined || value === "") return value;
  if (objectType === "MultiLanguageDataElement" || objectType === "MultiValuedDataElement") {
    let structuredValue = value;
    if (typeof structuredValue === "string") {
      try {
        structuredValue = JSON.parse(structuredValue);
      } catch {
        const expectedShape = objectType === "MultiLanguageDataElement" ? "language object" : "value array";
        throw new Error(`Expected ${expectedShape} for ${label}`);
      }
    }
    if (objectType === "MultiLanguageDataElement") {
      if (!structuredValue || typeof structuredValue !== "object" || Array.isArray(structuredValue)) {
        throw new Error(`Expected language object for ${label}`);
      }
      return Object.fromEntries(
        Object.entries(structuredValue).map(([language, entryValue]) => [
          language,
          coerceSchemaValue(
            entryValue,
            normalizedDataType,
            `${label}.${language}`,
            "SingleValuedDataElement"
          ),
        ])
      );
    }
    if (!Array.isArray(structuredValue)) {
      throw new Error(`Expected value array for ${label}`);
    }
    return structuredValue.map((entryValue, index) =>
      coerceSchemaValue(
        entryValue,
        normalizedDataType,
        `${label}[${index}]`,
        "SingleValuedDataElement"
      )
    );
  }
  if (normalizedDataType === "decimal") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number.parseFloat(value);
    throw new Error(`Expected decimal for ${label}`);
  }
  if (normalizedDataType === "integer") {
    if (Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
    throw new Error(`Expected integer for ${label}`);
  }
  if (normalizedDataType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalizedValue)) return true;
      if (["false", "0", "no"].includes(normalizedValue)) return false;
    }
    throw new Error(`Expected boolean for ${label}`);
  }
  if (normalizedDataType === "string") {
    if (Array.isArray(value) || (value && typeof value === "object")) throw new Error(`Expected string for ${label}`);
    return String(value);
  }
  if (normalizedDataType === "date") {
    const text = String(value).trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text;
    throw new Error(`Expected date for ${label}`);
  }
  if (normalizedDataType === "datetime") {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Expected date-time for ${label}`);
    }
    const text = value instanceof Date ? parsed.toISOString() : String(value).trim();
    const dateText = text.slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : null;
    const hasValidDate = date
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === dateText;
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
      && hasValidDate
    ) {
      return parsed.toISOString();
    }
    throw new Error(`Expected date-time for ${label}`);
  }
  if (normalizedDataType === "uri") {
    const text = String(value).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    throw new Error(`Expected URI for ${label}`);
  }
  throw new Error(`Unsupported scalar dataType "${normalizedDataType || "missing"}" for ${label}`);
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
  const schemaFields = getTypeDefSections(typeDef).flatMap((section) => section?.fields || []);

  for (const field of schemaFields) {
    if (!field?.key) continue;
    validateSemanticExportField(field);
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

function buildInlineContext(typeDef = null) {
  const inlineContext = {};
  for (const section of getTypeDefSections(typeDef)) {
    for (const field of (section.fields || [])) {
      if (field?.key && field.semanticId) {
        inlineContext[field.key] = {
          "@id": field.semanticId,
          ...(field.dataType === "array" ? { "@container": "@set" } : {}),
        };
      }
      if (field?.type === "table") {
        for (const column of (field.tableColumns || [])) {
          if (column?.key && column.semanticId) {
            inlineContext[column.key] = { "@id": column.semanticId };
          }
        }
      }
    }
  }
  return inlineContext;
}

function sanitizePassport(passport, passportType, typeDef = null) {
  const clean = { "@type": "DigitalProductPassport" };
  const typedPassport = coercePassportSchemaValues(passport, typeDef);
  const resolvedPassportType = typedPassport.passportType || passportType || null;

  Object.entries(typedPassport || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "_semanticIds") return;
    clean[key] = value;
  });

  if (resolvedPassportType && !clean.passportType) {
    clean.passportType = resolvedPassportType;
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
