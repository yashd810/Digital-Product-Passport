import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders } from "../../shared/api/authHeaders";
import { formatPassportStatus } from "../utils/passportStatus";
import "../../passport-viewer/styles/PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "";

function isPublicHistoryStatus(status) {
  return status === "released" || status === "obsolete";
}

function formatHistoryDate(value) {
  if (!value) return "Unknown date";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function PassportHistoryModal({
  guid,
  productId = "",
  passportType,
  companyId = null,
  mode = "public",
  onClose,
}) {
  const isCompanyMode = mode === "company" && companyId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [savingVersion, setSavingVersion] = useState(null);

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      setLoading(true);
      setError("");
      try {
        const endpoint = isCompanyMode
          ? `${API}/api/companies/${companyId}/passports/${guid}/history`
          : `${API}/api/passports/by-product/${encodeURIComponent(productId)}/history`;
        const response = await fetch(endpoint, isCompanyMode ? { headers: authHeaders() } : undefined);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load passport history");
        if (active) setPayload(data);
      } catch (err) {
        if (active) setError(err.message || "Failed to load passport history");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadHistory();
    return () => { active = false; };
  }, [companyId, guid, isCompanyMode, productId]);

  const toggleVisibility = async (entry) => {
    if (!isCompanyMode || !isPublicHistoryStatus(entry.release_status)) return;
    setSavingVersion(entry.version_number);
    setError("");
    try {
      const response = await fetch(
        `${API}/api/companies/${companyId}/passports/${guid}/history/${entry.version_number}`,
        {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ isPublic: !entry.is_public, passportType }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to update history visibility");
      setPayload((current) => ({
        ...current,
        history: (current?.history || []).map((item) =>
          item.version_number === entry.version_number
            ? { ...item, is_public: data.is_public }
            : item
        ),
      }));
    } catch (err) {
      setError(err.message || "Failed to update history visibility");
    } finally {
      setSavingVersion(null);
    }
  };

  const title = isCompanyMode ? "Update History" : "Version History";
  const subtitle = isCompanyMode
    ? "Review every passport version and control which published updates appear publicly."
    : "Review the published versions and the field changes made over time.";

  return createPortal(
    <div className="pv-history-overlay" onClick={(event) => { if (event.target === event.currentTarget && !savingVersion) onClose(); }}>
      <div className="pv-history-modal">
        <div className="pv-history-header">
          <div>
            <p className="pv-history-kicker">{payload?.displayName || passportType || "Passport"}</p>
            <h3>{title}</h3>
            <p className="pv-history-subtitle">{subtitle}</p>
          </div>
          <button type="button" className="pv-history-close" onClick={onClose} disabled={!!savingVersion}>
            ✕
          </button>
        </div>

        {loading && <div className="pv-history-state">Loading history…</div>}
        {!loading && error && <div className="pv-history-error">{error}</div>}
        {!loading && !error && !(payload?.history || []).length && (
          <div className="pv-history-state">
            {isCompanyMode ? "No version history is available for this passport yet." : "No public version history is available yet."}
          </div>
        )}

        {!loading && !error && (payload?.history || []).length > 0 && (
          <div className="pv-history-list">
            {payload.history.map((entry) => {
              const visibleChanges = entry.changed_fields?.slice(0, 6) || [];
              const hiddenChanges = Math.max((entry.changed_fields?.length || 0) - visibleChanges.length, 0);
              return (
                <article key={entry.version_number} className="pv-history-card">
                  <div className="pv-history-card-top">
                    <div className="pv-history-version-group">
                      <span className="pv-history-version-pill">v{entry.version_number}</span>
                      <span className={`pv-history-status ${entry.release_status}`}>{formatPassportStatus(entry.release_status)}</span>
                      {entry.is_current && <span className="pv-history-current">Current</span>}
                    </div>
                    {isCompanyMode && (
                      <button
                        type="button"
                        className={`pv-history-visibility-btn${entry.is_public ? " public" : ""}`}
                        onClick={() => toggleVisibility(entry)}
                        disabled={savingVersion === entry.version_number || !isPublicHistoryStatus(entry.release_status)}
                        title={!isPublicHistoryStatus(entry.release_status) ? "Only released or obsolete versions can be public." : ""}
                      >
                        {savingVersion === entry.version_number
                          ? "Saving…"
                          : entry.is_public
                            ? "Public"
                            : "Hidden"}
                      </button>
                    )}
                  </div>

                  <div className="pv-history-meta">
                    <span>{formatHistoryDate(entry.updated_at || entry.created_at)}</span>
                    {entry.created_by_name && <span>{entry.created_by_name}</span>}
                  </div>

                  <p className="pv-history-summary">{entry.summary}</p>

                  {(entry.public_path || entry.inactive_path) && (
                    <div className="pv-history-meta">
                      <a
                        href={entry.is_current ? entry.public_path : entry.inactive_path}
                        className="pv-history-open-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {entry.is_current ? "Open current passport" : `Open v${entry.version_number} snapshot`}
                      </a>
                    </div>
                  )}

                  {visibleChanges.length > 0 && (
                    <div className="pv-history-changes">
                      {visibleChanges.map((change) => (
                        <div key={`${entry.version_number}-${change.key}`} className="pv-history-change-row">
                          <span className="pv-history-change-label">{change.label}</span>
                          <div className="pv-history-change-values">
                            <span>{change.before}</span>
                            <span className="pv-history-change-arrow">→</span>
                            <span>{change.after}</span>
                          </div>
                        </div>
                      ))}
                      {hiddenChanges > 0 && (
                        <div className="pv-history-more">+ {hiddenChanges} more change{hiddenChanges === 1 ? "" : "s"}</div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default PassportHistoryModal;
