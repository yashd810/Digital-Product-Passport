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
            <th className="passport-version-col"><SortableHeader columnKey="version_number" label="Ver." sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="product_id" label="Serial Number" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="model_name" label="Model" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            {filterByUser && <th><SortableHeader columnKey="passport_type" label="Type" sortConfig={sortConfig} toggleSort={toggleSort} /></th>}
            <th><SortableHeader columnKey="created_at" label="Date" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="release_status" label="Status" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            <th><SortableHeader columnKey="completeness" label="Complete" sortConfig={sortConfig} toggleSort={toggleSort} /></th>
            {!filterByUser && <th><SortableHeader columnKey="created_by" label="Created By" sortConfig={sortConfig} toggleSort={toggleSort} /></th>}
            <th>Options</th>
          </tr>
          {showFilters && (
            <tr className="table-filter-row">
              {user?.role !== "viewer" && selectionMode && <th></th>}
              <th></th>
              <th><input className="table-filter-input" value={columnFilters.version_number || ""} onChange={(e) => updateColumnFilter("version_number", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.product_id || ""} onChange={(e) => updateColumnFilter("product_id", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.model_name || ""} onChange={(e) => updateColumnFilter("model_name", e.target.value)} placeholder="Filter" /></th>
              {filterByUser && <th><input className="table-filter-input" value={columnFilters.passport_type || ""} onChange={(e) => updateColumnFilter("passport_type", e.target.value)} placeholder="Filter" /></th>}
              <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={(e) => updateColumnFilter("created_at", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.release_status || ""} onChange={(e) => updateColumnFilter("release_status", e.target.value)} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.completeness || ""} onChange={(e) => updateColumnFilter("completeness", e.target.value)} placeholder="Filter" /></th>
              {!filterByUser && <th><input className="table-filter-input" value={columnFilters.created_by || ""} onChange={(e) => updateColumnFilter("created_by", e.target.value)} placeholder="Filter" /></th>}
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
                latestVersionNumber: group.latest.version_number,
              })}
              {expandedPassportGroups.has(group.key) && group.olderVersions.map((version) =>
                renderPassportRow(version, {
                  parentGuid: group.key,
                  isHistorical: true,
                  latestVersionNumber: group.latest.version_number,
                })
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
