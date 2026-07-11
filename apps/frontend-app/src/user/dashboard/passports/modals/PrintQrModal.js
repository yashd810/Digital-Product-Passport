import React, { useState } from "react";
import { createPortal } from "react-dom";

export function PrintQrModal({ selectedCount, onClose, onConfirm, isExporting }) {
  const [widthMm, setWidthMm] = useState("50");
  const [heightMm, setHeightMm] = useState("70");
  const [format, setFormat] = useState("png");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const width = Number(widthMm);
    const height = Number(heightMm);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setError("Enter a valid width and height in millimetres.");
      return;
    }
    if (width < 20 || height < 20) {
      setError("Use at least 20 mm for both width and height.");
      return;
    }
    setError("");
    onConfirm({ widthMm: width, heightMm: height, format });
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isExporting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Print Passport QR Code</h3>
        <p className="dashboard-modal-subtitle">
          Export {selectedCount} selected passport QR code{selectedCount !== 1 ? "s" : ""}. Each passport will download as its own image file.
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>Width (mm)</label>
              <input type="number" min="20" step="1" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} disabled={isExporting} />
            </div>
            <div className="form-group">
              <label>Height (mm)</label>
              <input type="number" min="20" step="1" value={heightMm} onChange={(e) => setHeightMm(e.target.value)} disabled={isExporting} />
            </div>
          </div>
          <div className="form-group">
            <label>Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={isExporting}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>
          <p className="bulk-create-note">
            The total label size includes passport category on top, the QR code in the middle, and the passport DPP ID at the bottom.
          </p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isExporting}>
              Cancel
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isExporting}>
              {isExporting ? "Preparing..." : "Download QR Codes"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
