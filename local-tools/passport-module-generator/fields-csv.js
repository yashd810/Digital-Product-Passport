"use strict";

(function exposePassportModuleFieldsCsv(root, factory) {
  const csvCore = typeof module === "object" && module.exports
    ? require("./csv-core")
    : root?.PassportModuleCsvCore;
  const sectionPaths = typeof module === "object" && module.exports
    ? require("./section-csv-paths")
    : root?.PassportModuleSectionCsvPaths;
  const derivedMetadata = typeof module === "object" && module.exports
    ? require("./derived-field-metadata")
    : root?.PassportModuleDerivedFieldMetadata;
  const api = factory(csvCore, sectionPaths, derivedMetadata);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleFieldsCsv = api;
})(typeof globalThis === "object" ? globalThis : null, (csvCore, sectionPaths, derivedMetadata) => {
  if (!csvCore) throw new Error("The passport module CSV core helper is unavailable.");
  if (!sectionPaths) throw new Error("The section CSV path helper is unavailable.");
  if (!derivedMetadata) throw new Error("The derived field metadata helper is unavailable.");

  const { buildSectionPathCells, convertRowsToNestedSections } = sectionPaths;
  const {
    deriveIdentityDescriptors,
    deriveSections,
    deriveTableColumns,
    fitCamelKey,
    unitKeyFromLabel,
  } = derivedMetadata;
  const fieldsCsvVersion = "2";
  const maxFieldsCsvBytes = 2 * 1024 * 1024;
  const maxFieldsCsvRows = sectionPaths.passportModuleSchemaLimits.maxFields;
  const fieldKeyPattern = /^[a-z][A-Za-z0-9]{0,199}$/;
  const columnKeyPattern = /^[a-z][A-Za-z0-9]{0,199}$/;

  const fieldsCsvV2Columns = Object.freeze([
    "formatVersion",
    "sectionLabel",
    "sectionPath",
    "sectionKeyPath",
    "sectionOrderPath",
    "fieldOrder",
    "fieldLabel",
    "fieldKey",
    "semanticSlug",
    "fieldType",
    "definition",
    "dataType",
    "unitKey",
    "unitLabel",
    "unitSymbol",
    "confidentiality",
    "objectType",
    "valueDataType",
    "queryable",
    "indexed",
    "tableColumns",
  ]);

  const fieldsCsvColumnLabels = Object.freeze({
    formatVersion: "Format version",
    sectionLabel: "Section label",
    sectionPath: "Section path",
    sectionKeyPath: "Section key path",
    sectionOrderPath: "Section order path",
    fieldOrder: "Field order",
    fieldLabel: "Label",
    fieldKey: "Field key",
    semanticSlug: "Semantic slug",
    fieldType: "UI type",
    definition: "Definition",
    dataType: "Data type",
    unitKey: "Unit key",
    unitLabel: "Unit label",
    unitSymbol: "Unit symbol",
    confidentiality: "Confidentiality",
    objectType: "Schema object",
    valueDataType: "Schema value",
    queryable: "queryable",
    indexed: "indexed",
    tableColumns: "Table schema",
  });

  const legacyFieldsCsvColumns = Object.freeze([
    "sectionLabel",
    "sectionPath",
    "sectionKeyPath",
    "fieldLabel",
    "fieldType",
    "definition",
    "dataType",
    "unitLabel",
    "unitSymbol",
    "confidentiality",
    "queryable",
    "indexed",
    "tableColumns",
  ]);

  const fieldsCsvColumnAliases = Object.freeze({
    formatVersion: ["Fields CSV version", "CSV version"],
    sectionLabel: ["Section"],
    sectionPath: ["Section labels path"],
    sectionKeyPath: ["Section keys path"],
    sectionOrderPath: ["Section positions", "Section order"],
    fieldOrder: ["Field position"],
    fieldLabel: ["Field label", "Field name"],
    fieldKey: ["Key"],
    semanticSlug: ["Slug"],
    fieldType: ["Type", "Field type"],
    dataType: ["JSON type"],
    unitKey: ["Unit ID"],
    objectType: ["Object type", "Schema object type"],
    valueDataType: ["Value type", "Value data type", "Schema value type"],
    tableColumns: ["Columns", "Table columns", "Table column JSON"],
  });

  const tableColumnLabels = Object.freeze({
    columnLabel: "Label",
    columnKey: "Column key",
    semanticSlug: "Semantic slug",
    dataType: "Data type",
    unitKey: "Unit key",
    unitLabel: "Unit label",
    unitSymbol: "Unit symbol",
    objectType: "Object type",
    valueDataType: "Value data type",
  });

  const tableColumnAliases = Object.freeze({
    columnLabel: ["Column label", "Column name"],
    columnKey: ["Key"],
    semanticSlug: ["Slug"],
    dataType: ["JSON type"],
    unitKey: ["Unit ID"],
    objectType: ["Schema object", "Schema object type"],
    valueDataType: ["Schema value", "Schema value type", "Value type"],
  });

  const fieldTypeOptions = new Map([
    ["text", ["text"]],
    ["textarea", ["textarea", "multi-line text", "long text"]],
    ["boolean", ["boolean", "true false", "yes no", "checkbox"]],
    ["date", ["date"]],
    ["datetime", ["datetime", "date time", "date-time"]],
    ["url", ["url", "link"]],
    ["file", ["file", "evidence file"]],
    ["symbol", ["symbol"]],
    ["table", ["table", "collection"]],
  ]);
  const dataTypeOptions = new Map([
    ["string", ["string", "text"]],
    ["decimal", ["decimal"]],
    ["integer", ["integer"]],
    ["boolean", ["boolean"]],
    ["date", ["date"]],
    ["datetime", ["datetime", "date time", "date-time"]],
    ["uri", ["uri", "url", "link"]],
    ["array", ["array", "list", "collection"]],
  ]);
  const tableColumnDataTypes = new Map(
    [...dataTypeOptions].filter(([value]) => value !== "array")
  );
  const confidentialityOptions = new Map([
    ["public", ["public"]],
    ["restricted", ["restricted"]],
  ]);
  const fixedDataTypeByFieldType = Object.freeze({
    boolean: "boolean",
    date: "date",
    datetime: "datetime",
    file: "uri",
    symbol: "uri",
    table: "array",
    url: "uri",
  });
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

  function text(value) {
    return String(value ?? "");
  }

  function clean(value) {
    return text(value).trim();
  }

  function token(value) {
    return clean(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function splitWords(value) {
    return clean(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  function slugFromValue(value) {
    return splitWords(value).map((word) => word.toLowerCase()).join("-");
  }

  function canonicalKeyFromSemanticSlug(value) {
    const words = splitWords(value).map((word) => word.toLowerCase());
    return words
      .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join("");
  }

  function aliasesFor(labels, extras) {
    const aliases = new Map();
    for (const [key, label] of Object.entries(labels)) {
      for (const candidate of [key, label, ...(extras[key] || [])]) {
        const normalized = token(candidate);
        if (normalized) aliases.set(normalized, key);
      }
    }
    return aliases;
  }

  const fieldHeaderAliases = aliasesFor(fieldsCsvColumnLabels, fieldsCsvColumnAliases);
  const tablePropertyAliases = aliasesFor(tableColumnLabels, tableColumnAliases);

  function optionAliases(options) {
    const aliases = new Map();
    for (const [value, candidates] of options) {
      for (const candidate of candidates) aliases.set(token(candidate), value);
    }
    return aliases;
  }

  const fieldTypeAliases = optionAliases(fieldTypeOptions);
  const dataTypeAliases = optionAliases(dataTypeOptions);
  const tableDataTypeAliases = optionAliases(tableColumnDataTypes);
  const confidentialityAliases = optionAliases(confidentialityOptions);

  function normalizeOption(value, aliases, fallback, label) {
    const supplied = clean(value);
    if (!supplied) return fallback;
    const normalized = aliases.get(token(supplied));
    if (normalized) return normalized;
    throw new Error(`${label} has unsupported value "${supplied}".`);
  }

  function parseBoolean(value, label) {
    const normalized = clean(value).toLowerCase();
    if (!normalized || ["false", "0", "no", "n"].includes(normalized)) return false;
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    throw new Error(`${label} must be true or false.`);
  }

  function utf8Size(value) {
    return new TextEncoder().encode(text(value)).byteLength;
  }

  function isBlankRow(row) {
    return !row?.some((cell) => clean(cell));
  }

  function isCommentRow(row) {
    return clean(row?.[0]).startsWith("#");
  }

  function rowLabel(rowNumber, column) {
    return `Fields CSV row ${rowNumber} ${fieldsCsvColumnLabels[column] || column}`;
  }

  function defaultDataType(fieldType) {
    return fixedDataTypeByFieldType[fieldType] || "string";
  }

  function valueDataTypeFromDataType(dataType) {
    return {
      array: "Array",
      integer: "Integer",
      decimal: "Decimal",
      boolean: "Boolean",
      date: "Date",
      datetime: "DateTime",
      uri: "URI",
    }[dataType] || "String";
  }

  function defaultObjectType(fieldType) {
    if (fieldType === "table") return "DataElementCollection";
    if (["file", "url", "symbol"].includes(fieldType)) return "RelatedResource";
    return "SingleValuedDataElement";
  }

  function defaultValueDataType(fieldType, dataType) {
    if (fieldType === "table") return "Array";
    if (["file", "url", "symbol"].includes(fieldType)) return "URI";
    return valueDataTypeFromDataType(dataType);
  }

  function normalizeSchemaMetadata(value, allowed, fallback, label) {
    const normalized = clean(value) || fallback;
    if (!allowed.has(normalized)) {
      throw new Error(`${label} must be one of: ${[...allowed].join(", ")}.`);
    }
    return normalized;
  }

  function normalizeTableObject(rawColumn, rowNumber, columnIndex) {
    if (!rawColumn || typeof rawColumn !== "object" || Array.isArray(rawColumn)) {
      throw new Error(`${rowLabel(rowNumber, "tableColumns")} item ${columnIndex + 1} must be an object.`);
    }
    const normalized = Object.create(null);
    for (const [key, value] of Object.entries(rawColumn)) {
      const property = tablePropertyAliases.get(token(key));
      if (!property) {
        throw new Error(`${rowLabel(rowNumber, "tableColumns")} item ${columnIndex + 1} contains unsupported property "${key}".`);
      }
      if (Object.prototype.hasOwnProperty.call(normalized, property)) {
        throw new Error(`${rowLabel(rowNumber, "tableColumns")} item ${columnIndex + 1} repeats property "${tableColumnLabels[property]}".`);
      }
      normalized[property] = value;
    }
    return normalized;
  }

  function normalizeTableColumns(value, rowNumber) {
    if (!Array.isArray(value)) {
      throw new Error(`${rowLabel(rowNumber, "tableColumns")} must be a JSON array.`);
    }
    const actualColumns = value.map((rawColumn, index) => {
      const column = normalizeTableObject(rawColumn, rowNumber, index);
      const labelPrefix = `${rowLabel(rowNumber, "tableColumns")} item ${index + 1}`;
      const columnLabel = clean(column.columnLabel);
      if (!columnLabel) throw new Error(`${labelPrefix} Label is required.`);
      const dataType = normalizeOption(column.dataType, tableDataTypeAliases, "string", `${labelPrefix} Data type`);
      return {
        columnLabel,
        dataType,
        unitLabel: clean(column.unitLabel),
        unitSymbol: clean(column.unitSymbol),
      };
    });
    return deriveTableColumns(actualColumns, `csv-row-${rowNumber}`);
  }

  function serializeTableColumns(columns = []) {
    const derivedColumns = deriveTableColumns(columns || [], "csv-export");
    return JSON.stringify(derivedColumns.map((column) => ({
      columnLabel: column.columnLabel || "",
      columnKey: column.columnKey || "",
      semanticSlug: column.semanticSlug || "",
      dataType: column.dataType || "string",
      unitKey: column.unitKey || "none",
      unitLabel: column.unitLabel || "",
      unitSymbol: column.unitSymbol || "",
      objectType: column.objectType || "SingleValuedDataElement",
      valueDataType: column.valueDataType || valueDataTypeFromDataType(column.dataType || "string"),
    })));
  }

  function getFieldsCsvRowsFromSpec(spec = {}) {
    const rows = [];
    const visitSection = (section, parentLabels, parentKeys, parentOrders, siblingIndex) => {
      const sectionLabel = clean(section?.label);
      const sectionKey = clean(section?.key) || canonicalKeyFromSemanticSlug(sectionLabel);
      const labels = [...parentLabels, sectionLabel];
      const keys = [...parentKeys, sectionKey];
      const orders = [...parentOrders, siblingIndex + 1];
      const paths = buildSectionPathCells({
        labels,
        keys,
        deriveSectionKey: canonicalKeyFromSemanticSlug,
      });
      const sectionFields = Array.isArray(section?.fields) ? section.fields : [];
      const childSections = Array.isArray(section?.sections) ? section.sections : [];
      if (!sectionFields.length && !childSections.length) {
        throw new Error(`Cannot export empty leaf section "${labels.join(" > ")}"; add a field or subsection first.`);
      }
      sectionFields.forEach((field, fieldIndex) => {
        const fieldType = clean(field?.fieldType) || "text";
        const dataType = clean(field?.dataType) || defaultDataType(fieldType);
        const semanticSlug = slugFromValue(field?.semanticSlug || field?.fieldLabel || field?.fieldKey);
        const fieldKey = clean(field?.fieldKey) || canonicalKeyFromSemanticSlug(semanticSlug);
        rows.push({
          formatVersion: fieldsCsvVersion,
          sectionLabel,
          ...paths,
          sectionOrderPath: JSON.stringify(orders),
          fieldOrder: String(fieldIndex + 1),
          fieldLabel: field?.fieldLabel || "",
          fieldKey,
          semanticSlug,
          fieldType,
          definition: field?.definition || "",
          dataType,
          unitKey: field?.unitKey || "none",
          unitLabel: field?.unitLabel || "",
          unitSymbol: field?.unitSymbol || "",
          confidentiality: field?.confidentiality || "public",
          objectType: field?.objectType || defaultObjectType(fieldType),
          valueDataType: field?.valueDataType || defaultValueDataType(fieldType, dataType),
          queryable: field?.queryable ? "true" : "false",
          indexed: field?.indexed ? "true" : "false",
          tableColumns: fieldType === "table" ? serializeTableColumns(field?.tableColumns || []) : "",
        });
      });
      childSections.forEach((child, index) => {
        visitSection(child, labels, keys, orders, index);
      });
    };
    const derivedSections = deriveSections(Array.isArray(spec?.sections) ? spec.sections : []);
    derivedSections.forEach((section, index) => {
      visitSection(section, [], [], [], index);
    });
    return rows;
  }

  function fieldsCsvHeaders() {
    return fieldsCsvV2Columns.map((column) => fieldsCsvColumnLabels[column]);
  }

  function buildFieldsCsvContent(rows = [], options = {}) {
    const matrix = [
      fieldsCsvHeaders(),
      ...rows.map((row) => fieldsCsvV2Columns.map((column) => row?.[column] ?? "")),
    ];
    const content = csvCore.buildCsv(matrix, {
      delimiter: options.delimiter || ",",
      bom: options.bom !== false,
      lineEnding: options.lineEnding || "\r\n",
      formulaSafe: options.formulaSafe !== false,
    });
    if (rows.length && options.validate !== false) readFieldsCsvRows(content);
    return content;
  }

  function findHeader(parsed) {
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      if (isBlankRow(row) || isCommentRow(row)) continue;
      const columns = row.map((cell) => fieldHeaderAliases.get(token(cell)) || "");
      if (columns.includes("sectionLabel") && columns.includes("fieldLabel")) {
        return { index, raw: row, columns, rowNumber: parsed.rowNumbers[index] };
      }
      throw new Error(`Fields CSV row ${parsed.rowNumbers[index]} must be a supported fields header.`);
    }
    throw new Error("Fields CSV file is empty.");
  }

  function validateHeader(header) {
    const unsupported = header.raw.filter((cell, index) => clean(cell) && !header.columns[index]);
    if (unsupported.length) {
      throw new Error(`Fields CSV contains unsupported columns: ${unsupported.join(", ")}.`);
    }
    const duplicates = header.columns.filter((column, index) => column && header.columns.indexOf(column) !== index);
    if (duplicates.length) {
      throw new Error(`Fields CSV contains duplicate columns: ${[...new Set(duplicates)].map((key) => fieldsCsvColumnLabels[key]).join(", ")}.`);
    }
    for (const required of ["sectionLabel", "fieldLabel"]) {
      if (!header.columns.includes(required)) {
        throw new Error(`Fields CSV is missing required column "${fieldsCsvColumnLabels[required]}".`);
      }
    }
    const isV2 = [
      "formatVersion",
      "sectionOrderPath",
      "fieldOrder",
      "fieldKey",
      "semanticSlug",
      "unitKey",
    ].some((column) => header.columns.includes(column));
    return isV2;
  }

  function parseJson(value, label, fallback) {
    const supplied = clean(value);
    if (!supplied) return fallback;
    try {
      return JSON.parse(supplied);
    } catch {
      throw new Error(`${label} must be valid JSON.`);
    }
  }

  function parseOrderPath(value, expectedDepth, rowNumber) {
    const parsed = parseJson(value, rowLabel(rowNumber, "sectionOrderPath"), null);
    if (parsed === null) return null;
    if (
      !Array.isArray(parsed)
      || parsed.length !== expectedDepth
      || parsed.some((part) => !Number.isInteger(part) || part < 1)
    ) {
      throw new Error(`${rowLabel(rowNumber, "sectionOrderPath")} must be a JSON array of positive integers matching the section path depth.`);
    }
    return parsed;
  }

  function parseFieldOrder(value, rowNumber) {
    const supplied = clean(value);
    if (!supplied) return null;
    if (!/^\d+$/.test(supplied) || Number(supplied) < 1) {
      throw new Error(`${rowLabel(rowNumber, "fieldOrder")} must be a positive integer.`);
    }
    return Number(supplied);
  }

  function normalizeActualSectionPath(entry, rowNumber) {
    const sectionLabel = clean(entry.sectionLabel);
    const supplied = clean(entry.sectionPath);
    const labels = supplied
      ? parseJson(supplied, rowLabel(rowNumber, "sectionPath"), null)
      : [sectionLabel];
    if (
      !Array.isArray(labels)
      || !labels.length
      || labels.length > sectionPaths.maxSectionPathDepth
      || labels.some((label) => typeof label !== "string" || !label.trim())
    ) {
      throw new Error(
        `${rowLabel(rowNumber, "sectionPath")} must be a JSON array of 1-${sectionPaths.maxSectionPathDepth} non-empty strings.`
      );
    }
    const normalized = labels.map(clean);
    if (normalized[normalized.length - 1] !== sectionLabel) {
      throw new Error(`${rowLabel(rowNumber, "sectionLabel")} must match the final Section path label.`);
    }
    return {
      sectionLabel,
      sectionPath: normalized,
      sectionKeyPath: [],
      usesExplicitPath: Boolean(supplied),
    };
  }

  function assignDerivedSectionKeyPaths(rows, explicitOrder) {
    const nodes = [];
    const nodesByIdentity = new Map();
    for (const row of rows) {
      for (let depth = 1; depth <= row.sectionPath.length; depth += 1) {
        const labelPath = row.sectionPath.slice(0, depth);
        const identity = explicitOrder
          ? `order:${JSON.stringify(row.sectionOrderPath.slice(0, depth))}`
          : `labels:${JSON.stringify(labelPath)}`;
        const known = nodesByIdentity.get(identity);
        if (known) {
          if (JSON.stringify(known.labelPath) !== JSON.stringify(labelPath)) {
            throw new Error(`${rowLabel(row.rowNumber, "sectionOrderPath")} reuses one section position for different labels.`);
          }
          continue;
        }
        const node = {
          identity,
          labelPath,
          label: labelPath[labelPath.length - 1],
          contextLabels: labelPath.slice(0, -1),
        };
        nodes.push(node);
        nodesByIdentity.set(identity, node);
      }
    }
    const identities = deriveIdentityDescriptors(
      nodes.map((node) => ({
        label: node.label,
        contextLabels: node.contextLabels,
        discriminator: node.identity,
      })),
      { maxLength: 200 }
    );
    nodes.forEach((node, index) => {
      node.key = identities[index].key;
    });
    for (const row of rows) {
      row.sectionKeyPath = row.sectionPath.map((_, index) => {
        const identity = explicitOrder
          ? `order:${JSON.stringify(row.sectionOrderPath.slice(0, index + 1))}`
          : `labels:${JSON.stringify(row.sectionPath.slice(0, index + 1))}`;
        return nodesByIdentity.get(identity).key;
      });
    }
    return rows;
  }

  function normalizeField(entry, rowNumber) {
    const fieldLabel = clean(entry.fieldLabel);
    const sectionLabel = clean(entry.sectionLabel);
    if (!fieldLabel || !sectionLabel) {
      throw new Error(`Fields CSV row ${rowNumber} requires both Section label and Label.`);
    }
    let fieldType = normalizeOption(
      entry.fieldType,
      fieldTypeAliases,
      "text",
      rowLabel(rowNumber, "fieldType")
    );
    const dataType = normalizeOption(
      entry.dataType,
      dataTypeAliases,
      defaultDataType(fieldType),
      rowLabel(rowNumber, "dataType")
    );
    if (fieldType === "date" && dataType === "datetime") fieldType = "datetime";
    if (fieldType === "datetime" && dataType === "date") fieldType = "date";
    if (fieldType === "table" && dataType !== "array") {
      throw new Error(`${rowLabel(rowNumber, "dataType")} must be array when UI type is table.`);
    }
    if (fieldType !== "table" && dataType === "array") {
      throw new Error(`${rowLabel(rowNumber, "dataType")} array requires UI type table.`);
    }
    const fixedDataType = fixedDataTypeByFieldType[fieldType];
    if (fixedDataType && dataType !== fixedDataType) {
      throw new Error(`${rowLabel(rowNumber, "fieldType")} "${fieldType}" requires Data type "${fixedDataType}".`);
    }

    // Identifier and schema columns are intentionally ignored on import. They
    // are reference-only in older CSV files and are regenerated from the
    // visible inputs after the complete nested tree is known.
    const semanticSlug = slugFromValue(fieldLabel);
    const fieldKey = canonicalKeyFromSemanticSlug(semanticSlug);
    const objectType = defaultObjectType(fieldType);
    const valueDataType = defaultValueDataType(fieldType, dataType);

    const tableSource = clean(entry.tableColumns);
    if (fieldType !== "table" && tableSource) {
      throw new Error(`${rowLabel(rowNumber, "tableColumns")} is only allowed for UI type table.`);
    }
    const rawColumns = fieldType === "table"
      ? parseJson(tableSource, rowLabel(rowNumber, "tableColumns"), [])
      : [];
    const tableColumns = normalizeTableColumns(rawColumns, rowNumber);
    return {
      sectionLabel,
      field: {
        fieldLabel,
        fieldKey,
        semanticSlug,
        fieldType,
        definition: text(entry.definition),
        dataType,
        unitKey: unitKeyFromLabel(entry.unitLabel),
        unitLabel: clean(entry.unitLabel),
        unitSymbol: clean(entry.unitSymbol),
        confidentiality: normalizeOption(
          entry.confidentiality,
          confidentialityAliases,
          "public",
          rowLabel(rowNumber, "confidentiality")
        ),
        objectType,
        valueDataType,
        queryable: parseBoolean(entry.queryable, rowLabel(rowNumber, "queryable")),
        indexed: parseBoolean(entry.indexed, rowLabel(rowNumber, "indexed")),
        tableColumns,
      },
    };
  }

  function compareOrderPath(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] === undefined) return -1;
      if (right[index] === undefined) return 1;
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  }

  function validateAndSortExplicitOrder(rows) {
    const labelPathByOrderPrefix = new Map();
    const fieldOrdersBySection = new Map();
    for (const row of rows) {
      for (let depth = 1; depth <= row.sectionPath.length; depth += 1) {
        const labelPrefix = JSON.stringify(row.sectionPath.slice(0, depth));
        const orderPrefix = JSON.stringify(row.sectionOrderPath.slice(0, depth));
        const knownLabelPrefix = labelPathByOrderPrefix.get(orderPrefix);
        if (knownLabelPrefix && knownLabelPrefix !== labelPrefix) {
          throw new Error(`${rowLabel(row.rowNumber, "sectionOrderPath")} reuses one section position for different section paths.`);
        }
        labelPathByOrderPrefix.set(orderPrefix, labelPrefix);
      }
      const sectionId = JSON.stringify(row.sectionOrderPath);
      if (!fieldOrdersBySection.has(sectionId)) fieldOrdersBySection.set(sectionId, new Set());
      const orders = fieldOrdersBySection.get(sectionId);
      if (orders.has(row.fieldOrder)) {
        throw new Error(`${rowLabel(row.rowNumber, "fieldOrder")} duplicates Field order ${row.fieldOrder} in this section.`);
      }
      orders.add(row.fieldOrder);
    }
    return [...rows].sort((left, right) => (
      compareOrderPath(left.sectionOrderPath, right.sectionOrderPath)
      || left.fieldOrder - right.fieldOrder
    ));
  }

  function summarizeSections(sections = []) {
    const summary = { sectionCount: 0, fieldCount: 0, tableColumnCount: 0, maxDepth: 0 };
    const visit = (section, depth) => {
      summary.sectionCount += 1;
      summary.maxDepth = Math.max(summary.maxDepth, depth);
      const fields = Array.isArray(section?.fields) ? section.fields : [];
      summary.fieldCount += fields.length;
      summary.tableColumnCount += fields.reduce(
        (count, field) => count + (Array.isArray(field?.tableColumns) ? field.tableColumns.length : 0),
        0
      );
      (Array.isArray(section?.sections) ? section.sections : []).forEach((child) => visit(child, depth + 1));
    };
    (Array.isArray(sections) ? sections : []).forEach((section) => visit(section, 1));
    return summary;
  }

  function convertFieldsCsvRowsToSections(rows = []) {
    return convertRowsToNestedSections(rows);
  }

  function readFieldsCsvRows(value, options = {}) {
    if (utf8Size(value) > (options.maxBytes || maxFieldsCsvBytes)) {
      throw new Error("Fields CSV file is too large. Maximum size is 2 MB.");
    }
    const parsed = csvCore.parseCsv(value, { delimiter: options.delimiter || "" });
    const header = findHeader(parsed);
    const isV2 = validateHeader(header);
    const rows = [];

    for (let index = header.index + 1; index < parsed.rows.length; index += 1) {
      const rawRow = parsed.rows[index];
      const rowNumber = parsed.rowNumbers[index];
      if (isBlankRow(rawRow) || isCommentRow(rawRow)) continue;
      if (rawRow.length !== header.raw.length) {
        throw new Error(`Fields CSV row ${rowNumber} expected ${header.raw.length} columns but found ${rawRow.length}.`);
      }
      const cells = rawRow.map(csvCore.restoreFormulaSafeCell);
      const entry = Object.fromEntries(header.columns.map((column, cellIndex) => [column, cells[cellIndex]]));
      if (header.columns.includes("formatVersion") && clean(entry.formatVersion) !== fieldsCsvVersion) {
        throw new Error(`${rowLabel(rowNumber, "formatVersion")} must be ${fieldsCsvVersion}.`);
      }
      const normalizedField = normalizeField(entry, rowNumber);
      const path = normalizeActualSectionPath(entry, rowNumber);
      rows.push({
        rowNumber,
        ...path,
        sectionOrderPath: isV2
          ? parseOrderPath(entry.sectionOrderPath, path.sectionPath.length, rowNumber)
          : null,
        fieldOrder: isV2 ? parseFieldOrder(entry.fieldOrder, rowNumber) : null,
        field: normalizedField.field,
      });
      if (rows.length > maxFieldsCsvRows) {
        throw new Error(`Fields CSV supports at most ${maxFieldsCsvRows} field rows.`);
      }
    }

    if (!rows.length) {
      throw new Error("Fields CSV must contain at least one complete field row; the current form was not changed.");
    }
    const explicitOrderCount = rows.filter((row) => row.sectionOrderPath && row.fieldOrder).length;
    const partialOrderCount = rows.filter((row) => Boolean(row.sectionOrderPath) !== Boolean(row.fieldOrder)).length;
    if (partialOrderCount || (explicitOrderCount && explicitOrderCount !== rows.length)) {
      throw new Error("Fields CSV version 2 must provide both order columns for every row, or leave both blank for every row.");
    }
    const orderedRows = explicitOrderCount ? validateAndSortExplicitOrder(rows) : rows;
    assignDerivedSectionKeyPaths(orderedRows, Boolean(explicitOrderCount));
    const sections = deriveSections(convertFieldsCsvRowsToSections(orderedRows));
    return {
      rows: orderedRows,
      sections,
      formatVersion: isV2 ? fieldsCsvVersion : "legacy",
      legacy: !isV2,
      explicitOrder: Boolean(explicitOrderCount),
      delimiter: parsed.delimiter,
      ...summarizeSections(sections),
    };
  }

  return {
    buildFieldsCsvContent,
    canonicalKeyFromSemanticSlug,
    convertFieldsCsvRowsToSections,
    fieldsCsvColumnLabels,
    fieldsCsvHeaders,
    fieldsCsvV2Columns,
    fieldsCsvVersion,
    getFieldsCsvRowsFromSpec,
    legacyFieldsCsvColumns,
    maxFieldsCsvBytes,
    maxFieldsCsvRows,
    readFieldsCsvRows,
    serializeTableColumns,
    slugFromValue,
    summarizeSections,
  };
});
