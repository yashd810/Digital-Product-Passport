"use strict";

(function exposePassportModuleSchemaLimits(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleSchemaLimits = api;
})(typeof globalThis === "object" ? globalThis : null, () => {
  const passportModuleSchemaLimits = Object.freeze({
    maxDepth: 32,
    maxSections: 500,
    maxFields: 2000,
  });

  function getSectionTreeLimitError(sections) {
    if (!Array.isArray(sections)) return "Sections must be an array.";
    if (sections.length > passportModuleSchemaLimits.maxSections) {
      return `Passport module schemas support at most ${passportModuleSchemaLimits.maxSections} sections.`;
    }

    let sectionCount = 0;
    let fieldCount = 0;
    const pending = sections
      .map((section) => ({ section, depth: 1 }))
      .reverse();

    while (pending.length) {
      const { section, depth } = pending.pop();
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        return "Each section must be an object.";
      }
      if (Object.prototype.hasOwnProperty.call(section, "groups")) {
        return 'Passport module sections must use "sections"; the retired "groups" property is not supported.';
      }
      if (depth > passportModuleSchemaLimits.maxDepth) {
        return `Passport module schemas support at most ${passportModuleSchemaLimits.maxDepth} nested section levels.`;
      }
      sectionCount += 1;
      if (sectionCount > passportModuleSchemaLimits.maxSections) {
        return `Passport module schemas support at most ${passportModuleSchemaLimits.maxSections} sections.`;
      }

      if (section.fields !== undefined && !Array.isArray(section.fields)) {
        return "Each section fields value must be an array.";
      }
      fieldCount += Array.isArray(section.fields) ? section.fields.length : 0;
      if (fieldCount > passportModuleSchemaLimits.maxFields) {
        return `Passport module schemas support at most ${passportModuleSchemaLimits.maxFields} fields.`;
      }

      if (section.sections !== undefined && !Array.isArray(section.sections)) {
        return "Each section sections value must be an array.";
      }
      const childSections = Array.isArray(section.sections) ? section.sections : [];
      if (pending.length + childSections.length > passportModuleSchemaLimits.maxSections - sectionCount) {
        return `Passport module schemas support at most ${passportModuleSchemaLimits.maxSections} sections.`;
      }
      for (let index = childSections.length - 1; index >= 0; index -= 1) {
        pending.push({ section: childSections[index], depth: depth + 1 });
      }
    }

    return null;
  }

  return {
    getSectionTreeLimitError,
    passportModuleSchemaLimits,
  };
});
