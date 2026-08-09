import React from "react";
import { useI18n } from "../../../../app/providers/i18n";

export function PassportListPagination({
  currentPage,
  setCurrentPage,
  rowsPerPage,
  filteredAndSortedPassports,
  totalPages,
}) {
  const { t } = useI18n();
  const from = (currentPage - 1) * rowsPerPage + 1;
  const to = Math.min(currentPage * rowsPerPage, filteredAndSortedPassports.length);
  return (
    <div className="passport-pagination">
      <div className="passport-pagination-summary">
        {t("showingPassports", { from, to, total: filteredAndSortedPassports.length })}
      </div>
      <div className="passport-pagination-controls">
        <button type="button" className="passport-page-btn" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
          {t("previous")}
        </button>
        <span className="passport-page-indicator">{t("pageOf", { current: currentPage, total: totalPages })}</span>
        <button type="button" className="passport-page-btn" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
          {t("next")}
        </button>
      </div>
    </div>
  );
}
