function getSectionList(sections) {
  if (Array.isArray(sections)) return sections;
  if (!sections || typeof sections !== "object") return [];
  return Object.values(sections);
}

export function getSchemaFieldDescriptors(sections) {
  return getSectionList(sections)
    .flatMap((section) => Array.isArray(section?.fields) ? section.fields : [])
    .filter((field) => field?.key)
    .map((field) => ({
      key: field.key,
    }));
}

export function buildSchemaFieldKeyMap(sections) {
  const keyMap = new Map();
  for (const field of getSchemaFieldDescriptors(sections)) {
    keyMap.set(field.key, field.key);
  }
  return keyMap;
}

export function alignRecordToSchemaKeys(record, sections) {
  if (!record || typeof record !== "object") return record || {};
  const aligned = { ...record };
  const keyMap = buildSchemaFieldKeyMap(sections);

  for (const [rawKey, value] of Object.entries(record)) {
    const canonicalKey = keyMap.get(String(rawKey).trim());
    if (canonicalKey && aligned[canonicalKey] === undefined) {
      aligned[canonicalKey] = value;
    }
  }

  return aligned;
}

export function canonicalizeRecordToSchemaKeys(record, sections) {
  if (!record || typeof record !== "object") return {};
  const keyMap = buildSchemaFieldKeyMap(sections);
  const canonical = {};

  for (const [rawKey, value] of Object.entries(record)) {
    const canonicalKey = keyMap.get(String(rawKey).trim()) || rawKey;
    if (canonical[canonicalKey] === undefined) {
      canonical[canonicalKey] = value;
    }
  }

  return canonical;
}

export function extractFieldValuesFromElements(elements, keyMap = new Map(), values = {}) {
  if (!Array.isArray(elements)) return values;
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const rawElementId = typeof element.elementId === "string" ? element.elementId.trim() : "";
    const targetKey = keyMap.get(rawElementId) || "";

    if (Array.isArray(element.elements) && element.elements.length) {
      extractFieldValuesFromElements(element.elements, keyMap, values);
    }

    if (!targetKey) continue;
    if (element.value !== undefined) {
      values[targetKey] = element.value;
    }
  }
  return values;
}
