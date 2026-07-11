"use strict";

const { rewriteRepositoryLinksDeep } = require("../repository/repository-file-links");
const {
  getSemanticGraphClass,
  getSemanticGraphEnum,
  isManyProperty,
} = require("./passport-semantic-graph");

const inRevisionStatus = "inRevision";

const systemPassportFields = new Set([
  "id",
  "dppId",
  "lineageId",
  "companyId",
  "createdBy",
  "createdAt",
  "passportType",
  "versionNumber",
  "releaseStatus",
  "deletedAt",
  "qrCode",
  "carrierAuthenticity",
  "carrierSecurityStatus",
  "carrierAuthenticationMethod",
  "carrierVerificationInstructions",
  "signedCarrierPayload",
  "issuerCertificateId",
  "carrierCompatibilityProfiles",
  "physicalCarrierSecurityFeatures",
  "trustedViewerOrigin",
  "trustedViewerHost",
  "counterfeitRiskLevel",
  "antiCounterfeitInstructions",
  "safetyWarnings",
  "qrPrintSpecification",
  "signCarrierPayload",
  "createdByEmail",
  "firstName",
  "lastName",
  "updatedBy",
  "updatedAt",
]);

const editablePassportStatuses = new Set(["draft", inRevisionStatus]);

const parseJsonOrFallback = (value, fallback = value) => {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
};

const quoteSqlIdentifier = (value) => {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
};

const joinQuotedSqlIdentifiers = (identifiers = []) =>
  identifiers.map((identifier) => quoteSqlIdentifier(identifier)).join(", ");

const toStorageSlug = (typeName) =>
  String(typeName || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const toCamelIdentifier = (value) => {
  const parts = String(value || "").split("_").filter(Boolean);
  return parts.map((part, index) => {
    const lower = part.toLowerCase();
    if (index === 0) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join("");
};

const getTable = (typeName) => {
  if (!typeName) throw new Error("typeName is required for table lookup");
  const safe = toStorageSlug(typeName);
  if (!safe) throw new Error("typeName must contain at least one alphanumeric character");
  const identifierSafeSlug = /^[a-z]/.test(safe) ? safe : `type${safe}`;
  return quoteSqlIdentifier(`${toCamelIdentifier(identifierSafeSlug)}Passports`);
};

const normalizeReleaseStatus = (status) => status;

const isPublicHistoryStatus = (status) => {
  const normalized = normalizeReleaseStatus(status);
  return normalized === "released" || normalized === "obsolete";
};

const isEditablePassportStatus = (status) =>
  editablePassportStatuses.has(normalizeReleaseStatus(status));

const getSectionChildren = (section) => {
  if (!section || typeof section !== "object") return [];
  if (Array.isArray(section.sections)) return section.sections;
  if (Array.isArray(section.groups)) return section.groups;
  return [];
};

const walkSchemaSections = (sections = [], visitor, parentPath = []) => {
  if (!Array.isArray(sections) || typeof visitor !== "function") return;
  sections.forEach((section, index) => {
    if (!section || typeof section !== "object") return;
    const sectionPath = [
      ...parentPath,
      {
        key: section.key || "",
        label: section.label || section.name || section.key || `Section ${index + 1}`,
        index,
        section,
      },
    ];
    visitor(section, sectionPath);
    walkSchemaSections(getSectionChildren(section), visitor, sectionPath);
  });
};

const flattenSchemaFieldsFromSections = (sections = []) => {
  const fields = [];
  walkSchemaSections(sections, (section, sectionPath) => {
    for (const field of Array.isArray(section?.fields) ? section.fields : []) {
      if (!field?.key) continue;
      const owner = sectionPath[sectionPath.length - 1] || {};
      fields.push({
        ...field,
        sectionKey: owner.key || null,
        sectionLabel: owner.label || null,
        sectionPath: sectionPath.map((entry) => ({
          key: entry.key || "",
          label: entry.label || "",
        })),
      });
    }
  });
  return fields;
};

const countSchemaFields = (sectionOrSections = []) => {
  const sections = Array.isArray(sectionOrSections) ? sectionOrSections : [sectionOrSections];
  return flattenSchemaFieldsFromSections(sections).length;
};

const extractSchemaFields = (schema) => {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.schemaFields)) return schema.schemaFields.filter((field) => field?.key);
  if (Array.isArray(schema.sections)) {
    return flattenSchemaFieldsFromSections(schema.sections);
  }
  return [];
};

const mapCompanyRow = (row = {}) => ({
  id: row.id ?? null,
  companyName: row.companyName ?? "",
  companyLogo: row.companyLogo ?? null,
  didSlug: row.didSlug ?? null,
  economicOperatorIdentifier: row.economicOperatorIdentifier ?? null,
  economicOperatorIdentifierScheme: row.economicOperatorIdentifierScheme ?? null,
  customerTrustLevel: row.customerTrustLevel ?? null,
  dppGranularity: row.dppGranularity ?? row.defaultGranularity ?? "item",
  defaultGranularity: row.defaultGranularity ?? row.dppGranularity ?? "item",
  jsonldExportEnabled: row.jsonldExportEnabled ?? true,
  isActive: row.isActive ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const mapCompanyFacilityRow = (row = {}) => ({
  id: row.id ?? null,
  companyId: row.companyId ?? null,
  facilityIdentifier: row.facilityIdentifier ?? "",
  identifierScheme: row.identifierScheme ?? "",
  displayName: row.displayName ?? null,
  metadataJson: row.metadataJson ?? {},
  isActive: row.isActive ?? true,
  createdBy: row.createdBy ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const mapPassportTemplateFieldRow = (row = {}) => ({
  fieldKey: row.fieldKey ?? "",
  fieldValue: row.fieldValue ?? null,
  isModelData: row.isModelData ?? false,
});

const mapPassportTypeRow = (row = {}) => ({
  id: row.id ?? null,
  typeName: row.typeName ?? null,
  displayName: row.displayName ?? null,
  productCategory: row.productCategory ?? null,
  productIcon: row.productIcon ?? null,
  semanticModelKey: row.semanticModelKey ?? null,
  fieldsJson: row.fieldsJson ?? null,
  accessGranted: row.accessGranted ?? null,
  createdBy: row.createdBy ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const getDisplayName = (rowData = {}) => {
  const explicitName = typeof rowData.createdByName === "string" ? rowData.createdByName.trim() : "";
  if (explicitName) return explicitName;

  const firstName = typeof rowData.firstName === "string" ? rowData.firstName.trim() : "";
  const lastName = typeof rowData.lastName === "string" ? rowData.lastName.trim() : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return null;
};

const normalizePassportRow = (row, schema) => {
  if (!row) return row;
  const dppId = row.dppId ?? null;
  const companyId = row.companyId ?? null;
  const schemaFields = extractSchemaFields(schema);

  // Deserialize JSONB fields
  let rowData = { ...row };

  if (schemaFields.length > 0) {
    const jsonbFields = new Set();
    schemaFields.forEach((field) => {
      if (field && field.key) {
        const storageType = String(field.storageType || field.valueType || "").trim().toLowerCase();
        if (field.type === "table" || field.repeated === true || field.structured === true || ["json", "jsonb", "object", "array"].includes(storageType)) {
          jsonbFields.add(field.key);
        }
      }
    });

    for (const key of jsonbFields) {
      if (typeof rowData[key] === "string" && rowData[key]) {
        rowData[key] = parseJsonOrFallback(rowData[key]);
      }
    }
  } else {
    for (const [key, value] of Object.entries(rowData)) {
      if (typeof value === "string" && value && value.trim().startsWith("{")) {
        rowData[key] = parseJsonOrFallback(value);
      } else if (typeof value === "string" && value && value.trim().startsWith("[")) {
        rowData[key] = parseJsonOrFallback(value);
      }
    }
  }

  const normalized = rewriteRepositoryLinksDeep({
    ...rowData,
    dppId,
    companyId,
    lineageId: rowData.lineageId ?? null,
    passportType: rowData.passportType ?? null,
    modelName: rowData.modelName ?? null,
    internalAliasId: rowData.internalAliasId ?? null,
    uniqueProductIdentifier: rowData.uniqueProductIdentifier ?? null,
    productImage: rowData.productImage ?? null,
    passportPolicyKey: rowData.passportPolicyKey ?? null,
    contentSpecificationIds: rowData.contentSpecificationIds ?? null,
    carrierPolicyKey: rowData.carrierPolicyKey ?? null,
    carrierAuthenticity: rowData.carrierAuthenticity ?? null,
    economicOperatorId: rowData.economicOperatorId ?? null,
    economicOperatorIdentifierScheme: rowData.economicOperatorIdentifierScheme ?? null,
    facilityId: rowData.facilityId ?? null,
    releaseStatus: normalizeReleaseStatus(rowData.releaseStatus),
    versionNumber: rowData.versionNumber ?? null,
    qrCode: rowData.qrCode ?? null,
    createdBy: rowData.createdBy ?? null,
    createdByName: getDisplayName(rowData),
    updatedBy: rowData.updatedBy ?? null,
    createdAt: rowData.createdAt ?? null,
    updatedAt: rowData.updatedAt ?? null,
    deletedAt: rowData.deletedAt ?? null,
    carrierSecurityStatus: rowData.carrierSecurityStatus ?? null,
    carrierAuthenticationMethod: rowData.carrierAuthenticationMethod ?? null,
    carrierVerificationInstructions: rowData.carrierVerificationInstructions ?? null,
    signedCarrierPayload: rowData.signedCarrierPayload ?? null,
    issuerCertificateId: rowData.issuerCertificateId ?? null,
    carrierCompatibilityProfiles: rowData.carrierCompatibilityProfiles ?? null,
    physicalCarrierSecurityFeatures: rowData.physicalCarrierSecurityFeatures ?? null,
    trustedViewerOrigin: rowData.trustedViewerOrigin ?? null,
    trustedViewerHost: rowData.trustedViewerHost ?? null,
    counterfeitRiskLevel: rowData.counterfeitRiskLevel ?? null,
    antiCounterfeitInstructions: rowData.antiCounterfeitInstructions ?? null,
    safetyWarnings: rowData.safetyWarnings ?? null,
    qrPrintSpecification: rowData.qrPrintSpecification ?? null,
    signCarrierPayload: rowData.signCarrierPayload ?? null,
  }, {
    appBaseUrl: process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.SERVER_URL || "http://localhost:3001",
  });

  return normalized;
};

const getPassportFieldLookupKeys = (fieldKey) => {
  const exactKey = String(fieldKey || "").trim();
  return exactKey ? [exactKey] : [];
};

const getPassportFieldValue = (passport, fieldKey) => {
  if (!passport || !fieldKey) return undefined;
  for (const lookupKey of getPassportFieldLookupKeys(fieldKey)) {
    if (Object.prototype.hasOwnProperty.call(passport, lookupKey)) {
      return passport[lookupKey];
    }
  }
  return undefined;
};

const toStoredPassportValue = (value) =>
  (Array.isArray(value) || (typeof value === "object" && value !== null))
    ? JSON.stringify(value)
    : value;

const normalizePassportRequestBody = (body = {}) => {
  return { ...body };
};

const normalizeInternalAliasIdValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const generateInternalAliasIdValue = (dppId) =>
  String(dppId || "").trim();

const facilityFieldCandidates = [
  "facilityId",
  "manufacturingFacilityId",
];

const extractExplicitFacilityId = (source) => {
  if (!source || typeof source !== "object") return null;
  for (const key of facilityFieldCandidates) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
};

const getWritablePassportColumns = (data, excluded = systemPassportFields) =>
  Object.keys(data).filter((key) =>
    data[key] !== undefined &&
    !excluded.has(key) &&
    /^[a-z][A-Za-z0-9]*$/.test(key)
  );

const getStoredPassportValues = (keys, data) =>
  keys.map((key) => toStoredPassportValue(data[key]));

const slugifyRouteSegment = (value, emptySegment = "item") => {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || emptySegment;
};

const buildCurrentPublicPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
}) => {
  const publicPassportId = String(dppId || "").trim();
  if (!publicPassportId) return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || publicPassportId, "product");
  return `/dpp/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(publicPassportId)}`;
};

const buildInactivePublicPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  versionNumber,
}) => {
  const publicPassportId = String(dppId || "").trim();
  if (!publicPassportId || versionNumber === null || versionNumber === undefined || versionNumber === "") return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || publicPassportId, "product");
  return `/dpp/inactive/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(publicPassportId)}/${encodeURIComponent(versionNumber)}`;
};

const buildPreviewPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  previewDppId = "",
}) => {
  const routeKey = String(previewDppId || "").trim();
  if (!routeKey) return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || routeKey, "product");
  return `/dpp/preview/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(routeKey)}`;
};

const coercePassportScalarValue = (fieldDef, rawValue) => {
  const dataType = String(fieldDef?.dataType || "").trim().toLowerCase();
  const fieldLabel = fieldDef?.label || fieldDef?.key || "field";
  if (rawValue === null || rawValue === undefined || rawValue === "") return rawValue;
  const objectType = String(fieldDef?.objectType || "").trim();
  if (objectType === "MultiLanguageDataElement" || objectType === "MultiValuedDataElement") {
    let structuredValue = rawValue;
    if (typeof structuredValue === "string") {
      try {
        structuredValue = JSON.parse(structuredValue);
      } catch {
        const expectedShape = objectType === "MultiLanguageDataElement" ? "language object" : "value array";
        throw new Error(`Expected ${expectedShape} for ${fieldLabel}`);
      }
    }
    if (objectType === "MultiLanguageDataElement") {
      if (!isPlainObject(structuredValue)) {
        throw new Error(`Expected language object for ${fieldLabel}`);
      }
      return Object.fromEntries(
        Object.entries(structuredValue).map(([language, value]) => [
          language,
          coercePassportScalarValue({
            ...fieldDef,
            label: `${fieldLabel}.${language}`,
            objectType: "SingleValuedDataElement",
          }, value),
        ])
      );
    }
    if (!Array.isArray(structuredValue)) {
      throw new Error(`Expected value array for ${fieldLabel}`);
    }
    return structuredValue.map((value, index) =>
      coercePassportScalarValue({
        ...fieldDef,
        label: `${fieldLabel}[${index}]`,
        objectType: "SingleValuedDataElement",
      }, value)
    );
  }
  if (dataType === "decimal") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) return rawValue;
    if (typeof rawValue === "string" && /^-?\d+(\.\d+)?$/.test(rawValue.trim())) {
      return Number.parseFloat(rawValue);
    }
    throw new Error(`Expected decimal for ${fieldLabel}`);
  }
  if (dataType === "integer") {
    if (Number.isInteger(rawValue)) return rawValue;
    if (typeof rawValue === "string" && /^-?\d+$/.test(rawValue.trim())) {
      return Number.parseInt(rawValue, 10);
    }
    throw new Error(`Expected integer for ${fieldLabel}`);
  }
  if (dataType === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    if (typeof rawValue === "string") {
      const normalized = rawValue.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
    throw new Error(`Expected boolean for ${fieldLabel}`);
  }
  if (dataType === "date") {
    const text = String(rawValue).trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text;
    throw new Error(`Expected date for ${fieldLabel}`);
  }
  if (dataType === "datetime") {
    const parsed = rawValue instanceof Date ? rawValue : new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Expected date-time for ${fieldLabel}`);
    }
    const text = rawValue instanceof Date ? parsed.toISOString() : String(rawValue).trim();
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
    throw new Error(`Expected date-time for ${fieldLabel}`);
  }
  if (dataType === "uri") {
    const text = String(rawValue).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    throw new Error(`Expected URI for ${fieldLabel}`);
  }
  if (dataType === "string") {
    if (Array.isArray(rawValue) || (rawValue && typeof rawValue === "object")) {
      throw new Error(`Expected string for ${fieldLabel}`);
    }
    return String(rawValue);
  }
  throw new Error(`Unsupported scalar dataType "${dataType || "missing"}" for ${fieldLabel}`);
};

const coerceTableColumnValues = (fieldDef, rows) => {
  const columns = Array.isArray(fieldDef?.tableColumns) ? fieldDef.tableColumns : [];
  const columnKeys = new Set(columns.map((column) => column?.key).filter(Boolean));
  return rows.map((row) => {
    const unknownKeys = Object.keys(row).filter((key) => !columnKeys.has(key));
    if (unknownKeys.length) {
      throw new Error(
        `Unknown table column(s) for ${fieldDef?.label || fieldDef?.key || "table"}: ${unknownKeys.join(", ")}`
      );
    }
    const typedRow = { ...row };
    for (const column of columns) {
      if (!column?.key || !Object.prototype.hasOwnProperty.call(typedRow, column.key)) continue;
      typedRow[column.key] = coercePassportScalarValue(column, typedRow[column.key]);
    }
    return typedRow;
  });
};

const parseStructuredSemanticValue = (rawValue, label) => {
  if (typeof rawValue !== "string") return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`Expected valid JSON for ${label}`);
  }
};

const coerceSemanticGraphPropertyValue = (property, rawValue, semanticGraph, path = property?.key || "field") => {
  const many = isManyProperty(property);
  let value = rawValue;
  if (rawValue === "" && many) {
    value = [];
  } else if (
    rawValue !== ""
    && (many || (property?.rangeKind === "class" && property?.relationshipType === "composition"))
  ) {
    value = parseStructuredSemanticValue(rawValue, path);
  }
  const values = many ? value : [value];
  if (many && !Array.isArray(value)) throw new Error(`Expected array for ${path}`);
  const count = many ? value.length : (value === null || value === undefined || value === "" ? 0 : 1);
  if (count < property.minCount) throw new Error(`${path} requires at least ${property.minCount} value(s)`);
  if (property.maxCount !== null && count > property.maxCount) {
    throw new Error(`${path} allows at most ${property.maxCount} value(s)`);
  }
  if (count === 0) return many ? [] : value;

  const coerceOne = (entryValue, index) => {
    const entryPath = many ? `${path}[${index}]` : path;
    if (property.rangeKind === "scalar") {
      return coercePassportScalarValue({
        key: property.key,
        label: entryPath,
        dataType: property.dataType,
        objectType: "SingleValuedDataElement",
      }, entryValue);
    }
    if (property.rangeKind === "enum") {
      const enumDef = getSemanticGraphEnum(semanticGraph, property.rangeEnumKey);
      const allowedValues = new Set((enumDef?.values || []).map((entry) => entry.key));
      const normalized = String(entryValue ?? "").trim();
      if (!allowedValues.has(normalized)) {
        throw new Error(`${entryPath} must be one of: ${[...allowedValues].join(", ")}`);
      }
      return normalized;
    }
    if (property.relationshipType === "reference") {
      const reference = isPlainObject(entryValue) ? entryValue["@id"] : entryValue;
      const iri = String(reference || "").trim();
      if (
        !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(iri)
        || /^(?:javascript|data|vbscript):/i.test(iri)
      ) {
        throw new Error(`${entryPath} must be an absolute IRI reference`);
      }
      return { "@id": iri };
    }

    if (!isPlainObject(entryValue)) throw new Error(`${entryPath} must be an object`);
    const classDef = getSemanticGraphClass(semanticGraph, property.rangeClassKey);
    if (!classDef) throw new Error(`${entryPath} references an unknown semantic class`);
    const propertyByKey = new Map((classDef.properties || []).map((entry) => [entry.key, entry]));
    const unknownKeys = Object.keys(entryValue).filter((key) => !propertyByKey.has(key) && !["@id", "@type"].includes(key));
    if (unknownKeys.length) throw new Error(`${entryPath} contains unknown property(s): ${unknownKeys.join(", ")}`);
    const typedObject = {};
    if (entryValue["@id"] !== undefined) {
      const iri = String(entryValue["@id"] || "").trim();
      if (
        !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(iri)
        || /^(?:javascript|data|vbscript):/i.test(iri)
      ) {
        throw new Error(`${entryPath}.@id must be an absolute IRI`);
      }
      typedObject["@id"] = iri;
    }
    for (const childProperty of classDef.properties || []) {
      const hasValue = Object.prototype.hasOwnProperty.call(entryValue, childProperty.key);
      if (!hasValue) {
        if (childProperty.minCount > 0) {
          throw new Error(`${entryPath}.${childProperty.key} requires at least ${childProperty.minCount} value(s)`);
        }
        continue;
      }
      typedObject[childProperty.key] = coerceSemanticGraphPropertyValue(
        childProperty,
        entryValue[childProperty.key],
        semanticGraph,
        `${entryPath}.${childProperty.key}`
      );
    }
    return typedObject;
  };

  const typedValues = values.map(coerceOne);
  return many ? typedValues : typedValues[0];
};

const coerceBulkFieldValue = (fieldDef, rawValue, semanticGraph = null) => {
  if (rawValue === null || rawValue === undefined) return rawValue;

  if (fieldDef?.rangeKind && semanticGraph) {
    return coerceSemanticGraphPropertyValue(fieldDef, rawValue, semanticGraph, fieldDef.label || fieldDef.key);
  }

  if (fieldDef?.type === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }

  if (fieldDef?.type === "table" && typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return rawValue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`Expected table rows as a JSON array of objects for ${fieldDef?.label || fieldDef?.key}`);
    }
    if (Array.isArray(parsed) && parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return coerceTableColumnValues(fieldDef, parsed);
    }
    throw new Error(`Expected table rows as a JSON array of objects for ${fieldDef?.label || fieldDef?.key}`);
  }

  if (fieldDef?.type === "table" && Array.isArray(rawValue)) {
    if (rawValue.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return coerceTableColumnValues(fieldDef, rawValue);
    }
    throw new Error(`Expected table rows as objects for ${fieldDef?.label || fieldDef?.key}`);
  }

  const dataType = String(fieldDef?.dataType || "").trim().toLowerCase();
  if (dataType && dataType !== "array") {
    return coercePassportScalarValue(fieldDef, rawValue);
  }

  return rawValue;
};

const getHistoryFieldDefs = (typeRow) => {
  const baseFields = [
    { key: "modelName", label: "Model Name", type: "text", confidentiality: "public" },
    { key: "internalAliasId", label: "Internal Alias ID", type: "text" },
  ];
  const schemaFields = flattenSchemaFieldsFromSections(typeRow?.fieldsJson?.sections || [])
    .filter((field) => field?.key);
  const seen = new Set();
  return [...baseFields, ...schemaFields].filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
};

const formatHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";
  if (fieldDef?.type === "boolean") return rawValue ? "Yes" : "No";
  if (fieldDef?.type === "file") return "File uploaded";
  if (fieldDef?.type === "symbol") return "Symbol updated";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    if (Array.isArray(rows)) {
      const formatted = rows
        .map((row) => row && typeof row === "object" && !Array.isArray(row)
          ? Object.values(row).filter(Boolean).join(" | ")
          : "")
        .filter(Boolean)
        .join(" ; ");
      return formatted.length > 180 ? `${formatted.slice(0, 177)}...` : formatted || "—";
    }
  }

  if (typeof rawValue === "object") {
    const json = JSON.stringify(rawValue);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  }

  const text = String(rawValue);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};

const comparableHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  if (fieldDef?.type === "boolean") return rawValue ? "true" : "false";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    return Array.isArray(rows) || (typeof rows === "object" && rows !== null)
      ? JSON.stringify(rows)
      : String(rows);
  }

  return (Array.isArray(rawValue) || (typeof rawValue === "object" && rawValue !== null))
    ? JSON.stringify(rawValue)
    : String(rawValue).trim();
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getAssetFieldMap = (typeSchema) => {
  const map = new Map();
  const semanticGraph = typeSchema?.fieldsJson?.semanticGraph || null;
  [
    { key: "dppId", label: "Passport DPP ID", type: "text", system: true },
    { key: "internalAliasId", label: "Internal Alias ID", type: "text", system: true },
    { key: "modelName", label: "Model Name", type: "text", system: true },
  ].forEach((field) => map.set(field.key, field));
  (typeSchema?.schemaFields || []).forEach((field) => {
    if (field?.key) map.set(field.key, semanticGraph ? { ...field, semanticGraph } : field);
  });
  return map;
};

const getValueAtPath = (value, pathExpression) => {
  if (!pathExpression) return value;
  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => {
      if (acc === undefined || acc === null) return undefined;
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, indexText] = arrayMatch;
        const next = key ? acc[key] : acc;
        return Array.isArray(next) ? next[Number(indexText)] : undefined;
      }
      return acc[part];
    }, value);
};

const normalizeAssetHeaders = (headers) => {
  if (!isPlainObject(headers)) return {};
  return Object.entries(headers).reduce((acc, [key, value]) => {
    if (!key) return acc;
    acc[String(key)] = typeof value === "string" ? value : JSON.stringify(value);
    return acc;
  }, {});
};

const coerceAssetFieldValue = (fieldDef, rawValue) => {
  if (rawValue === undefined) return { ok: false, error: "value is undefined" };
  if (rawValue === null || rawValue === "") return { ok: true, value: rawValue };

  if (fieldDef?.rangeKind && fieldDef?.semanticGraph) {
    try {
      return {
        ok: true,
        value: coerceSemanticGraphPropertyValue(
          fieldDef,
          rawValue,
          fieldDef.semanticGraph,
          fieldDef.label || fieldDef.key
        ),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  const type = fieldDef?.type || "text";

  if (type === "boolean") {
    if (typeof rawValue === "boolean") return { ok: true, value: rawValue };
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return { ok: true, value: true };
    if (["false", "0", "no"].includes(normalized)) return { ok: true, value: false };
    return { ok: false, error: `Expected boolean for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "table") {
    if (Array.isArray(rawValue)) {
      const isRowObjectArray = rawValue.every((row) => row && typeof row === "object" && !Array.isArray(row));
      if (!isRowObjectArray) {
        return { ok: false, error: `Expected table rows as objects for ${fieldDef?.label || fieldDef?.key}` };
      }
      try {
        return { ok: true, value: coerceTableColumnValues(fieldDef, rawValue) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (typeof rawValue === "string") {
      const parsed = parseJsonOrFallback(rawValue, null);
      if (Array.isArray(parsed) && parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
        try {
          return { ok: true, value: coerceTableColumnValues(fieldDef, parsed) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    }
    return { ok: false, error: `Expected table rows as a JSON array of objects for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "date") {
    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Expected a valid date for ${fieldDef?.label || fieldDef?.key}` };
    }
    return { ok: true, value: date.toISOString().slice(0, 10) };
  }

  const dataType = String(fieldDef?.dataType || "").trim().toLowerCase();
  if (dataType && dataType !== "array") {
    try {
      return { ok: true, value: coercePassportScalarValue(fieldDef, rawValue) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  if ((type === "file" || type === "symbol") && typeof rawValue === "object") {
    return { ok: false, error: `Expected a file URL string for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (Array.isArray(rawValue) || typeof rawValue === "object") {
    return { ok: false, error: `Expected a primitive value for ${fieldDef?.label || fieldDef?.key}` };
  }

  return { ok: true, value: String(rawValue) };
};

const toDynamicStoredValue = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
};

module.exports = {
  inRevisionStatus,
  systemPassportFields,
  editablePassportStatuses,
  getTable,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody,
  coercePassportScalarValue,
  coerceSemanticGraphPropertyValue,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  extractExplicitFacilityId,
  getWritablePassportColumns,
  getStoredPassportValues,
  slugifyRouteSegment,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  coerceBulkFieldValue,
  getHistoryFieldDefs,
  formatHistoryFieldValue,
  comparableHistoryFieldValue,
  isPlainObject,
  getSectionChildren,
  walkSchemaSections,
  flattenSchemaFieldsFromSections,
  countSchemaFields,
  extractSchemaFields,
  mapCompanyRow,
  mapCompanyFacilityRow,
  mapPassportTemplateFieldRow,
  mapPassportTypeRow,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  getPassportFieldLookupKeys,
  getPassportFieldValue,
  getAssetFieldMap,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  toDynamicStoredValue,
};
