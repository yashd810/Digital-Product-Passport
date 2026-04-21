import React from "react";

export function PassportListPagination({
  currentPage,
  setCurrentPage,
  rowsPerPage,
  filteredAndSortedPassports,
  totalPages,
}) {
  return (
    <div className="passport-pagination">
      <div className="passport-pagination-summary">
        Showing {(currentPage - 1) * rowsPerPage + 1}-{Math.min(currentPage * rowsPerPage, filteredAndSortedPassports.length)} of {filteredAndSortedPassports.length}
      </div>
      <div className="passport-pagination-controls">
        <button type="button" className="passport-page-btn" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
          Previous
        </button>
        <span className="passport-page-indicator">Page {currentPage} of {totalPages}</span>
        <button type="button" className="passport-page-btn" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}
