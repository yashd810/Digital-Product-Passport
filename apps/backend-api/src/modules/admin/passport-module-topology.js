"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sectionPathLabel(path = []) {
  return path.length ? path.join(" > ") : "root";
}

function fieldSourceKey(field = {}) {
  return field?.sourceModuleFieldKey || field?.key || null;
}

function tableColumnSourceKey(column = {}) {
  return column?.sourceModuleColumnKey || column?.key || null;
}

function sameCanonicalLabel(expected, actual) {
  return (expected ?? null) === (actual ?? null);
}

function compareTableColumns({ expectedField, actualField, sectionPath, issues }) {
  const expectedColumns = asArray(expectedField?.tableColumns);
  const actualColumns = asArray(actualField?.tableColumns);
  const fieldKey = fieldSourceKey(expectedField) || actualField?.key || "unknown";

  if (expectedColumns.length !== actualColumns.length) {
    issues.push({
      code: "moduleTableColumnCountMismatch",
      field: actualField?.key || fieldKey,
      sectionPath,
      expected: expectedColumns.length,
      actual: actualColumns.length,
      message: `Table field "${fieldKey}" must retain all module columns in their original order.`,
    });
  }

  const count = Math.min(expectedColumns.length, actualColumns.length);
  for (let index = 0; index < count; index += 1) {
    const expectedColumn = expectedColumns[index] || {};
    const actualColumn = actualColumns[index] || {};
    const expectedKey = tableColumnSourceKey(expectedColumn);
    const actualSourceKey = actualColumn.sourceModuleColumnKey || null;

    if (actualSourceKey !== expectedKey) {
      issues.push({
        code: "moduleTableColumnOrderOrPathMismatch",
        field: actualField?.key || fieldKey,
        column: actualColumn?.key || expectedKey,
        sectionPath,
        expected: expectedKey,
        actual: actualSourceKey,
        message: `Table column "${actualColumn?.key || expectedKey || "unknown"}" must remain in its original module position in "${fieldKey}".`,
      });
    }
    if ((actualColumn?.key ?? null) !== (expectedColumn?.key ?? null)) {
      issues.push({
        code: "moduleTableColumnKeyMismatch",
        field: actualField?.key || fieldKey,
        column: actualColumn?.key || expectedKey,
        sectionPath,
        expected: expectedColumn?.key ?? null,
        actual: actualColumn?.key ?? null,
        message: `Table column "${expectedKey || "unknown"}" must keep its module key.`,
      });
    }
    if (!sameCanonicalLabel(expectedColumn?.label, actualColumn?.label)) {
      issues.push({
        code: "moduleTableColumnLabelMismatch",
        field: actualField?.key || fieldKey,
        column: actualColumn?.key || expectedKey,
        sectionPath,
        expected: expectedColumn?.label ?? null,
        actual: actualColumn?.label ?? null,
        message: `Table column "${expectedKey || "unknown"}" must keep its module label.`,
      });
    }
  }
}

function compareSectionFields({ expectedSection, actualSection, sectionPath, issues }) {
  const expectedFields = asArray(expectedSection?.fields);
  const actualFields = asArray(actualSection?.fields);

  if (expectedFields.length !== actualFields.length) {
    issues.push({
      code: "moduleSectionFieldCountMismatch",
      sectionPath,
      expected: expectedFields.length,
      actual: actualFields.length,
      message: `Section "${sectionPathLabel(sectionPath)}" must retain all module fields in their original order.`,
    });
  }

  const count = Math.min(expectedFields.length, actualFields.length);
  for (let index = 0; index < count; index += 1) {
    const expectedField = expectedFields[index] || {};
    const actualField = actualFields[index] || {};
    const expectedSourceKey = fieldSourceKey(expectedField);
    const actualSourceKey = actualField.sourceModuleFieldKey || null;

    if (actualSourceKey !== expectedSourceKey) {
      issues.push({
        code: "moduleFieldOrderOrPathMismatch",
        field: actualField?.key || expectedSourceKey,
        sectionPath,
        expected: expectedSourceKey,
        actual: actualSourceKey,
        message: `Field "${actualField?.key || expectedSourceKey || "unknown"}" must remain in its original module section and order.`,
      });
    }
    if ((actualField?.key ?? null) !== (expectedField?.key ?? null)) {
      issues.push({
        code: "moduleFieldKeyMismatch",
        field: actualField?.key || expectedSourceKey,
        sectionPath,
        expected: expectedField?.key ?? null,
        actual: actualField?.key ?? null,
        message: `Field "${expectedSourceKey || "unknown"}" must keep its module key.`,
      });
    }
    if (!sameCanonicalLabel(expectedField?.label, actualField?.label)) {
      issues.push({
        code: "moduleFieldLabelMismatch",
        field: actualField?.key || expectedSourceKey,
        sectionPath,
        expected: expectedField?.label ?? null,
        actual: actualField?.label ?? null,
        message: `Field "${expectedSourceKey || "unknown"}" must keep its module label.`,
      });
    }
    if (expectedField?.type === "table" || actualField?.type === "table") {
      compareTableColumns({ expectedField, actualField, sectionPath, issues });
    }
  }
}

/**
 * Compares a submitted section tree against its registered module tree.
 * Structural data is intentionally exact: section and field order, keys,
 * labels, nesting, and table-column topology cannot drift. Presentation and
 * governance metadata is validated separately and may remain configurable.
 */
function getModuleTopologyIssues({ canonicalSections = [], submittedSections = [] } = {}) {
  const issues = [];
  const pending = [{
    canonicalList: asArray(canonicalSections),
    submittedList: asArray(submittedSections),
    parentPath: [],
  }];

  while (pending.length) {
    const { canonicalList, submittedList, parentPath } = pending.pop();
    if (canonicalList.length !== submittedList.length) {
      issues.push({
        code: "moduleSectionCountMismatch",
        sectionPath: parentPath,
        expected: canonicalList.length,
        actual: submittedList.length,
        message: `Section "${sectionPathLabel(parentPath)}" must retain all module subsections in their original order.`,
      });
    }

    const count = Math.min(canonicalList.length, submittedList.length);
    for (let index = count - 1; index >= 0; index -= 1) {
      const expectedSection = canonicalList[index] || {};
      const actualSection = submittedList[index] || {};
      const expectedSectionKey = expectedSection.key ?? null;
      const nextPath = [...parentPath, expectedSectionKey || `section${index + 1}`];

      if ((actualSection.key ?? null) !== expectedSectionKey) {
        issues.push({
          code: "moduleSectionKeyOrOrderMismatch",
          sectionPath: nextPath,
          expected: expectedSectionKey,
          actual: actualSection.key ?? null,
          message: `Section "${expectedSectionKey || "unknown"}" must remain in its original module position and keep its key.`,
        });
      }
      if (!sameCanonicalLabel(expectedSection.label, actualSection.label)) {
        issues.push({
          code: "moduleSectionLabelMismatch",
          sectionPath: nextPath,
          expected: expectedSection.label ?? null,
          actual: actualSection.label ?? null,
          message: `Section "${expectedSectionKey || "unknown"}" must keep its module label.`,
        });
      }

      compareSectionFields({
        expectedSection,
        actualSection,
        sectionPath: nextPath,
        issues,
      });
      pending.push({
        canonicalList: asArray(expectedSection.sections),
        submittedList: asArray(actualSection.sections),
        parentPath: nextPath,
      });
    }
  }

  return issues;
}

module.exports = {
  getModuleTopologyIssues,
};
