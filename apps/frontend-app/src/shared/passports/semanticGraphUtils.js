import { isSafeIdentifierUri } from "../security/urlSafety";

export function isSafeSemanticIri(value) {
  return isSafeIdentifierUri(value);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSemanticGraphValue(value, fallback = null) {
  if (typeof value !== "string") return value ?? fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function getSemanticGraphClass(graph, classKey) {
  return graph?.classes?.find((classDef) => classDef.key === classKey) || null;
}

export function getSemanticGraphEnum(graph, enumKey) {
  return graph?.enums?.find((enumDef) => enumDef.key === enumKey) || null;
}

export function getRootSemanticProperty(graph, propertyKey) {
  return getSemanticGraphClass(graph, graph?.rootClassKey)
    ?.properties?.find((property) => property.key === propertyKey) || null;
}

export function isManySemanticProperty(property) {
  return property?.maxCount === null || Number(property?.maxCount) > 1;
}

export function semanticPropertyCardinality(property) {
  const minimum = Number.isInteger(property?.minCount) ? property.minCount : 0;
  const maximum = property?.maxCount === null ? "n" : (Number.isInteger(property?.maxCount) ? property.maxCount : 1);
  return `${minimum}..${maximum}`;
}

export function createEmptySemanticClassValue(graph, classKey) {
  const classDef = getSemanticGraphClass(graph, classKey);
  if (!classDef) return {};
  return Object.fromEntries(
    (classDef.properties || [])
      .filter((property) => property.minCount > 0)
      .map((property) => {
        if (isManySemanticProperty(property)) return [property.key, []];
        if (property.rangeKind === "class" && property.relationshipType === "composition") {
          return [property.key, createEmptySemanticClassValue(graph, property.rangeClassKey)];
        }
        if (property.rangeKind === "scalar" && property.dataType === "boolean") return [property.key, false];
        return [property.key, ""];
      })
  );
}

function coerceScalar(value, dataType, path) {
  if (dataType === "decimal") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number.parseFloat(value);
    throw new Error(`Expected decimal for ${path}`);
  }
  if (dataType === "integer") {
    if (Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
    throw new Error(`Expected integer for ${path}`);
  }
  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
    throw new Error(`Expected boolean for ${path}`);
  }
  if (dataType === "date") {
    const text = String(value).trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text;
    throw new Error(`Expected date for ${path}`);
  }
  if (dataType === "datetime") {
    const text = value instanceof Date ? value.toISOString() : String(value).trim();
    const parsed = new Date(text);
    const dateText = text.slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : null;
    if (
      !Number.isNaN(parsed.getTime())
      && date
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === dateText
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    ) {
      return parsed.toISOString();
    }
    throw new Error(`Expected date-time for ${path}`);
  }
  if (dataType === "uri") {
    const text = String(value).trim();
    if (isSafeSemanticIri(text)) return text;
    throw new Error(`Expected URI for ${path}`);
  }
  if (dataType === "string") {
    if (Array.isArray(value) || isPlainObject(value)) throw new Error(`Expected string for ${path}`);
    return String(value);
  }
  throw new Error(`Unsupported scalar dataType "${dataType || "missing"}" for ${path}`);
}

export function coerceSemanticGraphPropertyValue(property, rawValue, graph, path = property?.key || "field") {
  const many = isManySemanticProperty(property);
  let value = rawValue;
  if (rawValue === "" && many) {
    value = [];
  } else if (
    rawValue !== ""
    && (many || (property?.rangeKind === "class" && property?.relationshipType === "composition"))
  ) {
    value = parseSemanticGraphValue(rawValue, rawValue);
  }
  if (many && !Array.isArray(value)) throw new Error(`Expected array for ${path}`);

  const values = many ? value : [value];
  const count = many ? value.length : (value === null || value === undefined || value === "" ? 0 : 1);
  if (count < property.minCount) throw new Error(`${path} requires at least ${property.minCount} value(s)`);
  if (property.maxCount !== null && count > property.maxCount) {
    throw new Error(`${path} allows at most ${property.maxCount} value(s)`);
  }
  if (count === 0) return many ? [] : value;

  const coerceOne = (entryValue, index) => {
    const entryPath = many ? `${path}[${index}]` : path;
    if (property.rangeKind === "scalar") return coerceScalar(entryValue, property.dataType, entryPath);

    if (property.rangeKind === "enum") {
      const enumDef = getSemanticGraphEnum(graph, property.rangeEnumKey);
      const allowed = new Set((enumDef?.values || []).map((entry) => entry.key));
      const normalized = String(entryValue ?? "").trim();
      if (!allowed.has(normalized)) throw new Error(`${entryPath} must be one of: ${[...allowed].join(", ")}`);
      return normalized;
    }

    if (property.relationshipType === "reference") {
      const iri = String(isPlainObject(entryValue) ? entryValue["@id"] : entryValue || "").trim();
      if (!isSafeSemanticIri(iri)) throw new Error(`${entryPath} must be an absolute IRI reference`);
      return { "@id": iri };
    }

    if (!isPlainObject(entryValue)) throw new Error(`${entryPath} must be an object`);
    const classDef = getSemanticGraphClass(graph, property.rangeClassKey);
    if (!classDef) throw new Error(`${entryPath} references an unknown semantic class`);
    const propertyByKey = new Map((classDef.properties || []).map((entry) => [entry.key, entry]));
    const unknownKeys = Object.keys(entryValue).filter((key) => !propertyByKey.has(key) && !["@id", "@type"].includes(key));
    if (unknownKeys.length) throw new Error(`${entryPath} contains unknown property(s): ${unknownKeys.join(", ")}`);

    const typedObject = {};
    if (entryValue["@id"] !== undefined) {
      const iri = String(entryValue["@id"] || "").trim();
      if (!isSafeSemanticIri(iri)) throw new Error(`${entryPath}.@id must be an absolute IRI`);
      typedObject["@id"] = iri;
    }
    for (const childProperty of classDef.properties || []) {
      if (!Object.prototype.hasOwnProperty.call(entryValue, childProperty.key)) {
        if (childProperty.minCount > 0) {
          throw new Error(`${entryPath}.${childProperty.key} requires at least ${childProperty.minCount} value(s)`);
        }
        continue;
      }
      typedObject[childProperty.key] = coerceSemanticGraphPropertyValue(
        childProperty,
        entryValue[childProperty.key],
        graph,
        `${entryPath}.${childProperty.key}`
      );
    }
    return typedObject;
  };

  const typedValues = values.map(coerceOne);
  return many ? typedValues : typedValues[0];
}

export function decorateSemanticGraphPropertyValue(property, value, graph) {
  if (value === null || value === undefined || value === "") return value;
  const many = isManySemanticProperty(property);
  const entries = many ? (Array.isArray(value) ? value : []) : [value];

  const decorateOne = (entry) => {
    if (property.rangeKind === "scalar") return entry;
    if (property.rangeKind === "enum") {
      const enumValue = getSemanticGraphEnum(graph, property.rangeEnumKey)
        ?.values?.find((candidate) => candidate.key === entry);
      return enumValue?.semanticId ? { "@id": enumValue.semanticId } : entry;
    }
    if (property.relationshipType === "reference") {
      return isPlainObject(entry) ? entry : { "@id": entry };
    }
    const classDef = getSemanticGraphClass(graph, property.rangeClassKey);
    if (!classDef || !isPlainObject(entry)) return entry;
    const decorated = {
      ...(entry["@id"] ? { "@id": entry["@id"] } : {}),
      ...(classDef.semanticId ? { "@type": classDef.semanticId } : {}),
    };
    for (const childProperty of classDef.properties || []) {
      if (!Object.prototype.hasOwnProperty.call(entry, childProperty.key)) continue;
      decorated[childProperty.key] = decorateSemanticGraphPropertyValue(
        childProperty,
        entry[childProperty.key],
        graph
      );
    }
    return decorated;
  };

  const decorated = entries.map(decorateOne);
  return many ? decorated : decorated[0];
}

export function buildSemanticGraphInlineContext(graph) {
  if (!graph) return {};
  const buildClassContext = (classKey, visited = new Set()) => {
    if (visited.has(classKey)) return {};
    const classDef = getSemanticGraphClass(graph, classKey);
    if (!classDef) return {};
    const nextVisited = new Set(visited).add(classKey);
    return Object.fromEntries((classDef.properties || []).map((property) => {
      const term = { "@id": property.semanticId };
      if (isManySemanticProperty(property)) term["@container"] = "@set";
      if (property.rangeKind === "scalar") {
        const scalarTypes = {
          decimal: "http://www.w3.org/2001/XMLSchema#decimal",
          integer: "http://www.w3.org/2001/XMLSchema#integer",
          boolean: "http://www.w3.org/2001/XMLSchema#boolean",
          date: "http://www.w3.org/2001/XMLSchema#date",
          datetime: "http://www.w3.org/2001/XMLSchema#dateTime",
          uri: "@id",
        };
        if (scalarTypes[property.dataType]) term["@type"] = scalarTypes[property.dataType];
      } else if (property.rangeKind === "enum" || property.relationshipType === "reference") {
        term["@type"] = "@id";
      } else {
        const nestedContext = buildClassContext(property.rangeClassKey, nextVisited);
        if (Object.keys(nestedContext).length) term["@context"] = nestedContext;
      }
      return [property.key, term];
    }));
  };
  return buildClassContext(graph.rootClassKey);
}
