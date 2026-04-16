import React from "react";
import { ReleaseModal } from "../../workflow/WorkflowDashboard";
import PassportHistoryModal from "../../../../passports/history/PassportHistoryModal";
import {
  ArchiveConfirmModal,
  BulkCreateModal,
  BulkReviseModal,
  BulkWorkflowModal,
  CsvUpdateModal,
  DeviceIntegrationModal,
  ExportModal,
  PrintQrModal,
} from "../modals";

export function PassportListModalStack({
  activeType,
  allPassportTypes,
  archiveConfirm,
  bulkActionLoading,
  bulkCreateOpen,
  bulkReviseOpen,
  bulkWorkflowOpen,
  companyId,
  csvModal,
  deviceModal,
  downloadQrCodes,
  exportModalOpen,
  fetchPassports,
  filteredAndSortedPassports,
  historyModal,
  passports,
  printQrModalOpen,
  qrExporting,
  releaseModal,
  selectedPassportList,
  selectedPassports,
  setArchiveConfirm,
  setBulkCreateOpen,
  setBulkReviseOpen,
  setBulkWorkflowOpen,
  setCsvModal,
  setDeviceModal,
  setExportModalOpen,
  setHistoryModal,
  setPrintQrModalOpen,
  setReleaseModal,
  setSelectedPassports,
  showSuccess,
  user,
  confirmArchive,
  paginatedPassports,
}) {
  return (
    <>
      {releaseModal && (
        <ReleaseModal
          passport={releaseModal}
          companyId={companyId}
          user={user}
          onClose={() => setReleaseModal(null)}
          onDone={(msg) => {
            setReleaseModal(null);
            showSuccess(msg);
            fetchPassports();
          }}
        />
      )}

      {printQrModalOpen && (
        <PrintQrModal
          selectedCount={selectedPassportList.length}
          isExporting={qrExporting}
          onClose={() => { if (!qrExporting) setPrintQrModalOpen(false); }}
          onConfirm={downloadQrCodes}
        />
      )}

      {archiveConfirm && (
        <ArchiveConfirmModal
          title={archiveConfirm.mode === "bulk"
            ? `Archive ${archiveConfirm.count} passport${archiveConfirm.count !== 1 ? "s" : ""}?`
            : "Archive this passport?"}
          message={archiveConfirm.mode === "bulk"
            ? "The selected passports will be moved to the archive and removed from the active list."
            : "This passport will be moved to the archive and removed from the active list."}
          confirmLabel={archiveConfirm.mode === "bulk" ? "Archive Selected" : "Archive Passport"}
          isSubmitting={bulkActionLoading}
          onClose={() => { if (!bulkActionLoading) setArchiveConfirm(null); }}
          onConfirm={confirmArchive}
        />
      )}

      {csvModal && (
        <CsvUpdateModal
          passport={csvModal.passport}
          passportType={csvModal.pType}
          companyId={companyId}
          onClose={() => setCsvModal(null)}
          onDone={(msg) => {
            setCsvModal(null);
            showSuccess(msg);
            fetchPassports();
          }}
        />
      )}

      {exportModalOpen && (
        <ExportModal
          passports={passports}
          filteredPassports={filteredAndSortedPassports.map((group) => group.latest)}
          pagePassports={paginatedPassports.map((group) => group.latest)}
          selectedPassports={selectedPassports}
          activeType={activeType}
          allPassportTypes={allPassportTypes}
          onClose={() => setExportModalOpen(false)}
          onDone={(msg) => {
            setExportModalOpen(false);
            showSuccess(msg);
          }}
        />
      )}

      {bulkReviseOpen && (
        <BulkReviseModal
          companyId={companyId}
          user={user}
          allPassportTypes={allPassportTypes}
          passports={passports}
          filteredPassports={filteredAndSortedPassports.map((group) => group.latest)}
          pagePassports={paginatedPassports.map((group) => group.latest)}
          selectedPassports={selectedPassports}
          activeType={activeType}
          onClose={() => setBulkReviseOpen(false)}
          onApplied={async (data) => {
            await fetchPassports();
            showSuccess(
              `Bulk revise batch #${data.batch?.id} complete: ${data.summary?.revised || 0} revised, ${data.summary?.skipped || 0} skipped, ${data.summary?.failed || 0} failed.`
            );
          }}
        />
      )}

      {historyModal && (
        <PassportHistoryModal
          guid={historyModal.guid}
          passportType={historyModal.passportType}
          companyId={companyId}
          mode="company"
          onClose={() => setHistoryModal(null)}
        />
      )}

      {bulkCreateOpen && activeType && (
        <BulkCreateModal
          passportType={activeType}
          companyId={companyId}
          onClose={() => setBulkCreateOpen(false)}
          onDone={(createdCount) => {
            setBulkCreateOpen(false);
            showSuccess(`Created ${createdCount} draft passport${createdCount !== 1 ? "s" : ""}`);
            fetchPassports();
          }}
        />
      )}

      {deviceModal && (
        <DeviceIntegrationModal
          passport={deviceModal.passport}
          passportType={deviceModal.pType}
          companyId={companyId}
          onClose={() => setDeviceModal(null)}
        />
      )}

      {bulkWorkflowOpen && (
        <BulkWorkflowModal
          companyId={companyId}
          user={user}
          selectedList={selectedPassportList}
          onClose={() => setBulkWorkflowOpen(false)}
          onDone={(msg) => {
            setBulkWorkflowOpen(false);
            showSuccess(msg);
            setSelectedPassports(new Set());
            fetchPassports();
          }}
        />
      )}
    </>
  );
}
