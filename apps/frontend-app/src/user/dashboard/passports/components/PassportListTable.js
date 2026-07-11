import React from "react";
import { sortIndicator } from "../../../../shared/table/tableControls";

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
  filterByUser,
  sortConfig,
  toggleSort,
  showFilters,
  columnFilters,
  updateColumnFilter,
  expandedPassportGroups,
  renderPassportRow,
}) {
  return (
    <div className="table-scroll-wrapper">
      <table className="passports-table">
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
                  title="Select All"
                />
              </th>
            )}
            <th className="passport-table-pin-col"></th>
            <th className="passport-version-col"><SortableHeader columnKey="versionNumber" label="Ver." sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="serialNumber" label="Serial Number" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="modelName" label="Model" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            {filterByUser && <th><SortableHeader columnKey="passportType" label="Type" sortConfig={sortConfig} toggleSort={toggleSort} /></th>}
            <th><SortableHeader columnKey="createdAt" label="Date" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="releaseStatus" label="Status" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="completeness" label="Complete" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            {!filterByUser && <th><SortableHeader columnKey="createdBy" label="Created By" sortConfig={sortConfig} toggleSort={toggleSort} /></th>}
            <th>Options</th>
          </tr>
          {showFilters && (
            <tr className="table-filter-row">
              {user?.role !== "viewer" && selectionMode && <th></th>}
              <th></th>
              <th><input className="table-filter-input" value={columnFilters.versionNumber || ""} onChange={(e) => updateColumnFilter("versionNumber", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.serialNumber || ""} onChange={(e) => updateColumnFilter("serialNumber", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.modelName || ""} onChange={(e) => updateColumnFilter("modelName", e.target.value)} placeholder="Filter" /></th>
              {filterByUser && <th><input className="table-filter-input" value={columnFilters.passportType || ""} onChange={(e) => updateColumnFilter("passportType", e.target.value)} placeholder="Filter" /></th>}
              <th><input className="table-filter-input" value={columnFilters.createdAt || ""} onChange={(e) => updateColumnFilter("createdAt", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.releaseStatus || ""} onChange={(e) => updateColumnFilter("releaseStatus", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.completeness || ""} onChange={(e) => updateColumnFilter("completeness", e.target.value)} placeholder="Filter" /></th>
              {!filterByUser && <th><input className="table-filter-input" value={columnFilters.createdBy || ""} onChange={(e) => updateColumnFilter("createdBy", e.target.value)} placeholder="Filter" /></th>}
              <th></th>
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
              })}
              {expandedPassportGroups.has(group.key) && group.olderVersions.map((version) =>
                renderPassportRow(version, {
                  parentGuid: group.key,
                  isHistorical: true,
                  latestVersionNumber: group.latest.versionNumber,
                })
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
