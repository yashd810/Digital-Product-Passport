"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");
const { URL } = require("url");
const {
  normalizeAndValidateSemanticGraph,
  runtimeFieldFromSemanticProperty,
} = require(path.resolve(
  __dirname,
  "../../apps/backend-api/src/shared/passports/passport-semantic-graph"
));

const port = Number.parseInt(process.env.PORT || "5055", 10);
const appDir = __dirname;
const maxBodyBytes = 2 * 1024 * 1024;
const allowedApiOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);
const staticSecurityHeaders = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const headerSlotDefinitions = [
  { slotKey: "digitalProductPassportId", label: "Digital Product Passport ID", managedKey: "internalManagedDigitalProductPassportId" },
  { slotKey: "uniqueProductIdentifier", label: "Unique Product Identifier", managedKey: "internalManagedUniqueProductIdentifier" },
  { slotKey: "internalAliasId", label: "Internal Alias ID", managedKey: "internalManagedInternalAliasId" },
  { slotKey: "granularity", label: "Granularity", managedKey: "internalManagedGranularity" },
  { slotKey: "dppSchemaVersion", label: "DPP Schema Version", managedKey: "internalManagedDppSchemaVersion" },
  { slotKey: "dppStatus", label: "DPP Status", managedKey: "internalManagedDppStatus" },
  { slotKey: "lastUpdate", label: "Last Update", managedKey: "internalManagedLastUpdate" },
  { slotKey: "economicOperatorId", label: "Economic Operator ID", managedKey: "internalManagedEconomicOperatorId" },
  { slotKey: "facilityId", label: "Facility ID", managedKey: "internalManagedFacilityId" },
  { slotKey: "contentSpecificationIds", label: "Content Specification IDs", managedKey: "internalManagedContentSpecificationIds" },
  { slotKey: "subjectDid", label: "Subject DID", managedKey: "internalManagedSubjectDid", managedOnly: true },
  { slotKey: "dppDid", label: "DPP DID", managedKey: "internalManagedDppDid", managedOnly: true },
  { slotKey: "companyDid", label: "Company DID", managedKey: "internalManagedCompanyDid", managedOnly: true },
];

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendBuffer(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let rejected = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        rejected = true;
        const error = new Error("Request body is too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isPathInside(basePath, candidatePath) {
  const relativePath = path.relative(basePath, candidatePath);
  return relativePath !== ""
    && !relativePath.startsWith(`..${path.sep}`)
    && relativePath !== ".."
    && !path.isAbsolute(relativePath);
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, staticSecurityHeaders);
    res.end();
    return;
  }
  const fileName = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(appDir, fileName);
  if (!isPathInside(appDir, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    ...staticSecurityHeaders,
  });
  fs.createReadStream(filePath).pipe(res);
}

function validateApiPostRequest(req) {
  const origin = clean(req.headers.origin);
  if (origin && !allowedApiOrigins.has(origin)) {
    const error = new Error("Cross-origin API requests are not allowed");
    error.statusCode = 403;
    throw error;
  }
  const contentType = clean(req.headers["content-type"]).split(";")[0].toLowerCase();
  if (contentType !== "application/json") {
    const error = new Error("API POST requests require Content-Type: application/json");
    error.statusCode = 415;
    throw error;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function titleCase(value) {
  return clean(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function kebabCase(value) {
  return clean(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function camelCase(value) {
  const words = clean(value).match(/[A-Za-z0-9]+/g) || [];
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join("");
}

function canonicalKeyFromSemanticSlug(value, fallback = "") {
  return camelCase(clean(value) || fallback);
}

function pascalCase(value) {
  const camel = camelCase(value);
  return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function pascalCaseSemanticKey(value) {
  return pascalCase(clean(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

function normalizeTableColumnKey(value) {
  const text = clean(value);
  if (/^[a-z][A-Za-z0-9]*$/.test(text)) return text;
  return camelCase(text);
}

function normalizeTableColumns(columns = [], fieldLabel = "Table") {
  const normalized = (columns || []).map((column, index) => {
    const columnLabel = clean(column.columnLabel || column.label) || titleCase(column.columnKey || column.key || `column ${index + 1}`);
    const semanticSlug = kebabCase(column.semanticSlug || columnLabel || column.columnKey || column.key || `column-${index + 1}`);
    const columnKey = canonicalKeyFromSemanticSlug(semanticSlug, column.columnKey || column.key || columnLabel || `column${index + 1}`);
    const unitKey = clean(column.unitKey || column.unit || "none").toLowerCase() || "none";
    const dataType = normalizeDataType(column.dataType, supportedTableColumnDataTypes);
    const objectType = normalizeObjectType(
      column.objectType || "SingleValuedDataElement",
      `${fieldLabel} column "${columnLabel}"`
    );
    const expectedValueDataType = defaultValueDataTypeForField("text", dataType);
    const valueDataType = normalizeValueDataType(
      column.valueDataType || expectedValueDataType,
      `${fieldLabel} column "${columnLabel}"`
    );
    if (objectType !== "SingleValuedDataElement") {
      throw new Error(`${fieldLabel} column "${columnLabel}" objectType must be "SingleValuedDataElement".`);
    }
    if (valueDataType !== expectedValueDataType) {
      throw new Error(
        `${fieldLabel} column "${columnLabel}" dataType "${dataType}" requires valueDataType "${expectedValueDataType}".`
      );
    }
    return {
      columnKey,
      columnLabel,
      semanticSlug,
      dataType,
      unitKey,
      unitLabel: clean(column.unitLabel) || (unitKey === "none" ? "None" : titleCase(unitKey)),
      unitSymbol: unitKey === "none" ? "" : clean(column.unitSymbol || unitKey),
      objectType,
      valueDataType,
    };
  }).filter((column) => column.columnKey);

  if (!normalized.length) {
    throw new Error(`${fieldLabel} table fields must define at least one column.`);
  }

  const duplicateColumn = normalized.find((column, index) =>
    normalized.findIndex((candidate) => candidate.columnKey === column.columnKey) !== index
  );
  if (duplicateColumn) {
    throw new Error(`Duplicate table column key: ${duplicateColumn.columnKey}`);
  }

  return normalized;
}

function semanticBase(spec) {
  const { family, version, baseUrl } = spec.module;
  return `${baseUrl}/dictionary/${family}/${version}`;
}

function apiBase(spec) {
  const { family, version, baseUrl } = spec.module;
  return `${baseUrl}/api/dictionary/${family}/${version}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function splitList(value) {
  return clean(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHeaderAssignments(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const assignments = Object.fromEntries(
    Object.entries(source)
      .map(([slotKey, fieldKey]) => [clean(slotKey), clean(fieldKey)])
      .filter(([slotKey, fieldKey]) => slotKey && fieldKey)
  );
  headerSlotDefinitions.filter((slot) => slot.managedOnly).forEach((slot) => {
    assignments[slot.slotKey] = `__managed__:${slot.managedKey}`;
  });
  return assignments;
}

function getSectionChildren(section) {
  if (!section || typeof section !== "object") return [];
  if (Array.isArray(section.sections)) return section.sections;
  if (Array.isArray(section.groups)) return section.groups;
  return [];
}

function flattenDraftSections(sections = []) {
  const flattened = [];
  const visit = (sectionList = []) => {
    for (const section of Array.isArray(sectionList) ? sectionList : []) {
      if (!section || typeof section !== "object") continue;
      flattened.push(section);
      visit(getSectionChildren(section));
    }
  };
  visit(sections);
  return flattened;
}

function flattenDraftFieldsFromSections(sections = []) {
  return flattenDraftSections(sections).flatMap((section) => section.fields || []);
}

function normalizeSummaryRole(value) {
  const role = clean(value);
  if (/^card[1-9]$/.test(role)) return role;
  if (role === "model") return "card1";
  if (role === "capacity") return "card2";
  if (role === "category") return "card3";
  return role;
}

function normalizeVersion(value) {
  const version = clean(value || "v1").toLowerCase();
  if (/^v\d+$/.test(version)) return version;
  if (/^\d+$/.test(version)) return `v${version}`;
  return kebabCase(version) || "v1";
}

const supportedDataTypes = new Set(["string", "decimal", "integer", "boolean", "date", "datetime", "uri", "object", "array"]);
const supportedTableColumnDataTypes = new Set(
  [...supportedDataTypes].filter((dataType) => !["array", "object"].includes(dataType))
);

function normalizeDataType(value, allowedDataTypes = supportedDataTypes) {
  const type = clean(value || "string").toLowerCase();
  if (!allowedDataTypes.has(type)) {
    throw new Error(`Data type "${type}" must be one of: ${[...allowedDataTypes].join(", ")}.`);
  }
  return type;
}

function normalizeFieldType(value, dataType) {
  const fieldType = clean(value || (dataType === "boolean" ? "boolean" : "text"));
  if (fieldType === "checkbox") return "boolean";
  return fieldType;
}

function dataTypeFor(value) {
  const dataType = normalizeDataType(value);
  if (dataType === "array") return { format: "Array", jsonType: "array", items: { jsonType: "object" } };
  if (dataType === "decimal") return { format: "Decimal", jsonType: "decimal", xsdType: "xsd:decimal" };
  if (dataType === "integer") return { format: "Integer", jsonType: "integer", xsdType: "xsd:integer" };
  if (dataType === "boolean") return { format: "Boolean", jsonType: "boolean", xsdType: "xsd:boolean" };
  if (dataType === "date") return { format: "Date", jsonType: "string", xsdType: "xsd:date" };
  if (dataType === "datetime") return { format: "DateTime", jsonType: "string", xsdType: "xsd:dateTime" };
  if (dataType === "uri") return { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" };
  if (dataType === "object") return { format: "Object", jsonType: "object" };
  return { format: "String", jsonType: "string", xsdType: "xsd:string" };
}

function defaultObjectTypeForField(fieldType) {
  if (fieldType === "table") return "DataElementCollection";
  if (fieldType === "object" || fieldType === "objectList") return "DataElementCollection";
  if (fieldType === "file" || fieldType === "url" || fieldType === "symbol") return "RelatedResource";
  return "SingleValuedDataElement";
}

function defaultValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (fieldType === "objectList" || fieldType === "multiselect" || fieldType === "scalarList") return "Array";
  if (fieldType === "object") return "Object";
  if (fieldType === "file") return "URI";
  if (fieldType === "url" || fieldType === "symbol") return "URI";
  if (fieldType === "date") return "Date";
  if (fieldType === "datetime") return "DateTime";
  if (fieldType === "boolean") return "Boolean";
  return dataTypeFor(dataType).format.replace("/URL", "");
}

function validateFieldDataType(fieldType, dataType, fieldLabel) {
  if (fieldType === "table" && dataType !== "array") {
    throw new Error(`${fieldLabel} table fields must use dataType "array".`);
  }
  if (fieldType !== "table" && dataType === "array") {
    if (!["objectList", "multiselect", "scalarList"].includes(fieldType)) {
      throw new Error(`${fieldLabel} dataType "array" requires a repeated structured field type.`);
    }
  }
  if (dataType === "object" && fieldType !== "object") {
    throw new Error(`${fieldLabel} dataType "object" requires fieldType "object".`);
  }
  const requiredDataTypeByFieldType = {
    boolean: "boolean",
    date: "date",
    datetime: "datetime",
    file: "uri",
    symbol: "uri",
    url: "uri",
  };
  const requiredDataType = requiredDataTypeByFieldType[fieldType];
  if (requiredDataType && dataType !== requiredDataType) {
    throw new Error(`${fieldLabel} fieldType "${fieldType}" requires dataType "${requiredDataType}".`);
  }
}

function inferPresentation(field) {
  if (field.fieldType === "table") return "table";
  if (field.fieldType === "object" || field.fieldType === "objectList") return "semanticTree";
  if (field.fieldType === "file") return "evidenceFile";
  if (field.fieldType === "symbol") return "symbol";
  if (field.fieldType === "url") return "link";
  if (field.fieldType === "textarea") return "narrative";
  if (field.fieldType === "boolean" || field.dataType === "boolean") return "badge";
  if (field.dataType === "decimal" || field.dataType === "integer") return "liveMetric";
  return "data";
}

const objectTypes = new Set([
  "SingleValuedDataElement",
  "MultiValuedDataElement",
  "DataElementCollection",
  "RelatedResource",
  "MultiLanguageDataElement",
]);

const valueDataTypes = new Set([
  "String",
  "Boolean",
  "Integer",
  "Decimal",
  "Date",
  "DateTime",
  "URI",
  "Binary",
  "Array",
  "Object",
]);

function normalizeObjectType(value, label) {
  const normalized = clean(value);
  if (!objectTypes.has(normalized)) {
    throw new Error(`${label} objectType must be one of: ${[...objectTypes].join(", ")}`);
  }
  return normalized;
}

function normalizeValueDataType(value, label) {
  const normalized = clean(value);
  if (!valueDataTypes.has(normalized)) {
    throw new Error(`${label} valueDataType must be one of: ${[...valueDataTypes].join(", ")}`);
  }
  return normalized;
}

function xsdContextType(xsdType) {
  const suffix = clean(xsdType).replace(/^xsd:/, "");
  if (!suffix || suffix === "string") return null;
  return `http://www.w3.org/2001/XMLSchema#${suffix}`;
}

function jsValue(value) {
  return JSON.stringify(value);
}

function normalizeBaseUrl(value) {
  const suppliedValue = String(value ?? "");
  if (!suppliedValue || suppliedValue.trim() !== suppliedValue) {
    throw new Error("Base URL is required and must not contain surrounding whitespace.");
  }
  const rawUrl = suppliedValue.replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Base URL must be a valid absolute URL.");
  }
  const isLocalHttp = parsed.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Base URL must use HTTPS, except for localhost development.");
  }
  if (!parsed.hostname || /[\u0000-\u001F\u007F\s\\]/.test(rawUrl)
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Base URL must not include credentials, a query, or a fragment.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Base URL must use the site root without a path.");
  }
  return rawUrl;
}

function semanticSlugFromIri(value, fallback = "") {
  const iri = clean(value);
  const terminal = iri.split(/[\/#]/).filter(Boolean).pop();
  return kebabCase(terminal || fallback);
}

function buildSemanticGraphDraft(rawGraph, { family, version, baseUrl, sections }) {
  if (!rawGraph || typeof rawGraph !== "object" || Array.isArray(rawGraph)) {
    throw new Error("Semantic class graph is required.");
  }
  const graphInput = rawGraph || {};
  const dictionaryBase = `${baseUrl}/dictionary/${family}/${version}`;
  const termsBase = `${dictionaryBase}/terms`;
  const classesBase = `${dictionaryBase}/classes`;
  const enumsBase = `${dictionaryBase}/enums`;
  const rootInput = graphInput.rootClass || {};
  const rootClassKey = clean(rootInput.key || graphInput.rootClassKey || `${camelCase(family)}Passport`);
  const rootClassLabel = clean(rootInput.label) || titleCase(rootClassKey);

  const normalizeGraphProperty = (property, classDef) => {
    const label = clean(property.propertyLabel || property.label) || titleCase(property.propertyKey || property.key);
    const semanticSlug = kebabCase(property.semanticSlug || label || property.propertyKey || property.key);
    const key = clean(property.propertyKey || property.key)
      || canonicalKeyFromSemanticSlug(semanticSlug, label);
    const maxCountInput = property.maxCount;
    return {
      key,
      label: label || titleCase(key),
      semanticId: clean(property.semanticId) || (
        classDef.root
          ? `${termsBase}/${kebabCase(key)}`
          : `${termsBase}/${kebabCase(classDef.key)}/${kebabCase(key)}`
      ),
      definition: clean(property.definition) || `${label || titleCase(key)} on ${classDef.label}.`,
      domainClassKey: classDef.key,
      domainClassIri: classDef.semanticId,
      rangeKind: clean(property.rangeKind || "scalar").toLowerCase(),
      dataType: clean(property.dataType || "string").toLowerCase(),
      rangeClassKey: clean(property.rangeClassKey),
      rangeEnumKey: clean(property.rangeEnumKey),
      relationshipType: clean(property.relationshipType || "composition").toLowerCase(),
      minCount: property.minCount === "" || property.minCount === undefined ? 0 : Number(property.minCount),
      maxCount: maxCountInput === "" || maxCountInput === undefined
        ? 1
        : (maxCountInput === null || ["n", "*"].includes(String(maxCountInput).toLowerCase())
          ? null
          : Number(maxCountInput)),
      unit: clean(property.unit || property.unitSymbol),
      uiType: clean(property.uiType),
    };
  };

  const normalizeGraphClass = (rawClass) => {
    const label = clean(rawClass.classLabel || rawClass.label) || titleCase(rawClass.classKey || rawClass.key);
    const semanticSlug = kebabCase(rawClass.semanticSlug || label || rawClass.classKey || rawClass.key);
    const classDef = {
      key: clean(rawClass.classKey || rawClass.key) || canonicalKeyFromSemanticSlug(semanticSlug),
      label,
      semanticId: "",
      definition: clean(rawClass.definition) || `${label} semantic class.`,
      properties: [],
    };
    classDef.semanticId = clean(rawClass.semanticId) || `${classesBase}/${pascalCaseSemanticKey(classDef.key)}`;
    classDef.properties = (Array.isArray(rawClass.properties) ? rawClass.properties : [])
      .map((property) => normalizeGraphProperty(property, classDef));
    return classDef;
  };

  const normalizeGraphEnum = (rawEnum) => {
    const label = clean(rawEnum.enumLabel || rawEnum.label) || titleCase(rawEnum.enumKey || rawEnum.key);
    const semanticSlug = kebabCase(rawEnum.semanticSlug || label || rawEnum.enumKey || rawEnum.key);
    const key = clean(rawEnum.enumKey || rawEnum.key) || canonicalKeyFromSemanticSlug(semanticSlug);
    return {
      key,
      label,
      semanticId: clean(rawEnum.semanticId) || `${enumsBase}/${pascalCaseSemanticKey(key)}`,
      definition: clean(rawEnum.definition) || `${label} controlled vocabulary.`,
      values: (Array.isArray(rawEnum.values) ? rawEnum.values : []).map((rawValue) => {
        const valueLabel = clean(rawValue.valueLabel || rawValue.label) || titleCase(rawValue.valueKey || rawValue.key);
        const valueSlug = kebabCase(rawValue.semanticSlug || valueLabel || rawValue.valueKey || rawValue.key);
        const valueKey = clean(rawValue.valueKey || rawValue.key) || canonicalKeyFromSemanticSlug(valueSlug);
        return {
          key: valueKey,
          label: valueLabel,
          semanticId: clean(rawValue.semanticId) || `${enumsBase}/${pascalCaseSemanticKey(key)}/${kebabCase(valueKey)}`,
          definition: clean(rawValue.definition),
        };
      }),
    };
  };

  const rootClass = {
    key: rootClassKey,
    label: rootClassLabel,
    semanticId: clean(rootInput.semanticId) || `${classesBase}/${pascalCaseSemanticKey(rootClassKey)}`,
    definition: clean(rootInput.definition) || `${rootClassLabel} root semantic class.`,
    root: true,
    properties: [],
  };
  rootClass.properties = (Array.isArray(graphInput.rootProperties) ? graphInput.rootProperties : [])
    .map((property) => normalizeGraphProperty(property, rootClass));

  const classes = [
    rootClass,
    ...(Array.isArray(graphInput.classes) ? graphInput.classes : []).map(normalizeGraphClass),
  ];
  const enums = (Array.isArray(graphInput.enums) ? graphInput.enums : []).map(normalizeGraphEnum);
  const fieldEnumOverrides = new Map(
    [
      ...(Array.isArray(graphInput.rootProperties) ? graphInput.rootProperties : []),
      ...(Array.isArray(graphInput.classes) ? graphInput.classes : [])
        .flatMap((classDef) => Array.isArray(classDef?.properties) ? classDef.properties : []),
    ].flatMap((property) => {
      const [sourceKind, , sourceFieldKey] = clean(property?.sourceRef).split(":");
      const rangeEnumKey = clean(property?.enumOverrideKey || property?.rangeEnumKey);
      return sourceKind === "field"
        && sourceFieldKey
        && clean(property?.rangeKind).toLowerCase() === "enum"
        && rangeEnumKey
        ? [[sourceFieldKey, rangeEnumKey]]
        : [];
    })
  );
  const classKeys = new Set(classes.map((classDef) => classDef.key));
  const existingRootKeys = new Set(rootClass.properties.map((property) => property.key));

  for (const field of flattenDraftFieldsFromSections(sections)) {
    if (existingRootKeys.has(field.fieldKey)) continue;
    if (field.fieldType === "table") {
      const entryClassKey = `${field.fieldKey}Entry`;
      if (!classKeys.has(entryClassKey)) {
        const entryClass = {
          key: entryClassKey,
          label: `${field.fieldLabel} Entry`,
          semanticId: `${classesBase}/${pascalCase(field.semanticSlug)}Entry`,
          definition: `One structured entry within ${field.fieldLabel}.`,
          properties: (field.tableColumns || []).map((column) => ({
            key: column.columnKey,
            label: column.columnLabel,
            semanticId: `${termsBase}/${field.semanticSlug}/${column.semanticSlug}`,
            definition: `${column.columnLabel} within ${field.fieldLabel}.`,
            domainClassKey: entryClassKey,
            domainClassIri: `${classesBase}/${pascalCase(field.semanticSlug)}Entry`,
            rangeKind: "scalar",
            dataType: column.dataType,
            minCount: 0,
            maxCount: 1,
            unit: column.unitKey === "none" ? "" : (column.unitSymbol || ""),
          })),
        };
        classes.push(entryClass);
        classKeys.add(entryClassKey);
      }
      rootClass.properties.push({
        key: field.fieldKey,
        label: field.fieldLabel,
        semanticId: `${termsBase}/${field.semanticSlug}`,
        definition: field.definition,
        domainClassKey: rootClass.key,
        domainClassIri: rootClass.semanticId,
        rangeKind: "class",
        rangeClassKey: entryClassKey,
        relationshipType: "composition",
        minCount: 0,
        maxCount: null,
      });
    } else {
      const rangeEnumKey = fieldEnumOverrides.get(field.fieldKey);
      rootClass.properties.push({
        key: field.fieldKey,
        label: field.fieldLabel,
        semanticId: `${termsBase}/${field.semanticSlug}`,
        definition: field.definition,
        domainClassKey: rootClass.key,
        domainClassIri: rootClass.semanticId,
        rangeKind: rangeEnumKey ? "enum" : "scalar",
        ...(rangeEnumKey ? { rangeEnumKey } : { dataType: field.dataType }),
        minCount: field.required ? 1 : 0,
        maxCount: 1,
        unit: rangeEnumKey ? "" : (field.unitKey === "none" ? "" : (field.unitSymbol || "")),
        uiType: field.fieldType,
      });
    }
    existingRootKeys.add(field.fieldKey);
  }

  const semanticGraph = normalizeAndValidateSemanticGraph({
    schemaVersion: 1,
    rootClassKey: rootClass.key,
    classes,
    enums,
  });
  const existingFieldKeys = new Set(
    flattenDraftFieldsFromSections(sections).map((field) => field.fieldKey)
  );
  const generatedFields = semanticGraph.classes
    .find((classDef) => classDef.key === semanticGraph.rootClassKey)
    .properties
    .filter((property) => !existingFieldKeys.has(property.key))
    .map((property) => {
      const runtimeField = runtimeFieldFromSemanticProperty(property, semanticGraph);
      return {
        fieldKey: property.key,
        fieldLabel: property.label,
        fieldType: runtimeField.type,
        semanticSlug: semanticSlugFromIri(property.semanticId, property.key),
        definition: property.definition,
        specRef: "",
        dataType: runtimeField.dataType,
        itemDataType: runtimeField.itemDataType,
        unitKey: "none",
        unitLabel: "None",
        unitSymbol: "n.a.",
        confidentiality: "public",
        queryable: false,
        indexed: false,
        storageType: "jsonb",
        objectType: runtimeField.objectType,
        valueDataType: runtimeField.valueDataType,
        required: runtimeField.required,
        semanticId: property.semanticId,
        domainClassKey: property.domainClassKey,
        domainClassIri: property.domainClassIri,
        rangeKind: property.rangeKind,
        rangeClassKey: property.rangeClassKey,
        rangeEnumKey: property.rangeEnumKey,
        rangeIri: property.rangeIri,
        relationshipType: property.relationshipType,
        minCount: property.minCount,
        maxCount: property.maxCount,
        allowedValues: runtimeField.allowedValues,
        enumValues: runtimeField.enumValues,
        structured: runtimeField.structured,
      };
    });

  return { semanticGraph, generatedFields };
}

function validateSpec(input) {
  const module = input.module || {};
  const roles = input.roles || {};
  const family = kebabCase(module.family);
  const version = normalizeVersion(module.version);
  const moduleKey = clean(module.moduleKey) || `${family}:${version}`;
  const typeName = clean(module.typeName) || `${camelCase(family)}Passport${pascalCase(version)}`;
  const displayName = clean(module.displayName) || `${titleCase(family)} Passport ${version}`;
  const productCategory = clean(module.productCategory) || titleCase(family);
  const productIcon = clean(module.productIcon) || "PT";
  const semanticModelKey = clean(module.semanticModelKey) || `${camelCase(family)}Dictionary${pascalCase(version)}`;
  const contentSpecificationId = clean(module.contentSpecificationId) || semanticModelKey;
  const passportPolicyKey = clean(module.passportPolicyKey) || `${camelCase(family)}Dpp${pascalCase(version)}`;
  const defaultCarrierPolicyKey = clean(module.defaultCarrierPolicyKey || "webPublicEntryV1");
  const systemHeaderFieldAssignments = normalizeHeaderAssignments(module.systemHeaderFieldAssignments);
  const systemHeaderFieldMappings = headerSlotDefinitions
    .map((slot) => {
      const selectedValue = clean(systemHeaderFieldAssignments[slot.slotKey]);
      if (!selectedValue) return null;
      if (selectedValue === `__managed__:${slot.managedKey}`) {
        return {
          slotKey: slot.slotKey,
          label: slot.label,
          sourceType: "managed",
          managedKey: slot.managedKey,
        };
      }
      return {
        slotKey: slot.slotKey,
        label: slot.label,
        sourceType: "field",
        fieldKey: selectedValue,
      };
    })
    .filter(Boolean);
  const systemHeaderFieldKeys = systemHeaderFieldMappings
    .filter((entry) => entry.sourceType === "field")
    .map((entry) => entry.fieldKey);
  const baseUrl = normalizeBaseUrl(module.baseUrl);
  const dictionaryName = clean(module.dictionaryName) || `${titleCase(family)} Dictionary`;
  const dictionaryDescription = clean(module.dictionaryDescription)
    || `Internal ${family} passport dictionary used for Digital Product Passport implementations.`;
  const businessIdentifierField = clean(roles.businessIdentifierField || module.businessIdentifierField);
  const rawSummaryRoles = roles.summaryRoles && typeof roles.summaryRoles === "object" ? roles.summaryRoles : {};
  const summaryRoles = Object.fromEntries(
    Object.entries(rawSummaryRoles)
      .map(([fieldKey, role]) => [clean(fieldKey), normalizeSummaryRole(role)])
      .filter(([fieldKey, role]) => fieldKey && role)
  );
  const lifecycleRoles = roles.lifecycleRoles && typeof roles.lifecycleRoles === "object" ? roles.lifecycleRoles : {};
  const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
  const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
  const compositionFieldKey = clean(roles.compositionFieldKey);
  const compositionLabelColumnKey = normalizeTableColumnKey(roles.compositionLabelColumnKey);
  const compositionValueColumnKey = normalizeTableColumnKey(roles.compositionValueColumnKey);

  if (!family) throw new Error("Product family is required");
  if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName)) {
    throw new Error("typeName must be camelCase letters/numbers, 2-100 chars, start with lowercase");
  }

  const normalizeInputField = (field) => {
    const rawFieldKey = clean(field.fieldKey || field.key);
    const fieldLabel = clean(field.fieldLabel) || clean(field.label) || titleCase(rawFieldKey);
    const semanticSlug = kebabCase(field.semanticSlug || fieldLabel || rawFieldKey);
    const fieldKey = canonicalKeyFromSemanticSlug(semanticSlug, field.fieldKey || field.key || fieldLabel);
    const resolvedFieldLabel = fieldLabel || titleCase(fieldKey);
    const unitKey = clean(field.unitKey || field.unit || "none").toLowerCase() || "none";
    const unitSymbol = unitKey === "none" ? "n.a." : clean(field.unitSymbol || field.unitDisplay || unitKey);
    const dataType = normalizeDataType(field.dataType);
    const fieldType = normalizeFieldType(field.fieldType || field.type, dataType);
    validateFieldDataType(fieldType, dataType, resolvedFieldLabel);
    const normalized = {
      fieldKey,
      fieldLabel: resolvedFieldLabel,
      fieldType,
      semanticSlug,
      definition: clean(field.definition) || `${resolvedFieldLabel} for the ${productCategory} passport.`,
      specRef: clean(field.specRef),
      dataType,
      unitKey,
      unitLabel: clean(field.unitLabel) || (unitKey === "none" ? "None" : titleCase(unitKey)),
      unitSymbol,
      confidentiality: clean(field.confidentiality || "public").toLowerCase() === "restricted" ? "restricted" : "public",
      queryable: Boolean(field.queryable),
      indexed: Boolean(field.indexed),
      storageType: clean(field.storageType),
      objectType: clean(field.objectType),
      valueDataType: clean(field.valueDataType),
    };

    if (fieldType === "table") {
      const tableColumns = normalizeTableColumns(field.tableColumns || [], fieldLabel);
      normalized.tableColumns = tableColumns;
    }

    return normalized;
  };

  const normalizeInputSection = (section) => {
    const normalized = {
      key: clean(section.key) || camelCase(section.label),
      label: clean(section.label || section.name) || titleCase(section.key),
      fields: (section.fields || []).map(normalizeInputField),
      sections: getSectionChildren(section).map(normalizeInputSection),
    };
    return normalized;
  };

  let sections = (input.sections || [])
    .map(normalizeInputSection)
    .filter((section) => section.key && (section.fields.length || section.sections.length));

  if (!sections.length) throw new Error("At least one section with one field is required");
  const {
    semanticGraph,
    generatedFields: semanticGraphFields,
  } = buildSemanticGraphDraft(input.semanticGraph, {
    family,
    version,
    baseUrl,
    sections,
  });
  if (semanticGraphFields.length) {
    sections = [
      ...sections,
      {
        key: "semanticRelationships",
        label: "Semantic Relationships",
        fields: semanticGraphFields,
      },
    ];
  }
  const sectionKeys = flattenDraftSections(sections).map((section) => section.key);
  const duplicateSection = sectionKeys.find((key, index) => sectionKeys.indexOf(key) !== index);
  if (duplicateSection) throw new Error(`Duplicate section key: ${duplicateSection}`);

  const fieldKeys = flattenDraftFieldsFromSections(sections).map((field) => field.fieldKey);
  const duplicateField = fieldKeys.find((key, index) => fieldKeys.indexOf(key) !== index);
  if (duplicateField) throw new Error(`Duplicate field key: ${duplicateField}`);
  const fieldByKey = new Map(flattenDraftFieldsFromSections(sections).map((field) => [field.fieldKey, field]));
  const requireKnownFieldKey = (fieldKey, label) => {
    if (fieldKey && !fieldByKey.has(fieldKey)) {
      throw new Error(`${label} "${fieldKey}" must exist as a generated field.`);
    }
  };
  if (!businessIdentifierField) {
    throw new Error("Business identifier field is required.");
  }
  requireKnownFieldKey(businessIdentifierField, "Business identifier field");
  for (const fieldKey of [
    ...Object.keys(summaryRoles),
    ...Object.keys(lifecycleRoles),
    ...Object.keys(objectTypes),
    ...Object.keys(valueDataTypes),
    ...systemHeaderFieldKeys,
  ]) {
    requireKnownFieldKey(fieldKey, "Role metadata field");
  }
  const duplicateHeaderFieldKey = systemHeaderFieldKeys.find((fieldKey, index) => systemHeaderFieldKeys.indexOf(fieldKey) !== index);
  if (duplicateHeaderFieldKey) {
    throw new Error(`Passport header field "${duplicateHeaderFieldKey}" is assigned to multiple header slots.`);
  }
  const summaryCardRoles = Object.values(summaryRoles).filter((role) => /^card[1-9]$/.test(role));
  const duplicateSummaryCardRole = summaryCardRoles.find((role, index) => summaryCardRoles.indexOf(role) !== index);
  if (duplicateSummaryCardRole) {
    throw new Error(`Product overview ${duplicateSummaryCardRole.replace("card", "card ")} is assigned to multiple fields.`);
  }
  requireKnownFieldKey(compositionFieldKey, "Composition chart field");

  for (const field of fieldByKey.values()) {
    field.displayRole = summaryRoles[field.fieldKey] ? "hero" : "detail";
    field.presentation = inferPresentation(field);
    field.summaryRole = clean(summaryRoles[field.fieldKey]);
    field.lifecycleRole = clean(lifecycleRoles[field.fieldKey]);
    field.elementIdPath = field.fieldKey;
    field.objectType = normalizeObjectType(
      field.objectType || objectTypes[field.fieldKey] || defaultObjectTypeForField(field.fieldType),
      `Field "${field.fieldKey}"`
    );
    field.valueDataType = normalizeValueDataType(
      field.valueDataType || valueDataTypes[field.fieldKey] || defaultValueDataTypeForField(field.fieldType, field.dataType),
      `Field "${field.fieldKey}"`
    );
    const expectedValueDataType = defaultValueDataTypeForField(field.fieldType, field.dataType);
    if (field.valueDataType !== expectedValueDataType) {
      throw new Error(
        `Field "${field.fieldKey}" dataType "${field.dataType}" requires valueDataType "${expectedValueDataType}".`
      );
    }
    if (field.fieldType === "table" && field.objectType !== "DataElementCollection") {
      throw new Error(`Field "${field.fieldKey}" table fields require objectType "DataElementCollection".`);
    }
    if (field.fieldType === "table" && field.valueDataType !== "Array") {
      throw new Error(`Field "${field.fieldKey}" table fields require valueDataType "Array".`);
    }
    for (const column of field.tableColumns || []) {
      column.elementIdPath = `${field.fieldKey}.${column.columnKey}`;
    }
  }

  if (compositionFieldKey) {
    const field = fieldByKey.get(compositionFieldKey);
    if (field.fieldType !== "table") {
      throw new Error("Composition chart field must be a table field.");
    }
    if (!compositionLabelColumnKey || !compositionValueColumnKey) {
      throw new Error("Composition chart must define both label and data columns.");
    }
    if (compositionLabelColumnKey === compositionValueColumnKey) {
      throw new Error("Composition chart must use different label and data columns.");
    }
    const columnKeys = new Set((field.tableColumns || []).map((column) => column.columnKey));
    if (!columnKeys.has(compositionLabelColumnKey) || !columnKeys.has(compositionValueColumnKey)) {
      throw new Error("Composition chart columns must exist on the selected table field.");
    }
    const labelColumn = field.tableColumns.find((column) => column.columnKey === compositionLabelColumnKey);
    const valueColumn = field.tableColumns.find((column) => column.columnKey === compositionValueColumnKey);
    if (labelColumn.dataType !== "string") {
      throw new Error("Composition chart label column must use dataType \"string\".");
    }
    if (!["decimal", "integer"].includes(valueColumn.dataType)) {
      throw new Error("Composition chart data column must use dataType \"decimal\" or \"integer\".");
    }
    field.composition = true;
    field.compositionLabelColumnKey = compositionLabelColumnKey;
    field.compositionValueColumnKey = compositionValueColumnKey;
    field.presentation = "compositionChart";
  }

  const rootClass = semanticGraph.classes.find((classDef) => classDef.key === semanticGraph.rootClassKey);
  const rootPropertiesByKey = new Map(
    (rootClass?.properties || []).map((property) => [property.key, property])
  );
  for (const field of fieldByKey.values()) {
    const property = rootPropertiesByKey.get(field.fieldKey);
    if (!property) throw new Error(`Field "${field.fieldKey}" is missing from the semantic graph root class.`);
    const runtimeField = runtimeFieldFromSemanticProperty(property, semanticGraph);
    Object.assign(field, {
      fieldType: runtimeField.type,
      dataType: runtimeField.dataType,
      itemDataType: runtimeField.itemDataType,
      objectType: runtimeField.objectType,
      valueDataType: runtimeField.valueDataType,
      required: runtimeField.required,
      semanticId: property.semanticId,
      domainClassKey: property.domainClassKey,
      domainClassIri: property.domainClassIri,
      rangeKind: property.rangeKind,
      rangeClassKey: property.rangeClassKey,
      rangeEnumKey: property.rangeEnumKey,
      rangeIri: property.rangeIri,
      relationshipType: property.relationshipType,
      minCount: property.minCount,
      maxCount: property.maxCount,
      allowedValues: runtimeField.allowedValues,
      enumValues: runtimeField.enumValues,
      structured: runtimeField.structured,
      storageType: runtimeField.storageType || field.storageType,
    });
    if (property.rangeKind !== "scalar") {
      delete field.tableColumns;
    }
    field.presentation = field.composition ? "compositionChart" : inferPresentation(field);
  }

  for (const section of flattenDraftSections(sections)) {
    if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(section.key)) {
      throw new Error(`Invalid section key: ${section.key}`);
    }
    for (const field of section.fields || []) {
      if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(field.fieldKey)) {
        throw new Error(`Invalid field key: ${field.fieldKey}`);
      }
      if (field.fieldType === "table") {
        for (const column of field.tableColumns || []) {
          if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(column.columnKey)) {
            throw new Error(`Invalid table column key: ${column.columnKey}`);
          }
        }
      }
    }
  }

  return {
    module: {
      family,
      version,
      moduleKey,
      typeName,
      displayName,
      productCategory,
      productIcon,
      semanticModelKey,
      contentSpecificationId,
      passportPolicyKey,
      defaultCarrierPolicyKey,
      systemHeaderFieldAssignments,
      systemHeaderFieldMappings,
      systemHeaderFieldKeys: [...new Set(systemHeaderFieldKeys)],
      baseUrl,
      dictionaryName,
      dictionaryDescription,
      businessIdentifierField,
    },
    sections,
    semanticGraph,
  };
}

function buildTerms(spec) {
  let graphNumber = 0;
  return spec.semanticGraph.classes.flatMap((classDef) =>
      classDef.properties.map((property) => {
        graphNumber += 1;
        let dataType;
        if (property.rangeKind === "scalar") {
          dataType = property.maxCount === null || property.maxCount > 1
            ? { format: "Array", jsonType: "array", items: dataTypeFor(property.dataType) }
            : dataTypeFor(property.dataType);
        } else if (property.rangeKind === "enum") {
          dataType = property.maxCount === null || property.maxCount > 1
            ? { format: "Array", jsonType: "array", items: { jsonType: "string" } }
            : dataTypeFor("string");
        } else {
          dataType = property.maxCount === null || property.maxCount > 1
            ? {
                format: "Array",
                jsonType: "array",
                items: { jsonType: "object", classIri: property.rangeIri },
              }
            : { format: "Object", jsonType: "object", classIri: property.rangeIri };
        }
        return {
          number: graphNumber,
          specRef: `${spec.module.family.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "DPP"}-${String(graphNumber).padStart(3, "0")}`,
          slug: kebabCase(classDef.root ? property.key : `${classDef.key}-${property.key}`),
          iri: property.semanticId,
          label: property.label,
          definition: property.definition,
          internalKey: property.key,
          dataType,
          unit: property.unit || "none",
          rangeKind: property.rangeKind,
          domain: {
            iri: classDef.semanticId,
            curie: `${spec.module.family}:${classDef.key}`,
            key: classDef.key,
            label: classDef.label,
          },
          range: property.rangeKind === "scalar"
            ? {
                iri: scalarRangeIri(property.dataType),
                curie: dataTypeFor(property.dataType).xsdType,
                label: dataTypeFor(property.dataType).format,
                jsonType: dataTypeFor(property.dataType).jsonType,
              }
            : {
                iri: property.rangeIri,
                label: property.rangeKind === "class"
                  ? spec.semanticGraph.classes.find((entry) => entry.key === property.rangeClassKey)?.label
                  : spec.semanticGraph.enums.find((entry) => entry.key === property.rangeEnumKey)?.label,
                jsonType: property.rangeKind === "class" ? "object" : "string",
              },
          minCount: property.minCount,
          maxCount: property.maxCount,
          relationshipType: property.relationshipType || undefined,
        };
      })
  );
}

function buildUnits(spec) {
  const properties = spec.semanticGraph.classes
    .flatMap((classDef) => classDef.properties)
    .filter((property) => property.unit);
  return uniqueBy(properties, (property) => property.unit).map((property) => ({
    key: kebabCase(property.unit),
    label: property.unit,
    symbol: property.unit,
  }));
}

function termIri(spec, term) {
  return `${semanticBase(spec)}/terms/${term.slug}`;
}

function buildContext(spec, terms) {
  const termsByIri = new Map(terms.map((term) => [term.iri, term]));
  const classesByKey = new Map(spec.semanticGraph.classes.map((classDef) => [classDef.key, classDef]));
  const buildScopedClassContext = (classKey) => {
    const classDef = classesByKey.get(classKey);
    const scoped = {};
    for (const property of classDef?.properties || []) {
      const term = termsByIri.get(property.semanticId);
      const definition = { "@id": property.semanticId };
      if (property.maxCount === null || property.maxCount > 1) definition["@container"] = "@set";
      if (property.rangeKind === "scalar") {
        const type = xsdContextType(dataTypeFor(property.dataType).xsdType);
        if (type) definition["@type"] = type;
      } else if (property.rangeKind === "enum" || property.relationshipType === "reference") {
        definition["@type"] = "@id";
      } else if (property.rangeKind === "class") {
        definition["@context"] = buildScopedClassContext(property.rangeClassKey);
      }
      scoped[term?.internalKey || property.key] = definition;
    }
    return scoped;
  };
  return {
    "@context": {
      "@version": 1.1,
      [spec.module.family]: `${semanticBase(spec)}/terms/`,
      ...Object.fromEntries(spec.semanticGraph.classes.map((classDef) => [
        classDef.key,
        { "@id": classDef.semanticId },
      ])),
      ...buildScopedClassContext(spec.semanticGraph.rootClassKey),
    },
  };
}

function buildClasses(spec) {
  return spec.semanticGraph.classes.map((classDef) => ({
    key: classDef.key,
    label: classDef.label,
    iri: classDef.semanticId,
    definition: classDef.definition,
    root: classDef.key === spec.semanticGraph.rootClassKey,
    properties: classDef.properties.map((property) => ({
      key: property.key,
      label: property.label,
      iri: property.semanticId,
      definition: property.definition,
      domainClassKey: property.domainClassKey,
      domainIri: property.domainClassIri,
      rangeKind: property.rangeKind,
      rangeIri: property.rangeIri,
      dataType: property.dataType || null,
      rangeClassKey: property.rangeClassKey || null,
      rangeEnumKey: property.rangeEnumKey || null,
      minCount: property.minCount,
      maxCount: property.maxCount,
      relationshipType: property.relationshipType || null,
      unit: property.unit || null,
      uiType: property.uiType || null,
    })),
  }));
}

function buildEnums(spec) {
  return spec.semanticGraph.enums.map((enumDef) => ({
    key: enumDef.key,
    label: enumDef.label,
    iri: enumDef.semanticId,
    definition: enumDef.definition,
    values: enumDef.values.map((value) => ({
      key: value.key,
      label: value.label,
      iri: value.semanticId,
      definition: value.definition,
    })),
  }));
}

function scalarRangeIri(dataType) {
  return xsdContextType(dataTypeFor(dataType).xsdType) || "http://www.w3.org/2001/XMLSchema#string";
}

function buildOntology(spec) {
  const context = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };
  const graph = [];
  for (const classDef of spec.semanticGraph.classes) {
    const restrictions = classDef.properties.map((property) => ({
      "@type": "owl:Restriction",
      "owl:onProperty": { "@id": property.semanticId },
      ...(property.minCount > 0
        ? { "owl:minCardinality": { "@value": property.minCount, "@type": "xsd:nonNegativeInteger" } }
        : {}),
      ...(property.maxCount !== null
        ? { "owl:maxCardinality": { "@value": property.maxCount, "@type": "xsd:nonNegativeInteger" } }
        : {}),
    }));
    graph.push({
      "@id": classDef.semanticId,
      "@type": "owl:Class",
      "rdfs:label": classDef.label,
      "rdfs:comment": classDef.definition,
      ...(restrictions.length ? { "rdfs:subClassOf": restrictions } : {}),
    });
    for (const property of classDef.properties) {
      graph.push({
        "@id": property.semanticId,
        "@type": property.rangeKind === "scalar" ? "owl:DatatypeProperty" : "owl:ObjectProperty",
        "rdfs:label": property.label,
        "rdfs:comment": property.definition,
        "rdfs:domain": { "@id": classDef.semanticId },
        "rdfs:range": {
          "@id": property.rangeKind === "scalar"
            ? scalarRangeIri(property.dataType)
            : property.rangeIri,
        },
      });
    }
  }
  for (const enumDef of spec.semanticGraph.enums) {
    graph.push({
      "@id": enumDef.semanticId,
      "@type": "owl:Class",
      "rdfs:label": enumDef.label,
      "rdfs:comment": enumDef.definition,
      "owl:oneOf": {
        "@list": enumDef.values.map((value) => ({ "@id": value.semanticId })),
      },
    });
    enumDef.values.forEach((value) => {
      graph.push({
        "@id": value.semanticId,
        "@type": ["owl:NamedIndividual", enumDef.semanticId],
        "rdfs:label": value.label,
        ...(value.definition ? { "rdfs:comment": value.definition } : {}),
      });
    });
  }
  return { "@context": context, "@graph": graph };
}

function buildShapes(spec) {
  const context = {
    sh: "http://www.w3.org/ns/shacl#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };
  return {
    "@context": context,
    "@graph": spec.semanticGraph.classes.map((classDef) => ({
      "@id": `${classDef.semanticId}Shape`,
      "@type": "sh:NodeShape",
      "sh:targetClass": { "@id": classDef.semanticId },
      "sh:closed": true,
      "sh:ignoredProperties": {
        "@list": [{ "@id": "rdf:type" }],
      },
      "sh:property": classDef.properties.map((property) => ({
        "sh:path": { "@id": property.semanticId },
        "sh:name": property.label,
        "sh:minCount": property.minCount,
        ...(property.maxCount !== null ? { "sh:maxCount": property.maxCount } : {}),
        ...(property.rangeKind === "scalar"
          ? { "sh:datatype": { "@id": scalarRangeIri(property.dataType) } }
          : property.rangeKind === "class"
            ? property.relationshipType === "reference"
              ? { "sh:nodeKind": { "@id": "sh:IRI" } }
              : { "sh:class": { "@id": property.rangeIri } }
            : {
                "sh:nodeKind": { "@id": "sh:IRI" },
                "sh:in": {
                  "@list": (spec.semanticGraph.enums.find((entry) => entry.key === property.rangeEnumKey)?.values || [])
                    .map((value) => ({ "@id": value.semanticId })),
                },
              }),
      })),
    })),
  };
}

function buildManifest(spec) {
  const { family, version, baseUrl, semanticModelKey, dictionaryName, dictionaryDescription } = spec.module;
  const publicBase = semanticBase(spec);
  const dictionaryApiBase = apiBase(spec);
  const catalogUrl = `${publicBase}/catalog.jsonld`;
  return {
    semanticModelKey,
    name: dictionaryName,
    version: "1.0.0",
    description: dictionaryDescription,
    versioning: {
      dictionaryVersion: "1.0.0",
    },
    publisher: {
      name: "Digital Product Passport Platform",
      url: baseUrl,
    },
    issuerDid: `did:web:${baseUrl.replace(/^https?:\/\//, "")}`,
    baseIri: publicBase,
    contextUrl: `${publicBase}/context.jsonld`,
    termsUrl: `${dictionaryApiBase}/terms`,
    unitsUrl: `${dictionaryApiBase}/units`,
    classesUrl: `${dictionaryApiBase}/classes`,
    enumsUrl: `${dictionaryApiBase}/enums`,
    ontologyUrl: `${publicBase}/ontology.jsonld`,
    shapesUrl: `${publicBase}/shapes.jsonld`,
    catalogUrl,
    interoperabilityProfile: {
      catalogUrl,
    },
  };
}

function buildCatalog(spec, terms = []) {
  const { family, semanticModelKey, dictionaryName, dictionaryDescription } = spec.module;
  const publicBase = semanticBase(spec);
  const dictionaryApiBase = apiBase(spec);
  return {
    "@context": {
      "@version": 1.1,
      dcat: "http://www.w3.org/ns/dcat#",
      dcterms: "http://purl.org/dc/terms/",
      skos: "http://www.w3.org/2004/02/skos/core#",
    },
    "@id": `${publicBase}/catalog.jsonld`,
    "@type": "dcat:Catalog",
    "dcterms:title": dictionaryName,
    "dcterms:description": dictionaryDescription,
    "dcat:dataset": {
      "@id": `${publicBase}/dataset`,
      "@type": "dcat:Dataset",
      "dcterms:identifier": semanticModelKey,
      "dcterms:title": dictionaryName,
      "dcat:keyword": [
        `${family} passport`,
        "digital product passport",
        "semantic dictionary",
      ],
      "dcat:distribution": [
        {
          "@id": `${publicBase}/distributions/terms-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} dictionary terms JSON`,
          "dcat:accessURL": { "@id": `${dictionaryApiBase}/terms` },
          "dcat:mediaType": "application/json",
        },
        {
          "@id": `${publicBase}/distributions/context-jsonld`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} dictionary JSON-LD context`,
          "dcat:accessURL": { "@id": `${publicBase}/context.jsonld` },
          "dcat:mediaType": "application/ld+json",
        },
        {
          "@id": `${publicBase}/distributions/ontology-jsonld`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} ontology JSON-LD`,
          "dcat:accessURL": { "@id": `${publicBase}/ontology.jsonld` },
          "dcat:mediaType": "application/ld+json",
        },
        {
          "@id": `${publicBase}/distributions/shacl-jsonld`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} SHACL shapes JSON-LD`,
          "dcat:accessURL": { "@id": `${publicBase}/shapes.jsonld` },
          "dcat:mediaType": "application/ld+json",
        },
      ],
    },
    "dcat:service": {
      "@id": `${publicBase}/service`,
      "@type": "dcat:DataService",
      "dcterms:title": `${dictionaryName} api`,
      "dcat:endpointURL": { "@id": dictionaryApiBase },
      "dcat:servesDataset": { "@id": `${publicBase}/dataset` },
    },
    termCount: terms.length,
  };
}

function buildModuleJs(spec) {
  const {
    family,
    version,
    moduleKey,
    typeName,
    displayName,
    productCategory,
    productIcon,
    semanticModelKey,
    contentSpecificationId,
    passportPolicyKey,
    baseUrl,
    businessIdentifierField,
    defaultCarrierPolicyKey,
    systemHeaderFieldMappings = [],
    systemHeaderFieldKeys = [],
  } = spec.module;
  const semanticBase = `${baseUrl}/dictionary/${family}/${version}/terms`;

  const renderSection = (section, indent = "    ") => {
    const childIndent = `${indent}  `;
    const fieldIndent = `${childIndent}  `;
    const fieldLines = section.fields.map((field) => {
      const args = {
        key: field.fieldKey,
        label: field.fieldLabel,
        semanticSlug: field.semanticSlug,
        semanticId: field.semanticId || `${semanticBase}/${field.semanticSlug}`,
      };
      if (field.fieldType !== "text") args.type = field.fieldType;
      if (field.confidentiality === "restricted") args.confidentiality = "restricted";
      if (field.unitKey !== "none") args.unit = field.unitSymbol;
      if (field.dataType !== "string") args.dataType = field.dataType === "integer" ? "integer" : field.dataType;
      if (field.queryable) args.queryable = true;
      if (field.indexed) args.indexed = true;
      if (field.storageType) args.storageType = field.storageType;
      args.displayRole = field.displayRole;
      if (field.summaryRole) args.summaryRole = field.summaryRole;
      if (field.lifecycleRole) args.lifecycleRole = field.lifecycleRole;
      args.presentation = field.presentation;
      args.elementIdPath = field.elementIdPath;
      args.objectType = field.objectType;
      args.valueDataType = field.valueDataType;
      for (const metadataKey of [
        "itemDataType",
        "domainClassKey",
        "domainClassIri",
        "rangeKind",
        "rangeClassKey",
        "rangeEnumKey",
        "rangeIri",
        "relationshipType",
        "minCount",
        "maxCount",
        "allowedValues",
        "enumValues",
        "structured",
      ]) {
        if (field[metadataKey] !== undefined) args[metadataKey] = field[metadataKey];
      }
      if (field.composition) args.composition = true;
      if (field.compositionLabelColumnKey) args.compositionLabelColumnKey = field.compositionLabelColumnKey;
      if (field.compositionValueColumnKey) args.compositionValueColumnKey = field.compositionValueColumnKey;
      if (field.fieldType === "table") {
        args.tableColumns = (field.tableColumns || []).map((column) => ({
          label: column.columnLabel,
          semanticSlug: column.semanticSlug,
          elementIdPath: column.elementIdPath,
          objectType: column.objectType,
          valueDataType: column.valueDataType,
          dataType: column.dataType,
          ...(column.unitKey !== "none" ? { unit: column.unitSymbol || column.unitKey } : {}),
        }));
      }
      return `${fieldIndent}field(${jsValue(args)})`;
    }).join(",\n");
    const childSectionLines = (section.sections || [])
      .map((child) => renderSection(child, childIndent))
      .join(",\n");
    const fieldBlock = fieldLines
      ? `\n${childIndent}fields: [\n${fieldLines}\n${childIndent}],`
      : `\n${childIndent}fields: [],`;
    const childBlock = childSectionLines
      ? `\n${childIndent}sections: [\n${childSectionLines}\n${childIndent}],`
      : "";
    return `${indent}{\n${childIndent}key: ${jsValue(section.key)},\n${childIndent}label: ${jsValue(section.label)},${fieldBlock}${childBlock}\n${indent}}`;
  };

  const sectionLines = spec.sections.map((section) => renderSection(section)).join(",\n");

  return `"use strict";

const semanticBaseUrl = ${jsValue(semanticBase)};

function term(slug) {
  return \`${"${semanticBaseUrl}"}/\${slug}\`;
}

function keyFromSemanticSlug(slug, fallback = "") {
  const words = String(slug || fallback || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : \`\${word.charAt(0).toUpperCase()}\${word.slice(1)}\`)
    .join("");
}

function field({
  key,
  label,
  semanticSlug,
  semanticId,
  type = "text",
  confidentiality = "public",
  unit = "",
  dataType = "string",
  queryable = false,
  indexed = false,
  storageType = "",
  tableColumns = [],
  composition = false,
  compositionLabelColumnKey = "",
  compositionValueColumnKey = "",
  displayRole,
  summaryRole = "",
  lifecycleRole = "",
  presentation,
  elementIdPath,
  objectType,
  valueDataType,
  itemDataType,
  domainClassKey,
  domainClassIri,
  rangeKind,
  rangeClassKey,
  rangeEnumKey,
  rangeIri,
  relationshipType,
  minCount,
  maxCount,
  allowedValues,
  enumValues,
  structured,
}) {
  const resolvedKey = key || keyFromSemanticSlug(semanticSlug, label);
  return {
    key: resolvedKey,
    label,
    type,
    confidentiality: confidentiality === "restricted" ? "restricted" : "public",
    semanticId: semanticId || term(semanticSlug),
    elementIdPath,
    unit,
    dataType,
    objectType,
    valueDataType,
    ...(itemDataType ? { itemDataType } : {}),
    ...(domainClassKey ? { domainClassKey } : {}),
    ...(domainClassIri ? { domainClassIri } : {}),
    ...(rangeKind ? { rangeKind } : {}),
    ...(rangeClassKey ? { rangeClassKey } : {}),
    ...(rangeEnumKey ? { rangeEnumKey } : {}),
    ...(rangeIri ? { rangeIri } : {}),
    ...(relationshipType ? { relationshipType } : {}),
    ...(minCount !== undefined ? { minCount } : {}),
    ...(maxCount !== undefined ? { maxCount } : {}),
    ...(allowedValues ? { allowedValues } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(structured ? { structured: true } : {}),
    displayRole,
    ...(summaryRole ? { summaryRole } : {}),
    ...(lifecycleRole ? { lifecycleRole } : {}),
    presentation,
    ...(queryable ? { queryable: true } : {}),
    ...(indexed ? { indexed: true } : {}),
    ...(storageType ? { storageType } : {}),
    ...(composition ? { composition: true } : {}),
    ...(compositionLabelColumnKey ? { compositionLabelColumnKey } : {}),
    ...(compositionValueColumnKey ? { compositionValueColumnKey } : {}),
    ...(type === "table" ? {
      tableColumnCount: tableColumns.length,
      tableColumns: tableColumns.map((column) => ({
        key: keyFromSemanticSlug(column.semanticSlug, column.label),
        label: column.label,
        semanticId: term(column.semanticSlug),
        elementIdPath: column.elementIdPath,
        objectType: column.objectType,
        valueDataType: column.valueDataType,
        dataType: column.dataType,
        ...(column.unit ? { unit: column.unit } : {}),
      })),
    } : {}),
  };
}

module.exports = {
  moduleKey: ${jsValue(moduleKey)},
  typeName: ${jsValue(typeName)},
  displayName: ${jsValue(displayName)},
  productCategory: ${jsValue(productCategory)},
  productIcon: ${jsValue(productIcon)},
  semanticModelKey: ${jsValue(semanticModelKey)},
  semanticGraph: ${jsValue(spec.semanticGraph)},
  systemHeader: {
    section: {
      key: "passportHeader",
      label: "Passport Header",
    },
    fieldMappings: ${jsValue(systemHeaderFieldMappings)},
    fieldKeys: ${jsValue(systemHeaderFieldKeys)},
  },
  identity: {
    businessIdentifierField: ${businessIdentifierField ? jsValue(businessIdentifierField) : "null"},
  },
  passportPolicy: {
    key: ${jsValue(passportPolicyKey)},
    displayName: ${jsValue(`${displayName.replace(/\s+passport\s+v\d+$/i, "").replace(/\s+v\d+$/i, "")} Passport Policy ${version}`)},
    contentSpecificationIds: [${jsValue(contentSpecificationId)}],
    defaultCarrierPolicyKey: ${jsValue(defaultCarrierPolicyKey)},
  },
  schemaVersion: 1,
  lifecycle: {
    source: "code",
    stability: "versioned",
    changePolicy: "Breaking schema or semantic changes require a new module and typeName.",
  },
  sections: [
${sectionLines}
  ],
};
`;
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const crc32Table = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
}));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const dosDate = 0x0021;
  const utf8Flag = 0x0800;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const content = Buffer.from(file.content, "utf8");
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildArtifacts(input) {
  const spec = validateSpec(input);
  const terms = buildTerms(spec);
  const units = buildUnits(spec);
  const context = buildContext(spec, terms);
  const manifest = buildManifest(spec);
  const catalog = buildCatalog(spec, terms);
  const classes = buildClasses(spec);
  const enums = buildEnums(spec);
  const ontology = buildOntology(spec);
  const shapes = buildShapes(spec);
  const packageDir = `apps/backend-api/passport-modules/${spec.module.family}-${spec.module.version}`;

  return {
    spec,
    artifacts: [
      {
        path: `${packageDir}/module.js`,
        content: buildModuleJs(spec),
      },
      { path: `${packageDir}/manifest.json`, content: prettyJson(manifest) },
      { path: `${packageDir}/terms.json`, content: prettyJson(terms) },
      { path: `${packageDir}/context.jsonld`, content: prettyJson(context) },
      { path: `${packageDir}/units.json`, content: prettyJson(units) },
      { path: `${packageDir}/catalog.jsonld`, content: prettyJson(catalog) },
      { path: `${packageDir}/classes.json`, content: prettyJson(classes) },
      { path: `${packageDir}/enums.json`, content: prettyJson(enums) },
      { path: `${packageDir}/ontology.jsonld`, content: prettyJson(ontology) },
      { path: `${packageDir}/shapes.jsonld`, content: prettyJson(shapes) },
    ],
  };
}

async function buildArtifactsZip(input) {
  const result = buildArtifacts(input);
  const buffer = buildZipBuffer(result.artifacts);
  return {
    buffer,
    fileName: `${result.spec.module.family}-${result.spec.module.version}-passport-module.zip`,
    artifacts: result.artifacts.map((artifact) => artifact.path),
  };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "POST") validateApiPostRequest(req);
    if (req.method === "GET" && pathname === "/api/status") {
      sendJson(res, 200, { mode: "download-only", port: port });
      return;
    }

    if (req.method === "POST" && pathname === "/api/preview") {
      const input = await readBody(req);
      const result = buildArtifacts(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/download") {
      const input = await readBody(req);
      const result = await buildArtifactsZip(input);
      sendBuffer(res, 200, result.buffer, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      });
      return;
    }

    sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      error: error.message,
      conflicts: error.conflicts || undefined,
    });
  }
}

// nosemgrep: problem-based-packs.insecure-transport.js-node.using-http-server.using-http-server -- This export-only tool listens exclusively on 127.0.0.1, never a network interface; HTTPS would require a locally trusted certificate without improving transport security.
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch {
    sendJson(res, 400, { error: "Request URL is invalid" });
  }
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Passport module generator running at http://127.0.0.1:${port}`);
    console.log("Export-only mode: repository writes are disabled");
  });
}

module.exports = {
  buildArtifacts,
  buildArtifactsZip,
  validateSpec,
};
