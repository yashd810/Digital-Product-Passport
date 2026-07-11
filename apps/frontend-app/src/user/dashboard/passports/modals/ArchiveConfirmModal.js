import React from "react";
import { createPortal } from "react-dom";

export function ArchiveConfirmModal({ title, message, confirmLabel = "Archive", onClose, onConfirm, isSubmitting }) {
  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Archive Passport</h3>
        <p className="dashboard-modal-subtitle">{title}</p>
        <div className="dashboard-warning-panel">
          <div className="dashboard-warning-item">
            <strong className="dashboard-warning-label">What happens next</strong>
            <div className="dashboard-warning-copy">{message}</div>
          </div>
        </div>
        <div className="dashboard-modal-actions dashboard-modal-actions-end">
          <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Archiving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
