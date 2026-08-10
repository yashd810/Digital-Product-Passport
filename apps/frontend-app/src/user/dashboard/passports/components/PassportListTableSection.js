import React from "react";
import { useI18n } from "../../../../app/providers/i18n";
import { PassportListFiltersBar } from "./PassportListFiltersBar";
import { PassportListHeader } from "./PassportListHeader";
import { PassportListPagination } from "./PassportListPagination";
import { PassportListSelectionBar } from "./PassportListSelectionBar";
import { PassportListTable } from "./PassportListTable";

export function PassportListTableSection({
  pageTitle,
  user,
  selectionMode,
  setSelectionMode,
  setSelectedPassports,
  setPrintQrModalOpen,
  setExportModalOpen,
  selectedPassportList,
  bulkActionLoading,
  setBulkWorkflowOpen,
  setBulkEditOpen,
  setBulkReviseOpen,
  bulkExportJson,
  bulkArchive,
  bulkDelete,
  searchText,
  setSearchText,
  filterStatus,
  setFilterStatus,
  showFilters,
  setShowFilters,
  isFiltering,
  rowsPerPage,
  setRowsPerPage,
  error,
  successMsg,
  isLoading,
  filteredAndSortedPassports,
  columnFilters,
  updateColumnFilter,
  paginatedPassports,
  getVisiblePassportKeys,
  selectedPassports,
  toggleSelectAll,
  sortConfig,
  toggleSort,
  expandedPassportGroups,
  renderPassportRow,
  currentPage,
  setCurrentPage,
  totalPages,
  activeType,
}) {
  const { t } = useI18n();
  return (
    <>
      <PassportListHeader
        pageTitle={pageTitle}
        user={user}
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        setSelectedPassports={setSelectedPassports}
        setPrintQrModalOpen={setPrintQrModalOpen}
        setExportModalOpen={setExportModalOpen}
      />

      <PassportListSelectionBar
        selectionMode={selectionMode}
        selectedPassportList={selectedPassportList}
        bulkActionLoading={bulkActionLoading}
        setBulkWorkflowOpen={setBulkWorkflowOpen}
        setBulkEditOpen={setBulkEditOpen}
        setBulkReviseOpen={setBulkReviseOpen}
        bulkExportJson={bulkExportJson}
        setPrintQrModalOpen={setPrintQrModalOpen}
        bulkArchive={bulkArchive}
        bulkDelete={bulkDelete}
      />

      <PassportListFiltersBar
        searchText={searchText}
        setSearchText={setSearchText}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        isFiltering={isFiltering}
        rowsPerPage={rowsPerPage}
        setRowsPerPage={setRowsPerPage}
      />

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {isLoading && <div className="loading">{t("loadingPassports")}</div>}

      {!isLoading && (
        <div className="table-container">
          {filteredAndSortedPassports.length === 0 ? (
            <div className="empty-state"><p>
              {searchText || filterStatus || Object.values(columnFilters).some(Boolean)
                ? t("noPassportMatches")
                : t("noPassportsYet", { type: activeType })}
            </p></div>
          ) : (
            <PassportListTable
              user={user}
              selectionMode={selectionMode}
              getVisiblePassportKeys={getVisiblePassportKeys}
              paginatedPassports={paginatedPassports}
              selectedPassports={selectedPassports}
              toggleSelectAll={toggleSelectAll}
              sortConfig={sortConfig}
              toggleSort={toggleSort}
              showFilters={showFilters}
              columnFilters={columnFilters}
              updateColumnFilter={updateColumnFilter}
              expandedPassportGroups={expandedPassportGroups}
              renderPassportRow={renderPassportRow}
            />
          )}
        </div>
      )}

      {!isLoading && !isFiltering && filteredAndSortedPassports.length > 0 && (
        <PassportListPagination
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          rowsPerPage={rowsPerPage}
          filteredAndSortedPassports={filteredAndSortedPassports}
          totalPages={totalPages}
        />
      )}
    </>
  );
}
