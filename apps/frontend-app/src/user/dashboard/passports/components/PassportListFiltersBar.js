import React from "react";

export function PassportListFiltersBar({
  searchText,
  setSearchText,
  filterStatus,
  setFilterStatus,
  showFilters,
  setShowFilters,
  isFiltering,
  rowsPerPage,
  setRowsPerPage,
}) {
  return (
    <div className="search-bar">
      <input type="text" placeholder="🔍 Search by serial number or model name…" value={searchText} onChange={(e) => setSearchText(e.target.value)} className="search-input" />
      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select">
        <option value="">All Statuses</option>
        <option value="draft">Draft</option>
        <option value="released">Released</option>
        <option value="in_revision">In Revision</option>
        <option value="obsolete">Obsolete</option>
      </select>
      {(searchText || filterStatus) && (
        <button className="clear-filter-btn" onClick={() => { setSearchText(""); setFilterStatus(""); }}>
          ✕ Clear
        </button>
      )}
      <button
        type="button"
        className={`table-filter-toggle-btn search-filter-toggle-btn${showFilters ? " active" : ""}`}
        onClick={() => setShowFilters((prev) => !prev)}
        title={showFilters ? "Hide column filters" : "Show column filters"}
      >
        Filter
      </button>
      {!isFiltering && (
        <div className="passport-pagination-size">
          <label htmlFor="passportRowsPerPage" className="passport-pagination-label">Rows per page</label>
          <select id="passportRowsPerPage" value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className="filter-select passport-page-size-select">
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
      )}
    </div>
  );
}
