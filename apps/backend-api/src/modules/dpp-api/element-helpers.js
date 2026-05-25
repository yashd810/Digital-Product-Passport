"use strict";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSimpleIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
}

function encodeElementPath(segments) {
  return segments.map((segment, index) => {
    if (segment.type === "index") return `[${segment.value}]`;
    if (index === 0 && isSimpleIdentifier(segment.value)) return segment.value;
    if (isSimpleIdentifier(segment.value)) return `.${segment.value}`;
    const escaped = String(segment.value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `['${escaped}']`;
  }).join("");
}

function normalizeStructuredElementValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function cloneStructuredElementValue(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function normalizeSupportedElementIdPath(elementIdPath) {
  const raw = String(elementIdPath || "").trim();
  if (!raw) {
    return { error: "elementIdPath is required" };
  }
  if (raw.includes("*") || raw.includes("?") || raw.includes("..") || raw.includes("[?") || raw.includes(",")) {
    return {
      error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
    };
  }

  let expression = raw;
  if (expression.startsWith("$")) {
    expression = expression.slice(1);
    if (expression.startsWith(".")) expression = expression.slice(1);
  }

  const segments = [];
  let index = 0;
  while (index < expression.length) {
    const current = expression[index];
    if (current === ".") {
      index += 1;
      continue;
    }
    if (current === "[") {
      const next = expression[index + 1];
      if (next === "'" || next === "\"") {
        const quote = next;
        index += 2;
        let value = "";
        let closed = false;
        while (index < expression.length) {
          const ch = expression[index];
          if (ch === "\\") {
            index += 1;
            if (index < expression.length) value += expression[index];
            index += 1;
            continue;
          }
          if (ch === quote) {
            if (expression[index + 1] !== "]") {
              return {
                error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
              };
            }
            index += 2;
            closed = true;
            break;
          }
          value += ch;
          index += 1;
        }
        if (!closed) {
          return {
            error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
          };
        }
        segments.push({ type: "key", value });
        continue;
      }

      const remainder = expression.slice(index);
      const indexMatch = remainder.match(/^\[(\d+)\]/);
      if (!indexMatch) {
        return {
          error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
        };
      }
      segments.push({ type: "index", value: Number.parseInt(indexMatch[1], 10) });
      index += indexMatch[0].length;
      continue;
    }

    const remainder = expression.slice(index);
    const keyMatch = remainder.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!keyMatch) {
      return {
        error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
      };
    }
    segments.push({ type: "key", value: keyMatch[0] });
    index += keyMatch[0].length;
  }

  if (!segments.length) {
    return { error: "elementIdPath is required" };
  }
  if (segments[0]?.type === "key" && segments[0].value === "fields") {
    segments.shift();
  }
  if (!segments.length || segments[0]?.type !== "key") {
    return {
      error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
    };
  }

  return {
    path: encodeElementPath(segments),
    segments,
    rootElementIdPath: segments[0].value,
    childSegments: segments.slice(1),
    leafElementId: segments[segments.length - 1]?.value,
  };
}

function extractCanonicalElementValue(payload, elementIdPath) {
  if (!payload || !elementIdPath) return undefined;
  if (payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, elementIdPath)) {
    return payload.fields[elementIdPath];
  }
  if (Object.prototype.hasOwnProperty.call(payload, elementIdPath)) {
    return payload[elementIdPath];
  }
  return undefined;
}

function readValueAtStructuredPath(value, segments) {
  let current = normalizeStructuredElementValue(value);
  for (const segment of segments || []) {
    current = normalizeStructuredElementValue(current);
    if (segment.type === "index") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.value];
      continue;
    }
    if (!isPlainObject(current)) return undefined;
    current = current[segment.value];
  }
  return normalizeStructuredElementValue(current);
}

function extractElementValue(payload, normalizedPath) {
  if (!payload || !normalizedPath?.rootElementIdPath) return undefined;
  const rootValue = extractCanonicalElementValue(payload, normalizedPath.rootElementIdPath);
  if (!normalizedPath.childSegments?.length) {
    return normalizeStructuredElementValue(rootValue);
  }
  return readValueAtStructuredPath(rootValue, normalizedPath.childSegments);
}

function setStructuredElementValue(rootValue, childSegments, nextValue) {
  if (!childSegments?.length) {
    return { value: nextValue };
  }

  const firstContainer = childSegments[0]?.type === "index" ? [] : {};
  let working = normalizeStructuredElementValue(rootValue);
  if (working === undefined || working === null || working === "") {
    working = firstContainer;
  }
  if (!Array.isArray(working) && !isPlainObject(working)) {
    return {
      error: "This element path does not point to a structured data element"
    };
  }

  working = cloneStructuredElementValue(working);
  let current = working;

  for (let index = 0; index < childSegments.length; index += 1) {
    const segment = childSegments[index];
    const isLast = index === childSegments.length - 1;
    const nextSegment = childSegments[index + 1] || null;

    if (segment.type === "index") {
      if (!Array.isArray(current)) {
        return {
          error: "This element path does not point to a structured data element"
        };
      }
      if (isLast) {
        current[segment.value] = nextValue;
        break;
      }

      let branch = normalizeStructuredElementValue(current[segment.value]);
      if (branch === undefined || branch === null || branch === "") {
        branch = nextSegment?.type === "index" ? [] : {};
      }
      if (!Array.isArray(branch) && !isPlainObject(branch)) {
        return {
          error: "This element path does not point to a structured data element"
        };
      }
      current[segment.value] = cloneStructuredElementValue(branch);
      current = current[segment.value];
      continue;
    }

    if (!isPlainObject(current)) {
      return {
        error: "This element path does not point to a structured data element"
      };
    }
    if (isLast) {
      current[segment.value] = nextValue;
      break;
    }

    let branch = normalizeStructuredElementValue(current[segment.value]);
    if (branch === undefined || branch === null || branch === "") {
      branch = nextSegment?.type === "index" ? [] : {};
    }
    if (!Array.isArray(branch) && !isPlainObject(branch)) {
      return {
        error: "This element path does not point to a structured data element"
      };
    }
    current[segment.value] = cloneStructuredElementValue(branch);
    current = current[segment.value];
  }

  return { value: working };
}

function getSchemaFieldDefinitions(typeDef) {
  return (typeDef?.fieldsJson?.sections || [])
    .flatMap((section) => section.fields || [])
    .filter((field) => field?.key);
}

function findSchemaFieldDefinition(typeDef, elementIdPath) {
  const normalizedPath = normalizeSupportedElementIdPath(elementIdPath);
  const exactPath = normalizedPath.error ? String(elementIdPath || "").trim() : normalizedPath.path;
  const rootPath = normalizedPath.error ? String(elementIdPath || "").trim() : normalizedPath.rootElementIdPath;

  return getSchemaFieldDefinitions(typeDef).find((field) =>
    field.key === exactPath ||
    field.semanticId === exactPath ||
    field.elementId === exactPath ||
    field.key === rootPath ||
    field.semanticId === rootPath ||
    field.elementId === rootPath ||
    (
      rootPath &&
      (
        field.key === rootPath ||
        field.semanticId === rootPath ||
        field.elementId === rootPath
      )
    )) || null;
}

function createElementHelpers({
  buildExpandedDataElement,
  dppIdentity,
  productIdentifierService,
}) {
  function buildElementEnvelope(passport, typeDef, normalizedPath, value) {
    const elementIdPath = normalizedPath?.path || String(normalizedPath || "");
    const fieldDef = normalizedPath?.childSegments?.length ? null : findSchemaFieldDefinition(typeDef, elementIdPath);
    const granularity = String(passport?.granularity || "item").trim().toLowerCase() || "item";
    const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}) || "";
    const derivedProductIdentifier = businessIdentifier ?
      productIdentifierService?.buildCanonicalProductDid?.({
        companyId: passport.companyId,
        passportType: passport.passportType || typeDef?.typeName || "battery",
        rawProductId: businessIdentifier,
        granularity
      }) || null :
      null;
    let dppId = null;
    try {
      if (passport?.companyId && passport?.internalAliasId) {
        dppId = dppIdentity.dppDid(granularity, passport.companyId, passport.internalAliasId);
      }
    } catch {}

    return {
      productIdentifier: passport?.productIdentifierDid || derivedProductIdentifier || null,
      internalAliasId: passport?.internalAliasId || null,
      dppId,
      elementIdPath,
      ...buildExpandedDataElement({
        typeDef,
        elementIdPath: fieldDef ? elementIdPath : normalizedPath?.leafElementId || elementIdPath,
        value,
        fieldDef
      })
    };
  }

  function parseElementUpdatePayload({ body, normalizedPath, typeDef }) {
    const payload = body && typeof body === "object" ? body : {};
    if (!Object.prototype.hasOwnProperty.call(payload, "value")) {
      return { error: "value is required" };
    }

    const elementIdPath = normalizedPath?.path || "";
    const fieldDef = findSchemaFieldDefinition(typeDef, elementIdPath);
    const allowedElementIds = new Set(
      [
        fieldDef?.elementId,
        fieldDef?.key,
        elementIdPath,
        normalizedPath?.leafElementId,
        normalizedPath?.rootElementIdPath,
      ]
        .filter(Boolean)
        .map((value) => String(value))
    );
    if (
      payload.elementId !== undefined &&
      payload.elementId !== null &&
      !allowedElementIds.has(String(payload.elementId))
    ) {
      return { error: "elementId does not match the target elementIdPath" };
    }

    const expectedDictionaryReference = fieldDef?.semanticId || null;
    if (
      payload.dictionaryReference !== undefined &&
      payload.dictionaryReference !== null &&
      expectedDictionaryReference &&
      !normalizedPath?.childSegments?.length &&
      String(payload.dictionaryReference) !== String(expectedDictionaryReference)
    ) {
      return { error: "dictionaryReference does not match the target elementIdPath" };
    }

    return { value: payload.value };
  }

  return {
    normalizeSupportedElementIdPath,
    extractElementValue,
    setStructuredElementValue,
    getSchemaFieldDefinitions,
    findSchemaFieldDefinition,
    buildElementEnvelope,
    parseElementUpdatePayload,
  };
}

module.exports = {
  createElementHelpers,
};
