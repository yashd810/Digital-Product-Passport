import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PassportListTableSection } from "../components/PassportListTableSection";
import { PassportListModalStack } from "../components/PassportListModalStack";
import { PassportListRow } from "../components/PassportListRow";
import { usePassportListActions } from "../hooks/usePassportListActions";
import { usePassportListState } from "../hooks/usePassportListState";
import "../../../../assets/styles/Dashboard.css";

function PassportList({ user, companyId, filterByUser }) {
  const navigate = useNavigate();
  const state = usePassportListState({ user, companyId, filterByUser });
  const actions = usePassportListActions({
    activeType: state.activeType,
    archiveConfirm: state.archiveConfirm,
    companyId,
    fetchPassports: state.fetchPassports,
    selectedPassportList: state.selectedPassportList,
    setArchiveConfirm: state.setArchiveConfirm,
    setBulkActionLoading: state.setBulkActionLoading,
    setPrintQrModalOpen: state.setPrintQrModalOpen,
    setQrExporting: state.setQrExporting,
    setSelectedPassports: state.setSelectedPassports,
    showError: state.showError,
    showSuccess: state.showSuccess,
    user,
    navigate,
  });

  const renderPassportRow = (passport, rowOptions = {}) => (
    <PassportListRow
      passport={passport}
      {...rowOptions}
      user={user}
      activeType={state.activeType}
      allPassportTypes={state.allPassportTypes}
      pinnedGuids={state.pinnedGuids}
      expandedPassportGroups={state.expandedPassportGroups}
      openMenuId={state.openMenuId}
      menuAnchorRect={state.menuAnchorRect}
      selectionMode={state.selectionMode}
      selectedPassports={state.selectedPassports}
      openPassportViewer={state.openPassportViewer}
      toggleSelectPassport={state.toggleSelectPassport}
      togglePassportGroup={state.togglePassportGroup}
      setOpenMenuId={state.setOpenMenuId}
      setMenuAnchorRect={state.setMenuAnchorRect}
      openMenu={state.openMenu}
      filterByUser={filterByUser}
      navigate={navigate}
      setReleaseModal={state.setReleaseModal}
      handleRevise={actions.handleRevise}
      handleClone={actions.handleClone}
      setCsvModal={state.setCsvModal}
      setHistoryModal={state.setHistoryModal}
      setDeviceModal={state.setDeviceModal}
      companyId={companyId}
      showError={state.showError}
      showSuccess={state.showSuccess}
      getViewerPath={state.getViewerPath}
      handleArchive={actions.handleArchive}
      handleDelete={actions.handleDelete}
      togglePin={state.togglePin}
    />
  );

  return (
    <div className="passport-list-page">
      <PassportListTableSection
        pageTitle={state.pageTitle}
        user={user}
        selectionMode={state.selectionMode}
        setSelectionMode={state.setSelectionMode}
        setSelectedPassports={state.setSelectedPassports}
        setPrintQrModalOpen={state.setPrintQrModalOpen}
        setExportModalOpen={state.setExportModalOpen}
        selectedPassportList={state.selectedPassportList}
        bulkActionLoading={state.bulkActionLoading}
        bulkRelease={actions.bulkRelease}
        setBulkWorkflowOpen={state.setBulkWorkflowOpen}
        setBulkReviseOpen={state.setBulkReviseOpen}
        bulkExportJson={actions.bulkExportJson}
        bulkArchive={actions.bulkArchive}
        bulkDelete={actions.bulkDelete}
        searchText={state.searchText}
        setSearchText={state.setSearchText}
        filterStatus={state.filterStatus}
        setFilterStatus={state.setFilterStatus}
        showFilters={state.showFilters}
        setShowFilters={state.setShowFilters}
        isFiltering={state.isFiltering}
        rowsPerPage={state.rowsPerPage}
        setRowsPerPage={state.setRowsPerPage}
        error={state.error}
        successMsg={state.successMsg}
        isLoading={state.isLoading}
        filteredAndSortedPassports={state.filteredAndSortedPassports}
        columnFilters={state.columnFilters}
        updateColumnFilter={state.updateColumnFilter}
        paginatedPassports={state.paginatedPassports}
        getVisiblePassportKeys={state.getVisiblePassportKeys}
        selectedPassports={state.selectedPassports}
        toggleSelectAll={state.toggleSelectAll}
        filterByUser={filterByUser}
        sortConfig={state.sortConfig}
        toggleSort={state.toggleSort}
        expandedPassportGroups={state.expandedPassportGroups}
        renderPassportRow={renderPassportRow}
        currentPage={state.currentPage}
        setCurrentPage={state.setCurrentPage}
        totalPages={state.totalPages}
        activeType={state.activeType}
      />

      <PassportListModalStack
        activeType={state.activeType}
        allPassportTypes={state.allPassportTypes}
        archiveConfirm={state.archiveConfirm}
        bulkActionLoading={state.bulkActionLoading}
        bulkCreateOpen={state.bulkCreateOpen}
        bulkReviseOpen={state.bulkReviseOpen}
        bulkWorkflowOpen={state.bulkWorkflowOpen}
        companyId={companyId}
        csvModal={state.csvModal}
        deviceModal={state.deviceModal}
        downloadQrCodes={actions.downloadQrCodes}
        exportModalOpen={state.exportModalOpen}
        fetchPassports={state.fetchPassports}
        filteredAndSortedPassports={state.filteredAndSortedPassports}
        historyModal={state.historyModal}
        passports={state.passports}
        printQrModalOpen={state.printQrModalOpen}
        qrExporting={state.qrExporting}
        releaseModal={state.releaseModal}
        selectedPassportList={state.selectedPassportList}
        selectedPassports={state.selectedPassports}
        setArchiveConfirm={state.setArchiveConfirm}
        setBulkCreateOpen={state.setBulkCreateOpen}
        setBulkReviseOpen={state.setBulkReviseOpen}
        setBulkWorkflowOpen={state.setBulkWorkflowOpen}
        setCsvModal={state.setCsvModal}
        setDeviceModal={state.setDeviceModal}
        setExportModalOpen={state.setExportModalOpen}
        setHistoryModal={state.setHistoryModal}
        setPrintQrModalOpen={state.setPrintQrModalOpen}
        setReleaseModal={state.setReleaseModal}
        setSelectedPassports={state.setSelectedPassports}
        showSuccess={state.showSuccess}
        user={user}
        confirmArchive={actions.confirmArchive}
        paginatedPassports={state.paginatedPassports}
      />
    </div>
  );
}

export default PassportList;
