// Field renderer: keeps type-specific input controls separate from page-level form policy.
import React from "react";
import {
  createEmptyTableRow,
  normalizeTableColumns,
  parseTableRows,
} from "../../../shared/passports/tableSchemaUtils";
import SemanticGraphFieldEditor from "../../../shared/passports/SemanticGraphFieldEditor";
import { toSafeImageSrc, toSafeResourceHref } from "../../../shared/security/urlSafety";
import { formatFieldLabelWithUnit } from "../../../passport-viewer/utils/viewerHelpers";
import { getFieldInputPrompt } from "../passportFormDrafts";
import { useI18n } from "../../../app/providers/i18n";

/**
 * Type-specific passport field control.
 *
 * The form page decides which fields are visible, editable, or required. This
 * component renders one already-authorized field and reports all edits through
 * its callbacks, keeping file, table, and semantic input behavior together.
 */
function PassportFieldInput({
  field,
  value,
  disabled,
  fieldClassName,
  semanticGraph,
  onChange,
  fileSelections,
  fileDisplayNames,
  symbols,
  onClearFileSelection,
  onOpenRepositoryPicker,
  onOpenSymbolPicker,
}) {
  const { t } = useI18n();
  const semanticProperty = field.rangeKind ? field : null;

  if (semanticProperty && semanticGraph && !["file", "symbol", "table"].includes(field.type)) {
    return (
      <SemanticGraphFieldEditor
        graph={semanticGraph}
        property={semanticProperty}
        value={value}
        disabled={disabled}
        hideRootLabel
        onChange={onChange}
      />
    );
  }

  if (field.type === "boolean") {
    return (
      <label className={fieldClassName} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={!!value}
          onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
        <span style={{ fontSize: 14, color: "var(--text-primary)", fontFamily: "var(--font)" }}>
          {formatFieldLabelWithUnit(field.label, field)}
        </span>
      </label>
    );
  }

  if (field.type === "file") {
    const linkedUrl = toSafeResourceHref(value);
    const selectedFile = fileSelections[field.key];
    const fileName = selectedFile?.name || fileDisplayNames[field.key] || (linkedUrl ? t("linkedDocument") : null);
    const commitPastedUrl = (input) => {
      const safeUrl = toSafeResourceHref(input);
      if (safeUrl) {
        onClearFileSelection(field.key);
        onChange(safeUrl);
      }
      return Boolean(safeUrl);
    };

    return (
      <div className="file-upload-widget">
        {linkedUrl || selectedFile ? (
          <div className="file-existing">
            {linkedUrl ? (
              <a href={linkedUrl} target="_blank" rel="noopener noreferrer" className="file-existing-link">
                📄 {fileName || t("document")}
              </a>
            ) : (
              <span className="file-existing-link">📄 {fileName || t("document")}</span>
            )}
            <button type="button" className="file-clear-btn" disabled={disabled}
              onClick={() => { onClearFileSelection(field.key); onChange(""); }}>✕ {t("remove")}</button>
          </div>
        ) : (
          <button type="button" className="file-upload-label" disabled={disabled}
            onClick={() => onOpenRepositoryPicker(field.key)}>
            <span className="file-placeholder">📁 {t("linkPdfFromRepository")}</span>
          </button>
        )}
        {linkedUrl && (
          <button type="button" className="file-upload-label file-replace-label" disabled={disabled}
            onClick={() => onOpenRepositoryPicker(field.key)}>
            <span className="file-placeholder">↺ {t("change")}</span>
          </button>
        )}
        <div className="file-link-paste">
          <input
            type="text"
            className={`file-link-input${fieldClassName ? ` ${fieldClassName}` : ""}`}
            placeholder={t("repositoryLinkPaste")}
            disabled={disabled}
            value={linkedUrl && document.activeElement?.dataset?.fieldKey !== field.key ? "" : undefined}
            data-field-key={field.key}
            onPaste={(event) => {
              if (commitPastedUrl(event.clipboardData.getData("text").trim())) event.preventDefault();
            }}
            onBlur={(event) => {
              if (commitPastedUrl(event.target.value.trim())) event.target.value = "";
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && commitPastedUrl(event.target.value.trim())) {
                event.target.value = "";
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (field.type === "symbol") {
    const linkedUrl = toSafeResourceHref(value);
    const picked = linkedUrl ? symbols.find((symbol) => symbol.fileUrl === linkedUrl) : null;
    const commitPastedUrl = (input) => {
      const safeUrl = toSafeResourceHref(input);
      if (safeUrl) onChange(safeUrl);
      return Boolean(safeUrl);
    };

    return (
      <div className="file-upload-widget">
        {linkedUrl ? (
          <div className="file-existing">
            {toSafeImageSrc(linkedUrl) && <img src={toSafeImageSrc(linkedUrl)} alt={picked?.name || "symbol"} className="pf-symbol-thumb" />}
            <span className="file-existing-link">{picked?.name || "Symbol"}</span>
            <button type="button" className="file-clear-btn" disabled={disabled}
              onClick={() => onChange("")}>✕ {t("remove")}</button>
          </div>
        ) : (
          <button type="button" className="file-upload-label" disabled={disabled}
            onClick={() => onOpenSymbolPicker(field.key)}>
            <span className="file-placeholder">🔣 {t("linkSymbolFromRepository")}</span>
          </button>
        )}
        {linkedUrl && (
          <button type="button" className="file-upload-label file-replace-label" disabled={disabled}
            onClick={() => onOpenSymbolPicker(field.key)}>
            <span className="file-placeholder">↺ {t("change")}</span>
          </button>
        )}
        <div className="file-link-paste">
          <input
            type="text"
            className={`file-link-input${fieldClassName ? ` ${fieldClassName}` : ""}`}
            placeholder={t("repositoryLinkPaste")}
            disabled={disabled}
            data-field-key={field.key}
            onPaste={(event) => {
              if (commitPastedUrl(event.clipboardData.getData("text").trim())) event.preventDefault();
            }}
            onBlur={(event) => {
              if (commitPastedUrl(event.target.value.trim())) event.target.value = "";
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && commitPastedUrl(event.target.value.trim())) {
                event.target.value = "";
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (field.type === "table") {
    const tableColumns = normalizeTableColumns(field);
    const rows = parseTableRows(value, field);
    const commitTable = (nextRows) => onChange(nextRows);
    const updateCell = (rowIndex, columnIndex, cellValue) => {
      const column = tableColumns[columnIndex];
      if (!column) return;
      const next = rows.map((row) => ({ ...row }));
      next[rowIndex][column.key] = cellValue;
      commitTable(next);
    };
    const addRow = () => commitTable([...rows, createEmptyTableRow(tableColumns)]);
    const removeRow = (rowIndex) => {
      const next = rows.filter((_, index) => index !== rowIndex);
      commitTable(next.length ? next : [createEmptyTableRow(tableColumns)]);
    };

    return (
      <div className="pf-table-wrap">
        <table className="pf-table">
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th key={column.key}>{formatFieldLabelWithUnit(column.label || column.key, column)}</th>
              ))}
              <th className="pf-table-action-col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {tableColumns.map((column, columnIndex) => (
                  <td key={column.key}>
                    <input
                      type="text"
                      value={row[column.key] ?? ""}
                      disabled={disabled}
                      placeholder="—"
                      onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                      className={`pf-table-cell-input${fieldClassName ? ` ${fieldClassName}` : ""}`}
                    />
                  </td>
                ))}
                <td className="pf-table-action-col">
                  <button type="button" className="pf-table-remove-row" onClick={() => removeRow(rowIndex)} disabled={disabled} title={t("removeRow")}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="pf-table-add-row" onClick={addRow} disabled={disabled}>+ {t("addRow")}</button>
      </div>
    );
  }

  if (field.type === "textarea") {
    return <textarea value={value} disabled={disabled}
      className={fieldClassName}
      placeholder={getFieldInputPrompt(field)}
      onChange={(event) => onChange(event.target.value)} />;
  }

  if (field.type === "date") {
    // Native date inputs use YYYY-MM-DD; preserve legacy DD/MM/YYYY values on read.
    const toInput = (input) => {
      if (!input) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
      const [day, month, year] = input.split("/");
      return day && month && year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
    };
    return (
      <div className="pf-date-wrap">
        <input
          type="date"
          value={toInput(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`pf-date-input${fieldClassName ? ` ${fieldClassName}` : ""}`}
        />
        <span className="pf-date-hint">{t("dateFormatHint")}</span>
      </div>
    );
  }

  return <input type="text" value={value} disabled={disabled}
    className={fieldClassName}
    placeholder={getFieldInputPrompt(field)}
    onChange={(event) => onChange(event.target.value)} />;
}

export default PassportFieldInput;
