import { toFieldKey } from "./builderHelpers";
import { normalizeSemanticModelKey } from "./semanticTermCatalog";
import { normalizeTableColumns } from "../../shared/passports/tableSchemaUtils";

function getSectionChildren(section = {}) {
  if (Array.isArray(section.sections)) return section.sections;
  return [];
}

function withChildSections(section, children) {
  const nextSection = { ...section };
  if (children.length) {
    nextSection.sections = children;
  } else {
    delete nextSection.sections;
  }
  return nextSection;
}

function semanticTerminalSegment(semanticId = "") {
  const raw = String(semanticId || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0].replace(/\/+$/g, "");
  const hashSegment = withoutQuery.includes("#") ? withoutQuery.split("#").pop() : "";
  const pathSegment = withoutQuery.split("/").pop();
  const colonSegment = withoutQuery.split(":").pop();
  return hashSegment || pathSegment || colonSegment || "";
}

export function canonicalFieldKeyFromSemanticId(semanticId = "", fallback = "") {
  return toFieldKey(semanticTerminalSegment(semanticId) || fallback);
}

export function normalizeFieldForSemanticModel(
  field,
  semanticModelKey,
  { clearSemanticId = false } = {},
) {
  const nextField = {
    ...field,
    key: field.key || canonicalFieldKeyFromSemanticId(field.semanticId, field.label || ""),
  };

  if (nextField.type === "table") {
    nextField.dataType = "array";
    nextField.objectType = nextField.objectType || "DataElementCollection";
    nextField.valueDataType = "Array";
    nextField.tableColumns = normalizeTableColumns(nextField);
    nextField.tableColumnCount = nextField.tableColumns.length;
  }

  if (!normalizeSemanticModelKey(semanticModelKey) || clearSemanticId) {
    delete nextField.semanticId;
    delete nextField._semanticSearch;
    delete nextField._semanticOpen;
    if (nextField.type === "table") {
      nextField.tableColumns = normalizeTableColumns(nextField).map(
        (column) => {
          const nextColumn = { ...column };
          delete nextColumn.semanticId;
          delete nextColumn._semanticSearch;
          delete nextColumn._semanticOpen;
          return nextColumn;
        },
      );
    }
  }

  return nextField;
}

export function syncSectionsWithSemanticModel(
  currentSections,
  semanticModelKey,
  options = {},
) {
  let hasChanges = false;

  const syncSection = (section) => {
    let sectionChanged = false;

    const nextFields = (section.fields || []).map((field) => {
      const normalizedField = normalizeFieldForSemanticModel(
        field,
        semanticModelKey,
        options,
      );
      const nextKey = normalizedField.key || field.key;
      const nextSemanticId = normalizedField.semanticId;
      const keyChanged = nextKey !== field.key;
      const semanticChanged = nextSemanticId !== field.semanticId;

      if (!keyChanged && !semanticChanged) return field;

      sectionChanged = true;
      hasChanges = true;

      if (nextSemanticId) {
        return {
          ...field,
          key: nextKey,
          semanticId: nextSemanticId,
        };
      }

      const nextField = {
        ...field,
        key: nextKey,
      };
      delete nextField.semanticId;
      return nextField;
    });

    const sourceChildren = getSectionChildren(section);
    const nextChildren = sourceChildren.map(syncSection);
    const childrenChanged = nextChildren.some((child, index) => child !== sourceChildren[index]);
    if (childrenChanged) hasChanges = true;
    if (!sectionChanged && !childrenChanged) return section;
    return withChildSections({
      ...section,
      fields: nextFields,
    }, nextChildren);
  };

  const nextSections = currentSections.map(syncSection);

  return hasChanges ? nextSections : currentSections;
}

export function rekeyModuleSection(section = {}, sourceModuleKey = "") {
  const childSections = getSectionChildren(section).map((child) =>
    rekeyModuleSection(child, sourceModuleKey)
  );
  return withChildSections({
    ...section,
    localId: Math.random().toString(36).slice(2),
    labelI18n: section.labelI18n || {},
    sourceModuleKey,
    fields: (section.fields || []).map((field) => {
      const tableColumns =
        field.type === "table"
          ? normalizeTableColumns(field).map((column) => ({
              ...column,
              canonicalLocked: true,
              sourceModuleKey,
              sourceModuleColumnKey: column.key,
            }))
          : undefined;
      const nextField = {
        ...field,
        localId: Math.random().toString(36).slice(2),
        labelI18n: field.labelI18n || {},
        _keyManual: true,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
        required: false,
      };
      if (tableColumns) {
        nextField.tableColumns = tableColumns;
        nextField.tableColumnCount = tableColumns.length;
      }
      return nextField;
    }),
  }, childSections);
}

export function unlockModuleSection(section = {}) {
  const sectionRest = { ...section };
  delete sectionRest.sourceModuleKey;
  const childSections = getSectionChildren(section).map(unlockModuleSection);
  return withChildSections({
    ...sectionRest,
    fields: (section.fields || []).map((field) => {
      const fieldRest = { ...field };
      delete fieldRest.canonicalLocked;
      delete fieldRest.sourceModuleKey;
      delete fieldRest.sourceModuleFieldKey;
      if (fieldRest.type !== "table") return fieldRest;

      const tableColumns = normalizeTableColumns(fieldRest).map((column) => {
        const columnRest = { ...column };
        delete columnRest.canonicalLocked;
        delete columnRest.sourceModuleKey;
        delete columnRest.sourceModuleColumnKey;
        return columnRest;
      });
      return {
        ...fieldRest,
        tableColumns,
      };
    }),
  }, childSections);
}
