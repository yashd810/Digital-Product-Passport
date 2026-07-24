import { flattenSchemaFieldsFromSections } from "./passportSchemaUtils";

export const semanticRelationshipsSectionKey = "semanticRelationships";

export function isSemanticRelationshipsSection(section) {
  return String(section?.key || "").trim() === semanticRelationshipsSectionKey;
}

/**
 * The generated semantic-relationships section describes the schema graph; it
 * is not passport record data. Keep that metadata in the passport type, while
 * removing its generated editor section from company-user data-entry screens.
 */
export function filterPassportDataEntrySections(sections) {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter((section) => !isSemanticRelationshipsSection(section))
    .map((section) => {
      if (!Array.isArray(section?.sections)) return section;

      const visibleChildren = filterPassportDataEntrySections(section.sections);
      const childrenUnchanged = visibleChildren.length === section.sections.length
        && visibleChildren.every((child, index) => child === section.sections[index]);

      return childrenUnchanged
        ? section
        : { ...section, sections: visibleChildren };
    });
}

export function getPassportDataEntryFieldKeys(sections) {
  const sectionList = Array.isArray(sections)
    ? sections
    : Object.values(sections && typeof sections === "object" ? sections : {});
  return new Set(
    flattenSchemaFieldsFromSections(sectionList)
      .map((field) => field?.key)
      .filter(Boolean)
  );
}

export function selectPassportDataEntryValues(record, sections) {
  const allowedKeys = getPassportDataEntryFieldKeys(sections);
  return Object.fromEntries(
    Object.entries(record && typeof record === "object" ? record : {})
      .filter(([key]) => allowedKeys.has(key))
  );
}
