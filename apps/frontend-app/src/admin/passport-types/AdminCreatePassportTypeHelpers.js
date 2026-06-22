import React from "react";
import { toFieldKey } from "./builderHelpers";
import { normalizeSemanticModelKey } from "./semanticTermCatalog";
import { normalizeTableColumns } from "../../shared/passports/tableSchemaUtils";

export function summarizeSelectedValues(
  values = [],
  labelMap = {},
  emptyLabel = "Select options",
) {
  const normalized = Array.isArray(values) ? values : [];
  if (!normalized.length) return emptyLabel;
  if (normalized.length <= 2) {
    return normalized.map((value) => labelMap[value] || value).join(", ");
  }
  const [first, second] = normalized;
  return `${labelMap[first] || first}, ${labelMap[second] || second} +${normalized.length - 2}`;
}

export function CheckboxDropdown({
  label,
  icon,
  summary,
  isOpen,
  onToggle,
  children,
  className = "",
}) {
  return (
    <div
      className={`acpt-checkbox-dropdown ${className}${isOpen ? " open" : ""}`}
    >
      <span className="acpt-access-label">
        {icon} {label}:
      </span>
      <button
        type="button"
        className="acpt-checkbox-dropdown-trigger"
        onClick={onToggle}
      >
        <span className="acpt-checkbox-dropdown-summary">{summary}</span>
        <span className="acpt-checkbox-dropdown-caret">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>
      {isOpen && <div className="acpt-checkbox-dropdown-menu">{children}</div>}
    </div>
  );
}

export function normalizeFieldForSemanticModel(
  field,
  semanticModelKey,
  { clearSemanticId = false } = {},
) {
  const nextField = {
    ...field,
    key: field.key || toFieldKey(field.label || ""),
  };

  if (nextField.type === "table") {
    nextField.table_columns = normalizeTableColumns(nextField);
    nextField.table_cols = nextField.table_columns.length;
  }

  if (!normalizeSemanticModelKey(semanticModelKey) || clearSemanticId) {
    delete nextField.semanticId;
    delete nextField._semanticSearch;
    delete nextField._semanticOpen;
    if (nextField.type === "table") {
      nextField.table_columns = normalizeTableColumns(nextField).map(
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

  const nextSections = currentSections.map((section) => {
    let sectionChanged = false;

    const nextFields = section.fields.map((field) => {
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

    if (!sectionChanged) return section;
    return {
      ...section,
      fields: nextFields,
    };
  });

  return hasChanges ? nextSections : currentSections;
}

export function rekeyModuleSection(section = {}, sourceModuleKey = "") {
  return {
    ...section,
    localId: Math.random().toString(36).slice(2),
    label_i18n: section.label_i18n || {},
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
        label_i18n: field.label_i18n || {},
        _keyManual: true,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
        required: false,
      };
      if (tableColumns) {
        nextField.table_columns = tableColumns;
        nextField.table_cols = tableColumns.length;
      }
      return nextField;
    }),
  };
}

export function unlockModuleSection(section = {}) {
  const sectionRest = { ...section };
  delete sectionRest.sourceModuleKey;
  return {
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
        table_columns: tableColumns,
      };
    }),
  };
}
