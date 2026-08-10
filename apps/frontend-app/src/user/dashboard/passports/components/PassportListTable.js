import React, { useCallback, useMemo, useState } from "react";
import { sortIndicator } from "../../../../shared/table/tableControls";
import { useI18n } from "../../../../app/providers/i18n";

function SortableHeader({ columnKey, label, sortConfig, toggleSort }) {
  const indicator = sortIndicator(sortConfig, columnKey);

  return (
    <button type="button" className="table-sort-btn" onClick={() => toggleSort(columnKey)}>
      {label}
      {indicator ? ` ${indicator}` : ""}
    </button>
  );
}

export function PassportListTable({
  user,
  selectionMode,
  getVisiblePassportKeys,
  paginatedPassports,
  selectedPassports,
  toggleSelectAll,
  sortConfig,
  toggleSort,
  showFilters,
  columnFilters,
  updateColumnFilter,
  expandedPassportGroups,
  renderPassportRow,
}) {
  const { t } = useI18n();
  const [identifierColumnWidths, setIdentifierColumnWidths] = useState({});
  const widestIdentifierColumn = useMemo(
    () => Math.max(0, ...Object.values(identifierColumnWidths)),
    [identifierColumnWidths],
  );
  const updateIdentifierColumnWidth = useCallback((cellId, width) => {
    setIdentifierColumnWidths((currentWidths) => {
      const nextWidth = Number.isFinite(width) && width > 0 ? Math.ceil(width) : 0;
      if (nextWidth === 0 && !currentWidths[cellId]) return currentWidths;
      if (nextWidth === currentWidths[cellId]) return currentWidths;

      const nextWidths = { ...currentWidths };
      if (nextWidth === 0) delete nextWidths[cellId];
      else nextWidths[cellId] = nextWidth;
      return nextWidths;
    });
  }, []);
  const hasWideIdentifiers = widestIdentifierColumn > 0;

  return (
    <div className={`table-scroll-wrapper passport-list-scroll-wrapper${hasWideIdentifiers ? " passport-list-scroll-wrapper--wide-identifiers" : ""}`}>
      <table
        className={`passports-table passport-list-table${hasWideIdentifiers ? " passport-list-table--wide-identifiers" : ""}`}
        style={hasWideIdentifiers ? { "--passport-identifier-wide-column-width": `${widestIdentifierColumn}px` } : undefined}
      >
        <thead>
          <tr>
            {user?.role !== "viewer" && selectionMode && (
              <th className="passport-table-select-col">
                <input
                  type="checkbox"
                  checked={(() => {
                    const visibleKeys = getVisiblePassportKeys(paginatedPassports);
                    return visibleKeys.length > 0 && visibleKeys.every((key) => selectedPassports.has(key));
                  })()}
                  onChange={toggleSelectAll}
                  title={t("selectAll")}
                />
              </th>
            )}
            <th className="passport-table-pin-col"></th>
            <th className="passport-version-col"><SortableHeader columnKey="versionNumber" label={t("versionAbbreviation")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th className="passport-serial-col"><SortableHeader columnKey="serialNumber" label={t("serialNumber")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th className="passport-model-col"><SortableHeader columnKey="modelName" label={t("model")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th className="passport-date-col"><SortableHeader columnKey="createdAt" label={t("date")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th className="passport-status-col"><SortableHeader columnKey="releaseStatus" label={t("status")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th className="passport-view-col" scope="col">{t("viewer")}</th>
            <th className="passport-options-col">{t("options")}</th>
            <th><SortableHeader columnKey="completeness" label={t("complete")} sortConfig={sortConfig} toggleSort={toggleSort} /></th>
          </tr>
          {showFilters && (
            <tr className="table-filter-row">
              {user?.role !== "viewer" && selectionMode && <th></th>}
              <th></th>
              <th><input className="table-filter-input" value={columnFilters.versionNumber || ""} onChange={(e) => updateColumnFilter("versionNumber", e.target.value)} placeholder={t("filter")} /></th>
              <th className="passport-serial-col"><input className="table-filter-input" value={columnFilters.serialNumber || ""} onChange={(e) => updateColumnFilter("serialNumber", e.target.value)} placeholder={t("filter")} /></th>
              <th className="passport-model-col"><input className="table-filter-input" value={columnFilters.modelName || ""} onChange={(e) => updateColumnFilter("modelName", e.target.value)} placeholder={t("filter")} /></th>
              <th className="passport-date-col"><input className="table-filter-input" value={columnFilters.createdAt || ""} onChange={(e) => updateColumnFilter("createdAt", e.target.value)} placeholder={t("filter")} /></th>
              <th className="passport-status-col"><input className="table-filter-input" value={columnFilters.releaseStatus || ""} onChange={(e) => updateColumnFilter("releaseStatus", e.target.value)} placeholder={t("filter")} /></th>
              <th></th>
              <th className="passport-options-col"></th>
              <th><input className="table-filter-input" value={columnFilters.completeness || ""} onChange={(e) => updateColumnFilter("completeness", e.target.value)} placeholder={t("filter")} /></th>
            </tr>
          )}
        </thead>
        <tbody>
          {paginatedPassports.map((group) => (
            <React.Fragment key={group.key}>
              {renderPassportRow(group.latest, {
                parentGuid: group.key,
                hasOlderVersions: group.olderVersions.length > 0,
                latestVersionNumber: group.latest.versionNumber,
                onIdentifierColumnWidthChange: updateIdentifierColumnWidth,
              })}
              {expandedPassportGroups.has(group.key) && group.olderVersions.map((version) =>
                renderPassportRow(version, {
                  parentGuid: group.key,
                  isHistorical: true,
                  latestVersionNumber: group.latest.versionNumber,
                  onIdentifierColumnWidthChange: updateIdentifierColumnWidth,
                })
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
