export function getSectionChildren(section) {
  if (!section || typeof section !== "object") return [];
  if (Array.isArray(section.sections)) return section.sections;
  if (Array.isArray(section.groups)) return section.groups;
  return [];
}

export function walkSchemaSections(sections = [], visitor, parentPath = []) {
  if (!Array.isArray(sections) || typeof visitor !== "function") return;
  sections.forEach((section, index) => {
    if (!section || typeof section !== "object") return;
    const sectionPath = [
      ...parentPath,
      {
        key: section.key || "",
        label: section.label || section.name || section.key || `Section ${index + 1}`,
        index,
        section,
      },
    ];
    visitor(section, sectionPath);
    walkSchemaSections(getSectionChildren(section), visitor, sectionPath);
  });
}

export function flattenSchemaFieldsFromSections(sections = []) {
  const fields = [];
  walkSchemaSections(sections, (section, sectionPath) => {
    const owner = sectionPath[sectionPath.length - 1] || {};
    for (const field of Array.isArray(section?.fields) ? section.fields : []) {
      if (!field?.key) continue;
      fields.push({
        ...field,
        sectionKey: owner.key || null,
        sectionLabel: owner.label || null,
        sectionPath: sectionPath.map((entry) => ({
          key: entry.key || "",
          label: entry.label || "",
        })),
      });
    }
  });
  return fields;
}

export function countSchemaFields(sectionOrSections = []) {
  const sections = Array.isArray(sectionOrSections) ? sectionOrSections : [sectionOrSections];
  return flattenSchemaFieldsFromSections(sections).length;
}

export function normalizeSchemaSections(sections = []) {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((section) => section && typeof section === "object")
    .map((section) => {
      const nestedSections = getSectionChildren(section);
      return {
        ...section,
        label: section.label || section.name || section.key || "",
        fields: Array.isArray(section.fields) ? section.fields : [],
        sections: normalizeSchemaSections(nestedSections),
      };
    });
}
