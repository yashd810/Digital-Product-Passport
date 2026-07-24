"use strict";

const {
  assertCanonicalSchemaSections,
  isSafePassportStorageFieldKey,
  walkSchemaSections,
} = require("../../shared/passports/passport-helpers");
const { getPassportFieldDataTypeError } = require("../../shared/passports/passport-field-data-types");
const {
  findReservedPassportHeaderFieldConflicts,
} = require("../../shared/passports/passport-reserved-fields");

// Passport type schemas are authored by authenticated users, but still arrive
// as untrusted JSON. These ceilings are intentionally far above a practical
// DPP form while ensuring traversal and validation remain bounded.
const passportTypeSchemaLimits = Object.freeze({
  maxDepth: 32,
  maxSections: 500,
  maxFields: 2000,
});

function getSectionTreeShapeError(sections) {
  if (!Array.isArray(sections)) return "At least one section is required";
  if (sections.length > passportTypeSchemaLimits.maxSections) {
    return `Passport type schemas support at most ${passportTypeSchemaLimits.maxSections} sections.`;
  }

  let sectionCount = 0;
  let fieldCount = 0;
  const pending = [];
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    pending.push({ section: sections[index], depth: 1 });
  }

  while (pending.length) {
    const { section, depth } = pending.pop();
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return "Each section must be an object";
    }
    if (Object.prototype.hasOwnProperty.call(section, "groups")) {
      return 'Passport schemas must use "sections"; the retired "groups" property is not supported.';
    }
    if (depth > passportTypeSchemaLimits.maxDepth) {
      return `Passport type schemas support at most ${passportTypeSchemaLimits.maxDepth} nested section levels.`;
    }
    sectionCount += 1;
    if (sectionCount > passportTypeSchemaLimits.maxSections) {
      return `Passport type schemas support at most ${passportTypeSchemaLimits.maxSections} sections.`;
    }

    if (section.fields !== undefined && !Array.isArray(section.fields)) {
      return "Each section fields value must be an array";
    }
    fieldCount += Array.isArray(section.fields) ? section.fields.length : 0;
    if (fieldCount > passportTypeSchemaLimits.maxFields) {
      return `Passport type schemas support at most ${passportTypeSchemaLimits.maxFields} fields.`;
    }

    if (section.sections !== undefined && !Array.isArray(section.sections)) {
      return "Each section sections value must be an array";
    }
    const childSections = Array.isArray(section.sections) ? section.sections : [];
    if (pending.length + childSections.length > passportTypeSchemaLimits.maxSections - sectionCount) {
      return `Passport type schemas support at most ${passportTypeSchemaLimits.maxSections} sections.`;
    }
    for (let index = childSections.length - 1; index >= 0; index -= 1) {
      pending.push({ section: childSections[index], depth: depth + 1 });
    }
  }

  return null;
}

function validatePassportTypeSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return "At least one section is required";
  }

  const shapeError = getSectionTreeShapeError(sections);
  if (shapeError) return shapeError;

  try {
    assertCanonicalSchemaSections(sections);
  } catch (error) {
    return error.message;
  }

  const seenFieldKeys = new Set();
  let validationError = null;
  walkSchemaSections(sections, (section) => {
    if (validationError) return;
    if (!section.key || !section.label) {
      validationError = "Each section must have key and label";
      return;
    }
    if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(section.key)) {
      validationError = `Invalid section key: ${section.key}. Section keys must be camelCase, start with a lowercase letter, and contain only letters and numbers.`;
      return;
    }
    const fields = Array.isArray(section.fields) ? section.fields : [];
    const childSections = Array.isArray(section.sections) ? section.sections : [];
    if (fields.length === 0 && childSections.length === 0) {
      validationError = "A section without subsections needs at least one field.";
      return;
    }
    for (const field of fields) {
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        validationError = "Each field must be an object";
        return;
      }
      if (!field.key || !field.label || !field.type) {
        validationError = "Each field must have key, label, and type";
        return;
      }
      if (!isSafePassportStorageFieldKey(field.key)) {
        validationError = `Invalid field key: ${field.key}. Field keys must be lower camelCase identifiers of at most 200 characters.`;
        return;
      }
      if (seenFieldKeys.has(field.key)) {
        validationError = `Duplicate field key: ${field.key}`;
        return;
      }
      seenFieldKeys.add(field.key);
      if (![
        "text",
        "textarea",
        "boolean",
        "file",
        "table",
        "url",
        "date",
        "datetime",
        "symbol",
        "object",
        "objectList",
        "select",
        "multiselect",
        "scalarList",
      ].includes(field.type)) {
        validationError = `Invalid field type: ${field.type}`;
        return;
      }
      const dataTypeError = getPassportFieldDataTypeError(field);
      if (dataTypeError) {
        validationError = dataTypeError;
        return;
      }
    }
  });
  return validationError;
}

module.exports = {
  findReservedPassportHeaderFieldConflicts,
  getSectionTreeShapeError,
  passportTypeSchemaLimits,
  validatePassportTypeSections,
};
