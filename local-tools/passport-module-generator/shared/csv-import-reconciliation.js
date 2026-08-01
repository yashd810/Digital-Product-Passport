"use strict";

// Reconciles imported field trees with their dependent semantic graph entries.

(function exposePassportModuleCsvImportReconciliation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleCsvImportReconciliation = api;
})(typeof globalThis === "object" ? globalThis : null, () => {
  function clean(value) {
    return String(value ?? "").trim();
  }

  function cloneValue(value, seen = new WeakMap()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const clone = [];
      seen.set(value, clone);
      value.forEach((entry) => clone.push(cloneValue(entry, seen)));
      return clone;
    }
    const clone = {};
    seen.set(value, clone);
    Object.entries(value).forEach(([key, entry]) => {
      clone[key] = cloneValue(entry, seen);
    });
    return clone;
  }

  function parseSemanticGraphSourceRef(value) {
    const sourceRef = clean(value);
    if (!sourceRef) return null;
    const segments = sourceRef.split(":");
    const kind = segments[0];
    if (kind === "section" && segments.length === 2 && segments[1]) {
      return { kind, sectionKey: segments[1], sourceRef };
    }
    if ((kind === "field" || kind === "table") && segments.length === 3 && segments[1] && segments[2]) {
      return {
        kind,
        sectionKey: segments[1],
        fieldKey: segments[2],
        sourceRef,
      };
    }
    if (kind === "column" && segments.length === 4 && segments[1] && segments[2] && segments[3]) {
      return {
        kind,
        sectionKey: segments[1],
        fieldKey: segments[2],
        columnKey: segments[3],
        sourceRef,
      };
    }
    return { kind: "invalid", sourceRef };
  }

  function buildSemanticGraphSourceCatalog(sections = []) {
    if (!Array.isArray(sections)) throw new Error("Imported sections must be an array.");
    const sectionRefs = new Set();
    const fieldRefs = new Set();
    const tableRefs = new Set();
    const columnRefs = new Set();
    const sectionKeys = new Set();
    const parentSectionKeys = new Map();
    const pending = [...sections].reverse().map((section) => ({ section, parentKey: "" }));

    while (pending.length) {
      const { section, parentKey } = pending.pop();
      if (!section || typeof section !== "object" || Array.isArray(section)) continue;
      const sectionKey = clean(section.key);
      if (sectionKey) {
        if (sectionKeys.has(sectionKey)) {
          throw new Error(`Imported sections contain duplicate section key "${sectionKey}".`);
        }
        sectionKeys.add(sectionKey);
        sectionRefs.add(`section:${sectionKey}`);
        parentSectionKeys.set(sectionKey, parentKey);
        const fields = Array.isArray(section.fields) ? section.fields : [];
        for (const field of fields) {
          if (!field || typeof field !== "object" || Array.isArray(field)) continue;
          const fieldKey = clean(field.fieldKey || field.key);
          if (!fieldKey) continue;
          fieldRefs.add(`field:${sectionKey}:${fieldKey}`);
          const fieldType = clean(field.fieldType || field.type).toLowerCase();
          if (fieldType !== "table") continue;
          tableRefs.add(`table:${sectionKey}:${fieldKey}`);
          for (const column of Array.isArray(field.tableColumns) ? field.tableColumns : []) {
            const columnKey = clean(column?.columnKey || column?.key);
            if (columnKey) columnRefs.add(`column:${sectionKey}:${fieldKey}:${columnKey}`);
          }
        }
      }
      const children = Array.isArray(section.sections) ? section.sections : [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ section: children[index], parentKey: sectionKey });
      }
    }

    return {
      sectionRefs,
      fieldRefs,
      tableRefs,
      columnRefs,
      parentSectionKeys,
    };
  }

  function parsedSourceRefExists(parsed, catalog) {
    if (!parsed) return true;
    if (parsed.kind === "section") return catalog.sectionRefs.has(parsed.sourceRef);
    if (parsed.kind === "field") return catalog.fieldRefs.has(parsed.sourceRef);
    if (parsed.kind === "table") return catalog.tableRefs.has(parsed.sourceRef);
    if (parsed.kind === "column") return catalog.columnRefs.has(parsed.sourceRef);
    return false;
  }

  function classSourceRefIsValid(value, catalog) {
    const parsed = parseSemanticGraphSourceRef(value);
    if (!parsed) return true;
    return ["section", "table"].includes(parsed.kind) && parsedSourceRefExists(parsed, catalog);
  }

  function propertySourceRefIsValid(value, catalog, ownerSourceRef = null, { rootProperty = false } = {}) {
    const parsed = parseSemanticGraphSourceRef(value);
    if (!parsed) return true;
    if (!parsedSourceRefExists(parsed, catalog)) return false;
    if (rootProperty) {
      return parsed.kind === "section"
        && !catalog.parentSectionKeys.get(parsed.sectionKey);
    }

    const owner = parseSemanticGraphSourceRef(ownerSourceRef);
    if (!owner) return false;
    if (owner.kind === "section") {
      return (parsed.kind === "field" && parsed.sectionKey === owner.sectionKey)
        || (parsed.kind === "section"
          && catalog.parentSectionKeys.get(parsed.sectionKey) === owner.sectionKey);
    }
    if (owner.kind === "table") {
      return parsed.kind === "column"
        && parsed.sectionKey === owner.sectionKey
        && parsed.fieldKey === owner.fieldKey;
    }
    return false;
  }

  function propertyLabel(property, ownerKey) {
    const propertyKey = clean(property?.key) || clean(property?.label) || "unknownProperty";
    return `${ownerKey || "rootClass"}.${propertyKey}`;
  }

  function assertNoDanglingRanges(graph) {
    const classKeys = new Set([
      clean(graph.rootClass?.key),
      ...(Array.isArray(graph.classes) ? graph.classes : []).map((entry) => clean(entry?.key)),
    ].filter(Boolean));
    const enumKeys = new Set(
      (Array.isArray(graph.enums) ? graph.enums : []).map((entry) => clean(entry?.key)).filter(Boolean)
    );
    const owners = [
      {
        key: clean(graph.rootClass?.key) || "rootClass",
        properties: Array.isArray(graph.rootProperties) ? graph.rootProperties : [],
      },
      ...(Array.isArray(graph.classes) ? graph.classes : []).map((classDef) => ({
        key: clean(classDef?.key) || "unknownClass",
        properties: Array.isArray(classDef?.properties) ? classDef.properties : [],
      })),
    ];

    for (const owner of owners) {
      for (const property of owner.properties) {
        const path = propertyLabel(property, owner.key);
        const rangeClassKey = clean(property?.rangeClassKey);
        const rangeEnumKey = clean(property?.rangeEnumKey);
        const enumOverrideKey = clean(property?.enumOverrideKey);
        if (rangeClassKey && !classKeys.has(rangeClassKey)) {
          throw new Error(
            `CSV import cannot retain semantic property "${path}": rangeClassKey "${rangeClassKey}" does not identify a retained class.`
          );
        }
        if (rangeEnumKey && !enumKeys.has(rangeEnumKey)) {
          throw new Error(
            `CSV import cannot retain semantic property "${path}": rangeEnumKey "${rangeEnumKey}" does not identify a retained enum.`
          );
        }
        if (enumOverrideKey && !enumKeys.has(enumOverrideKey)) {
          throw new Error(
            `CSV import cannot retain semantic property "${path}": enumOverrideKey "${enumOverrideKey}" does not identify a retained enum.`
          );
        }
      }
    }
  }

  function reconcileSemanticGraphSources(rawGraph, sections = []) {
    if (!rawGraph || typeof rawGraph !== "object" || Array.isArray(rawGraph)) {
      throw new Error("Semantic graph must be an object.");
    }
    const graph = cloneValue(rawGraph);
    const catalog = buildSemanticGraphSourceCatalog(sections);
    let removedClassCount = 0;
    let removedPropertyCount = 0;

    const reconcileProperties = (properties, ownerSourceRef, options = {}) => (
      Array.isArray(properties) ? properties : []
    ).filter((property) => {
      if (propertySourceRefIsValid(property?.sourceRef, catalog, ownerSourceRef, options)) return true;
      removedPropertyCount += 1;
      return false;
    });

    graph.rootProperties = reconcileProperties(graph.rootProperties, null, { rootProperty: true });
    graph.classes = (Array.isArray(graph.classes) ? graph.classes : []).filter((classDef) => {
      if (!classSourceRefIsValid(classDef?.sourceRef, catalog)) {
        removedClassCount += 1;
        removedPropertyCount += Array.isArray(classDef?.properties) ? classDef.properties.length : 0;
        return false;
      }
      classDef.properties = reconcileProperties(classDef.properties, classDef?.sourceRef);
      return true;
    });
    if (!Array.isArray(graph.enums)) graph.enums = [];

    assertNoDanglingRanges(graph);
    return {
      graph,
      removedClassCount,
      removedPropertyCount,
    };
  }

  return {
    buildSemanticGraphSourceCatalog,
    parseSemanticGraphSourceRef,
    reconcileSemanticGraphSources,
  };
});
