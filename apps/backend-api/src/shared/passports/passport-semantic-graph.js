"use strict";

const { canonicalKeyFromSemanticId } = require("./canonical-field-keys");
const { isSafePassportUri } = require("./passport-uri");

const semanticGraphRangeKinds = Object.freeze(["scalar", "class", "enum"]);
const semanticGraphRelationshipTypes = Object.freeze(["composition", "reference"]);
const semanticGraphScalarDataTypes = Object.freeze([
  "string",
  "decimal",
  "integer",
  "boolean",
  "date",
  "datetime",
  "uri",
]);
const semanticGraphScalarRangeIris = Object.freeze({
  string: "http://www.w3.org/2001/XMLSchema#string",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  date: "http://www.w3.org/2001/XMLSchema#date",
  datetime: "http://www.w3.org/2001/XMLSchema#dateTime",
  uri: "http://www.w3.org/2001/XMLSchema#anyURI",
});
const semanticGraphLimits = Object.freeze({
  classes: 256,
  enums: 256,
  propertiesPerClass: 512,
  totalProperties: 4096,
  valuesPerEnum: 2048,
  compositionDepth: 32,
});

const rangeKindSet = new Set(semanticGraphRangeKinds);
const relationshipTypeSet = new Set(semanticGraphRelationshipTypes);
const scalarDataTypeSet = new Set(semanticGraphScalarDataTypes);

function clean(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalKey(value) {
  return /^[a-z][A-Za-z0-9]{0,199}$/.test(clean(value));
}

function isAbsoluteIri(value) {
  return isSafePassportUri(clean(value));
}

function normalizeCount(value, fallback = null) {
  if (value === null || value === undefined || value === "" || value === "n" || value === "*") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function normalizeEnum(rawEnum = {}) {
  return {
    key: clean(rawEnum.key),
    label: clean(rawEnum.label),
    semanticId: clean(rawEnum.semanticId),
    definition: clean(rawEnum.definition),
    values: (Array.isArray(rawEnum.values) ? rawEnum.values : []).map((value) => ({
      key: clean(value?.key),
      label: clean(value?.label),
      semanticId: clean(value?.semanticId),
      definition: clean(value?.definition),
    })),
  };
}

function normalizeProperty(rawProperty = {}, domainClass = null) {
  const rangeKind = clean(rawProperty.rangeKind || "scalar").toLowerCase();
  const dataType = rangeKind === "scalar" ? clean(rawProperty.dataType || "string").toLowerCase() : null;
  const minCount = normalizeCount(rawProperty.minCount, 0);
  const maxCount = normalizeCount(rawProperty.maxCount, null);
  const relationshipType = rangeKind === "class"
    ? clean(rawProperty.relationshipType || "composition").toLowerCase()
    : null;
  return {
    key: clean(rawProperty.key),
    label: clean(rawProperty.label),
    semanticId: clean(rawProperty.semanticId),
    definition: clean(rawProperty.definition),
    domainClassKey: clean(rawProperty.domainClassKey || domainClass?.key),
    domainClassIri: clean(rawProperty.domainClassIri || domainClass?.semanticId),
    rangeKind,
    dataType,
    rangeClassKey: rangeKind === "class" ? clean(rawProperty.rangeClassKey) : null,
    rangeEnumKey: rangeKind === "enum" ? clean(rawProperty.rangeEnumKey) : null,
    rangeIri: clean(rawProperty.rangeIri) || (
      rangeKind === "scalar" ? semanticGraphScalarRangeIris[dataType] || null : null
    ),
    relationshipType,
    minCount,
    maxCount,
    unit: clean(rawProperty.unit),
    uiType: clean(rawProperty.uiType),
  };
}

function normalizeClass(rawClass = {}) {
  const normalized = {
    key: clean(rawClass.key),
    label: clean(rawClass.label),
    semanticId: clean(rawClass.semanticId),
    definition: clean(rawClass.definition),
    root: rawClass.root === true,
    properties: [],
  };
  normalized.properties = (Array.isArray(rawClass.properties) ? rawClass.properties : [])
    .map((property) => normalizeProperty(property, normalized));
  return normalized;
}

function graphError(message, path = null) {
  const error = new Error(path ? `${path}: ${message}` : message);
  error.code = "semanticGraphInvalid";
  error.path = path;
  return error;
}

function validateUniqueRecords(records, typeLabel) {
  const keys = new Set();
  const iris = new Set();
  for (const record of records) {
    if (!isCanonicalKey(record.key)) {
      throw graphError(`${typeLabel} key must be lower camelCase letters and numbers.`, record.key || typeLabel);
    }
    if (!record.label) throw graphError(`${typeLabel} label is required.`, record.key);
    if (!isAbsoluteIri(record.semanticId)) {
      throw graphError(`${typeLabel} semanticId must be an absolute IRI.`, record.key);
    }
    if (canonicalKeyFromSemanticId(record.semanticId) !== record.key) {
      throw graphError(
        `${typeLabel} key must match the canonical lower-camel key derived from its semanticId.`,
        record.key
      );
    }
    if (keys.has(record.key)) throw graphError(`Duplicate ${typeLabel.toLowerCase()} key "${record.key}".`, record.key);
    if (iris.has(record.semanticId)) {
      throw graphError(`Duplicate ${typeLabel.toLowerCase()} semanticId "${record.semanticId}".`, record.key);
    }
    keys.add(record.key);
    iris.add(record.semanticId);
  }
}

function assertNoCompositionCycles(classesByKey) {
  const visiting = new Set();
  const visited = new Set();

  function visit(classKey, path = []) {
    if (visiting.has(classKey)) {
      throw graphError(`Composition cycle detected: ${[...path, classKey].join(" -> ")}. Use a reference relationship for cycles.`);
    }
    if (visited.has(classKey)) return;
    visiting.add(classKey);
    const classDef = classesByKey.get(classKey);
    for (const property of classDef?.properties || []) {
      if (property.rangeKind === "class" && property.relationshipType === "composition") {
        visit(property.rangeClassKey, [...path, classKey]);
      }
    }
    visiting.delete(classKey);
    visited.add(classKey);
  }

  for (const classKey of classesByKey.keys()) visit(classKey);

  const depthByClass = new Map();
  function getCompositionDepth(classKey) {
    if (depthByClass.has(classKey)) return depthByClass.get(classKey);
    const childDepths = (classesByKey.get(classKey)?.properties || [])
      .filter((property) => property.rangeKind === "class" && property.relationshipType === "composition")
      .map((property) => getCompositionDepth(property.rangeClassKey));
    const depth = 1 + (childDepths.length ? Math.max(...childDepths) : 0);
    depthByClass.set(classKey, depth);
    return depth;
  }
  for (const classKey of classesByKey.keys()) {
    if (getCompositionDepth(classKey) > semanticGraphLimits.compositionDepth) {
      throw graphError(
        `Composition depth exceeds ${semanticGraphLimits.compositionDepth} classes. Use references to break deep chains.`
      );
    }
  }
}

function normalizeAndValidateSemanticGraph(rawGraph, { required = false } = {}) {
  if (!rawGraph || (isPlainObject(rawGraph) && Object.keys(rawGraph).length === 0)) {
    if (required) throw graphError("semanticGraph is required.");
    return null;
  }
  if (!isPlainObject(rawGraph)) throw graphError("semanticGraph must be an object.");

  const classes = (Array.isArray(rawGraph.classes) ? rawGraph.classes : []).map(normalizeClass);
  const enums = (Array.isArray(rawGraph.enums) ? rawGraph.enums : []).map(normalizeEnum);
  const rootClassKey = clean(rawGraph.rootClassKey);
  if (!classes.length) throw graphError("semanticGraph must define at least one class.");
  if (classes.length > semanticGraphLimits.classes) {
    throw graphError(`semanticGraph supports at most ${semanticGraphLimits.classes} classes.`);
  }
  if (enums.length > semanticGraphLimits.enums) {
    throw graphError(`semanticGraph supports at most ${semanticGraphLimits.enums} enums.`);
  }
  validateUniqueRecords(classes, "Class");
  validateUniqueRecords(enums, "Enum");

  const classesByKey = new Map(classes.map((classDef) => [classDef.key, classDef]));
  const enumsByKey = new Map(enums.map((enumDef) => [enumDef.key, enumDef]));
  if (!classesByKey.has(rootClassKey)) {
    throw graphError(`Root class "${rootClassKey || "missing"}" is not defined.`, "rootClassKey");
  }

  for (const enumDef of enums) {
    if (!enumDef.values.length) throw graphError("Enum must define at least one value.", enumDef.key);
    if (enumDef.values.length > semanticGraphLimits.valuesPerEnum) {
      throw graphError(`Enum supports at most ${semanticGraphLimits.valuesPerEnum} values.`, enumDef.key);
    }
    const valueKeys = new Set();
    const valueIris = new Set();
    for (const value of enumDef.values) {
      if (!isCanonicalKey(value.key)) throw graphError("Enum value key must be lower camelCase.", `${enumDef.key}.${value.key || "value"}`);
      if (!value.label) throw graphError("Enum value label is required.", `${enumDef.key}.${value.key}`);
      if (!isAbsoluteIri(value.semanticId)) throw graphError("Enum value semanticId must be an absolute IRI.", `${enumDef.key}.${value.key}`);
      if (canonicalKeyFromSemanticId(value.semanticId) !== value.key) {
        throw graphError("Enum value key must match its semanticId.", `${enumDef.key}.${value.key}`);
      }
      if (valueKeys.has(value.key)) throw graphError(`Duplicate enum value key "${value.key}".`, enumDef.key);
      if (valueIris.has(value.semanticId)) throw graphError(`Duplicate enum value semanticId "${value.semanticId}".`, enumDef.key);
      valueKeys.add(value.key);
      valueIris.add(value.semanticId);
    }
  }

  const propertyIris = new Set();
  let totalProperties = 0;
  for (const classDef of classes) {
    if (classDef.properties.length > semanticGraphLimits.propertiesPerClass) {
      throw graphError(
        `Class supports at most ${semanticGraphLimits.propertiesPerClass} properties.`,
        classDef.key
      );
    }
    totalProperties += classDef.properties.length;
    if (totalProperties > semanticGraphLimits.totalProperties) {
      throw graphError(`semanticGraph supports at most ${semanticGraphLimits.totalProperties} properties.`);
    }
    const propertyKeys = new Set();
    for (const property of classDef.properties) {
      const path = `${classDef.key}.${property.key || "property"}`;
      if (!isCanonicalKey(property.key)) throw graphError("Property key must be lower camelCase.", path);
      if (!property.label) throw graphError("Property label is required.", path);
      if (!isAbsoluteIri(property.semanticId)) throw graphError("Property semanticId must be an absolute IRI.", path);
      if (canonicalKeyFromSemanticId(property.semanticId) !== property.key) {
        throw graphError("Property key must match its semanticId.", path);
      }
      if (property.domainClassKey !== classDef.key || property.domainClassIri !== classDef.semanticId) {
        throw graphError("Property domain must match its owning class.", path);
      }
      if (propertyKeys.has(property.key)) throw graphError(`Duplicate property key "${property.key}".`, classDef.key);
      if (propertyIris.has(property.semanticId)) throw graphError(`Duplicate property semanticId "${property.semanticId}".`, path);
      propertyKeys.add(property.key);
      propertyIris.add(property.semanticId);
      if (!rangeKindSet.has(property.rangeKind)) throw graphError(`Unsupported rangeKind "${property.rangeKind}".`, path);
      if (!Number.isInteger(property.minCount) || property.minCount < 0) throw graphError("minCount must be a non-negative integer.", path);
      if (property.maxCount !== null && (!Number.isInteger(property.maxCount) || property.maxCount < property.minCount)) {
        throw graphError("maxCount must be null (unbounded) or an integer greater than or equal to minCount.", path);
      }
      if (property.rangeKind === "scalar") {
        if (!scalarDataTypeSet.has(property.dataType)) throw graphError(`Unsupported scalar dataType "${property.dataType}".`, path);
        const expectedRangeIri = semanticGraphScalarRangeIris[property.dataType];
        if (property.rangeIri !== expectedRangeIri) {
          throw graphError(`Scalar dataType "${property.dataType}" requires rangeIri "${expectedRangeIri}".`, path);
        }
      } else if (property.rangeKind === "class") {
        const rangeClass = classesByKey.get(property.rangeClassKey);
        if (!rangeClass) throw graphError(`Unknown range class "${property.rangeClassKey}".`, path);
        if (!relationshipTypeSet.has(property.relationshipType)) {
          throw graphError(`Unsupported relationshipType "${property.relationshipType}".`, path);
        }
        property.rangeIri = rangeClass.semanticId;
      } else {
        const rangeEnum = enumsByKey.get(property.rangeEnumKey);
        if (!rangeEnum) throw graphError(`Unknown range enum "${property.rangeEnumKey}".`, path);
        property.rangeIri = rangeEnum.semanticId;
      }
    }
  }

  assertNoCompositionCycles(classesByKey);
  const rootClass = classesByKey.get(rootClassKey);
  classes.forEach((classDef) => {
    classDef.root = classDef.key === rootClassKey;
  });

  return {
    schemaVersion: 1,
    rootClassKey,
    rootClassIri: rootClass.semanticId,
    classes,
    enums,
  };
}

function getSemanticGraphClass(graph, classKey) {
  return graph?.classes?.find((classDef) => classDef.key === classKey) || null;
}

function getSemanticGraphEnum(graph, enumKey) {
  return graph?.enums?.find((enumDef) => enumDef.key === enumKey) || null;
}

function isManyProperty(property) {
  return property?.maxCount === null || Number(property?.maxCount) > 1;
}

function runtimeFieldFromSemanticProperty(property, graph) {
  if (!property) return null;
  if (property.rangeKind === "scalar") {
    if (isManyProperty(property)) {
      return {
        ...property,
        type: "scalarList",
        dataType: "array",
        itemDataType: property.dataType,
        objectType: "MultiValuedDataElement",
        valueDataType: "Array",
        required: property.minCount > 0,
        structured: true,
        storageType: "jsonb",
      };
    }
    const typeByDataType = {
      boolean: "boolean",
      date: "date",
      datetime: "datetime",
      uri: "url",
    };
    return {
      ...property,
      type: property.uiType || typeByDataType[property.dataType] || "text",
      dataType: property.dataType,
      objectType: "SingleValuedDataElement",
      valueDataType: {
        string: "String",
        decimal: "Decimal",
        integer: "Integer",
        boolean: "Boolean",
        date: "Date",
        datetime: "DateTime",
        uri: "URI",
      }[property.dataType],
      required: property.minCount > 0,
    };
  }
  if (property.rangeKind === "enum") {
    const enumDef = getSemanticGraphEnum(graph, property.rangeEnumKey);
    const many = isManyProperty(property);
    return {
      ...property,
      type: many ? "multiselect" : "select",
      dataType: many ? "array" : "string",
      objectType: many ? "MultiValuedDataElement" : "SingleValuedDataElement",
      valueDataType: many ? "Array" : "String",
      required: property.minCount > 0,
      allowedValues: (enumDef?.values || []).map((value) => value.key),
      enumValues: enumDef?.values || [],
      ...(many ? { structured: true, storageType: "jsonb" } : {}),
    };
  }
  return {
    ...property,
    type: isManyProperty(property) ? "objectList" : "object",
    dataType: isManyProperty(property) ? "array" : "object",
    objectType: "DataElementCollection",
    valueDataType: isManyProperty(property) ? "Array" : "Object",
    required: property.minCount > 0,
    structured: true,
    storageType: "jsonb",
  };
}

module.exports = {
  getSemanticGraphClass,
  getSemanticGraphEnum,
  isManyProperty,
  normalizeAndValidateSemanticGraph,
  runtimeFieldFromSemanticProperty,
  semanticGraphRangeKinds,
  semanticGraphRelationshipTypes,
  semanticGraphScalarDataTypes,
  semanticGraphScalarRangeIris,
  semanticGraphLimits,
};
