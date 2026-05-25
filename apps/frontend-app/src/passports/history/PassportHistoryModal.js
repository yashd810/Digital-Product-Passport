import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
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
  dppId,
  internalAliasId = "",
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
          ? `${API}/api/companies/${companyId}/passports/${dppId}/history`
          : `${API}/api/passports/by-product/${encodeURIComponent(internalAliasId)}/history`;
        const response = await fetchWithAuth(endpoint, isCompanyMode ? { headers: authHeaders() } : undefined);
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
  }, [companyId, dppId, isCompanyMode, internalAliasId]);

  const toggleVisibility = async (entry) => {
    if (!isCompanyMode || !isPublicHistoryStatus(entry.releaseStatus)) return;
    setSavingVersion(entry.versionNumber);
    setError("");
    try {
      const response = await fetchWithAuth(
        `${API}/api/companies/${companyId}/passports/${dppId}/history/${entry.versionNumber}`,
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
          item.versionNumber === entry.versionNumber
            ? { ...item, isPublic: data.isPublic }
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
                <article key={entry.versionNumber} className="pv-history-card">
                  <div className="pv-history-card-top">
                    <div className="pv-history-version-group">
                      <span className="pv-history-version-pill">v{entry.versionNumber}</span>
                      <span className={`pv-history-status ${entry.releaseStatus}`}>{formatPassportStatus(entry.releaseStatus)}</span>
                      {entry.isCurrent && <span className="pv-history-current">Current</span>}
                    </div>
                    {isCompanyMode && (
                      <button
                        type="button"
                        className={`pv-history-visibility-btn${entry.isPublic ? " public" : ""}`}
                        onClick={() => toggleVisibility(entry)}
                        disabled={savingVersion === entry.versionNumber || !isPublicHistoryStatus(entry.releaseStatus)}
                        title={!isPublicHistoryStatus(entry.releaseStatus) ? "Only released or obsolete versions can be public." : ""}
                      >
                        {savingVersion === entry.versionNumber
                          ? "Saving…"
                          : entry.isPublic
                            ? "Public"
                            : "Hidden"}
                      </button>
                    )}
                  </div>

                  <div className="pv-history-meta">
                    <span>{formatHistoryDate(entry.updatedAt || entry.createdAt)}</span>
                    {entry.createdByName && <span>{entry.createdByName}</span>}
                  </div>

                  <p className="pv-history-summary">{entry.summary}</p>

                  {(entry.publicPath || entry.inactivePath) && (
                    <div className="pv-history-meta">
                      <a
                        href={entry.isCurrent ? entry.publicPath : entry.inactivePath}
                        className="pv-history-open-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {entry.isCurrent ? "Open current passport" : `Open v${entry.versionNumber} snapshot`}
                      </a>
                    </div>
                  )}

                  {visibleChanges.length > 0 && (
                    <div className="pv-history-changes">
                      {visibleChanges.map((change) => (
                        <div key={`${entry.versionNumber}-${change.key}`} className="pv-history-change-row">
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
