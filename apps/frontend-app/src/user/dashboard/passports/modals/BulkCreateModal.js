import React, { useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";

export function BulkCreateModal({ passportType, companyId, onClose, onDone }) {
  const [count, setCount] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedCount = parseInt(count, 10);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500) {
      setError("Enter a number between 1 and 500.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          passport_type: passportType,
          passports: Array.from({ length: parsedCount }, () => ({})),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Bulk create failed");
      onDone(data.summary?.created || parsedCount);
    } catch (err) {
      setError(err.message || "Bulk create failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Bulk Create Passports</h3>
        <p className="dashboard-modal-subtitle">
          Enter how many <strong>{passportType}</strong> drafts you want to create. Each one will get its own DPP ID and a default untitled name.
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <label htmlFor="bulkCreateCount" className="device-manual-label">Number of Passports</label>
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
          <p className="bulk-create-note">You can rename and edit the generated drafts later.</p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Drafts"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
