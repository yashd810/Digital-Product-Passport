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
      aliases: [
        field.key,
        field.elementId,
        field.semanticId,
      ]
        .filter((alias) => typeof alias === "string")
        .map((alias) => alias.trim())
        .filter(Boolean),
    }));
}

export function buildSchemaFieldAliasMap(sections) {
  const aliasToKey = new Map();
  for (const field of getSchemaFieldDescriptors(sections)) {
    for (const alias of field.aliases) {
      aliasToKey.set(alias, field.key);
    }
  }
  return aliasToKey;
}

export function alignRecordToSchemaKeys(record, sections) {
  if (!record || typeof record !== "object") return record || {};
  const aligned = { ...record };
  const aliasToKey = buildSchemaFieldAliasMap(sections);

  for (const [rawKey, value] of Object.entries(record)) {
    const canonicalKey = aliasToKey.get(String(rawKey).trim());
    if (canonicalKey && aligned[canonicalKey] === undefined) {
      aligned[canonicalKey] = value;
    }
  }

  return aligned;
}

export function canonicalizeRecordToSchemaKeys(record, sections) {
  if (!record || typeof record !== "object") return {};
  const aliasToKey = buildSchemaFieldAliasMap(sections);
  const canonical = {};

  for (const [rawKey, value] of Object.entries(record)) {
    const canonicalKey = aliasToKey.get(String(rawKey).trim()) || rawKey;
    if (canonical[canonicalKey] === undefined) {
      canonical[canonicalKey] = value;
    }
  }

  return canonical;
}

export function extractFieldValuesFromElements(elements, aliasToKey = new Map(), values = {}) {
  if (!Array.isArray(elements)) return values;
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const candidateAliases = [
      element.elementId,
      element.dictionaryReference,
    ]
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const canonicalKey = candidateAliases
      .map((alias) => aliasToKey.get(alias))
      .find(Boolean);
    const rawElementId = typeof element.elementId === "string" ? element.elementId.trim() : "";
    const targetKey = canonicalKey || rawElementId;

    if (Array.isArray(element.elements) && element.elements.length) {
      extractFieldValuesFromElements(element.elements, aliasToKey, values);
    }

    if (!targetKey) continue;
    if (element.value !== undefined) {
      values[targetKey] = element.value;
    }
  }
  return values;
}
