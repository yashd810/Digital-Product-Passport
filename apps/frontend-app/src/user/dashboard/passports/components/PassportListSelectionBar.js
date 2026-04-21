import React from "react";

export function PassportListSelectionBar({
  selectionMode,
  selectedPassportList,
  bulkActionLoading,
  setBulkWorkflowOpen,
  setBulkReviseOpen,
  bulkExportJson,
  setPrintQrModalOpen,
  bulkArchive,
  bulkDelete,
}) {
  if (!selectionMode || selectedPassportList.length === 0) {
    return null;
  }

  return (
    <div className="bulk-actions-bar">
      <span className="bulk-actions-count">{selectedPassportList.length} selected</span>
      <div className="bulk-actions-buttons">
        <button className="bulk-action-btn bulk-action-workflow" onClick={() => setBulkWorkflowOpen(true)} disabled={bulkActionLoading} title="Submit selected passports to review/approval workflow">
          📋 Send to Workflow
        </button>
        <button className="bulk-action-btn bulk-action-revise" onClick={() => setBulkReviseOpen(true)} disabled={bulkActionLoading} title="Open the bulk revise flow for the selected passports">
          🔄 Bulk Revise
        </button>
        <button className="bulk-action-btn bulk-action-export" onClick={bulkExportJson} disabled={bulkActionLoading} title="Download selected passports as JSON-LD">
          📦 Export JSON-LD
        </button>
        <button className="bulk-action-btn bulk-action-qr" onClick={() => setPrintQrModalOpen(true)} disabled={bulkActionLoading} title="Print QR codes for selected passports">
          🖨 Print QR
        </button>
        <button className="bulk-action-btn bulk-action-archive" onClick={bulkArchive} disabled={bulkActionLoading} title="Archive selected passports">
          📦 Archive
        </button>
        <button className="bulk-action-btn bulk-action-delete" onClick={bulkDelete} disabled={bulkActionLoading} title="Delete selected draft/in-revision passports">
          🗑️ Delete
        </button>
      </div>
      {bulkActionLoading && <span className="bulk-actions-loading">Processing…</span>}
    </div>
  );
}
