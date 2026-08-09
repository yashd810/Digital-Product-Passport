import React from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../../app/providers/i18n";

export function ArchiveConfirmModal({ title, message, confirmLabel = "Archive", onClose, onConfirm, isSubmitting }) {
  const { t } = useI18n();
  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">{t("archivePassport")}</h3>
        <p className="dashboard-modal-subtitle">{title}</p>
        <div className="dashboard-warning-panel">
          <div className="dashboard-warning-item">
            <strong className="dashboard-warning-label">{t("whatHappensNext")}</strong>
            <div className="dashboard-warning-copy">{message}</div>
          </div>
        </div>
        <div className="dashboard-modal-actions dashboard-modal-actions-end">
          <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
            {t("cancel")}
          </button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? t("archiving") : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
