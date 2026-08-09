import React, { useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { useI18n } from "../../../../app/providers/i18n";

const api = import.meta.env.VITE_API_URL || "";

export function BulkCreateModal({ passportType, companyId, onClose, onDone }) {
  const { t } = useI18n();
  const [count, setCount] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedCount = parseInt(count, 10);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500) {
      setError(t("enterNumberRange"));
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          passportType,
          passports: Array.from({ length: parsedCount }, () => ({})),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || t("bulkCreateFailed"));
      onDone(data.summary?.created || parsedCount);
    } catch (err) {
      setError(err.message || t("bulkCreateFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">{t("bulkCreatePassports")}</h3>
        <p className="dashboard-modal-subtitle">
          {t("bulkCreateDescription", { type: passportType })}
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <label htmlFor="bulkCreateCount" className="device-manual-label">{t("numberOfPassports")}</label>
          <input
            id="bulkCreateCount"
            type="number"
            min="1"
            max="500"
            step="1"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="device-manual-input"
            disabled={isSubmitting}
            autoFocus
          />
          <p className="bulk-create-note">{t("editDraftsLater")}</p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
              {t("cancel")}
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t("creating") : t("createDrafts")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
