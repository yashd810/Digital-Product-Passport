"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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
  { slotKey: "subjectDid", label: "Subject DID", managedKey: "internalManagedSubjectDid" },
  { slotKey: "dppDid", label: "DPP DID", managedKey: "internalManagedDppDid" },
  { slotKey: "companyDid", label: "Company DID", managedKey: "internalManagedCompanyDid" },
];

const sample = {
  module: {
    family: "example-product",
    version: "v1",
    moduleKey: "example-product:v1",
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "EX",
    semanticModelKey: "exampleProductDictionaryV1",
    passportPolicyKey: "exampleProductDppV1",
    defaultCarrierPolicyKey: "webPublicEntryV1",
    systemHeaderFieldAssignments: {
      digitalProductPassportId: "__managed__:internalManagedDigitalProductPassportId",
      uniqueProductIdentifier: "__managed__:internalManagedUniqueProductIdentifier",
      internalAliasId: "__managed__:internalManagedInternalAliasId",
      granularity: "__managed__:internalManagedGranularity",
      dppSchemaVersion: "__managed__:internalManagedDppSchemaVersion",
      dppStatus: "__managed__:internalManagedDppStatus",
      lastUpdate: "__managed__:internalManagedLastUpdate",
      economicOperatorId: "__managed__:internalManagedEconomicOperatorId",
      facilityId: "__managed__:internalManagedFacilityId",
      contentSpecificationIds: "__managed__:internalManagedContentSpecificationIds",
      subjectDid: "__managed__:internalManagedSubjectDid",
      dppDid: "__managed__:internalManagedDppDid",
      companyDid: "__managed__:internalManagedCompanyDid",
    },
    baseUrl: "https://www.claros-dpp.online",
    dictionaryName: "Example Product Dictionary",
    dictionaryDescription: "Starter dictionary for a new Digital Product Passport module.",
  },
  roles: {
    businessIdentifierField: "modelIdentifier",
    summaryRoles: {
      modelIdentifier: "card1",
      performanceScore: "card2",
      productCategoryDetail: "card3",
    },
    lifecycleRoles: {},
    compositionFieldKey: "",
    compositionLabelColumnKey: "",
    compositionValueColumnKey: "",
  },
  sections: [
    {
      key: "productIdentity",
      label: "Product Identity",
      fields: [
        {
          fieldKey: "productCategoryDetail",
          fieldLabel: "Product Category Detail",
          fieldType: "text",
          semanticSlug: "product-category-detail",
          definition: "Classifies the product category used for requirement and reporting policies.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "modelIdentifier",
          fieldLabel: "Model Identifier",
          fieldType: "text",
          semanticSlug: "model-identifier",
          definition: "Identifies the product model that the passport describes.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "manufacturerName",
          fieldLabel: "Manufacturer Name",
          fieldType: "text",
          semanticSlug: "manufacturer-name",
          definition: "Name of the manufacturer responsible for placing the product on the market.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          confidentiality: "public",
        },
      ],
    },
    {
      key: "performanceCharacteristics",
      label: "Performance Characteristics",
      fields: [
        {
          fieldKey: "performanceScore",
          fieldLabel: "Performance Score",
          fieldType: "text",
          semanticSlug: "performance-score",
          definition: "Declared performance score for the product.",
          dataType: "decimal",
          categoryKey: "performance-characteristics",
          categoryLabel: "Performance Characteristics",
          unitKey: "percent",
          unitLabel: "Percent",
          unitSymbol: "%",
          confidentiality: "public",
        },
      ],
    },
  ],
};

const fieldsCsvColumns = [
  "sectionLabel",
  "fieldLabel",
  "fieldType",
  "definition",
  "categoryLabel",
  "dataType",
  "unitLabel",
  "unitSymbol",
  "confidentiality",
  "queryable",
  "indexed",
  "tableColumns",
];

const fieldsCsvColumnLabels = {
  fieldLabel: "Label",
  sectionLabel: "Section label",
  fieldType: "UI type",
  definition: "Definition",
  categoryLabel: "Category label",
  dataType: "Data type",
  unitLabel: "Unit label",
  unitSymbol: "Unit symbol",
  confidentiality: "Confidentiality",
  objectType: "Schema object",
  valueDataType: "Schema value",
  queryable: "queryable",
  indexed: "indexed",
  tableColumns: "Table schema",
};

const fieldsCsvColumnAliases = {
  fieldLabel: ["Field label", "Field name"],
  sectionLabel: ["Section"],
  fieldType: ["Type", "Field type"],
  dataType: ["JSON type"],
  objectType: ["Object type", "Schema object type"],
  valueDataType: ["Value type", "Value data type", "Schema value type"],
  tableColumns: ["Columns", "Table columns", "Table column JSON"],
};

const tableColumnCsvPropertyLabels = {
  columnLabel: "Label",
  dataType: "Data type",
  unitLabel: "Unit label",
  unitSymbol: "Unit symbol",
  objectType: "Object type",
  valueDataType: "Value data type",
  semanticSlug: "Semantic slug",
  columnKey: "Column key",
  unitKey: "Unit key",
};

const tableColumnCsvPropertyAliases = {
  columnLabel: ["Column label", "Column name"],
  dataType: ["JSON type"],
  objectType: ["Schema object", "Schema object type"],
  valueDataType: ["Schema value", "Schema value type", "Value type"],
};

const fieldTypeCsvOptions = [
  { value: "text" },
  { value: "textarea", aliases: ["multi-line text", "long text"] },
  { value: "boolean", aliases: ["true false", "yes no"] },
  { value: "date" },
  { value: "url", aliases: ["link"] },
  { value: "file", aliases: ["evidence file"] },
  { value: "symbol" },
  { value: "table", aliases: ["collection"] },
];
const dataTypeCsvOptions = [
  { value: "string", aliases: ["text"] },
  { value: "decimal" },
  { value: "integer" },
  { value: "boolean" },
  { value: "date" },
  { value: "datetime", aliases: ["date time", "date-time"] },
  { value: "uri", aliases: ["url", "link"] },
  { value: "array", aliases: ["list", "collection"] },
];
const tableColumnDataTypeCsvOptions = dataTypeCsvOptions.filter((option) => option.value !== "array");
const confidentialityCsvOptions = [
  { value: "public" },
  { value: "restricted" },
];

const fieldTypeOptions = new Set(fieldTypeCsvOptions.map((option) => option.value));
const dataTypeOptions = new Set(dataTypeCsvOptions.map((option) => option.value));
const tableColumnDataTypeOptions = new Set(tableColumnDataTypeCsvOptions.map((option) => option.value));
const confidentialityOptions = new Set(confidentialityCsvOptions.map((option) => option.value));
const fixedDataTypeByFieldType = Object.freeze({
  boolean: "boolean",
  date: "date",
  file: "string",
  symbol: "uri",
  table: "array",
  url: "uri",
});

const fieldTypeCsvAliases = buildCsvOptionAliases(fieldTypeCsvOptions);
const dataTypeCsvAliases = buildCsvOptionAliases(dataTypeCsvOptions);
const tableColumnDataTypeCsvAliases = buildCsvOptionAliases(tableColumnDataTypeCsvOptions);
const confidentialityCsvAliases = buildCsvOptionAliases(confidentialityCsvOptions);
const fieldsCsvColumnNameAliases = buildCsvColumnAliases(fieldsCsvColumnLabels, fieldsCsvColumnAliases);
const tableColumnCsvPropertyNameAliases = buildCsvColumnAliases(tableColumnCsvPropertyLabels, tableColumnCsvPropertyAliases);

const draftStorageKey = "passport-module-generator:draft:v1";
const sessionStorageKey = "passport-module-generator:session:v1";
const maxFieldsCsvBytes = 2 * 1024 * 1024;
const maxFieldsCsvRows = 5000;
let sessionSaveTimer = null;

function setMessage(text, type = "info") {
  const box = $("#message");
  box.textContent = text;
  box.className = `message ${type}`;
}

function clearMessage() {
  const box = $("#message");
  box.textContent = "";
  box.className = "message hidden";
}

function getCurrentStep() {
  return $(".tool-step.active")?.dataset.step || "module";
}

function createBlankSpec() {
  return {
    module: {
      family: "",
      version: "v1",
      moduleKey: "",
      typeName: "",
      displayName: "",
      productCategory: "",
      productIcon: "",
      semanticModelKey: "",
      passportPolicyKey: "",
      defaultCarrierPolicyKey: "webPublicEntryV1",
      systemHeaderFieldAssignments: Object.fromEntries(
        headerSlotDefinitions.map((slot) => [slot.slotKey, `__managed__:${slot.managedKey}`])
      ),
      baseUrl: "https://www.claros-dpp.online",
      dictionaryName: "",
      dictionaryDescription: "",
    },
    roles: {
      businessIdentifierField: "",
      summaryRoles: {},
      lifecycleRoles: {},
      compositionFieldKey: "",
      compositionLabelColumnKey: "",
      compositionValueColumnKey: "",
    },
    sections: [],
  };
}

function readWorkspaceState() {
  return {
    spec: readSpec(),
    overwrite: getCheckboxValue("overwrite"),
    activeStep: getCurrentStep(),
    savedAt: new Date().toISOString(),
  };
}

function applyWorkspaceState(state = {}) {
  loadSpec(state.spec || createBlankSpec());
  setCheckboxValue("overwrite", state.overwrite);
  setActiveStep(state.activeStep || "module");
}

function loadJsonStorage(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSessionNow() {
  try {
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(readWorkspaceState()));
  } catch {
    // Ignore local browser storage failures.
  }
}

function queueSessionSave() {
  if (sessionSaveTimer) window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    saveSessionNow();
    sessionSaveTimer = null;
  }, 250);
}

function setActiveStep(step) {
  const nextStep = step || "module";
  $$("[data-step]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.step === nextStep);
  });
  $$("[data-step-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.stepTarget === nextStep);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  queueSessionSave();
}

function setupWorkspaceNavigation() {
  $$("[data-step-target]").forEach((button) => {
    button.addEventListener("click", () => setActiveStep(button.dataset.stepTarget));
  });
}

function updateSectionSummaries() {
  $$(".section-card").forEach((section) => {
    const fieldCount = $$(".field-row", section).length;
    const count = $("[data-section-count]", section);
    if (count) count.textContent = `${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  });
}

function updateWorkspaceMeta() {
  const sectionCount = $$(".section-card").length;
  const fieldCount = $$(".field-row").length;
  const meta = $("#fieldsStepMeta");
  if (meta) {
    meta.textContent = `${sectionCount} section${sectionCount === 1 ? "" : "s"}, ${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  }
  updateSectionSummaries();
}

function setFormValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.value = value || "";
}

function getFormValue(id) {
  return $(`#${id}`)?.value.trim() || "";
}

function getCheckboxValue(id) {
  return Boolean($(`#${id}`)?.checked);
}

function setCheckboxValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.checked = Boolean(value);
}

function getMultiSelectValues(id) {
  const el = $(`#${id}`);
  if (!el) return [];
  return [...el.selectedOptions].map((option) => option.value).filter(Boolean);
}

function setMultiSelectValues(id, values = []) {
  const selected = new Set(Array.isArray(values) ? values : String(values || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  const el = $(`#${id}`);
  if (!el) return;
  [...el.options].forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function splitWords(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function titleCase(value) {
  return splitWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function csvOptionKey(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildCsvOptionAliases(options) {
  const aliases = new Map();
  for (const option of options) {
    for (const value of [option.value, option.label, ...(option.aliases || [])]) {
      const key = csvOptionKey(value);
      if (key) aliases.set(key, option.value);
    }
  }
  return aliases;
}

function buildCsvColumnAliases(labels, extraAliases = {}) {
  const aliases = new Map();
  for (const [key, label] of Object.entries(labels)) {
    for (const value of [key, label, ...(extraAliases[key] || [])]) {
      const aliasKey = csvOptionKey(value);
      if (aliasKey) aliases.set(aliasKey, key);
    }
  }
  return aliases;
}

function normalizeCsvColumnName(value) {
  return fieldsCsvColumnNameAliases.get(csvOptionKey(value)) || "";
}

function normalizeCsvTableColumnPropertyName(value) {
  return tableColumnCsvPropertyNameAliases.get(csvOptionKey(value)) || "";
}

function describeCsvOptions(options) {
  return options
    .map((option) => option.label && option.label !== option.value ? `${option.label} (${option.value})` : option.value)
    .join(" | ");
}

function getCsvColumnHeaders() {
  return fieldsCsvColumns.map((column) => fieldsCsvColumnLabels[column] || column);
}

function csvEscape(value) {
  const rawText = String(value ?? "");
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function restoreCsvFormulaCell(value) {
  const text = String(value ?? "");
  return /^'[\u0000-\u0020]*[=+\-@]/.test(text) ? text.slice(1) : text;
}

function downloadTextFile(fileName, content, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let index = 0;
  let inQuotes = false;
  let quotedValueClosed = false;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 2;
        continue;
      }
      if (char === "\"") {
        inQuotes = false;
        quotedValueClosed = true;
        index += 1;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }

    if (char === "\"") {
      if (value || quotedValueClosed) {
        throw new Error("CSV contains a quote in an unquoted value.");
      }
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      row.push(value);
      value = "";
      quotedValueClosed = false;
      index += 1;
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      quotedValueClosed = false;
      index += 1;
      continue;
    }

    if (char === "\r") {
      index += 1;
      continue;
    }

    if (quotedValueClosed) {
      throw new Error("CSV contains characters after a closing quote.");
    }
    value += char;
    index += 1;
  }

  if (inQuotes) throw new Error("CSV contains an unterminated quoted value.");
  row.push(value);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

function parseBooleanCell(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || ["false", "0", "no", "n"].includes(text)) return false;
  if (["true", "1", "yes", "y"].includes(text)) return true;
  throw new Error(`${label} must be true or false.`);
}

function normalizeCsvOption(value, allowedValues, fallback, aliases, label, allowedDescription = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (allowedValues.has(text)) return text;
  const normalized = aliases?.get(csvOptionKey(text));
  if (normalized && allowedValues.has(normalized)) return normalized;
  throw new Error(`${label} must be one of: ${allowedDescription || [...allowedValues].join(", ")}.`);
}

function parseJsonCell(value, label, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function isCsvCommentRow(row) {
  return String(row?.[0] || "").trim().startsWith("#");
}

function normalizeCsvObjectKeys(input, aliasResolver) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const normalized = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    normalized[aliasResolver(key) || key] = value;
  }
  return normalized;
}

function csvRowLabel(rowNumber, column) {
  return `CSV row ${rowNumber} ${fieldsCsvColumnLabels[column] || column}`;
}

function csvTableColumnLabel(rowNumber, columnIndex, property) {
  return `CSV row ${rowNumber} tableColumns[${columnIndex}] ${tableColumnCsvPropertyLabels[property] || property}`;
}

function normalizeCsvTableColumns(tableColumns, rowNumber) {
  return tableColumns.map((rawColumn, columnIndex) => {
    const column = normalizeCsvObjectKeys(rawColumn, normalizeCsvTableColumnPropertyName);
    const editableProperties = new Set(["columnLabel", "dataType", "unitLabel", "unitSymbol"]);
    const unsupportedProperties = Object.keys(column).filter((property) => !editableProperties.has(property));
    if (unsupportedProperties.length) {
      throw new Error(
        `CSV row ${rowNumber} tableColumns[${columnIndex}] contains unsupported properties: ${unsupportedProperties.join(", ")}.`
      );
    }
    const dataType = normalizeCsvOption(
      column.dataType,
      tableColumnDataTypeOptions,
      "string",
      tableColumnDataTypeCsvAliases,
      csvTableColumnLabel(rowNumber, columnIndex, "dataType"),
      describeCsvOptions(tableColumnDataTypeCsvOptions)
    );
    return {
      columnLabel: String(column.columnLabel || "").trim(),
      dataType,
      unitLabel: String(column.unitLabel || "").trim(),
      unitSymbol: String(column.unitSymbol || "").trim(),
      objectType: "SingleValuedDataElement",
      valueDataType: valueDataTypeFromDataType(dataType),
    };
  });
}

function serializeEditableTableColumns(columns = []) {
  return JSON.stringify(columns.map((column) => ({
    [tableColumnCsvPropertyLabels.columnLabel]: column.columnLabel || "",
    [tableColumnCsvPropertyLabels.dataType]: column.dataType || "string",
    [tableColumnCsvPropertyLabels.unitLabel]: column.unitLabel || "",
    [tableColumnCsvPropertyLabels.unitSymbol]: column.unitSymbol || "",
  })));
}

function getFieldsCsvRowsFromSpec(spec = readSpec()) {
  return (spec.sections || []).flatMap((section) =>
    (section.fields || []).map((field) => ({
      fieldLabel: field.fieldLabel || "",
      sectionLabel: section.label || "",
      fieldType: field.fieldType || "text",
      definition: field.definition || "",
      categoryLabel: field.categoryLabel || "",
      dataType: field.dataType || defaultDataTypeForFieldType(field.fieldType || "text"),
      unitLabel: field.unitLabel || "",
      unitSymbol: field.unitSymbol || "",
      confidentiality: field.confidentiality || "public",
      queryable: field.queryable ? "true" : "false",
      indexed: field.indexed ? "true" : "false",
      tableColumns: field.fieldType === "table" ? serializeEditableTableColumns(field.tableColumns || []) : "",
    }))
  );
}

function buildFieldsCsvContent(rows = []) {
  const lines = [
    getCsvColumnHeaders().join(","),
    ...rows.map((row) => fieldsCsvColumns.map((column) => csvEscape(row[column] || "")).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function readFieldsCsvRows(text) {
  if (new Blob([String(text || "")]).size > maxFieldsCsvBytes) {
    throw new Error("CSV file is too large. Maximum size is 2 MB.");
  }
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV file is empty.");
  if (rows.length > maxFieldsCsvRows + 1) {
    throw new Error(`CSV contains too many rows. Maximum field rows: ${maxFieldsCsvRows}.`);
  }

  const headerIndex = rows.findIndex((row) => {
    if (isCsvCommentRow(row)) return false;
    const cells = row.map((cell) => normalizeCsvColumnName(cell));
    return cells.includes("fieldLabel") && cells.includes("sectionLabel");
  });
  if (headerIndex === -1) {
    throw new Error("CSV is missing the field header row. Download the template and fill that format only.");
  }

  const rawHeader = rows[headerIndex].map((cell) => String(cell || "").trim());
  const header = rawHeader.map((cell) => normalizeCsvColumnName(cell));
  for (const column of ["fieldLabel", "sectionLabel"]) {
    if (!header.includes(column)) {
      throw new Error(`CSV is missing required column "${fieldsCsvColumnLabels[column]}". Download the template and fill that format only.`);
    }
  }

  const unsupported = rawHeader.filter((column, index) => column && !header[index]);
  if (unsupported.length) {
    throw new Error(`CSV contains unsupported columns: ${unsupported.join(", ")}. Use the fixed local-tool template only.`);
  }
  const duplicates = header.filter((column, index) => column && header.indexOf(column) !== index);
  if (duplicates.length) {
    const duplicateLabels = [...new Set(duplicates)].map((column) => fieldsCsvColumnLabels[column] || column);
    throw new Error(`CSV contains duplicate columns after name matching: ${duplicateLabels.join(", ")}.`);
  }

  const parsedRows = [];
  let skippedRowCount = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    if (isCsvCommentRow(row)) continue;
    if (!row.some((cell) => String(cell || "").trim())) continue;

    const entry = Object.fromEntries(header.map((column, columnIndex) => [
      column,
      restoreCsvFormulaCell(row[columnIndex]).trim(),
    ]));
    const fieldLabel = entry.fieldLabel || "";
    const sectionLabel = entry.sectionLabel || "";
    if (!fieldLabel || !sectionLabel) {
      skippedRowCount += 1;
      continue;
    }
    const fieldType = normalizeCsvOption(
      entry.fieldType,
      fieldTypeOptions,
      "text",
      fieldTypeCsvAliases,
      csvRowLabel(rowNumber, "fieldType"),
      describeCsvOptions(fieldTypeCsvOptions)
    );
    const dataType = normalizeCsvOption(
      entry.dataType,
      dataTypeOptions,
      defaultDataTypeForFieldType(fieldType),
      dataTypeCsvAliases,
      csvRowLabel(rowNumber, "dataType"),
      describeCsvOptions(dataTypeCsvOptions)
    );
    if (fieldType === "table" && dataType !== "array") {
      throw new Error(`CSV row ${rowNumber} Data type must be "array" when UI type is "table".`);
    }
    if (fieldType !== "table" && dataType === "array") {
      throw new Error(`CSV row ${rowNumber} Data type "array" requires UI type "table".`);
    }
    const fixedDataType = fixedDataTypeByFieldType[fieldType];
    if (fixedDataType && dataType !== fixedDataType) {
      throw new Error(
        `CSV row ${rowNumber} UI type "${fieldType}" requires Data type "${fixedDataType}".`
      );
    }
    const tableColumnsSource = entry.tableColumns || "";
    let tableColumns = fieldType === "table"
      ? parseJsonCell(tableColumnsSource, `CSV row ${rowNumber} tableColumns`, [])
      : [];

    if (fieldType === "table" && !Array.isArray(tableColumns)) {
      throw new Error(`CSV row ${rowNumber} tableColumns must be a JSON array.`);
    }
    tableColumns = normalizeCsvTableColumns(tableColumns, rowNumber);

    parsedRows.push({
      sectionLabel,
      field: {
        fieldLabel,
        fieldType,
        definition: entry.definition || "",
        categoryLabel: entry.categoryLabel || "",
        dataType,
        unitLabel: entry.unitLabel || "",
        unitSymbol: entry.unitSymbol || "",
        confidentiality: normalizeCsvOption(
          entry.confidentiality,
          confidentialityOptions,
          "public",
          confidentialityCsvAliases,
          csvRowLabel(rowNumber, "confidentiality"),
          describeCsvOptions(confidentialityCsvOptions)
        ),
        queryable: parseBooleanCell(entry.queryable, csvRowLabel(rowNumber, "queryable")),
        indexed: parseBooleanCell(entry.indexed, csvRowLabel(rowNumber, "indexed")),
        tableColumns,
      },
    });
  }

  return {
    rows: parsedRows,
    skippedRowCount,
  };
}

function convertFieldsCsvRowsToSections(rows = []) {
  const sectionsByKey = new Map();

  for (const row of rows) {
    const sectionLabel = row.sectionLabel;
    const sectionKey = camelCaseFromWords(sectionLabel);
    if (!sectionsByKey.has(sectionKey)) {
      sectionsByKey.set(sectionKey, {
        key: sectionKey,
        label: sectionLabel,
        fields: [],
      });
    }
    sectionsByKey.get(sectionKey).fields.push(row.field);
  }

  return [...sectionsByKey.values()];
}

function camelCaseFromWords(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function pascalCaseFromWords(value) {
  return splitWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function slugFromValue(value) {
  return splitWords(value)
    .map((word) => word.toLowerCase())
    .join("-");
}

function unitKeyFromLabel(value) {
  const slug = slugFromValue(value);
  return slug || "none";
}

function trackManualInput(input) {
  if (!input || input.dataset.manualBound === "true") return;
  input.dataset.manualBound = "true";
  input.addEventListener("input", () => {
    input.dataset.manual = input.value.trim() ? "true" : "";
    input.dataset.autoFilled = "";
  });
}

function autoFillInput(input, nextValue) {
  if (!input) return;
  const value = String(nextValue || "").trim();
  if (!value) return;
  const canAutoFill = !input.dataset.manual || !input.value.trim() || input.dataset.autoFilled === "true";
  if (!canAutoFill) return;
  input.value = value;
  input.dataset.autoFilled = "true";
}

function bindDerivedInput(input, computeValue, sources = []) {
  if (!input || input.dataset.derivedBound === "true") return;
  input.dataset.derivedBound = "true";
  trackManualInput(input);
  const update = () => autoFillInput(input, computeValue());
  for (const source of sources) {
    if (!source) continue;
    source.addEventListener("input", update);
    source.addEventListener("blur", update);
  }
  update();
}

function maybeAutoModuleValues() {
  const family = getFormValue("family");
  const version = getFormValue("version") || "v1";
  const familyCamel = camelCaseFromWords(family);
  const versionPascal = pascalCaseFromWords(version);
  const title = titleCase(family);

  autoFillInput($("#moduleKey"), family && version ? `${family}:${version}` : "");
  autoFillInput($("#typeName"), familyCamel && versionPascal ? `${familyCamel}Passport${versionPascal}` : "");
  autoFillInput($("#displayName"), title && version ? `${title} Passport ${version}` : "");
  autoFillInput($("#productCategory"), title);
  autoFillInput($("#semanticModelKey"), familyCamel && versionPascal ? `${familyCamel}Dictionary${versionPascal}` : "");
  autoFillInput($("#passportPolicyKey"), familyCamel && versionPascal ? `${familyCamel}Dpp${versionPascal}` : "");
  autoFillInput($("#dictionaryName"), title ? `${title} Dictionary` : "");
}

function columnKeyFromLabel(value) {
  return canonicalKeyFromSemanticSlug(value);
}

function canonicalKeyFromSemanticSlug(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function valueDataTypeFromDataType(dataType) {
  if (dataType === "array") return "Array";
  if (dataType === "integer") return "Integer";
  if (dataType === "decimal") return "Decimal";
  if (dataType === "boolean") return "Boolean";
  if (dataType === "date") return "Date";
  if (dataType === "datetime") return "DateTime";
  if (dataType === "uri") return "URI";
  return "String";
}

function defaultDataTypeForFieldType(fieldType) {
  return fixedDataTypeByFieldType[fieldType] || "string";
}

function defaultObjectTypeForFieldType(fieldType) {
  if (fieldType === "table") return "DataElementCollection";
  if (fieldType === "file" || fieldType === "url" || fieldType === "symbol") return "RelatedResource";
  return "SingleValuedDataElement";
}

function defaultValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (fieldType === "file") return "Binary";
  if (fieldType === "url" || fieldType === "symbol") return "URI";
  if (fieldType === "date") return "Date";
  if (fieldType === "boolean") return "Boolean";
  return valueDataTypeFromDataType(dataType);
}

function setupModuleAutoFill() {
  const familyInput = $("#family");
  const versionInput = $("#version");
  [
    $("#moduleKey"),
    $("#typeName"),
    $("#displayName"),
    $("#productCategory"),
    $("#semanticModelKey"),
    $("#passportPolicyKey"),
    $("#dictionaryName"),
  ].forEach(trackManualInput);
  familyInput.addEventListener("input", maybeAutoModuleValues);
  familyInput.addEventListener("blur", maybeAutoModuleValues);
  versionInput.addEventListener("input", maybeAutoModuleValues);
  versionInput.addEventListener("blur", maybeAutoModuleValues);
  maybeAutoModuleValues();
}

function setupSectionAutoFill(node) {
  const keyInput = $("[data-section-key]", node);
  const labelInput = $("[data-section-label]", node);
  bindDerivedInput(keyInput, () => camelCaseFromWords(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
}

function setupFieldAutoFill(node) {
  const keyInput = $("[data-field='fieldKey']", node);
  const labelInput = $("[data-field='fieldLabel']", node);
  const semanticSlugInput = $("[data-field='semanticSlug']", node);
  const categoryKeyInput = $("[data-field='categoryKey']", node);
  const categoryLabelInput = $("[data-field='categoryLabel']", node);
  const unitKeyInput = $("[data-field='unitKey']", node);
  const unitLabelInput = $("[data-field='unitLabel']", node);

  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value), [labelInput]);
  bindDerivedInput(keyInput, () => canonicalKeyFromSemanticSlug(semanticSlugInput.value || slugFromValue(labelInput.value)), [semanticSlugInput, labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(categoryKeyInput, () => slugFromValue(categoryLabelInput.value), [categoryLabelInput]);
  bindDerivedInput(categoryLabelInput, () => titleCase(categoryKeyInput.value), [categoryKeyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);
}

function setupTableColumnAutoFill(row, node) {
  const keyInput = $("[data-column='columnKey']", node);
  const labelInput = $("[data-column='columnLabel']", node);
  const semanticSlugInput = $("[data-column='semanticSlug']", node);
  const unitKeyInput = $("[data-column='unitKey']", node);
  const unitLabelInput = $("[data-column='unitLabel']", node);

  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value), [labelInput]);
  bindDerivedInput(keyInput, () => canonicalKeyFromSemanticSlug(semanticSlugInput.value || slugFromValue(labelInput.value)), [semanticSlugInput, labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);

  labelInput.addEventListener("input", () => {
    syncRoleOptions();
  });
  keyInput.addEventListener("input", () => {
    syncRoleOptions();
  });
}

function getTableColumnDefaults(index = 0) {
  const semanticSlug = `column-${index + 1}`;
  return {
    columnKey: canonicalKeyFromSemanticSlug(semanticSlug),
    columnLabel: `Column ${index + 1}`,
    semanticSlug,
    dataType: "string",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
  };
}

function readTableColumns(row) {
  return $$("[data-table-columns] .table-column-card", row).map((columnNode) => {
    const column = {};
    for (const input of $$("[data-column]", columnNode)) {
      column[input.dataset.column] = input.type === "checkbox" ? input.checked : input.value.trim();
    }
    column.semanticSlug = slugFromValue(column.semanticSlug || column.columnLabel || column.columnKey);
    column.columnKey = canonicalKeyFromSemanticSlug(column.semanticSlug || column.columnLabel || column.columnKey);
    return column;
  });
}

function fieldOptionLabel(field) {
  return `${field.fieldLabel || titleCase(field.fieldKey) || "Unnamed field"} (${field.fieldKey || "missingKey"})`;
}

function getAllFieldsFromDom() {
  return $$(".section-card").flatMap((section) =>
    $$(".field-row", section).map((row) => readField(row)).filter((field) => field.fieldKey)
  );
}

function getTableFieldsFromDom() {
  return getAllFieldsFromDom().filter((field) => field.fieldType === "table");
}

function setSelectOptions(select, options, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = options.some((option) => option.value === current) ? current : "";
}

function createFieldSelect(datasetKey, fieldKey, value, optionPairs, placeholder = "") {
  const select = document.createElement("select");
  select.dataset[datasetKey] = fieldKey;
  if (placeholder) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
  }
  for (const [optionValue, label] of optionPairs) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

function productOverviewCardOptions() {
  return [
    ["", "Not shown in Product overview cards"],
    ...Array.from({ length: 9 }, (_, index) => {
      const cardNumber = index + 1;
      return [`card${cardNumber}`, `Card ${cardNumber}`];
    }),
  ];
}

function normalizeProductOverviewCardRole(value) {
  if (value === "model") return "card1";
  if (value === "capacity") return "card2";
  if (value === "category") return "card3";
  return value || "";
}

function renderPresentationFields(fields) {
  const container = $("#presentationFields");
  if (!container) return;
  const currentSummaryRole = new Map($$("[data-summary-role-field]", container).map((select) => [select.dataset.summaryRoleField, select.value]));
  const currentLifecycleRole = new Map($$("[data-lifecycle-role-field]", container).map((select) => [select.dataset.lifecycleRoleField, select.value]));
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "presentation-row presentation-row-head";
  [
    "Field",
    "Product overview card",
    "Timeline",
  ].forEach((label) => {
    const item = document.createElement("span");
    item.textContent = label;
    header.appendChild(item);
  });
  container.appendChild(header);
  for (const field of fields) {
    const row = document.createElement("label");
    row.className = "presentation-row";
    row.textContent = fieldOptionLabel(field);
    row.appendChild(createFieldSelect(
      "summaryRoleField",
      field.fieldKey,
      normalizeProductOverviewCardRole(currentSummaryRole.get(field.fieldKey)),
      productOverviewCardOptions()
    ));
    row.appendChild(createFieldSelect("lifecycleRoleField", field.fieldKey, currentLifecycleRole.get(field.fieldKey) || "", [
      ["", "Not in lifecycle timeline"],
      ["manufacturedDate", "Manufacturing Date"],
      ["manufacturedContext", "Manufacturing Place"],
      ["putIntoServiceDate", "Date of Putting to Service"],
    ]));
    row.title = "Product overview card controls the small cards below the product image. The viewer shows the field label and saved passport value.";
    container.appendChild(row);
  }
}

function renderSystemHeaderFields(fields) {
  const container = $("#systemHeaderFields");
  if (!container) return;
  const previousSelections = Object.fromEntries(
    $$("[data-system-header-slot]", container).map((select) => [select.dataset.systemHeaderSlot, select.value])
  );
  container.innerHTML = "";

  for (const slot of headerSlotDefinitions) {
    const row = document.createElement("label");
    row.className = "presentation-row";
    const text = document.createElement("span");
    text.textContent = slot.label;
    row.appendChild(text);
    const optionPairs = [
      [`__managed__:${slot.managedKey}`, "Use managed value"],
      ...fields.map((field) => [field.fieldKey, fieldOptionLabel(field)]),
    ];
    const select = createFieldSelect(
      "systemHeaderSlot",
      slot.slotKey,
      previousSelections[slot.slotKey] || `__managed__:${slot.managedKey}`,
      optionPairs,
      "Leave empty"
    );
    select.dataset.systemHeaderSlot = slot.slotKey;
    row.appendChild(select);
    row.title = "Choose a managed passport value or map a real module field into this header slot.";
    container.appendChild(row);
  }
}

function syncCompositionRoleColumns() {
  const tableKey = $("#compositionFieldKey")?.value || "";
  const tableField = getTableFieldsFromDom().find((field) => field.fieldKey === tableKey);
  const columns = tableField?.tableColumns || [];
  const toOption = (column) => ({
    value: column.columnKey,
    label: column.columnLabel || column.columnKey,
  });
  const labelOptions = columns.filter((column) => column.dataType === "string").map(toOption);
  const valueOptions = columns.filter((column) => ["decimal", "integer"].includes(column.dataType)).map(toOption);
  setSelectOptions($("#compositionLabelColumnKey"), labelOptions, "Select text label column");
  setSelectOptions($("#compositionValueColumnKey"), valueOptions, "Select numeric data column");
}

function syncRoleOptions() {
  const fields = getAllFieldsFromDom();
  const fieldOptions = fields.map((field) => ({ value: field.fieldKey, label: fieldOptionLabel(field) }));
  setSelectOptions($("#businessIdentifierField"), fieldOptions, "Select product identifier");
  setSelectOptions(
    $("#compositionFieldKey"),
    getTableFieldsFromDom().map((field) => ({ value: field.fieldKey, label: fieldOptionLabel(field) })),
    "No composition chart"
  );
  renderPresentationFields(fields);
  renderSystemHeaderFields(fields);
  syncCompositionRoleColumns();
  updateWorkspaceMeta();
}

function normalizeFilterValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getFieldFilterText(row, key) {
  if (key === "advanced") {
    return [
      "fieldKey",
      "semanticSlug",
      "categoryKey",
      "unitKey",
      "objectType",
      "valueDataType",
    ]
      .map((fieldKey) => $(`[data-field='${fieldKey}']`, row)?.value || "")
      .concat($$("[data-column]", row).map((input) => input.type === "checkbox" ? String(input.checked) : input.value))
      .join(" ");
  }
  const input = $(`[data-field='${key}']`, row);
  if (!input) return "";
  return input.type === "checkbox" ? String(input.checked) : input.value;
}

function applySectionFilters(sectionNode) {
  if (!sectionNode) return;
  const filters = $$("[data-field-filter]", sectionNode)
    .map((input) => ({
      key: input.dataset.fieldFilter,
      value: normalizeFilterValue(input.value),
      exact: input.tagName === "SELECT",
    }))
    .filter((filter) => filter.key && filter.value);
  const rows = $$(".field-row", sectionNode);
  let visibleCount = 0;

  for (const row of rows) {
    const isMatch = filters.every((filter) => {
      const value = normalizeFilterValue(getFieldFilterText(row, filter.key));
      return filter.exact ? value === filter.value : value.includes(filter.value);
    });
    row.classList.toggle("filtered-out", !isMatch);
    if (isMatch) visibleCount += 1;
  }

  const count = $("[data-filter-count]", sectionNode);
  if (count) {
    count.classList.toggle("hidden", filters.length === 0);
    count.textContent = `${visibleCount}/${rows.length} visible`;
  }
}

function setupSectionFilters(sectionNode) {
  $$("[data-field-filter]", sectionNode).forEach((input) => {
    input.addEventListener("input", () => applySectionFilters(sectionNode));
    input.addEventListener("change", () => applySectionFilters(sectionNode));
  });
  $("[data-clear-filters]", sectionNode)?.addEventListener("click", () => {
    $$("[data-field-filter]", sectionNode).forEach((input) => {
      input.value = "";
    });
    applySectionFilters(sectionNode);
  });
}

function addTableColumn(row, data = {}) {
  const host = $("[data-table-columns]", row);
  const template = $("#tableColumnTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  const defaults = getTableColumnDefaults($$(".table-column-card", host).length);

  for (const input of $$("[data-column]", node)) {
    const key = input.dataset.column;
    const value = data[key] !== undefined ? data[key] : defaults[key];
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = value || "";
    }
  }

  setupTableColumnAutoFill(row, node);
  const dataTypeSelect = $("[data-column='dataType']", node);
  const valueDataTypeSelect = $("[data-column='valueDataType']", node);
  dataTypeSelect?.addEventListener("change", () => {
    if (valueDataTypeSelect && !valueDataTypeSelect.dataset.manual) {
      valueDataTypeSelect.value = valueDataTypeFromDataType(dataTypeSelect.value);
    }
  });
  valueDataTypeSelect?.addEventListener("change", () => {
    valueDataTypeSelect.dataset.manual = "true";
  });

  $("[data-remove-column]", node).addEventListener("click", () => {
    node.remove();
    applySectionFilters(row.closest(".section-card"));
    syncRoleOptions();
  });

  host.appendChild(node);
  applySectionFilters(row.closest(".section-card"));
  syncRoleOptions();
  return node;
}

function syncTableConfigVisibility(row) {
  const typeSelect = $("[data-field='fieldType']", row);
  const panel = $("[data-table-config]", row);
  if (!typeSelect || !panel) return;
  const isTable = typeSelect.value === "table";
  panel.classList.toggle("hidden", !isTable);
  syncRoleOptions();
}

function addSection(data = {}) {
  const template = $("#sectionTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  $("[data-section-key]", node).value = data.key || "";
  $("[data-section-label]", node).value = data.label || "";
  $("[data-add-field]", node).addEventListener("click", () => addField(node));
  $("[data-toggle-section]", node).addEventListener("click", () => {
    node.classList.toggle("collapsed");
    const button = $("[data-toggle-section]", node);
    if (button) button.textContent = node.classList.contains("collapsed") ? "Expand" : "Collapse";
  });
  $("[data-toggle-details]", node).addEventListener("click", () => {
    const shouldOpen = !node.classList.contains("show-details");
    node.classList.toggle("show-details", shouldOpen);
    $$("[data-fields] .field-more-group", node).forEach((details) => {
      details.open = shouldOpen;
    });
    const button = $("[data-toggle-details]", node);
    if (button) button.textContent = shouldOpen ? "Hide details" : "Show details";
  });
  $("[data-remove-section]", node).addEventListener("click", () => {
    node.remove();
    syncRoleOptions();
  });
  setupSectionAutoFill(node);
  setupSectionFilters(node);
  $("#sections").appendChild(node);
  (data.fields || []).forEach((field) => addField(node, field));
  if (!data.fields?.length) addField(node);
  applySectionFilters(node);
  return node;
}

function addField(sectionNode, data = {}) {
  const template = $("#fieldTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-field]", node)) {
    const key = input.dataset.field;
    if (input.type === "checkbox") {
      input.checked = Boolean(data[key]);
    } else if (data[key] !== undefined) {
      input.value = data[key];
    }
  }
  const typeSelect = $("[data-field='fieldType']", node);
  const dataTypeSelect = $("[data-field='dataType']", node);
  const objectTypeSelect = $("[data-field='objectType']", node);
  const valueDataTypeSelect = $("[data-field='valueDataType']", node);
  const addColumnButton = $("[data-add-column]", node);
  if (typeSelect.value === "checkbox") typeSelect.value = "boolean";
  const syncFieldDataType = () => {
    if (!dataTypeSelect) return;
    const fixedDataType = fixedDataTypeByFieldType[typeSelect.value];
    if (fixedDataType) {
      dataTypeSelect.value = fixedDataType;
      dataTypeSelect.dataset.manual = "";
      dataTypeSelect.disabled = true;
      return;
    }
    dataTypeSelect.disabled = false;
    if (!dataTypeSelect.dataset.manual || dataTypeSelect.value === "array") {
      dataTypeSelect.value = defaultDataTypeForFieldType(typeSelect.value);
      dataTypeSelect.dataset.manual = "";
    }
  };
  const syncFieldSchemaMetadata = () => {
    syncFieldDataType();
    if (objectTypeSelect && !objectTypeSelect.dataset.manual) {
      objectTypeSelect.value = defaultObjectTypeForFieldType(typeSelect.value);
    }
    if (valueDataTypeSelect && !valueDataTypeSelect.dataset.manual) {
      valueDataTypeSelect.value = defaultValueDataTypeForField(typeSelect.value, dataTypeSelect?.value || "string");
    }
  };
  if (data.objectType) objectTypeSelect.dataset.manual = "true";
  if (data.valueDataType) valueDataTypeSelect.dataset.manual = "true";
  const defaultDataType = defaultDataTypeForFieldType(typeSelect.value);
  if (data.dataType && data.dataType !== defaultDataType) {
    dataTypeSelect.dataset.manual = "true";
  }
  syncFieldSchemaMetadata();
  setupFieldAutoFill(node);
  addColumnButton.addEventListener("click", () => addTableColumn(node));
  typeSelect.addEventListener("change", () => {
    syncFieldSchemaMetadata();
    syncTableConfigVisibility(node);
    syncRoleOptions();
  });
  dataTypeSelect?.addEventListener("change", () => {
    dataTypeSelect.dataset.manual = "true";
    syncFieldSchemaMetadata();
  });
  objectTypeSelect?.addEventListener("change", () => {
    objectTypeSelect.dataset.manual = "true";
  });
  valueDataTypeSelect?.addEventListener("change", () => {
    valueDataTypeSelect.dataset.manual = "true";
  });
  $("[data-field='fieldKey']", node).addEventListener("input", syncRoleOptions);
  $("[data-field='fieldLabel']", node).addEventListener("input", syncRoleOptions);
  node.addEventListener("input", () => applySectionFilters(sectionNode));
  node.addEventListener("change", () => applySectionFilters(sectionNode));

  (data.tableColumns || []).forEach((column) => addTableColumn(node, column));
  if ((data.tableColumns || []).length === 0) {
    syncTableConfigVisibility(node);
  } else {
    const panel = $("[data-table-config]", node);
    panel.classList.toggle("hidden", typeSelect.value !== "table");
  }
  if (sectionNode.classList.contains("show-details")) {
    $$(".field-more-group", node).forEach((details) => {
      details.open = true;
    });
  }

  $("[data-remove-field]", node).addEventListener("click", () => {
    node.remove();
    applySectionFilters(sectionNode);
    syncRoleOptions();
  });
  $("[data-fields]", sectionNode).appendChild(node);
  applySectionFilters(sectionNode);
  syncRoleOptions();
  return node;
}

function readField(row) {
  const field = {};
  for (const input of $$("[data-field]", row)) {
    if (input.type === "checkbox") {
      field[input.dataset.field] = input.checked;
    } else if (input.tagName === "TEXTAREA") {
      field[input.dataset.field] = input.value;
    } else {
      field[input.dataset.field] = input.value.trim();
    }
  }
  if (field.fieldType === "table") {
    field.tableColumns = readTableColumns(row);
  }
  field.semanticSlug = slugFromValue(field.semanticSlug || field.fieldLabel || field.fieldKey);
  field.fieldKey = canonicalKeyFromSemanticSlug(field.semanticSlug || field.fieldLabel || field.fieldKey);
  return field;
}

function readSpec() {
  const summaryRoleEntries = $$("[data-summary-role-field]").map((select) => [select.dataset.summaryRoleField, select.value]);
  const lifecycleRoleEntries = $$("[data-lifecycle-role-field]").map((select) => [select.dataset.lifecycleRoleField, select.value]);
  return {
    module: {
      family: getFormValue("family"),
      version: getFormValue("version"),
      moduleKey: getFormValue("moduleKey"),
      typeName: getFormValue("typeName"),
      displayName: getFormValue("displayName"),
      productCategory: getFormValue("productCategory"),
      productIcon: getFormValue("productIcon"),
      semanticModelKey: getFormValue("semanticModelKey"),
      passportPolicyKey: getFormValue("passportPolicyKey"),
      defaultCarrierPolicyKey: getFormValue("defaultCarrierPolicyKey"),
      systemHeaderFieldAssignments: Object.fromEntries(
        $$("[data-system-header-slot]").map((select) => [select.dataset.systemHeaderSlot, select.value]).filter(([, value]) => value)
      ),
      baseUrl: getFormValue("baseUrl"),
      dictionaryName: getFormValue("dictionaryName"),
      dictionaryDescription: getFormValue("dictionaryDescription"),
    },
    roles: {
      businessIdentifierField: getFormValue("businessIdentifierField"),
      summaryRoles: Object.fromEntries(summaryRoleEntries.filter(([, value]) => value)),
      lifecycleRoles: Object.fromEntries(lifecycleRoleEntries.filter(([, value]) => value)),
      compositionFieldKey: getFormValue("compositionFieldKey"),
      compositionLabelColumnKey: getFormValue("compositionLabelColumnKey"),
      compositionValueColumnKey: getFormValue("compositionValueColumnKey"),
    },
    sections: $$(".section-card").map((section) => ({
      key: $("[data-section-key]", section).value.trim(),
      label: $("[data-section-label]", section).value.trim(),
      fields: $$(".field-row", section).map(readField),
    })),
  };
}

function loadSpec(spec) {
  Object.entries(spec.module || {}).forEach(([key, value]) => setFormValue(key, value));
  const roles = spec.roles || {};
  const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
  const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
  const sections = (spec.sections || []).map((section) => ({
    ...section,
    fields: (section.fields || []).map((field) => ({
      ...field,
      objectType: field.objectType || objectTypes[field.fieldKey || field.key] || "",
      valueDataType: field.valueDataType || valueDataTypes[field.fieldKey || field.key] || "",
    })),
  }));
  $("#sections").innerHTML = "";
  sections.forEach(addSection);
  maybeAutoModuleValues();
  syncRoleOptions();
  setFormValue("businessIdentifierField", roles.businessIdentifierField);
  setFormValue("compositionFieldKey", roles.compositionFieldKey);
  syncCompositionRoleColumns();
  setFormValue("compositionLabelColumnKey", roles.compositionLabelColumnKey);
  setFormValue("compositionValueColumnKey", roles.compositionValueColumnKey);
  Object.entries(roles.summaryRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-summary-role-field="${fieldKey}"]`);
    if (select) select.value = normalizeProductOverviewCardRole(value);
  });
  Object.entries(roles.lifecycleRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-lifecycle-role-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  const assignments = spec.module?.systemHeaderFieldAssignments && typeof spec.module.systemHeaderFieldAssignments === "object"
    ? spec.module.systemHeaderFieldAssignments
    : {};
  $$("[data-system-header-slot]").forEach((select) => {
    select.value = assignments[select.dataset.systemHeaderSlot] || "";
  });
  queueSessionSave();
}

function saveDraft() {
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify(readWorkspaceState()));
    setMessage("Saved draft locally in this browser.", "success");
  } catch {
    setMessage("Could not save draft in this browser.", "error");
  }
}

function loadDraft() {
  const state = loadJsonStorage(localStorage, draftStorageKey);
  if (!state) {
    setMessage("No saved draft found in this browser.", "error");
    return;
  }
  applyWorkspaceState(state);
  setMessage("Loaded saved draft from this browser.", "success");
}

function restoreSession() {
  const state = loadJsonStorage(sessionStorage, sessionStorageKey);
  if (!state) {
    setMessage("No saved session found for this browser tab.", "error");
    return;
  }
  applyWorkspaceState(state);
  setMessage("Restored current browser session.", "success");
}

function clearAll() {
  sessionStorage.removeItem(sessionStorageKey);
  loadSpec(createBlankSpec());
  setCheckboxValue("overwrite", false);
  clearMessage();
  setActiveStep("module");
  setMessage("Cleared the current working session. Saved drafts are kept.", "success");
}

function downloadFieldsCsvTemplate() {
  const templateRows = [
    {
      fieldLabel: "Manufacturer Name",
      sectionLabel: "Product Identity",
      fieldType: "text",
      definition: "Name of the manufacturer responsible for placing the product on the market.",
      categoryLabel: "Product Identification",
      dataType: "string",
      unitLabel: "",
      unitSymbol: "",
      confidentiality: "public",
      queryable: "false",
      indexed: "false",
      tableColumns: "",
    },
    {
      fieldLabel: "Material Composition",
      sectionLabel: "Material Data",
      fieldType: "table",
      definition: "Lists the component materials used in the product.",
      categoryLabel: "Material Information",
      dataType: "array",
      unitLabel: "",
      unitSymbol: "",
      confidentiality: "public",
      queryable: "false",
      indexed: "false",
      tableColumns: JSON.stringify([
        {
          "Label": "Material Name",
          "Data type": "string",
          "Unit label": "",
          "Unit symbol": "",
        },
        {
          "Label": "Percentage",
          "Data type": "decimal",
          "Unit label": "Percent",
          "Unit symbol": "%",
        },
      ]),
    },
  ];
  downloadTextFile("passport-module-fields-template.csv", buildFieldsCsvContent(templateRows), "text/csv;charset=utf-8");
  setMessage("Downloaded fixed CSV template for Part 2 fields.", "success");
}

function exportFieldsCsv() {
  const rows = getFieldsCsvRowsFromSpec();
  if (!rows.length) {
    setMessage("Add at least one field before exporting CSV.", "error");
    return;
  }
  downloadTextFile("passport-module-fields.csv", buildFieldsCsvContent(rows), "text/csv;charset=utf-8");
  setMessage(`Exported ${rows.length} field rows to CSV.`, "success");
}

async function importFieldsCsvFile(file) {
  if (!file) return;
  clearMessage();
  try {
    if (file.size > maxFieldsCsvBytes) {
      throw new Error("CSV file is too large. Maximum size is 2 MB.");
    }
    const text = await file.text();
    const { rows, skippedRowCount } = readFieldsCsvRows(text);
    const nextSpec = readSpec();
    nextSpec.sections = convertFieldsCsvRowsToSections(rows);
    loadSpec(nextSpec);
    setActiveStep("fields");
    const skippedText = skippedRowCount ? ` Skipped ${skippedRowCount} incomplete row${skippedRowCount === 1 ? "" : "s"}.` : "";
    setMessage(`Imported ${rows.length} field rows from CSV using the fixed template.${skippedText}`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function renderPreview(result) {
  const fileList = $("#fileList");
  fileList.innerHTML = "";
  for (const artifact of result.artifacts || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = artifact.path;
    button.addEventListener("click", () => {
      $("#previewOutput").textContent = artifact.content;
      $$(".file-list button").forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
    });
    fileList.appendChild(button);
  }

  const first = result.artifacts?.[0];
  $("#previewOutput").textContent = first ? first.content : "No files generated.";
  $(".file-list button")?.classList.add("selected");
}

async function callApi(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const details = data.conflicts?.length ? `\n\nConflicts:\n${data.conflicts.join("\n")}` : "";
    throw new Error(`${data.error || "Request failed"}${details}`);
  }
  return data;
}

async function preview() {
  clearMessage();
  try {
    const result = await callApi("/api/preview", readSpec());
    renderPreview(result);
    setMessage(`Generated preview for ${result.artifacts.length} files.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function writeFiles() {
  clearMessage();
  try {
    const payload = readSpec();
    payload.overwrite = $("#overwrite").checked;
    const result = await callApi("/api/write", payload);
    setMessage(`Wrote ${result.written.length} files:\n${result.written.join("\n")}`, "success");
    await preview();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    $("#status").textContent = `Repo: ${data.repoRoot}`;
  } catch {
    $("#status").textContent = "Server unavailable";
  }
}

$("#loadSample").addEventListener("click", () => loadSpec(sample));
$("#addSection").addEventListener("click", () => addSection());
$("#saveDraft").addEventListener("click", saveDraft);
$("#loadDraft").addEventListener("click", loadDraft);
$("#restoreSession").addEventListener("click", restoreSession);
$("#clearAll").addEventListener("click", clearAll);
$("#downloadFieldsCsvTemplate").addEventListener("click", downloadFieldsCsvTemplate);
$("#exportFieldsCsv").addEventListener("click", exportFieldsCsv);
$("#importFieldsCsv").addEventListener("click", () => $("#fieldsCsvInput").click());
$("#fieldsCsvInput").addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await importFieldsCsvFile(file);
  event.target.value = "";
});
$("#preview").addEventListener("click", preview);
$("#writeFiles").addEventListener("click", writeFiles);
$("#compositionFieldKey").addEventListener("change", syncCompositionRoleColumns);
document.addEventListener("input", queueSessionSave, true);
document.addEventListener("change", queueSessionSave, true);
setupWorkspaceNavigation();
setupModuleAutoFill();
const restoredSession = loadJsonStorage(sessionStorage, sessionStorageKey);
loadSpec(restoredSession?.spec || sample);
setCheckboxValue("overwrite", restoredSession?.overwrite);
setActiveStep(restoredSession?.activeStep || "module");
loadStatus();
