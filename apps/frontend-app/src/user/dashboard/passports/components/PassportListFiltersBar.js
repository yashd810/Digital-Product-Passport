import React from "react";
import AppSelect from "../../../../shared/components/AppSelect";
import { useI18n } from "../../../../app/providers/i18n";

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
  const { t } = useI18n();
  return (
    <div className="search-bar">
      <input type="text" placeholder={`🔍 ${t("searchPassports")}`} value={searchText} onChange={(e) => setSearchText(e.target.value)} className="search-input" />
      <AppSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select" aria-label={t("filterPassportsByStatus")}>
        <option value="">{t("allStatuses")}</option>
        <option value="draft">{t("draft")}</option>
        <option value="released">{t("released")}</option>
        <option value="inRevision">{t("revised")}</option>
        <option value="obsolete">{t("obsolete")}</option>
      </AppSelect>
      {(searchText || filterStatus) && (
        <button className="clear-filter-btn" onClick={() => { setSearchText(""); setFilterStatus(""); }}>
          ✕ {t("clear")}
        </button>
      )}
      <button
        type="button"
        className={`table-filter-toggle-btn search-filter-toggle-btn${showFilters ? " active" : ""}`}
        onClick={() => setShowFilters((prev) => !prev)}
        title={showFilters ? t("hideColumnFilters") : t("showColumnFilters")}
      >
        {t("filter")}
      </button>
      {!isFiltering && (
        <div className="passport-pagination-size">
          <label htmlFor="passportRowsPerPage" className="passport-pagination-label">{t("rowsPerPage")}</label>
          <AppSelect id="passportRowsPerPage" value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className="filter-select passport-page-size-select">
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </AppSelect>
        </div>
      )}
    </div>
  );
}
