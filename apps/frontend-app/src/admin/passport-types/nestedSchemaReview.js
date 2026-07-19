import { getSectionChildren } from "../../shared/passports/passportSchemaUtils";

export const maxNestedSectionDepth = 32;

function text(value) {
  return String(value || "").trim();
}

function pathLabel(path = []) {
  return path.map((entry) => entry.label || entry.key || "Untitled section").join(" › ");
}

function pathKey(path = []) {
  return JSON.stringify(path.map((entry) => entry.key || ""));
}

function issue(code, message, { sectionId = "", fieldId = "", path = [] } = {}) {
  return {
    code,
    message,
    sectionId,
    fieldId,
    path: path.map((entry) => ({ key: entry.key || "", label: entry.label || "" })),
    pathLabel: pathLabel(path),
  };
}

export function getSectionTreeEntries(sections = []) {
  const entries = [];
  const visit = (nodes, parentPath = []) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((section, index) => {
      if (!section || typeof section !== "object") return;
      const entry = {
        key: text(section.key),
        label: text(section.label) || text(section.name),
        localId: section.localId || "",
        section,
        index,
      };
      const path = [...parentPath, entry];
      entries.push({ section, path, depth: parentPath.length, index });
      visit(getSectionChildren(section), path);
    });
  };
  visit(sections);
  return entries;
}

export function getFieldTreeEntries(sections = []) {
  return getSectionTreeEntries(sections).flatMap(({ section, path, depth }) =>
    (Array.isArray(section.fields) ? section.fields : [])
      .filter((field) => field && typeof field === "object")
      .map((field, index) => ({
        field,
        path,
        depth,
        index,
        fieldKey: text(field.key),
        sectionPathKey: pathKey(path),
        pathLabel: pathLabel(path),
      }))
  );
}

function collectTreeShapeIssues(sections = []) {
  const errors = [];
  const sectionKeys = new Map();
  const fieldKeys = new Map();
  const sectionsWithLegacyGroups = [];

  getSectionTreeEntries(sections).forEach(({ section, path }) => {
    const current = path[path.length - 1] || {};
    if (path.length > maxNestedSectionDepth) {
      errors.push(issue(
        "sectionDepthExceeded",
        `Passport types support at most ${maxNestedSectionDepth} nested section levels.`,
        { sectionId: current.localId, path },
      ));
    }
    if (!current.key) {
      errors.push(issue("sectionKeyRequired", "Every section needs a key.", {
        sectionId: current.localId,
        path,
      }));
    } else if (sectionKeys.has(current.key)) {
      errors.push(issue("duplicateSectionKey", `Section key "${current.key}" is used more than once.`, {
        sectionId: current.localId,
        path,
      }));
    } else {
      sectionKeys.set(current.key, path);
    }

    if (!current.label) {
      errors.push(issue("sectionLabelRequired", "Every section needs a name.", {
        sectionId: current.localId,
        path,
      }));
    }

    const fields = Array.isArray(section.fields) ? section.fields : [];
    const children = getSectionChildren(section);
    if (fields.length === 0 && children.length === 0) {
      errors.push(issue("emptyLeafSection", "A section without subsections needs at least one field.", {
        sectionId: current.localId,
        path,
      }));
    }
    if (Object.prototype.hasOwnProperty.call(section, "groups")) {
      sectionsWithLegacyGroups.push({ current, path });
    }
  });

  getFieldTreeEntries(sections).forEach(({ field, path, fieldKey }) => {
    if (!fieldKey) {
      errors.push(issue("fieldKeyRequired", "Every field needs a key.", {
        fieldId: field.localId || "",
        path,
      }));
      return;
    }
    if (!text(field.label)) {
      errors.push(issue("fieldLabelRequired", `Field "${fieldKey}" needs a name.`, {
        fieldId: field.localId || "",
        path,
      }));
    }
    if (fieldKeys.has(fieldKey)) {
      errors.push(issue("duplicateFieldKey", `Field key "${fieldKey}" is used more than once.`, {
        fieldId: field.localId || "",
        path,
      }));
      return;
    }
    fieldKeys.set(fieldKey, path);
  });

  sectionsWithLegacyGroups.forEach(({ current, path }) => {
    errors.push(issue("legacyGroupsUnsupported", "Use nested sections, not the retired groups property.", {
      sectionId: current.localId,
      path,
    }));
  });

  return errors;
}

function compareModuleSectionTree(actualSections = [], moduleSections = [], parentPath = [], errors = []) {
  const actual = Array.isArray(actualSections) ? actualSections : [];
  const expected = Array.isArray(moduleSections) ? moduleSections : [];
  if (actual.length !== expected.length) {
    errors.push(issue(
      "moduleSectionCountMismatch",
      `${pathLabel(parentPath) || "Root"} must keep the module's section order and count.`,
      { path: parentPath },
    ));
  }

  const count = Math.min(actual.length, expected.length);
  for (let index = 0; index < count; index += 1) {
    const actualSection = actual[index] || {};
    const expectedSection = expected[index] || {};
    const entry = {
      key: text(actualSection.key),
      label: text(actualSection.label) || text(actualSection.name),
      localId: actualSection.localId || "",
    };
    const currentPath = [...parentPath, entry];
    const expectedKey = text(expectedSection.key);
    const expectedLabel = text(expectedSection.label) || text(expectedSection.name);

    if (entry.key !== expectedKey) {
      errors.push(issue(
        "moduleSectionKeyMismatch",
        `Expected section key "${expectedKey}" at ${pathLabel(currentPath) || "this location"}.`,
        { sectionId: entry.localId, path: currentPath },
      ));
    }
    if (entry.label !== expectedLabel) {
      errors.push(issue(
        "moduleSectionLabelMismatch",
        `Expected section name "${expectedLabel}" at ${pathLabel(currentPath) || "this location"}.`,
        { sectionId: entry.localId, path: currentPath },
      ));
    }

    const actualFields = Array.isArray(actualSection.fields) ? actualSection.fields : [];
    const expectedFields = Array.isArray(expectedSection.fields) ? expectedSection.fields : [];
    if (actualFields.length !== expectedFields.length) {
      errors.push(issue(
        "moduleFieldCountMismatch",
        `${pathLabel(currentPath) || "This section"} must keep every module field in order.`,
        { sectionId: entry.localId, path: currentPath },
      ));
    }
    const fieldCount = Math.min(actualFields.length, expectedFields.length);
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const actualField = actualFields[fieldIndex] || {};
      const expectedField = expectedFields[fieldIndex] || {};
      const expectedFieldKey = text(expectedField.key);
      const sourceFieldKey = text(actualField.sourceModuleFieldKey) || text(actualField.key);
      if (text(actualField.key) !== expectedFieldKey || sourceFieldKey !== expectedFieldKey) {
        errors.push(issue(
          "moduleFieldPathMismatch",
          `Expected module field "${expectedFieldKey}" at ${pathLabel(currentPath)}.`,
          { fieldId: actualField.localId || "", path: currentPath },
        ));
      }
      if (text(actualField.label) !== text(expectedField.label)) {
        errors.push(issue(
          "moduleFieldLabelMismatch",
          `Expected field name "${text(expectedField.label)}" at ${pathLabel(currentPath)}.`,
          { fieldId: actualField.localId || "", path: currentPath },
        ));
      }
      if (text(actualField.type) !== text(expectedField.type)) {
        errors.push(issue(
          "moduleFieldTypeMismatch",
          `Expected field "${expectedFieldKey}" to keep type "${text(expectedField.type)}" at ${pathLabel(currentPath)}.`,
          { fieldId: actualField.localId || "", path: currentPath },
        ));
      }

      const expectedColumns = Array.isArray(expectedField.tableColumns) ? expectedField.tableColumns : [];
      const actualColumns = Array.isArray(actualField.tableColumns) ? actualField.tableColumns : [];
      if (expectedColumns.length || actualColumns.length) {
        if (actualColumns.length !== expectedColumns.length) {
          errors.push(issue(
            "moduleTableColumnCountMismatch",
            `Table field "${expectedFieldKey}" must keep every module column in order.`,
            { fieldId: actualField.localId || "", path: currentPath },
          ));
        }
        const columnCount = Math.min(actualColumns.length, expectedColumns.length);
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const actualColumn = actualColumns[columnIndex] || {};
          const expectedColumn = expectedColumns[columnIndex] || {};
          const expectedColumnKey = text(expectedColumn.key);
          const sourceColumnKey = text(actualColumn.sourceModuleColumnKey) || text(actualColumn.key);
          if (text(actualColumn.key) !== expectedColumnKey || sourceColumnKey !== expectedColumnKey) {
            errors.push(issue(
              "moduleTableColumnPathMismatch",
              `Expected table column "${expectedColumnKey}" in "${expectedFieldKey}" at ${pathLabel(currentPath)}.`,
              { fieldId: actualField.localId || "", path: currentPath },
            ));
          }
          if (text(actualColumn.label) !== text(expectedColumn.label)) {
            errors.push(issue(
              "moduleTableColumnLabelMismatch",
              `Expected table column name "${text(expectedColumn.label)}" in "${expectedFieldKey}".`,
              { fieldId: actualField.localId || "", path: currentPath },
            ));
          }
        }
      }
    }

    compareModuleSectionTree(
      getSectionChildren(actualSection),
      getSectionChildren(expectedSection),
      currentPath,
      errors,
    );
  }
  return errors;
}

function collectHeaderMappingIssues(sections, systemHeader) {
  const errors = [];
  const fieldKeys = new Set(getFieldTreeEntries(sections).map((entry) => entry.fieldKey).filter(Boolean));
  const mappings = Array.isArray(systemHeader?.fieldMappings) ? systemHeader.fieldMappings : [];
  mappings.forEach((mapping) => {
    if (text(mapping?.sourceType).toLowerCase() !== "field") return;
    const fieldKey = text(mapping.fieldKey);
    if (fieldKey && !fieldKeys.has(fieldKey)) {
      errors.push(issue(
        "headerFieldMissing",
        `Passport header mapping "${text(mapping.slotKey) || fieldKey}" refers to missing field "${fieldKey}".`,
      ));
    }
  });
  return errors;
}

export function buildNestedSchemaReview({
  sections = [],
  moduleSections = null,
  sourceModuleKey = "",
  systemHeader = null,
} = {}) {
  const errors = [
    ...collectTreeShapeIssues(sections),
    ...collectHeaderMappingIssues(sections, systemHeader),
  ];
  const warnings = [];
  const normalizedSourceModuleKey = text(sourceModuleKey);

  if (normalizedSourceModuleKey) {
    if (!Array.isArray(moduleSections)) {
      errors.push(issue(
        "moduleUnavailable",
        `The selected module "${normalizedSourceModuleKey}" is not available to verify.`,
      ));
    } else {
      compareModuleSectionTree(sections, moduleSections, [], errors);
    }
  } else {
    warnings.push("Select a registered passport module before saving. Its structure is the canonical source of truth.");
  }

  const sectionEntries = getSectionTreeEntries(sections);
  const fieldEntries = getFieldTreeEntries(sections);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sectionEntries,
    fieldEntries,
    sectionCount: sectionEntries.length,
    fieldCount: fieldEntries.length,
    maxDepth: sectionEntries.reduce((maximum, entry) => Math.max(maximum, entry.depth), 0),
    moduleChecked: Boolean(normalizedSourceModuleKey && Array.isArray(moduleSections)),
  };
}
