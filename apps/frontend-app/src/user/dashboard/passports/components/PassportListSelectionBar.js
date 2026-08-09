import React from "react";
import { useI18n } from "../../../../app/providers/i18n";

export function PassportListSelectionBar({
  selectionMode,
  selectedPassportList,
  bulkActionLoading,
  setBulkWorkflowOpen,
  setBulkEditOpen,
  setBulkReviseOpen,
  bulkExportJson,
  setPrintQrModalOpen,
  bulkArchive,
  bulkDelete,
}) {
  const { t } = useI18n();
  if (!selectionMode || selectedPassportList.length === 0) {
    return null;
  }

  return (
    <div className="bulk-actions-bar">
      <span className="bulk-actions-count">{t("selectedCount", { count: selectedPassportList.length })}</span>
      <div className="bulk-actions-buttons">
        <button className="bulk-action-btn bulk-action-workflow" onClick={() => setBulkWorkflowOpen(true)} disabled={bulkActionLoading} title={t("submitSelectedToWorkflow")}>
          📋 {t("sendToWorkflow")}
        </button>
        <button className="bulk-action-btn bulk-action-edit" onClick={() => setBulkEditOpen(true)} disabled={bulkActionLoading} title={t("updateSelectedPassports")}>
          ✏️ {t("bulkEdit")}
        </button>
        <button className="bulk-action-btn bulk-action-revise" onClick={() => setBulkReviseOpen(true)} disabled={bulkActionLoading} title={t("openBulkRevise")}>
          🔄 {t("bulkRevise")}
        </button>
        <button className="bulk-action-btn bulk-action-export" onClick={bulkExportJson} disabled={bulkActionLoading} title={t("downloadJsonLd")}>
          📦 {t("exportJsonLd")}
        </button>
        <button className="bulk-action-btn bulk-action-qr" onClick={() => setPrintQrModalOpen(true)} disabled={bulkActionLoading} title={t("printSelectedQr")}>
          🖨 {t("printQr")}
        </button>
        <button className="bulk-action-btn bulk-action-archive" onClick={bulkArchive} disabled={bulkActionLoading} title={t("archiveSelected")}>
          📦 {t("archive")}
        </button>
        <button className="bulk-action-btn bulk-action-delete" onClick={bulkDelete} disabled={bulkActionLoading} title={t("deleteSelected")}>
          🗑️ Delete
        </button>
      </div>
      {bulkActionLoading && <span className="bulk-actions-loading">{t("processing")}</span>}
    </div>
  );
}
