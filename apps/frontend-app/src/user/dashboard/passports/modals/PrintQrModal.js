import React, { useState } from "react";
import { createPortal } from "react-dom";
import AppSelect from "../../../../shared/components/AppSelect";
import { useI18n } from "../../../../app/providers/i18n";

export function PrintQrModal({ selectedCount, onClose, onConfirm, isExporting }) {
  const { t } = useI18n();
  const [widthMm, setWidthMm] = useState("50");
  const [heightMm, setHeightMm] = useState("70");
  const [format, setFormat] = useState("png");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const width = Number(widthMm);
    const height = Number(heightMm);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setError(t("validQrDimensions"));
      return;
    }
    if (width < 20 || height < 20) {
      setError(t("minimumQrDimensions"));
      return;
    }
    setError("");
    onConfirm({ widthMm: width, heightMm: height, format });
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isExporting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">{t("printPassportQrCode")}</h3>
        <p className="dashboard-modal-subtitle">
          {t("printQrDescription", { count: selectedCount, suffix: selectedCount !== 1 ? "s" : "" })}
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>{t("widthMillimetres")}</label>
              <input type="number" min="20" step="1" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} disabled={isExporting} />
            </div>
            <div className="form-group">
              <label>{t("heightMillimetres")}</label>
              <input type="number" min="20" step="1" value={heightMm} onChange={(e) => setHeightMm(e.target.value)} disabled={isExporting} />
            </div>
          </div>
          <div className="form-group">
            <label>{t("format")}</label>
            <AppSelect value={format} onChange={(e) => setFormat(e.target.value)} disabled={isExporting} aria-label={t("imageFormat")}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </AppSelect>
          </div>
          <p className="bulk-create-note">
            {t("qrLabelDescription")}
          </p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isExporting}>
              {t("cancel")}
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isExporting}>
              {isExporting ? t("preparing") : t("downloadQrCodes")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
