"use strict";

const crypto = require("node:crypto");
const {
  flattenSchemaFieldsFromSections,
} = require("../shared/passports/passport-helpers");
const {
  normalizeSystemPassportHeader,
  validateSystemPassportHeader,
} = require("./passport-header-fields");
const {
  normalizeAndValidateSemanticGraph,
} = require("../shared/passports/passport-semantic-graph");

const profileContractVersion = 1;
const allowedConfidentiality = new Set(["public", "restricted"]);
const numericChartDataTypes = new Set(["decimal", "integer"]);
const fieldPresentationOverrideKeys = Object.freeze([
  "labelI18n",
  "displayRole",
  "summaryRole",
  "lifecycleRole",
  "presentation",
  "composition",
  "compositionLabelColumnKey",
  "compositionValueColumnKey",
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableDigest(value) {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
  return `sha256:${digest}`;
}

function valuesEqual(left, right) {
  return JSON.stringify(stableValue(left ?? null)) === JSON.stringify(stableValue(right ?? null));
}

function profileError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === "passportTypeProfileModuleChanged" ? 409 : 400;
  error.issues = [{ code, message, ...details }];
  return error;
}

function own(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function clean(value) {
  return String(value || "").trim();
}

function buildPassportModuleDigest(moduleDefinition = {}) {
  const fieldsJson = moduleDefinition.fieldsJson || moduleDefinition;
  return stableDigest({
    moduleKey: moduleDefinition.moduleKey || fieldsJson.sourceModule || null,
    typeName: moduleDefinition.typeName || null,
    semanticModelKey: moduleDefinition.semanticModelKey || null,
    sections: fieldsJson.sections || moduleDefinition.sections || [],
    semanticGraph: fieldsJson.semanticGraph || moduleDefinition.semanticGraph || null,
    identity: fieldsJson.identity || moduleDefinition.identity || null,
    systemHeader: fieldsJson.systemHeader || moduleDefinition.systemHeader || null,
    passportPolicyKey: fieldsJson.passportPolicyKey || moduleDefinition.passportPolicy?.key || null,
    passportPolicy: fieldsJson.passportPolicy || moduleDefinition.passportPolicy || null,
    lifecycle: fieldsJson.lifecycle || moduleDefinition.lifecycle || null,
  });
}

function normalizeLabelI18n(value, path) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw profileError(
      "passportTypeProfileLabelI18nInvalid",
      `${path} must be an object of locale-to-label translations.`,
      { field: path }
    );
  }
  const entries = Object.entries(value);
  if (entries.length > 50) {
    throw profileError(
      "passportTypeProfileLabelI18nInvalid",
      `${path} supports at most 50 translations.`,
      { field: path }
    );
  }
  const normalized = {};
  for (const [localeValue, labelValue] of entries) {
    const locale = clean(localeValue);
    const label = clean(labelValue);
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || !label || label.length > 500) {
      throw profileError(
        "passportTypeProfileLabelI18nInvalid",
        `${path} contains an invalid locale or label.`,
        { field: path, locale: locale || null }
      );
    }
    normalized[locale] = label;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeShortTextOverride(selection, key, fieldKey) {
  if (!own(selection, key)) return undefined;
  if (selection[key] === null || selection[key] === "") return null;
  const value = clean(selection[key]);
  if (!value || value.length > 200) {
    throw profileError(
      "passportTypeProfilePresentationInvalid",
      `Field "${fieldKey}" has an invalid ${key} override.`,
      { field: fieldKey, metadataKey: key }
    );
  }
  return value;
}

function collectCanonicalSections(sections = []) {
  const byKey = new Map();
  const pending = [...sections];
  while (pending.length) {
    const section = pending.shift();
    if (!section?.key) continue;
    byKey.set(section.key, section);
    pending.push(...(Array.isArray(section.sections) ? section.sections : []));
  }
  return byKey;
}

function normalizeSectionOverrides(profileRequest = {}, canonicalSectionsByKey = new Map()) {
  const rawByKey = new Map();
  const compactOverrides = profileRequest.sectionOverrides;
  if (compactOverrides !== undefined) {
    if (!Array.isArray(compactOverrides)) {
      throw profileError(
        "passportTypeProfileSectionOverridesInvalid",
        "profile.sectionOverrides must be an array of canonical section references."
      );
    }
    for (const entry of compactOverrides) {
      const sectionKey = clean(entry?.sourceModuleSectionKey || entry?.sectionKey || entry?.key);
      if (!sectionKey) {
        throw profileError(
          "passportTypeProfileSectionReferenceRequired",
          "Each section override must reference a canonical module section."
        );
      }
      if (rawByKey.has(sectionKey)) {
        throw profileError(
          "passportTypeProfileSectionReferenceDuplicate",
          `Section "${sectionKey}" has more than one profile override.`,
          { section: sectionKey }
        );
      }
      rawByKey.set(sectionKey, entry);
    }
  }

  const normalized = {};
  for (const [sectionKeyValue, overrideValue] of rawByKey.entries()) {
    const sectionKey = clean(sectionKeyValue);
    if (!canonicalSectionsByKey.has(sectionKey)) {
      throw profileError(
        "passportTypeProfileSectionNotFound",
        `Section "${sectionKey || "unknown"}" is not defined by the selected passport module.`,
        { section: sectionKey || null }
      );
    }
    const override = overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)
      ? overrideValue
      : {};
    const labelI18n = normalizeLabelI18n(
      override.labelI18n,
      `profile.sectionOverrides.${sectionKey}.labelI18n`
    );
    if (labelI18n) normalized[sectionKey] = { labelI18n };
  }
  return normalized;
}

function buildProfileRequestFromSections(sections = []) {
  const includedFields = flattenSchemaFieldsFromSections(sections).map((field) => {
    const selection = {
      sourceModuleFieldKey: field.sourceModuleFieldKey || field.key,
      semanticId: field.semanticId,
      domainClassKey: field.domainClassKey,
      required: field.required === true,
      confidentiality: field.confidentiality,
    };
    for (const key of fieldPresentationOverrideKeys) {
      if (own(field, key)) selection[key] = clone(field[key]);
    }
    return selection;
  });
  const sectionOverrides = [];
  const pending = [...(Array.isArray(sections) ? sections : [])];
  while (pending.length) {
    const section = pending.shift();
    if (!section || typeof section !== "object") continue;
    if (section.labelI18n) {
      sectionOverrides.push({
        sourceModuleSectionKey: section.sourceModuleSectionKey || section.key,
        labelI18n: clone(section.labelI18n),
      });
    }
    pending.push(...(Array.isArray(section.sections) ? section.sections : []));
  }
  return {
    includedFields,
    ...(sectionOverrides.length ? { sectionOverrides } : {}),
  };
}

function resolveCanonicalField(selection, fieldsByKey, fieldsByIri) {
  const sourceKey = clean(
    selection?.sourceModuleFieldKey
    || selection?.fieldKey
    || selection?.key
    || (typeof selection === "string" ? selection : "")
  );
  const semanticId = clean(selection?.semanticId || selection?.propertyIri);
  const byKey = sourceKey ? fieldsByKey.get(sourceKey) : null;
  const byIri = semanticId ? fieldsByIri.get(semanticId) : null;
  if (byKey && byIri && byKey.key !== byIri.key) {
    throw profileError(
      "passportTypeProfileFieldReferenceMismatch",
      `Field reference "${sourceKey}" does not match semantic property "${semanticId}".`,
      { field: sourceKey, semanticId }
    );
  }
  const canonicalField = byKey || byIri || null;
  if (!canonicalField) {
    throw profileError(
      "passportTypeProfileFieldNotFound",
      `Field "${sourceKey || semanticId || "unknown"}" is not defined by the selected passport module.`,
      { field: sourceKey || null, semanticId: semanticId || null }
    );
  }
  if (semanticId && semanticId !== canonicalField.semanticId) {
    throw profileError(
      "passportTypeProfileFieldReferenceMismatch",
      `Field "${canonicalField.key}" must retain its canonical semanticId.`,
      { field: canonicalField.key, expected: canonicalField.semanticId, actual: semanticId }
    );
  }
  const requestedDomainClassKey = clean(selection?.domainClassKey);
  if (requestedDomainClassKey && requestedDomainClassKey !== canonicalField.domainClassKey) {
    throw profileError(
      "passportTypeProfileFieldReferenceMismatch",
      `Field "${canonicalField.key}" must remain owned by semantic class "${canonicalField.domainClassKey}".`,
      {
        field: canonicalField.key,
        expected: canonicalField.domainClassKey,
        actual: requestedDomainClassKey,
      }
    );
  }
  return canonicalField;
}

function normalizeFieldSelection(
  selection,
  canonicalField,
  includedBy = ["selection"],
  canonicalGraph = null
) {
  const canonicalMinCount = Number.isInteger(canonicalField.minCount)
    ? canonicalField.minCount
    : 0;
  if (own(selection, "required") && typeof selection.required !== "boolean") {
    throw profileError(
      "passportTypeProfileRequiredInvalid",
      `Field "${canonicalField.key}" required override must be boolean.`,
      { field: canonicalField.key }
    );
  }
  if (selection.required === false && (canonicalMinCount > 0 || canonicalField.required === true)) {
    throw profileError(
      "passportTypeProfileRequiredModuleFieldOptional",
      `Field "${canonicalField.key}" is mandatory in the module and cannot be made optional.`,
      { field: canonicalField.key }
    );
  }
  const required = own(selection, "required")
    ? selection.required
    : canonicalField.required === true || canonicalMinCount > 0;

  const rawConfidentiality = own(selection, "confidentiality")
    ? clean(selection.confidentiality).toLowerCase()
    : clean(canonicalField.confidentiality || "public").toLowerCase();
  if (!allowedConfidentiality.has(rawConfidentiality)) {
    throw profileError(
      "passportTypeProfileConfidentialityInvalid",
      `Field "${canonicalField.key}" confidentiality must be public or restricted.`,
      { field: canonicalField.key }
    );
  }

  const nextField = {
    ...clone(canonicalField),
    required,
    minCount: required ? Math.max(1, canonicalMinCount) : canonicalMinCount,
    confidentiality: rawConfidentiality,
  };
  const storedSelection = {
    sourceModuleFieldKey: canonicalField.sourceModuleFieldKey || canonicalField.key,
    semanticId: canonicalField.semanticId,
    domainClassKey: canonicalField.domainClassKey,
    required,
    confidentiality: rawConfidentiality,
    includedBy: [...new Set(includedBy)].sort(),
  };

  if (own(selection, "labelI18n")) {
    const labelI18n = normalizeLabelI18n(
      selection.labelI18n,
      `profile.includedFields.${canonicalField.key}.labelI18n`
    );
    if (labelI18n) {
      nextField.labelI18n = labelI18n;
      storedSelection.labelI18n = labelI18n;
    } else {
      delete nextField.labelI18n;
    }
  } else if (canonicalField.labelI18n) {
    storedSelection.labelI18n = clone(canonicalField.labelI18n);
  }

  for (const key of ["displayRole", "summaryRole", "lifecycleRole", "presentation"]) {
    const override = normalizeShortTextOverride(selection, key, canonicalField.key);
    if (override === undefined) {
      if (nextField[key] !== undefined) storedSelection[key] = nextField[key];
    } else if (override === null) {
      delete nextField[key];
    } else {
      nextField[key] = override;
      storedSelection[key] = override;
    }
  }

  const compositionExplicit = own(selection, "composition");
  if (compositionExplicit && typeof selection.composition !== "boolean") {
    throw profileError(
      "passportTypeProfileCompositionInvalid",
      `Field "${canonicalField.key}" composition override must be boolean.`,
      { field: canonicalField.key }
    );
  }
  const presentationExplicit = own(selection, "presentation");
  let composition = compositionExplicit
    ? selection.composition
    : nextField.composition === true;
  if (presentationExplicit && nextField.presentation === "compositionChart") composition = true;
  if (presentationExplicit && nextField.presentation !== "compositionChart" && !compositionExplicit) {
    composition = false;
  }

  if (!composition) {
    delete nextField.composition;
    delete nextField.compositionLabelColumnKey;
    delete nextField.compositionValueColumnKey;
    if (nextField.presentation === "compositionChart") nextField.presentation = "table";
    if (nextField.presentation !== undefined) storedSelection.presentation = nextField.presentation;
    storedSelection.composition = false;
    return { field: nextField, selection: storedSelection };
  }

  if (!["table", "objectList"].includes(canonicalField.type)) {
    throw profileError(
      "passportTypeProfileCompositionFieldInvalid",
      `Field "${canonicalField.key}" must be a canonical table or object-list field to use a composition chart.`,
      { field: canonicalField.key }
    );
  }
  const columns = canonicalField.type === "table"
    ? (Array.isArray(canonicalField.tableColumns) ? canonicalField.tableColumns : [])
    : ((canonicalGraph?.classes || []).find(
      (classDef) => classDef.key === canonicalField.rangeClassKey
    )?.properties || []);
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const labelColumnKey = clean(
    own(selection, "compositionLabelColumnKey")
      ? selection.compositionLabelColumnKey
      : canonicalField.compositionLabelColumnKey
  );
  const valueColumnKey = clean(
    own(selection, "compositionValueColumnKey")
      ? selection.compositionValueColumnKey
      : canonicalField.compositionValueColumnKey
  );
  const labelColumn = columnsByKey.get(labelColumnKey);
  const valueColumn = columnsByKey.get(valueColumnKey);
  if (!labelColumn || !valueColumn || labelColumnKey === valueColumnKey) {
    throw profileError(
      "passportTypeProfileCompositionColumnsInvalid",
      `Field "${canonicalField.key}" composition chart must use two distinct existing table columns.`,
      { field: canonicalField.key, labelColumnKey, valueColumnKey }
    );
  }
  if (clean(labelColumn.dataType).toLowerCase() !== "string") {
    throw profileError(
      "passportTypeProfileCompositionLabelColumnInvalid",
      `Field "${canonicalField.key}" composition chart label column must use string data.`,
      { field: canonicalField.key, column: labelColumnKey }
    );
  }
  if (!numericChartDataTypes.has(clean(valueColumn.dataType).toLowerCase())) {
    throw profileError(
      "passportTypeProfileCompositionValueColumnInvalid",
      `Field "${canonicalField.key}" composition chart value column must use decimal or integer data.`,
      { field: canonicalField.key, column: valueColumnKey }
    );
  }
  nextField.composition = true;
  nextField.presentation = "compositionChart";
  nextField.compositionLabelColumnKey = labelColumnKey;
  nextField.compositionValueColumnKey = valueColumnKey;
  Object.assign(storedSelection, {
    composition: true,
    presentation: "compositionChart",
    compositionLabelColumnKey: labelColumnKey,
    compositionValueColumnKey: valueColumnKey,
  });
  return { field: nextField, selection: storedSelection };
}

function collectHeaderFieldDependencies(systemHeader = {}) {
  const keys = new Set(Array.isArray(systemHeader.fieldKeys) ? systemHeader.fieldKeys : []);
  for (const mapping of Array.isArray(systemHeader.fieldMappings) ? systemHeader.fieldMappings : []) {
    if (mapping?.sourceType === "field" && mapping.fieldKey) keys.add(mapping.fieldKey);
  }
  return [...keys].filter(Boolean);
}

function pruneSections(canonicalSections, selectedFieldsByKey, sectionOverrides) {
  const prune = (section) => {
    const fields = (Array.isArray(section.fields) ? section.fields : [])
      .filter((field) => selectedFieldsByKey.has(field.key))
      .map((field) => clone(selectedFieldsByKey.get(field.key).field));
    const sections = (Array.isArray(section.sections) ? section.sections : [])
      .map(prune)
      .filter(Boolean);
    if (!fields.length && !sections.length) return null;
    const { sections: _nestedSections, fields: _fields, labelI18n: _labelI18n, ...rest } = section;
    const override = sectionOverrides[section.key] || null;
    return {
      ...clone(rest),
      ...(override?.labelI18n ? { labelI18n: clone(override.labelI18n) } : {}),
      fields,
      sections,
    };
  };
  return (Array.isArray(canonicalSections) ? canonicalSections : []).map(prune).filter(Boolean);
}

function collectIncludedSectionGraph(compiledSections, semanticGraph) {
  const classesByKey = new Map((semanticGraph.classes || []).map((classDef) => [classDef.key, classDef]));
  const requiredSections = new Set();
  const entries = [];

  const visit = (section, parentClassKey) => {
    let required = (section.fields || []).some((field) => field.required === true);
    for (const child of section.sections || []) {
      if (visit(child, section.key)) required = true;
    }
    if (required) requiredSections.add(section.key);
    entries.push({ section, parentClassKey, required });
    return required;
  };
  for (const section of compiledSections) visit(section, semanticGraph.rootClassKey);

  const containment = [];
  for (const entry of entries) {
    const parentClass = classesByKey.get(entry.parentClassKey);
    const property = (parentClass?.properties || []).find((candidate) => (
      candidate.key === entry.section.key
      && candidate.rangeKind === "class"
      && candidate.rangeClassKey === entry.section.key
    ));
    if (!property) {
      throw profileError(
        "passportTypeProfileSectionSemanticRelationshipMissing",
        `Section "${entry.section.key}" is missing its canonical semantic containment relationship.`,
        { section: entry.section.key, parentClassKey: entry.parentClassKey }
      );
    }
    containment.push({
      parentClassKey: entry.parentClassKey,
      property,
      required: requiredSections.has(entry.section.key),
    });
  }
  return { containment, requiredSections };
}

function projectSemanticGraph(canonicalGraph, compiledSections, selectedFieldsByKey) {
  if (!canonicalGraph) {
    throw profileError(
      "passportTypeProfileSemanticGraphRequired",
      "The selected passport module does not provide a semantic graph."
    );
  }
  const graph = clone(canonicalGraph);
  const classesByKey = new Map((graph.classes || []).map((classDef) => [classDef.key, classDef]));
  const includedClassKeys = new Set([graph.rootClassKey]);
  const includedEnumKeys = new Set();
  const includedPropertyIrisByClass = new Map();
  const minCountOverrideByIri = new Map();
  const expandedRangeClasses = new Set();
  const pendingRangeClasses = [];

  const includeProperty = (classKey, property, { expandRange = false, minCount = null } = {}) => {
    if (!property) return;
    includedClassKeys.add(classKey);
    if (!includedPropertyIrisByClass.has(classKey)) includedPropertyIrisByClass.set(classKey, new Set());
    includedPropertyIrisByClass.get(classKey).add(property.semanticId);
    if (minCount !== null) minCountOverrideByIri.set(property.semanticId, minCount);
    if (property.rangeKind === "enum" && property.rangeEnumKey) includedEnumKeys.add(property.rangeEnumKey);
    if (property.rangeKind === "class" && property.rangeClassKey) {
      includedClassKeys.add(property.rangeClassKey);
      if (expandRange) pendingRangeClasses.push(property.rangeClassKey);
    }
  };

  const { containment } = collectIncludedSectionGraph(compiledSections, graph);
  for (const entry of containment) {
    includeProperty(entry.parentClassKey, entry.property, {
      expandRange: false,
      minCount: entry.required ? Math.max(1, Number(entry.property.minCount) || 0) : null,
    });
  }

  for (const { field } of selectedFieldsByKey.values()) {
    const ownerClass = classesByKey.get(field.domainClassKey);
    const property = (ownerClass?.properties || []).find((candidate) => (
      candidate.semanticId === field.semanticId && candidate.key === field.key
    ));
    if (!property) {
      throw profileError(
        "passportTypeProfileFieldSemanticPropertyMissing",
        `Field "${field.key}" is missing from its canonical owning semantic class.`,
        { field: field.key, domainClassKey: field.domainClassKey }
      );
    }
    includeProperty(field.domainClassKey, property, {
      expandRange: property.rangeKind === "class",
      minCount: field.minCount,
    });
  }

  while (pendingRangeClasses.length) {
    const classKey = pendingRangeClasses.shift();
    if (expandedRangeClasses.has(classKey)) continue;
    expandedRangeClasses.add(classKey);
    const classDef = classesByKey.get(classKey);
    if (!classDef) continue;
    includedClassKeys.add(classKey);
    for (const property of classDef.properties || []) {
      includeProperty(classKey, property, { expandRange: property.rangeKind === "class" });
    }
  }

  const classes = (graph.classes || [])
    .filter((classDef) => includedClassKeys.has(classDef.key))
    .map((classDef) => ({
      ...classDef,
      properties: (classDef.properties || [])
        .filter((property) => includedPropertyIrisByClass.get(classDef.key)?.has(property.semanticId))
        .map((property) => ({
          ...property,
          ...(minCountOverrideByIri.has(property.semanticId)
            ? { minCount: minCountOverrideByIri.get(property.semanticId) }
            : {}),
        })),
    }));
  const enums = (graph.enums || []).filter((enumDef) => includedEnumKeys.has(enumDef.key));
  return normalizeAndValidateSemanticGraph({
    schemaVersion: 1,
    rootClassKey: graph.rootClassKey,
    rootClassIri: graph.rootClassIri,
    classes,
    enums,
  }, { required: true });
}

function buildSemanticProfileShapes(semanticGraph) {
  const enumsByKey = new Map((semanticGraph?.enums || []).map((enumDef) => [enumDef.key, enumDef]));
  const propertyShape = (property) => {
    const shape = {
      "sh:path": { "@id": property.semanticId },
      "sh:name": property.label,
      "sh:minCount": property.minCount,
      ...(property.maxCount === null ? {} : { "sh:maxCount": property.maxCount }),
    };
    if (property.rangeKind === "scalar") {
      shape["sh:datatype"] = { "@id": property.rangeIri };
    } else if (property.rangeKind === "class") {
      shape["sh:class"] = { "@id": property.rangeIri };
    } else {
      const enumDef = enumsByKey.get(property.rangeEnumKey);
      shape["sh:in"] = {
        "@list": (enumDef?.values || []).map((value) => ({ "@id": value.semanticId })),
      };
    }
    return shape;
  };
  return {
    "@context": {
      sh: "http://www.w3.org/ns/shacl#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": (semanticGraph?.classes || []).map((classDef) => ({
      "@id": `${classDef.semanticId}ProfileShape`,
      "@type": "sh:NodeShape",
      "sh:targetClass": { "@id": classDef.semanticId },
      "sh:closed": true,
      "sh:ignoredProperties": { "@list": [{ "@id": "rdf:type" }] },
      "sh:property": (classDef.properties || []).map(propertyShape),
    })),
  };
}

function compilePassportTypeProfile({
  moduleDefinition,
  profile: rawProfile = null,
  sections = null,
  identity = undefined,
  systemHeader = undefined,
  schemaVersion = 1,
} = {}) {
  if (!moduleDefinition?.moduleKey || !moduleDefinition?.fieldsJson) {
    throw profileError(
      "passportTypeProfileModuleRequired",
      "A registered passport module definition is required to compile a passport type profile."
    );
  }
  const canonicalFieldsJson = moduleDefinition.fieldsJson;
  const canonicalSections = canonicalFieldsJson.sections || [];
  const canonicalFields = flattenSchemaFieldsFromSections(canonicalSections);
  const canonicalSectionsByKey = collectCanonicalSections(canonicalSections);
  const fieldsByKey = new Map(canonicalFields.map((field) => [field.sourceModuleFieldKey || field.key, field]));
  const fieldsByIri = new Map(canonicalFields.map((field) => [field.semanticId, field]));
  const moduleDigest = moduleDefinition.moduleDigest || buildPassportModuleDigest(moduleDefinition);

  let profileRequest;
  if (rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile)) {
    profileRequest = clone(rawProfile);
  } else if (Array.isArray(sections)) {
    profileRequest = buildProfileRequestFromSections(sections);
  } else {
    profileRequest = {};
  }
  const explicitSelection = own(profileRequest, "includedFields");
  if (profileRequest.sourceModule && profileRequest.sourceModule !== moduleDefinition.moduleKey) {
    throw profileError(
      "passportTypeProfileModuleMismatch",
      `Profile sourceModule must be "${moduleDefinition.moduleKey}".`,
      { expected: moduleDefinition.moduleKey, actual: profileRequest.sourceModule }
    );
  }
  if (profileRequest.moduleDigest && profileRequest.moduleDigest !== moduleDigest) {
    throw profileError(
      "passportTypeProfileModuleChanged",
      "The passport module changed after this profile was loaded. Reload the module before saving.",
      { expected: moduleDigest, actual: profileRequest.moduleDigest }
    );
  }
  for (const [key, canonicalValue] of [
    ["identity", canonicalFieldsJson.identity],
    ["systemHeader", canonicalFieldsJson.systemHeader],
  ]) {
    if (own(profileRequest, key) && !valuesEqual(profileRequest[key], canonicalValue)) {
      throw profileError(
        "passportTypeProfileCanonicalMetadataMismatch",
        `profile.${key} is controlled by the selected passport module and cannot be changed.`,
        { field: `profile.${key}` }
      );
    }
  }
  if (explicitSelection && !Array.isArray(profileRequest.includedFields)) {
    throw profileError(
      "passportTypeProfileFieldsInvalid",
      "profile.includedFields must be an array."
    );
  }
  const rawSelections = explicitSelection
    ? profileRequest.includedFields
    : canonicalFields.map((field) => ({ sourceModuleFieldKey: field.sourceModuleFieldKey || field.key }));
  const rawSelectionByKey = new Map();
  for (const rawSelection of rawSelections) {
    const selection = typeof rawSelection === "string"
      ? { sourceModuleFieldKey: rawSelection }
      : rawSelection;
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw profileError(
        "passportTypeProfileFieldReferenceRequired",
        "Each included field must be a canonical module field reference."
      );
    }
    const canonicalField = resolveCanonicalField(selection, fieldsByKey, fieldsByIri);
    const sourceKey = canonicalField.sourceModuleFieldKey || canonicalField.key;
    if (rawSelectionByKey.has(sourceKey)) {
      throw profileError(
        "passportTypeProfileFieldReferenceDuplicate",
        `Field "${sourceKey}" is included more than once.`,
        { field: sourceKey }
      );
    }
    rawSelectionByKey.set(sourceKey, { selection, includedBy: new Set([explicitSelection ? "selection" : "module"]) });
  }

  if (explicitSelection) {
    for (const canonicalField of canonicalFields) {
      const canonicalMinCount = Number(canonicalField.minCount) || 0;
      if ((canonicalMinCount > 0 || canonicalField.required === true)
          && !rawSelectionByKey.has(canonicalField.sourceModuleFieldKey || canonicalField.key)) {
        throw profileError(
          "passportTypeProfileRequiredModuleFieldExcluded",
          `Field "${canonicalField.key}" is mandatory in the module and cannot be excluded.`,
          { field: canonicalField.key }
        );
      }
    }
  }

  if (identity !== undefined && !valuesEqual(identity, canonicalFieldsJson.identity)) {
    throw profileError(
      "passportTypeProfileCanonicalMetadataMismatch",
      "Passport type identity is controlled by the selected passport module and cannot be changed.",
      { field: "identity" }
    );
  }
  const resolvedIdentity = clone(canonicalFieldsJson.identity);
  const businessIdentifierField = clean(resolvedIdentity?.businessIdentifierField);
  if (!businessIdentifierField || !fieldsByKey.has(businessIdentifierField)) {
    throw profileError(
      "passportTypeProfileBusinessIdentifierInvalid",
      "Passport type identity must reference a canonical module business identifier field.",
      { field: businessIdentifierField || null }
    );
  }
  if (!rawSelectionByKey.has(businessIdentifierField)) {
    rawSelectionByKey.set(businessIdentifierField, {
      selection: { sourceModuleFieldKey: businessIdentifierField },
      includedBy: new Set(["identity"]),
    });
  } else {
    rawSelectionByKey.get(businessIdentifierField).includedBy.add("identity");
  }

  if (systemHeader !== undefined && !valuesEqual(
    normalizeSystemPassportHeader(systemHeader),
    normalizeSystemPassportHeader(canonicalFieldsJson.systemHeader)
  )) {
    throw profileError(
      "passportTypeProfileCanonicalMetadataMismatch",
      "Passport system-header mappings are controlled by the selected passport module and cannot be changed.",
      { field: "systemHeader" }
    );
  }
  const resolvedSystemHeader = normalizeSystemPassportHeader(canonicalFieldsJson.systemHeader);
  for (const fieldKey of collectHeaderFieldDependencies(resolvedSystemHeader)) {
    if (!fieldsByKey.has(fieldKey)) {
      throw profileError(
        "passportTypeProfileHeaderFieldInvalid",
        `Passport header field "${fieldKey}" is not defined by the selected module.`,
        { field: fieldKey }
      );
    }
    if (!rawSelectionByKey.has(fieldKey)) {
      rawSelectionByKey.set(fieldKey, {
        selection: { sourceModuleFieldKey: fieldKey },
        includedBy: new Set(["systemHeader"]),
      });
    } else {
      rawSelectionByKey.get(fieldKey).includedBy.add("systemHeader");
    }
  }

  const selectedFieldsByKey = new Map();
  for (const canonicalField of canonicalFields) {
    const sourceKey = canonicalField.sourceModuleFieldKey || canonicalField.key;
    const requested = rawSelectionByKey.get(sourceKey);
    if (!requested) continue;
    selectedFieldsByKey.set(sourceKey, normalizeFieldSelection(
      requested.selection,
      canonicalField,
      [...requested.includedBy],
      canonicalFieldsJson.semanticGraph
    ));
  }
  const sectionOverrides = normalizeSectionOverrides(profileRequest, canonicalSectionsByKey);
  const compiledSections = pruneSections(canonicalSections, selectedFieldsByKey, sectionOverrides);
  const headerValidation = validateSystemPassportHeader(resolvedSystemHeader, compiledSections);
  if (!headerValidation.valid) {
    throw profileError(
      "passportTypeProfileHeaderInvalid",
      headerValidation.error,
      { unknownKeys: headerValidation.unknownKeys || [] }
    );
  }
  const semanticGraph = projectSemanticGraph(
    canonicalFieldsJson.semanticGraph,
    compiledSections,
    selectedFieldsByKey
  );
  const shapes = buildSemanticProfileShapes(semanticGraph);
  const graphDigest = stableDigest(semanticGraph);
  const includedFields = canonicalFields
    .map((field) => selectedFieldsByKey.get(field.sourceModuleFieldKey || field.key)?.selection || null)
    .filter(Boolean);
  const passportPolicy = clone(canonicalFieldsJson.passportPolicy || moduleDefinition.passportPolicy || null);
  const passportPolicyKey = canonicalFieldsJson.passportPolicyKey || passportPolicy?.key || null;
  const lifecycle = clone(canonicalFieldsJson.lifecycle || moduleDefinition.lifecycle || null);
  const profileDigest = stableDigest({
    contractVersion: profileContractVersion,
    sourceModule: moduleDefinition.moduleKey,
    moduleDigest,
    includedFields: includedFields.map((field) => ({
      sourceModuleFieldKey: field.sourceModuleFieldKey,
      semanticId: field.semanticId,
      domainClassKey: field.domainClassKey,
      required: field.required,
      confidentiality: field.confidentiality,
    })),
    identity: resolvedIdentity,
    systemHeader: resolvedSystemHeader,
    passportPolicyKey,
    passportPolicy,
    lifecycle,
    semanticGraph,
  });
  const profile = {
    contractVersion: profileContractVersion,
    selectionMode: explicitSelection ? "explicit" : "full",
    sourceModule: moduleDefinition.moduleKey,
    moduleDigest,
    profileDigest,
    includedFields,
    sectionOverrides: Object.entries(sectionOverrides).map(([sourceModuleSectionKey, override]) => ({
      sourceModuleSectionKey,
      ...clone(override),
    })),
  };

  return {
    schemaVersion: Number.parseInt(schemaVersion, 10) > 0 ? Number.parseInt(schemaVersion, 10) : 1,
    systemHeader: resolvedSystemHeader,
    sections: compiledSections,
    semanticGraph,
    sourceModule: moduleDefinition.moduleKey,
    identity: resolvedIdentity,
    passportPolicyKey,
    passportPolicy,
    lifecycle,
    moduleDigest,
    profileDigest,
    profile,
    semanticProfile: {
      schemaVersion: 1,
      graphDigest,
      shapes,
    },
  };
}

module.exports = {
  buildPassportModuleDigest,
  buildProfileRequestFromSections,
  buildSemanticProfileShapes,
  compilePassportTypeProfile,
  profileContractVersion,
  stableDigest,
};
