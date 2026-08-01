"use strict";

// Defines the versioned semantic graph CSV format and its safe parser/serializer.

(function exposePassportModuleSemanticGraphCsv(root, factory) {
  const csvCore = typeof module === "object" && module.exports
    ? require("./csv-core")
    : root?.PassportModuleCsvCore;
  const api = factory(csvCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleSemanticGraphCsv = api;
})(typeof globalThis === "object" ? globalThis : null, (csvCore) => {
  if (!csvCore) throw new Error("The passport module CSV core helper is unavailable.");

  const semanticGraphCsvVersion = "2";
  const semanticGraphCsvV2Headers = Object.freeze([
    "Graph CSV version",
    "Record type",
    "Order",
    "Owner key",
    "Key",
    "Label",
    "Semantic IRI",
    "Definition",
    "Source reference",
    "Semantic slug",
    "Enum override key",
    "Range kind",
    "Data type",
    "Range class key",
    "Range enum key",
    "Relationship",
    "Minimum count",
    "Maximum count",
    "Unit",
    "UI type",
  ]);
  const legacySemanticGraphCsvHeaders = Object.freeze([
    "Owner class",
    "Class definition",
    "Property label",
    "Property definition",
    "Range kind",
    "Data type",
    "Range target",
    "Relationship",
    "Minimum count",
    "Maximum count",
    "Unit",
    "Enum values",
  ]);
  const recordTypes = new Map([
    ["rootclass", "rootClass"],
    ["class", "class"],
    ["property", "property"],
    ["enum", "enum"],
    ["enumvalue", "enumValue"],
  ]);
  const rangeKinds = new Set(["scalar", "class", "enum"]);
  const scalarDataTypes = new Set([
    "string",
    "decimal",
    "integer",
    "boolean",
    "date",
    "datetime",
    "uri",
  ]);
  const relationshipTypes = new Set(["composition", "reference"]);
  const canonicalKeyPattern = /^[a-z][A-Za-z0-9]{0,199}$/;

  function text(value) {
    return String(value ?? "");
  }

  function clean(value) {
    return text(value).trim();
  }

  function normalizeHeader(value) {
    return clean(value).toLowerCase();
  }

  function normalizeToken(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function rowError(rowNumber, message) {
    return new Error(`Semantic graph CSV row ${rowNumber}: ${message}`);
  }

  function graphError(message) {
    return new Error(`Semantic graph CSV: ${message}`);
  }

  function isCommentRow(row) {
    return clean(row?.[0]).startsWith("#");
  }

  function isBlankRow(row) {
    return !row?.some((cell) => clean(cell));
  }

  function assertExactHeaders(actual, expected, label) {
    const normalized = actual.map(normalizeHeader);
    const wanted = expected.map(normalizeHeader);
    if (normalized.length !== wanted.length || wanted.some((header, index) => normalized[index] !== header)) {
      throw graphError(`${label} headers do not match the supported template.`);
    }
  }

  function parseOrder(value, rowNumber) {
    const normalized = clean(value);
    if (!/^\d+$/.test(normalized)) {
      throw rowError(rowNumber, "Order must be a non-negative integer.");
    }
    return Number(normalized);
  }

  function parseMinCount(value, rowNumber) {
    const normalized = clean(value);
    if (!/^\d+$/.test(normalized)) {
      throw rowError(rowNumber, "Minimum count must be a non-negative integer.");
    }
    return Number(normalized);
  }

  function parseMaxCount(value, minCount, rowNumber) {
    const normalized = clean(value).toLowerCase();
    if (!normalized || normalized === "n" || normalized === "*") return null;
    if (!/^\d+$/.test(normalized)) {
      throw rowError(rowNumber, "Maximum count must be a non-negative integer or n/* for unbounded.");
    }
    const maximum = Number(normalized);
    if (maximum < minCount) {
      throw rowError(rowNumber, "Maximum count must be greater than or equal to Minimum count.");
    }
    return maximum;
  }

  function assertCanonicalKey(value, label) {
    if (!canonicalKeyPattern.test(clean(value))) {
      throw graphError(`${label} must be lower camelCase letters/numbers and start with a lowercase letter.`);
    }
  }

  function assertSemanticIri(value, label) {
    const iri = clean(value);
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s\\]+$/.test(iri)) {
      throw graphError(`${label} must be an absolute semantic IRI.`);
    }
  }

  function assertIdentity(record, label) {
    assertCanonicalKey(record.key, `${label} key`);
    if (!clean(record.label)) throw graphError(`${label} label is required.`);
    assertSemanticIri(record.semanticId, `${label} semantic IRI`);
  }

  function assertUniqueOrder(records, label) {
    const orders = new Set();
    for (const record of records) {
      if (!Number.isInteger(record.order) || record.order < 0) {
        throw graphError(`${label} order must be a non-negative integer.`);
      }
      if (orders.has(record.order)) throw graphError(`Duplicate ${label.toLowerCase()} order ${record.order}.`);
      orders.add(record.order);
    }
  }

  function assertUniqueIdentities(records, label, { iriSet = null } = {}) {
    const keys = new Set();
    const iris = iriSet || new Set();
    for (const record of records) {
      assertIdentity(record, label);
      if (keys.has(record.key)) throw graphError(`Duplicate ${label.toLowerCase()} key "${record.key}".`);
      if (iris.has(record.semanticId)) {
        throw graphError(`Duplicate ${label.toLowerCase()} semantic IRI "${record.semanticId}".`);
      }
      keys.add(record.key);
      iris.add(record.semanticId);
    }
    return { keys, iris };
  }

  function normalizeProperty(rawProperty = {}) {
    const minCount = rawProperty.minCount === "" || rawProperty.minCount === undefined
      ? 0
      : Number(rawProperty.minCount);
    let maxCount = rawProperty.maxCount;
    if (maxCount === "" || maxCount === undefined || maxCount === "n" || maxCount === "*") maxCount = null;
    else if (maxCount !== null) maxCount = Number(maxCount);
    return {
      label: clean(rawProperty.label),
      key: clean(rawProperty.key),
      semanticId: clean(rawProperty.semanticId),
      definition: text(rawProperty.definition),
      semanticSlug: clean(rawProperty.semanticSlug),
      rangeKind: clean(rawProperty.rangeKind || "scalar").toLowerCase(),
      dataType: clean(rawProperty.dataType),
      rangeClassKey: clean(rawProperty.rangeClassKey),
      rangeEnumKey: clean(rawProperty.rangeEnumKey),
      relationshipType: clean(rawProperty.relationshipType),
      minCount,
      maxCount,
      unit: text(rawProperty.unit),
      uiType: clean(rawProperty.uiType),
      sourceRef: text(rawProperty.sourceRef),
      enumOverrideKey: clean(rawProperty.enumOverrideKey),
    };
  }

  function normalizeClass(rawClass = {}) {
    return {
      label: clean(rawClass.label),
      key: clean(rawClass.key),
      semanticId: clean(rawClass.semanticId),
      definition: text(rawClass.definition),
      sourceRef: text(rawClass.sourceRef),
      properties: (Array.isArray(rawClass.properties) ? rawClass.properties : []).map(normalizeProperty),
    };
  }

  function normalizeEnum(rawEnum = {}) {
    return {
      label: clean(rawEnum.label),
      key: clean(rawEnum.key),
      semanticId: clean(rawEnum.semanticId),
      definition: text(rawEnum.definition),
      values: (Array.isArray(rawEnum.values) ? rawEnum.values : []).map((rawValue) => ({
        label: clean(rawValue?.label),
        key: clean(rawValue?.key),
        semanticId: clean(rawValue?.semanticId),
        definition: text(rawValue?.definition),
      })),
    };
  }

  function normalizeGraph(rawGraph = {}) {
    const root = normalizeClass(rawGraph.rootClass || {});
    delete root.sourceRef;
    delete root.properties;
    return {
      rootClass: root,
      rootProperties: (Array.isArray(rawGraph.rootProperties) ? rawGraph.rootProperties : []).map(normalizeProperty),
      classes: (Array.isArray(rawGraph.classes) ? rawGraph.classes : []).map(normalizeClass),
      enums: (Array.isArray(rawGraph.enums) ? rawGraph.enums : []).map(normalizeEnum),
    };
  }

  function validateProperty(property, ownerKey, classesByKey, enumsByKey, propertyIris) {
    assertIdentity(property, `Property ${ownerKey}.${property.key || "unknown"}`);
    if (propertyIris.has(property.semanticId)) {
      throw graphError(`Duplicate property semantic IRI "${property.semanticId}".`);
    }
    propertyIris.add(property.semanticId);
    if (!rangeKinds.has(property.rangeKind)) {
      throw graphError(`Property ${ownerKey}.${property.key} has unsupported range kind "${property.rangeKind}".`);
    }
    if (!Number.isInteger(property.minCount) || property.minCount < 0) {
      throw graphError(`Property ${ownerKey}.${property.key} Minimum count must be a non-negative integer.`);
    }
    if (
      property.maxCount !== null
      && (!Number.isInteger(property.maxCount) || property.maxCount < property.minCount)
    ) {
      throw graphError(
        `Property ${ownerKey}.${property.key} Maximum count must be null/unbounded or an integer greater than or equal to Minimum count.`
      );
    }
    if (property.rangeKind === "scalar" && !scalarDataTypes.has(property.dataType)) {
      throw graphError(`Property ${ownerKey}.${property.key} has unsupported scalar data type "${property.dataType}".`);
    }
    if (property.rangeKind === "class") {
      if (!classesByKey.has(property.rangeClassKey)) {
        throw graphError(`Property ${ownerKey}.${property.key} references unknown range class "${property.rangeClassKey}".`);
      }
      if (!relationshipTypes.has(property.relationshipType)) {
        throw graphError(`Property ${ownerKey}.${property.key} has unsupported relationship "${property.relationshipType}".`);
      }
    }
    if (property.rangeKind === "enum" && !enumsByKey.has(property.rangeEnumKey)) {
      throw graphError(`Property ${ownerKey}.${property.key} references unknown range enum "${property.rangeEnumKey}".`);
    }
    if (property.enumOverrideKey && !enumsByKey.has(property.enumOverrideKey)) {
      throw graphError(`Property ${ownerKey}.${property.key} references unknown enum override "${property.enumOverrideKey}".`);
    }
  }

  function validateSemanticGraphCsvGraph(rawGraph) {
    if (!rawGraph || typeof rawGraph !== "object" || Array.isArray(rawGraph)) {
      throw graphError("graph must be an object.");
    }
    const graph = normalizeGraph(rawGraph);
    assertIdentity(graph.rootClass, "Root class");

    const allClasses = [graph.rootClass, ...graph.classes];
    const semanticIris = new Set();
    const { keys: classKeys } = assertUniqueIdentities(allClasses, "Class", { iriSet: semanticIris });
    const { keys: enumKeys } = assertUniqueIdentities(graph.enums, "Enum", { iriSet: semanticIris });
    const classesByKey = new Map(allClasses.map((classDef) => [classDef.key, classDef]));
    const enumsByKey = new Map(graph.enums.map((enumDef) => [enumDef.key, enumDef]));

    for (const enumDef of graph.enums) {
      if (!enumDef.values.length) throw graphError(`Enum ${enumDef.key} must define at least one value.`);
      const valueKeys = new Set();
      for (const value of enumDef.values) {
        assertIdentity(value, `Enum value ${enumDef.key}.${value.key || "unknown"}`);
        if (valueKeys.has(value.key)) {
          throw graphError(`Duplicate enum value key "${value.key}" in enum ${enumDef.key}.`);
        }
        if (semanticIris.has(value.semanticId)) {
          throw graphError(`Duplicate enum value semantic IRI "${value.semanticId}".`);
        }
        valueKeys.add(value.key);
        semanticIris.add(value.semanticId);
      }
    }

    for (const owner of [
      { key: graph.rootClass.key, properties: graph.rootProperties },
      ...graph.classes,
    ]) {
      const propertyKeys = new Set();
      for (const property of owner.properties || []) {
        if (propertyKeys.has(property.key)) {
          throw graphError(`Duplicate property key "${property.key}" on class ${owner.key}.`);
        }
        propertyKeys.add(property.key);
        validateProperty(property, owner.key, classesByKey, enumsByKey, semanticIris);
      }
    }

    // Keep these variables intentionally exercised above; separate class and enum
    // namespaces are supported by the runtime graph model.
    void classKeys;
    void enumKeys;
    return graph;
  }

  function recordRow(record) {
    const values = {
      "Graph CSV version": semanticGraphCsvVersion,
      "Record type": record.recordType,
      Order: record.order,
      "Owner key": record.ownerKey || "",
      Key: record.key || "",
      Label: record.label || "",
      "Semantic IRI": record.semanticId || "",
      Definition: record.definition || "",
      "Source reference": record.sourceRef || "",
      "Semantic slug": record.semanticSlug || "",
      "Enum override key": record.enumOverrideKey || "",
      "Range kind": record.rangeKind || "",
      "Data type": record.dataType || "",
      "Range class key": record.rangeClassKey || "",
      "Range enum key": record.rangeEnumKey || "",
      Relationship: record.relationshipType || "",
      "Minimum count": record.minCount ?? "",
      "Maximum count": record.maxCount === null ? "*" : (record.maxCount ?? ""),
      Unit: record.unit || "",
      "UI type": record.uiType || "",
    };
    return semanticGraphCsvV2Headers.map((header) => values[header]);
  }

  function graphRecords(graph) {
    const records = [{
      recordType: "rootClass",
      order: 0,
      ...graph.rootClass,
    }];
    graph.rootProperties.forEach((property, order) => records.push({
      recordType: "property",
      order,
      ownerKey: graph.rootClass.key,
      ...property,
    }));
    graph.classes.forEach((classDef, order) => {
      records.push({ recordType: "class", order, ...classDef, properties: undefined });
      classDef.properties.forEach((property, propertyOrder) => records.push({
        recordType: "property",
        order: propertyOrder,
        ownerKey: classDef.key,
        ...property,
      }));
    });
    graph.enums.forEach((enumDef, order) => {
      records.push({ recordType: "enum", order, ...enumDef, values: undefined });
      enumDef.values.forEach((value, valueOrder) => records.push({
        recordType: "enumValue",
        order: valueOrder,
        ownerKey: enumDef.key,
        ...value,
      }));
    });
    return records;
  }

  function buildSemanticGraphCsvContent(rawGraph, options = {}) {
    const graph = validateSemanticGraphCsvGraph(rawGraph);
    const rows = [
      [...semanticGraphCsvV2Headers],
      ...graphRecords(graph).map(recordRow),
    ];
    return csvCore.buildCsv(rows, {
      delimiter: options.delimiter || ",",
      bom: options.bom !== false,
      lineEnding: options.lineEnding || "\r\n",
      formulaSafe: options.formulaSafe !== false,
    });
  }

  function findHeader(parsedRows) {
    for (let index = 0; index < parsedRows.rows.length; index += 1) {
      const row = parsedRows.rows[index];
      if (isBlankRow(row) || isCommentRow(row)) continue;
      const first = normalizeHeader(row[0]);
      if (
        first === normalizeHeader(semanticGraphCsvV2Headers[0])
        || first === normalizeHeader(legacySemanticGraphCsvHeaders[0])
      ) {
        return { index, row, rowNumber: parsedRows.rowNumbers[index] };
      }
      throw rowError(parsedRows.rowNumbers[index], "the first meaningful row must be a supported semantic graph CSV header.");
    }
    throw graphError("file is empty.");
  }

  function parseV2Rows(parsed, headerIndex) {
    const records = [];
    for (let index = headerIndex + 1; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      const rowNumber = parsed.rowNumbers[index];
      if (isBlankRow(row) || isCommentRow(row)) continue;
      if (row.length !== semanticGraphCsvV2Headers.length) {
        throw rowError(
          rowNumber,
          `expected ${semanticGraphCsvV2Headers.length} columns but found ${row.length}.`
        );
      }
      const cells = row.map(csvCore.restoreFormulaSafeCell);
      const entry = Object.fromEntries(semanticGraphCsvV2Headers.map((header, cellIndex) => [header, cells[cellIndex]]));
      if (clean(entry["Graph CSV version"]) !== semanticGraphCsvVersion) {
        throw rowError(rowNumber, `Graph CSV version must be ${semanticGraphCsvVersion}.`);
      }
      const recordType = recordTypes.get(normalizeToken(entry["Record type"]));
      if (!recordType) throw rowError(rowNumber, `unsupported Record type "${clean(entry["Record type"])}".`);
      const order = parseOrder(entry.Order, rowNumber);
      const base = {
        rowNumber,
        recordType,
        order,
        ownerKey: clean(entry["Owner key"]),
        key: clean(entry.Key),
        label: clean(entry.Label),
        semanticId: clean(entry["Semantic IRI"]),
        definition: text(entry.Definition),
      };
      if (recordType === "class") base.sourceRef = text(entry["Source reference"]);
      if (recordType === "property") {
        base.sourceRef = text(entry["Source reference"]);
        base.semanticSlug = clean(entry["Semantic slug"]);
        base.enumOverrideKey = clean(entry["Enum override key"]);
        base.rangeKind = clean(entry["Range kind"]).toLowerCase();
        base.dataType = clean(entry["Data type"]);
        base.rangeClassKey = clean(entry["Range class key"]);
        base.rangeEnumKey = clean(entry["Range enum key"]);
        base.relationshipType = clean(entry.Relationship);
        base.minCount = parseMinCount(entry["Minimum count"], rowNumber);
        base.maxCount = parseMaxCount(entry["Maximum count"], base.minCount, rowNumber);
        base.unit = text(entry.Unit);
        base.uiType = clean(entry["UI type"]);
      }
      records.push(base);
    }
    if (!records.length) throw graphError("version 2 file must contain at least one graph record.");
    return records;
  }

  function graphFromV2Records(records) {
    const rootRecords = records.filter((record) => record.recordType === "rootClass");
    if (rootRecords.length !== 1) throw graphError("version 2 must contain exactly one rootClass record.");
    const classRecords = records.filter((record) => record.recordType === "class");
    const enumRecords = records.filter((record) => record.recordType === "enum");
    const propertyRecords = records.filter((record) => record.recordType === "property");
    const enumValueRecords = records.filter((record) => record.recordType === "enumValue");

    assertUniqueOrder(classRecords, "Class");
    assertUniqueOrder(enumRecords, "Enum");
    const rootRecord = rootRecords[0];
    const allClassRecords = [rootRecord, ...classRecords];
    assertUniqueIdentities(allClassRecords, "Class");
    assertUniqueIdentities(enumRecords, "Enum");
    const classesByKey = new Map(allClassRecords.map((record) => [record.key, record]));
    const enumsByKey = new Map(enumRecords.map((record) => [record.key, record]));

    const propertiesByOwner = new Map(allClassRecords.map((record) => [record.key, []]));
    for (const property of propertyRecords) {
      if (!classesByKey.has(property.ownerKey)) {
        throw rowError(property.rowNumber, `property Owner key "${property.ownerKey}" does not identify a class.`);
      }
      propertiesByOwner.get(property.ownerKey).push(property);
    }
    const valuesByOwner = new Map(enumRecords.map((record) => [record.key, []]));
    for (const value of enumValueRecords) {
      if (!enumsByKey.has(value.ownerKey)) {
        throw rowError(value.rowNumber, `enumValue Owner key "${value.ownerKey}" does not identify an enum.`);
      }
      valuesByOwner.get(value.ownerKey).push(value);
    }

    for (const [ownerKey, properties] of propertiesByOwner) {
      assertUniqueOrder(properties, `Property on ${ownerKey}`);
    }
    for (const [ownerKey, values] of valuesByOwner) {
      assertUniqueOrder(values, `Enum value on ${ownerKey}`);
    }

    const withoutCsvFields = (record, extraFields = []) => {
      const result = { ...record };
      ["rowNumber", "recordType", "order", "ownerKey", ...extraFields].forEach((key) => delete result[key]);
      return result;
    };
    const propertyForGraph = (record) => withoutCsvFields(record);
    const rootClass = withoutCsvFields(rootRecord);
    const rootProperties = propertiesByOwner.get(rootRecord.key)
      .sort((left, right) => left.order - right.order)
      .map(propertyForGraph);
    const classes = classRecords
      .sort((left, right) => left.order - right.order)
      .map((record) => ({
        ...withoutCsvFields(record),
        properties: propertiesByOwner.get(record.key)
          .sort((left, right) => left.order - right.order)
          .map(propertyForGraph),
      }));
    const enums = enumRecords
      .sort((left, right) => left.order - right.order)
      .map((record) => ({
        ...withoutCsvFields(record),
        values: valuesByOwner.get(record.key)
          .sort((left, right) => left.order - right.order)
          .map((value) => withoutCsvFields(value)),
      }));
    return validateSemanticGraphCsvGraph({ rootClass, rootProperties, classes, enums });
  }

  function defaultKeyFromLabel(value) {
    const words = text(value).match(/[A-Za-z0-9]+/g) || [];
    return words
      .map((word) => word.toLowerCase())
      .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join("");
  }

  function defaultClassIri(key) {
    return `urn:passport-module:class:${key}`;
  }

  function defaultPropertyIri(key, ownerKey) {
    return `urn:passport-module:property:${ownerKey}:${key}`;
  }

  function defaultEnumIri(key) {
    return `urn:passport-module:enum:${key}`;
  }

  function defaultEnumValueIri(key, enumDef) {
    return `${enumDef.semanticId}:${key}`;
  }

  function legacyBuilders(options = {}) {
    const nested = options.legacy || {};
    return {
      rootClass: options.legacyRootClass || nested.rootClass || {},
      keyFromLabel: options.keyFromLabel || nested.keyFromLabel || defaultKeyFromLabel,
      classIri: options.classIri || nested.classIri || defaultClassIri,
      propertyIri: options.propertyIri || nested.propertyIri || defaultPropertyIri,
      enumIri: options.enumIri || nested.enumIri || defaultEnumIri,
      enumValueIri: options.enumValueIri || nested.enumValueIri || defaultEnumValueIri,
    };
  }

  function parseLegacyRows(parsed, headerIndex, options = {}) {
    const builders = legacyBuilders(options);
    const rootInput = builders.rootClass;
    const rootLabel = clean(rootInput.label) || "Digital Product Passport Root";
    const rootKey = clean(rootInput.key) || clean(builders.keyFromLabel(rootLabel));
    const rootClass = {
      label: rootLabel,
      key: rootKey,
      semanticId: clean(rootInput.semanticId) || clean(builders.classIri(rootKey, rootLabel)),
      definition: text(rootInput.definition),
    };
    const rootProperties = [];
    const classes = [];
    const enums = [];
    const classesByLabel = new Map();
    const enumsByKey = new Map();

    for (let index = headerIndex + 1; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      const rowNumber = parsed.rowNumbers[index];
      if (isBlankRow(row) || isCommentRow(row)) continue;
      if (row.length !== legacySemanticGraphCsvHeaders.length) {
        throw rowError(
          rowNumber,
          `expected ${legacySemanticGraphCsvHeaders.length} legacy columns but found ${row.length}.`
        );
      }
      const cells = row.map((cell) => csvCore.restoreFormulaSafeCell(cell));
      const [
        ownerClassRaw,
        classDefinition,
        propertyLabelRaw,
        propertyDefinition,
        rangeKindRaw,
        dataTypeRaw,
        rangeTargetRaw,
        relationshipRaw,
        minCountRaw,
        maxCountRaw,
        unit,
        enumValuesRaw,
      ] = cells;
      const ownerClass = clean(ownerClassRaw);
      if (!ownerClass) throw rowError(rowNumber, "Owner class is required.");

      let owner;
      let ownerKey;
      if (ownerClass === "@root") {
        owner = rootProperties;
        ownerKey = rootClass.key;
        if (!rootClass.definition && classDefinition) rootClass.definition = text(classDefinition);
      } else {
        if (!classesByLabel.has(ownerClass)) {
          const key = clean(builders.keyFromLabel(ownerClass));
          const classDef = {
            label: ownerClass,
            key,
            semanticId: clean(builders.classIri(key, ownerClass)),
            definition: text(classDefinition),
            sourceRef: "",
            properties: [],
          };
          classesByLabel.set(ownerClass, classDef);
          classes.push(classDef);
        }
        const classDef = classesByLabel.get(ownerClass);
        owner = classDef.properties;
        ownerKey = classDef.key;
      }

      const propertyLabel = clean(propertyLabelRaw);
      if (!propertyLabel) continue;
      const propertyKey = clean(builders.keyFromLabel(propertyLabel));
      const rangeKind = clean(rangeKindRaw || "scalar").toLowerCase();
      if (!rangeKinds.has(rangeKind)) {
        throw rowError(rowNumber, `Range kind must be scalar, class, or enum (received "${rangeKind}").`);
      }
      const targetKey = clean(builders.keyFromLabel(rangeTargetRaw));
      const minCount = parseMinCount(minCountRaw === "" ? "0" : minCountRaw, rowNumber);
      const maxCount = parseMaxCount(maxCountRaw, minCount, rowNumber);
      const property = {
        label: propertyLabel,
        key: propertyKey,
        semanticId: clean(builders.propertyIri(propertyKey, ownerKey, propertyLabel)),
        definition: text(propertyDefinition),
        semanticSlug: clean(defaultKeyFromLabel(propertyLabel).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()),
        rangeKind,
        dataType: rangeKind === "scalar" ? clean(dataTypeRaw || "string").toLowerCase() : "",
        rangeClassKey: rangeKind === "class" ? targetKey : "",
        rangeEnumKey: rangeKind === "enum" ? targetKey : "",
        relationshipType: rangeKind === "class" ? clean(relationshipRaw || "composition").toLowerCase() : "",
        minCount,
        maxCount,
        unit: text(unit),
        uiType: "",
        sourceRef: "",
        enumOverrideKey: "",
      };
      owner.push(property);

      if (rangeKind === "enum" && !enumsByKey.has(targetKey)) {
        const enumLabel = clean(rangeTargetRaw);
        const enumDef = {
          label: enumLabel,
          key: targetKey,
          semanticId: clean(builders.enumIri(targetKey, enumLabel)),
          definition: `${enumLabel} controlled vocabulary.`,
          values: [],
        };
        enumDef.values = text(enumValuesRaw)
          .split("|")
          .map(clean)
          .filter(Boolean)
          .map((label) => {
            const key = clean(builders.keyFromLabel(label));
            return {
              label,
              key,
              semanticId: clean(builders.enumValueIri(key, enumDef, label)),
              definition: "",
            };
          });
        enumsByKey.set(targetKey, enumDef);
        enums.push(enumDef);
      }
    }

    if (!rootProperties.length && !classes.length) {
      throw graphError("legacy file does not contain any graph records.");
    }
    return validateSemanticGraphCsvGraph({ rootClass, rootProperties, classes, enums });
  }

  function parseSemanticGraphCsv(value, options = {}) {
    const parsed = csvCore.parseCsv(value, { delimiter: options.delimiter || "" });
    const header = findHeader(parsed);
    if (normalizeHeader(header.row[0]) === normalizeHeader(semanticGraphCsvV2Headers[0])) {
      assertExactHeaders(header.row, semanticGraphCsvV2Headers, "Version 2");
      return graphFromV2Records(parseV2Rows(parsed, header.index));
    }
    assertExactHeaders(header.row, legacySemanticGraphCsvHeaders, "Legacy");
    return parseLegacyRows(parsed, header.index, options);
  }

  return {
    buildSemanticGraphCsvContent,
    legacySemanticGraphCsvHeaders,
    parseSemanticGraphCsv,
    semanticGraphCsvV2Headers,
    semanticGraphCsvVersion,
    validateSemanticGraphCsvGraph,
  };
});
