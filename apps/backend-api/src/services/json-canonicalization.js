"use strict";

function normalizeJsonValue(value) {
  if (value && typeof value.toJSON === "function") {
    return value.toJSON();
  }
  return value;
}

function canonicalizeJson(value) {
  const normalized = normalizeJsonValue(value);

  if (normalized === null) return "null";

  const valueType = typeof normalized;
  if (valueType === "string" || valueType === "boolean") {
    return JSON.stringify(normalized);
  }
  if (valueType === "number") {
    if (!Number.isFinite(normalized)) {
      throw new TypeError("Canonical JSON only supports finite numeric values");
    }
    return JSON.stringify(normalized);
  }
  if (Array.isArray(normalized)) {
    return `[${normalized.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (valueType === "object") {
    const keys = Object.keys(normalized).sort();
    const entries = [];
    for (const key of keys) {
      const entryValue = normalizeJsonValue(normalized[key]);
      if (entryValue === undefined) continue;
      entries.push(`${JSON.stringify(key)}:${canonicalizeJson(entryValue)}`);
    }
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported JSON value type "${valueType}"`);
}

module.exports = canonicalizeJson;
