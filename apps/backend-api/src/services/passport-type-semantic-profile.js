"use strict";

const {
  flattenSchemaFieldsFromSections,
  walkSchemaSections,
} = require("../shared/passports/passport-helpers");
const { isManyProperty } = require("../shared/passports/passport-semantic-graph");

const xsdByDataType = Object.freeze({
  string: "http://www.w3.org/2001/XMLSchema#string",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  date: "http://www.w3.org/2001/XMLSchema#date",
  datetime: "http://www.w3.org/2001/XMLSchema#dateTime",
  uri: "http://www.w3.org/2001/XMLSchema#anyURI",
});

function getFieldsJson(typeDef) {
  return typeDef?.fieldsJson && typeof typeDef.fieldsJson === "object"
    ? typeDef.fieldsJson
    : {};
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function getPropertyIri(property) {
  return normalizeOptionalText(property?.semanticId || property?.iri);
}

function getClassIri(classDef) {
  return normalizeOptionalText(classDef?.semanticId || classDef?.iri);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildSemanticProfileMetadata(typeDef, { profilePath = null } = {}) {
  const fieldsJson = getFieldsJson(typeDef);
  const profile = fieldsJson.profile && typeof fieldsJson.profile === "object"
    ? fieldsJson.profile
    : {};
  const semanticProfile = fieldsJson.semanticProfile && typeof fieldsJson.semanticProfile === "object"
    ? fieldsJson.semanticProfile
    : {};
  const parsedSchemaVersion = Number.parseInt(
    profile.schemaVersion ?? fieldsJson.schemaVersion,
    10
  );

  return {
    typeName: normalizeOptionalText(typeDef?.typeName),
    semanticModelKey: normalizeOptionalText(
      profile.semanticModelKey
      || typeDef?.semanticModelKey
      || fieldsJson.semanticModelKey
    ),
    sourceModule: normalizeOptionalText(profile.sourceModule || fieldsJson.sourceModule),
    schemaVersion: Number.isFinite(parsedSchemaVersion) && parsedSchemaVersion > 0
      ? parsedSchemaVersion
      : null,
    profileDigest: normalizeOptionalText(profile.profileDigest || fieldsJson.profileDigest),
    moduleDigest: normalizeOptionalText(profile.moduleDigest || fieldsJson.moduleDigest),
    graphDigest: normalizeOptionalText(semanticProfile.graphDigest || profile.graphDigest),
    contractVersion: Number.isInteger(profile.contractVersion) ? profile.contractVersion : null,
    selectionMode: normalizeOptionalText(profile.selectionMode),
    includedFieldCount: Array.isArray(profile.includedFields) ? profile.includedFields.length : null,
    profilePath: normalizeOptionalText(profile.profilePath || profilePath),
  };
}

function projectSemanticGraphToSections(semanticGraph, sections = []) {
  if (!semanticGraph || typeof semanticGraph !== "object") {
    throw new Error("Passport type semantic profile requires a semantic class graph.");
  }

  const classes = Array.isArray(semanticGraph.classes) ? semanticGraph.classes : [];
  const classesByKey = new Map(classes.map((classDef) => [classDef?.key, classDef]));
  const rootClassKey = semanticGraph.rootClassKey;
  if (!rootClassKey || !classesByKey.has(rootClassKey)) {
    throw new Error("Passport type semantic profile requires a valid root semantic class.");
  }

  const schemaFields = flattenSchemaFieldsFromSections(sections);
  const selectedPropertyIris = new Set(
    schemaFields.map((field) => getPropertyIri(field)).filter(Boolean)
  );
  const selectedPropertyOwners = new Set(
    schemaFields
      .filter((field) => field?.key && field?.domainClassKey)
      .map((field) => `${field.domainClassKey}\u0000${field.key}`)
  );
  const includedClassKeys = new Set([rootClassKey]);
  const sectionContainmentEdges = new Set();

  const resolveChildClassKey = (parentClassKey, sectionKey) => {
    const parentClass = classesByKey.get(parentClassKey);
    const containment = (parentClass?.properties || []).find((property) =>
      property?.rangeKind === "class"
      && property?.relationshipType === "composition"
      && (property.key === sectionKey || property.rangeClassKey === sectionKey)
    );
    return containment?.rangeClassKey || sectionKey;
  };

  walkSchemaSections(sections, (_section, sectionPath) => {
    let parentClassKey = rootClassKey;
    for (const pathEntry of sectionPath) {
      const childClassKey = resolveChildClassKey(parentClassKey, pathEntry.key);
      sectionContainmentEdges.add(`${parentClassKey}\u0000${childClassKey}`);
      includedClassKeys.add(childClassKey);
      parentClassKey = childClassKey;
    }
  });

  // A selected structured field owns its complete nested value contract. Its
  // nested class properties are not separate passport-type field choices, so
  // retain their reachable class closure as part of that selected field.
  const completeStructuredClassKeys = new Set();
  const includeStructuredClass = (classKey) => {
    if (!classKey || completeStructuredClassKeys.has(classKey)) return;
    const classDef = classesByKey.get(classKey);
    if (!classDef) return;
    completeStructuredClassKeys.add(classKey);
    includedClassKeys.add(classKey);
    for (const property of classDef.properties || []) {
      if (property?.rangeKind === "class") includeStructuredClass(property.rangeClassKey);
    }
  };

  for (const classDef of classes) {
    for (const property of classDef?.properties || []) {
      const iri = getPropertyIri(property);
      const selected = (iri && selectedPropertyIris.has(iri))
        || selectedPropertyOwners.has(`${classDef.key}\u0000${property.key}`);
      if (selected && property.rangeKind === "class") {
        includeStructuredClass(property.rangeClassKey);
      }
    }
  }

  const projectedClasses = classes
    .filter((classDef) => includedClassKeys.has(classDef?.key))
    .map((classDef) => {
      const keepEveryProperty = completeStructuredClassKeys.has(classDef.key);
      const properties = (classDef.properties || []).filter((property) => {
        if (keepEveryProperty) return true;
        const iri = getPropertyIri(property);
        if ((iri && selectedPropertyIris.has(iri))
          || selectedPropertyOwners.has(`${classDef.key}\u0000${property.key}`)) {
          return true;
        }
        return property?.rangeKind === "class"
          && sectionContainmentEdges.has(`${classDef.key}\u0000${property.rangeClassKey}`);
      });
      return { ...clone(classDef), properties: clone(properties) };
    });

  const referencedEnumKeys = new Set();
  for (const classDef of projectedClasses) {
    for (const property of classDef.properties || []) {
      if (property.rangeKind === "enum" && property.rangeEnumKey) {
        referencedEnumKeys.add(property.rangeEnumKey);
      }
    }
  }

  return {
    ...clone(semanticGraph),
    classes: projectedClasses,
    enums: (semanticGraph.enums || [])
      .filter((enumDef) => referencedEnumKeys.has(enumDef?.key))
      .map(clone),
  };
}

function buildPropertyContext(property, semanticGraph, visited) {
  const semanticId = getPropertyIri(property);
  if (!semanticId) return null;
  const term = { "@id": semanticId };
  if (isManyProperty(property)) term["@container"] = "@set";
  if (property.rangeKind === "scalar") {
    const scalarType = xsdByDataType[String(property.dataType || "").toLowerCase()]
      || normalizeOptionalText(property.rangeIri);
    if (scalarType) term["@type"] = scalarType;
  } else if (property.rangeKind === "enum" || property.relationshipType === "reference") {
    term["@type"] = "@id";
  } else if (property.rangeClassKey && !visited.has(property.rangeClassKey)) {
    const nested = buildClassContext(
      property.rangeClassKey,
      semanticGraph,
      new Set(visited).add(property.rangeClassKey)
    );
    if (Object.keys(nested).length) term["@context"] = nested;
  }
  return term;
}

function buildClassContext(classKey, semanticGraph, visited = new Set([classKey])) {
  const classDef = (semanticGraph.classes || []).find((entry) => entry?.key === classKey);
  if (!classDef) return {};
  const entries = [];
  for (const property of classDef.properties || []) {
    const term = buildPropertyContext(property, semanticGraph, visited);
    if (property?.key && term) entries.push([property.key, term]);
  }
  return Object.fromEntries(entries);
}

function buildSemanticProfileContext(semanticGraph, sections = []) {
  const rootClass = (semanticGraph.classes || []).find(
    (classDef) => classDef?.key === semanticGraph.rootClassKey
  );
  const context = { "@version": 1.1 };
  if (rootClass?.key && getClassIri(rootClass)) {
    context[rootClass.key] = { "@id": getClassIri(rootClass) };
  }
  Object.assign(context, buildClassContext(semanticGraph.rootClassKey, semanticGraph));
  for (const field of flattenSchemaFieldsFromSections(sections)) {
    if (!field?.key) continue;
    const term = buildPropertyContext(field, semanticGraph, new Set());
    if (term) context[field.key] = term;
  }
  return { "@context": context };
}

function buildShaclProperty(property) {
  const shape = {
    "sh:path": { "@id": getPropertyIri(property) },
    "sh:name": property.label || property.key,
    "sh:minCount": Number.isInteger(property.minCount) ? property.minCount : 0,
  };
  if (Number.isInteger(property.maxCount)) shape["sh:maxCount"] = property.maxCount;
  if (property.rangeKind === "scalar") {
    const datatype = normalizeOptionalText(property.rangeIri)
      || xsdByDataType[String(property.dataType || "").toLowerCase()];
    if (datatype) shape["sh:datatype"] = { "@id": datatype };
  } else if (property.rangeKind === "class") {
    const classIri = normalizeOptionalText(property.rangeIri);
    if (classIri) shape["sh:class"] = { "@id": classIri };
    if (property.relationshipType === "reference") shape["sh:nodeKind"] = { "@id": "sh:IRI" };
  }
  return shape;
}

function buildSemanticProfileShapes(semanticGraph) {
  return {
    "@context": {
      sh: "http://www.w3.org/ns/shacl#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": (semanticGraph.classes || []).map((classDef) => {
      const classIri = getClassIri(classDef);
      return {
        "@id": `${classIri}Shape`,
        "@type": "sh:NodeShape",
        ...(classDef.key === semanticGraph.rootClassKey
          ? { "sh:targetClass": { "@id": classIri } }
          : {}),
        "sh:closed": true,
        "sh:ignoredProperties": { "@list": [{ "@id": "rdf:type" }] },
        "sh:property": (classDef.properties || []).map(buildShaclProperty),
      };
    }),
  };
}

function propertyToTerm(property, classDef, classByKey) {
  const rangeClass = classByKey.get(property.rangeClassKey);
  return {
    slug: String(getPropertyIri(property) || property.key || "").split("/").filter(Boolean).pop(),
    iri: getPropertyIri(property),
    label: property.label || property.key,
    definition: property.definition || "",
    internalKey: property.key,
    dataType: property.dataType || null,
    unit: property.unit || "none",
    rangeKind: property.rangeKind,
    domain: {
      key: classDef.key,
      iri: getClassIri(classDef),
      label: classDef.label || classDef.key,
    },
    range: {
      iri: property.rangeIri || getClassIri(rangeClass),
      label: rangeClass?.label || property.dataType || property.rangeKind,
      jsonType: property.rangeKind === "class" ? "object" : property.dataType,
    },
    minCount: Number.isInteger(property.minCount) ? property.minCount : 0,
    maxCount: Number.isInteger(property.maxCount) ? property.maxCount : null,
    relationshipType: property.relationshipType || null,
  };
}

function buildPassportTypeSemanticProfile(typeDef, model = null, options = {}) {
  const fieldsJson = getFieldsJson(typeDef);
  const sections = Array.isArray(fieldsJson.sections) ? fieldsJson.sections : [];
  const semanticGraph = projectSemanticGraphToSections(fieldsJson.semanticGraph, sections);
  const classByKey = new Map((semanticGraph.classes || []).map((entry) => [entry.key, entry]));
  const propertyIris = new Set();
  const projectedProperties = [];
  for (const classDef of semanticGraph.classes || []) {
    for (const property of classDef.properties || []) {
      const iri = getPropertyIri(property);
      if (iri) propertyIris.add(iri);
      projectedProperties.push({ property, classDef });
    }
  }

  const canonicalTermsByIri = new Map(
    (model?.terms || []).map((term) => [normalizeOptionalText(term?.iri || term?.termIri), term])
  );
  const terms = projectedProperties.map(({ property, classDef }) => {
    const iri = getPropertyIri(property);
    return clone(canonicalTermsByIri.get(iri) || propertyToTerm(property, classDef, classByKey));
  });
  const referencedUnits = new Set(terms.map((term) => term?.unit).filter(Boolean));

  const canonicalClassesByIri = new Map(
    (model?.classes || []).map((classDef) => [normalizeOptionalText(classDef?.iri), classDef])
  );
  const classes = (semanticGraph.classes || []).map((classDef) => {
    const canonical = canonicalClassesByIri.get(getClassIri(classDef)) || {};
    return {
      ...clone(canonical),
      key: classDef.key,
      label: classDef.label || canonical.label || classDef.key,
      iri: getClassIri(classDef),
      definition: classDef.definition || canonical.definition || "",
      root: classDef.key === semanticGraph.rootClassKey,
      properties: clone(classDef.properties || []).map((property) => ({
        ...property,
        iri: getPropertyIri(property),
      })),
    };
  });

  const canonicalEnumsByKey = new Map((model?.enums || []).map((entry) => [entry?.key, entry]));
  const enums = (semanticGraph.enums || []).map((enumDef) => ({
    ...clone(canonicalEnumsByKey.get(enumDef.key) || {}),
    ...clone(enumDef),
    iri: normalizeOptionalText(enumDef.semanticId || enumDef.iri),
    values: clone(enumDef.values || []),
  }));
  const profilePath = options.profilePath
    || (typeDef?.typeName
      ? `/api/passport-types/${encodeURIComponent(typeDef.typeName)}/semantic-profile`
      : null);
  const metadata = buildSemanticProfileMetadata(typeDef, { profilePath });
  const selectedFields = flattenSchemaFieldsFromSections(sections).map((field) => ({
    key: field.key,
    label: field.label || field.key,
    semanticId: getPropertyIri(field),
    sectionPath: (field.sectionPath || []).map((entry) => ({
      key: entry.key,
      label: entry.label,
    })),
  }));

  return {
    ...metadata,
    displayName: normalizeOptionalText(typeDef?.displayName),
    productCategory: normalizeOptionalText(typeDef?.productCategory),
    canonicalDictionary: model
      ? {
          semanticModelKey: model.semanticModelKey,
          contextUrl: model.contextUrl || null,
          termsUrl: model.termsUrl || null,
        }
      : null,
    selectedFields,
    semanticGraph,
    context: buildSemanticProfileContext(semanticGraph, sections),
    terms,
    classes,
    enums,
    units: (model?.units || []).filter((unit) => referencedUnits.has(unit?.key)).map(clone),
    shapes: buildSemanticProfileShapes(semanticGraph),
  };
}

module.exports = {
  buildPassportTypeSemanticProfile,
  buildSemanticProfileContext,
  buildSemanticProfileMetadata,
  buildSemanticProfileShapes,
  projectSemanticGraphToSections,
};
