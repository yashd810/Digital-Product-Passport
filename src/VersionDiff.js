import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { authHeaders } from "./authHeaders";
import { formatPassportStatus } from "./passportStatus";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const SKIP = new Set([
  "id","company_id","created_at","updated_at","qr_code","deleted_at",
  "guid","created_by","updated_by","release_status","version_number",
]);

function VersionDiff({ companyId }) {
  const { guid }         = useParams();
  const navigate         = useNavigate();
  const [searchParams]   = useSearchParams();

  const [versions,  setVersions]  = useState([]);
  const [pType,     setPType]     = useState("");
  const [typeDef,   setTypeDef]   = useState(null); // Dynamic field definitions
  const [vA,        setVA]        = useState(null);
  const [vB,        setVB]        = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");

  useEffect(() => {
    const pt = searchParams.get("passportType") || searchParams.get("pt");
    if (!pt) {
      setError("passportType is missing from URL. Go back and click Compare versions again.");
      setLoading(false); return;
    }
    setPType(pt);

    // Fetch dynamic type definition
    fetch(`${API}/api/passport-types/${pt}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setTypeDef(data))
      .catch(() => setTypeDef(null));

    fetch(`${API}/api/companies/${companyId}/passports/${guid}/diff?passportType=${pt}`, {
      headers: { ...authHeaders() },
    })
    .then(r => r.ok ? r.json() : Promise.reject("Failed to load"))
    .then(d => {
      const vers = d.versions || [];
      setVersions(vers);
      if (vers.length >= 2) { setVA(vers[vers.length - 2]); setVB(vers[vers.length - 1]); }
      else if (vers.length === 1) { setVA(vers[0]); setVB(vers[0]); }
    })
    .catch(e => setError(String(e)))
    .finally(() => setLoading(false));
  }, [guid, companyId, searchParams]);

  if (loading) return <div className="loading" style={{ padding:60 }}>Loading version history…</div>;
  if (error)   return <div style={{ padding:40 }}><div className="alert alert-error">{error}</div><button className="diff-back-btn" onClick={() => navigate(-1)} style={{ marginTop:16 }}>← Go back</button></div>;
  if (!versions.length) return <div style={{ padding:40, textAlign:"center" }}><p>No version history found.</p><button className="diff-back-btn" onClick={() => navigate(-1)}>← Go back</button></div>;
  if (versions.length === 1) return (
    <div style={{ padding:40, textAlign:"center", color:"var(--charcoal)" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🔍</div>
      <h3>Only one version exists</h3>
      <p style={{ fontSize:13 }}>Release and revise this passport to see version differences here.</p>
      <button className="diff-back-btn" onClick={() => navigate(-1)} style={{ marginTop:16 }}>← Go back</button>
    </div>
  );

  const sections  = typeDef?.fields_json?.sections || {};
  const allFields = sections.flatMap(s => s.fields || []).filter(f => !SKIP.has(f.key));
  const norm = v => (v === null || v === undefined) ? "" : String(v);
  const changes   = allFields.map(f => ({ ...f, a:vA?.[f.key], b:vB?.[f.key], changed: norm(vA?.[f.key]) !== norm(vB?.[f.key]) }));
  const changed   = changes.filter(c => c.changed);
  const unchanged = changes.filter(c => !c.changed && (c.a || c.b));
  const formatStatus = (status) => formatPassportStatus(status);

  const fmtVal = (v, type) => {
    if (v === null || v === undefined || v === "") return <span style={{ color:"var(--steel)", fontStyle:"italic" }}>—</span>;
    if (type === "boolean") return v ? "Yes" : "No";
    if (typeof v === "string" && v.startsWith("http")) return <a href={v} target="_blank" rel="noopener noreferrer" style={{ color:"var(--jet)", fontSize:12 }}>📄 File</a>;
    return String(v);
  };

  return (
    <div className="diff-page">
      <div className="diff-header">
        <button className="diff-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div>
          <h2 className="diff-title">🔀 Version Comparison</h2>
          <p className="diff-subtitle">{vA?.model_name || guid} · {pType}</p>
        </div>
      </div>

      {versions.length > 2 && (
        <div className="diff-selectors">
          <div className="diff-sel-group">
            <label>Compare from</label>
            <select value={vA?.version_number || ""} onChange={e => setVA(versions.find(v => v.version_number === parseInt(e.target.value)))}>
              {versions.map(v => <option key={v.id} value={v.version_number}>v{v.version_number} — {formatStatus(v.release_status)}</option>)}
            </select>
          </div>
          <span className="diff-sel-arrow">↔</span>
          <div className="diff-sel-group">
            <label>Compare to</label>
            <select value={vB?.version_number || ""} onChange={e => setVB(versions.find(v => v.version_number === parseInt(e.target.value)))}>
              {versions.map(v => <option key={v.id} value={v.version_number}>v{v.version_number} — {formatStatus(v.release_status)}</option>)}
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
          <span>v{vA?.version_number}</span>
          <span className={`diff-status ${vA?.release_status}`}>{formatStatus(vA?.release_status)}</span>
        </div>
        <div className="diff-field-name-header">Field</div>
        <div className="diff-vh right">
          <span className={`diff-status ${vB?.release_status}`}>{formatStatus(vB?.release_status)}</span>
          <span>v{vB?.version_number}</span>
        </div>
      </div>

      {changed.length === 0 ? (
        <div style={{ background:"var(--white)", border:"1px solid #d0e4e0", borderTop:"none", padding:"28px", textAlign:"center", color:"var(--charcoal)" }}>
          ✅ No differences between these two versions.
        </div>
      ) : (
        <div className="diff-section">
          <div className="diff-section-label">Changed ({changed.length})</div>
          {changed.map(f => (
            <div key={f.key} className="diff-row changed-row">
              <div className="diff-cell old">{fmtVal(f.a, f.type)}</div>
              <div className="diff-label">{f.label}</div>
              <div className="diff-cell new">{fmtVal(f.b, f.type)}</div>
            </div>
          ))}
        </div>
      )}

      {unchanged.length > 0 && (
        <details className="diff-section">
          <summary className="diff-section-label unchanged-toggle">Unchanged ({unchanged.length}) — click to expand</summary>
          {unchanged.map(f => (
            <div key={f.key} className="diff-row">
              <div className="diff-cell">{fmtVal(f.a, f.type)}</div>
              <div className="diff-label">{f.label}</div>
              <div className="diff-cell">{fmtVal(f.b, f.type)}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export default VersionDiff;
