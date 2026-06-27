import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { formatPassportStatus } from "../utils/passportStatus";
import "../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const skip = new Set([
  "id", "companyId", "createdAt", "updatedAt", "qrCode", "deletedAt",
  "dppId", "createdBy", "updatedBy", "releaseStatus", "versionNumber",
]);

function formatHistoryDate(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function VersionDiff({ companyId }) {
  const { dppId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [versions, setVersions] = useState([]);
  const [historyPayload, setHistoryPayload] = useState(null);
  const [pType, setPType] = useState("");
  const [typeDef, setTypeDef] = useState(null);
  const [vA, setVA] = useState(null);
  const [vB, setVB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const pt = searchParams.get("passportType") || searchParams.get("pt");
    if (!pt) {
      setError("passportType is missing from the URL. Open Update History again from the passport list.");
      setLoading(false);
      return;
    }
    setPType(pt);

    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.all([
      fetchWithAuth(`${api}/api/internal/passport-types/${pt}`).then((response) => (response.ok ? response.json() : null)),
      fetchWithAuth(`${api}/api/companies/${companyId}/passports/${dppId}/diff?passportType=${pt}`, {
        headers: authHeaders(),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load version comparison");
        return data;
      }),
      fetchWithAuth(`${api}/api/companies/${companyId}/passports/${dppId}/history`, {
        headers: authHeaders(),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load update history");
        return data;
      }),
    ])
      .then(([typeData, diffData, historyData]) => {
        if (cancelled) return;
        const nextVersions = diffData?.versions || [];
        setTypeDef(typeData);
        setVersions(nextVersions);
        setHistoryPayload(historyData || null);
        if (nextVersions.length >= 2) {
          setVA(nextVersions[nextVersions.length - 2]);
          setVB(nextVersions[nextVersions.length - 1]);
        } else if (nextVersions.length === 1) {
          setVA(nextVersions[0]);
          setVB(nextVersions[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load update history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, dppId, searchParams]);

  const sections = typeDef?.fieldsJson?.sections || [];
  const allFields = useMemo(
    () => sections.flatMap((section) => section.fields || []).filter((field) => !skip.has(field.key)),
    [sections]
  );

  const norm = (value) => (value === null || value === undefined ? "" : String(value));
  const changes = useMemo(
    () => allFields.map((field) => ({
      ...field,
      a: vA?.[field.key],
      b: vB?.[field.key],
      changed: norm(vA?.[field.key]) !== norm(vB?.[field.key]),
    })),
    [allFields, vA, vB]
  );
  const changed = changes.filter((item) => item.changed);
  const unchanged = changes.filter((item) => !item.changed && (item.a || item.b));

  const fmtVal = (value, type) => {
    if (value === null || value === undefined || value === "") return <span style={{ color: "var(--steel)", fontStyle: "italic" }}>—</span>;
    if (type === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string" && value.startsWith("http")) {
      return <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: "var(--jet)", fontSize: 12 }}>Open file</a>;
    }
    return String(value);
  };

  if (loading) return <div className="loading" style={{ padding: 60 }}>Loading update history…</div>;
  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div className="alert alert-error">{error}</div>
        <button className="diff-back-btn" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>← Go back</button>
      </div>
    );
  }
  if (!versions.length) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>No update history found.</p>
        <button className="diff-back-btn" onClick={() => navigate(-1)}>← Go back</button>
      </div>
    );
  }

  return (
    <div className="diff-page">
      <div className="diff-header">
        <button className="diff-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div>
          <h2 className="diff-title">🕘 Update History</h2>
          <p className="diff-subtitle">{vB?.modelName || historyPayload?.displayName || dppId} · {pType}</p>
        </div>
      </div>

      <section className="history-page-section">
        <div className="history-page-head">
          <h3>Version timeline</h3>
          <p>Review every saved version and open the public snapshot when needed.</p>
        </div>
        <div className="history-page-list">
          {(historyPayload?.history || []).map((entry) => (
            <article key={entry.versionNumber} className="history-page-card">
              <div className="history-page-card-top">
                <div className="history-page-version-group">
                  <span className="pv-history-version-pill">v{entry.versionNumber}</span>
                  <span className={`pv-history-status ${entry.releaseStatus}`}>{formatPassportStatus(entry.releaseStatus)}</span>
                  {entry.isCurrent && <span className="pv-history-current">Current</span>}
                </div>
                <span className="history-page-date">{formatHistoryDate(entry.updatedAt || entry.createdAt)}</span>
              </div>
              <p className="pv-history-summary">{entry.summary}</p>
              <div className="pv-history-meta">
                {entry.createdByName && <span>{entry.createdByName}</span>}
                {entry.changeCount != null && <span>{entry.changeCount} changed field{entry.changeCount === 1 ? "" : "s"}</span>}
              </div>
              {(entry.publicPath || entry.inactivePath) && (
                <div className="history-page-links">
                  {entry.publicPath && entry.isCurrent && (
                    <a href={entry.publicPath} target="_blank" rel="noopener noreferrer" className="pv-history-open-link">
                      Open public passport
                    </a>
                  )}
                  {entry.inactivePath && !entry.isCurrent && (
                    <a href={entry.inactivePath} target="_blank" rel="noopener noreferrer" className="pv-history-open-link">
                      Open snapshot
                    </a>
                  )}
                </div>
              )}
              {(entry.changedFields || []).length > 0 && (
                <div className="pv-history-changes">
                  {entry.changedFields.slice(0, 6).map((change) => (
                    <div key={`${entry.versionNumber}-${change.key}`} className="pv-history-change-row">
                      <span className="pv-history-change-label">{change.label}</span>
                      <div className="pv-history-change-values">
                        <span>{change.before}</span>
                        <span className="pv-history-change-arrow">→</span>
                        <span>{change.after}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {versions.length > 1 && (
        <section className="history-page-section">
          <div className="history-page-head">
            <h3>Compare versions</h3>
            <p>Choose two versions to inspect exact field-level changes.</p>
          </div>

          {versions.length > 2 && (
            <div className="diff-selectors">
              <div className="diff-sel-group">
                <label>Compare from</label>
                <select value={vA?.versionNumber || ""} onChange={(event) => setVA(versions.find((version) => version.versionNumber === parseInt(event.target.value, 10)))}>
                  {versions.map((version) => (
                    <option key={`${version.dppId}-${version.versionNumber}`} value={version.versionNumber}>
                      v{version.versionNumber} — {formatPassportStatus(version.releaseStatus)}
                    </option>
                  ))}
                </select>
              </div>
              <span className="diff-sel-arrow">↔</span>
              <div className="diff-sel-group">
                <label>Compare to</label>
                <select value={vB?.versionNumber || ""} onChange={(event) => setVB(versions.find((version) => version.versionNumber === parseInt(event.target.value, 10)))}>
                  {versions.map((version) => (
                    <option key={`${version.dppId}-${version.versionNumber}`} value={version.versionNumber}>
                      v{version.versionNumber} — {formatPassportStatus(version.releaseStatus)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="diff-summary">
            <span className="diff-sum-badge changed">{changed.length} field{changed.length !== 1 ? "s" : ""} changed</span>
            <span className="diff-sum-badge same">{unchanged.length} unchanged</span>
          </div>

          <div className="diff-version-headers">
            <div className="diff-vh left">
              <span className="diff-vh-version">v{vA?.versionNumber}</span>
              <span className={`diff-status ${vA?.releaseStatus}`}>{formatPassportStatus(vA?.releaseStatus)}</span>
            </div>
            <div className="diff-field-name-header">Field</div>
            <div className="diff-vh right">
              <span className="diff-vh-version">v{vB?.versionNumber}</span>
              <span className={`diff-status ${vB?.releaseStatus}`}>{formatPassportStatus(vB?.releaseStatus)}</span>
            </div>
          </div>

          {changed.length === 0 ? (
            <div style={{ background: "var(--white)", border: "1px solid #d0e4e0", borderTop: "none", padding: "28px", textAlign: "center", color: "var(--charcoal)" }}>
              No differences between these two versions.
            </div>
          ) : (
            <div className="diff-section">
              <div className="diff-section-label">Changed ({changed.length})</div>
              {changed.map((field) => (
                <div key={field.key} className="diff-row changed-row">
                  <div className="diff-cell old">{fmtVal(field.a, field.type)}</div>
                  <div className="diff-label">{field.label}</div>
                  <div className="diff-cell new">{fmtVal(field.b, field.type)}</div>
                </div>
              ))}
            </div>
          )}

          {unchanged.length > 0 && (
            <details className="diff-section">
              <summary className="diff-section-label unchanged-toggle">Unchanged ({unchanged.length}) — click to expand</summary>
              {unchanged.map((field) => (
                <div key={field.key} className="diff-row">
                  <div className="diff-cell">{fmtVal(field.a, field.type)}</div>
                  <div className="diff-label">{field.label}</div>
                  <div className="diff-cell">{fmtVal(field.b, field.type)}</div>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}

export default VersionDiff;
