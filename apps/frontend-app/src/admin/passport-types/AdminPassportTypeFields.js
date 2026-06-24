import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  accessLevelLabels,
  confidentialityLevelLabels,
  updateAuthorityLabels,
  normalizeSystemPassportHeader,
  resolveSystemHeaderEntries,
} from "./builderHelpers";
import { formatSemanticModelLabel } from "./semanticTermCatalog";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const getSemanticModelLabel = formatSemanticModelLabel;

function AdminPassportTypeFields() {
  const navigate = useNavigate();
  const { typeName } = useParams();
  const location = useLocation();

  const [typeDef, setTypeDef] = useState(location.state?.passportType || null);
  const [loading, setLoading] = useState(!typeDef);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeDef) return;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetchWithAuth(`${api}/api/passport-types/${typeName}`);
        if (!res.ok) throw new Error("Passport type not found");
        const data = await res.json();
        setTypeDef({ ...data, typeName });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [typeName, typeDef]);

  if (loading) return <div className="loading">Loading fields…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!typeDef) return <div className="alert alert-error">No type data available.</div>;

  const sections = typeDef.fieldsJson?.sections || []; 
  const systemHeader = normalizeSystemPassportHeader(typeDef.fieldsJson?.systemHeader);
  const systemHeaderEntries = resolveSystemHeaderEntries(sections, systemHeader);
  const fieldCount = sections.reduce((sum, s) => sum + (s.fields?.length || 0), 0);
  const describeList = (values = [], labelMap = {}) =>
    (Array.isArray(values) ? values : [])
      .map((value) => labelMap[value] || value)
      .join(", ") || "—";

  return (
    <div className="apt-page">
      <div className="apt-toolbar admin-toolbar-compact">
        <button className="apt-create-btn apt-create-btn-back" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div>
          <h2 className="apt-title">Fields for {typeDef.displayName || typeName}</h2>
          <p className="apt-subtitle">{fieldCount} field{fieldCount === 1 ? "" : "s"} in {sections.length} section{sections.length === 1 ? "" : "s"}.</p>
          <p className="apt-subtitle">Semantic model: {getSemanticModelLabel(typeDef.semanticModelKey)}</p>
        </div>
      </div>

      <div className="apt-fields-viewer apt-fields-viewer-plain">
        <div className="apt-fv-section apt-fv-section-spaced">
          <div className="apt-fv-section-title apt-fv-section-title-strong">{systemHeader.section.label}</div>
          <table className="apt-fv-table apt-fv-table-full apt-fv-table-header">
            <caption className="apt-sr-only">
              Passport header fields selected from the passport module schema.
            </caption>
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Semantic ID</th>
                <th>Source</th>
                <th>Type</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {systemHeaderEntries.map(entry => (
                <tr key={`${entry.sourceType}:${entry.managedKey || entry.fieldKey || entry.slotKey}`}>
                  <td>{entry.label}</td>
                  <td><code>{entry.sourceType === "managed" ? entry.slotKey : entry.fieldKey}</code></td>
                  <td><code>{entry.semanticId || "—"}</code></td>
                  <td>{entry.sourceType === "managed" ? "Managed value" : "Module field"}</td>
                  <td>{entry.type || "—"}</td>
                  <td>{entry.required ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sections.length === 0 ? (
          <div className="alert alert-info">No custom field sections are defined.</div>
        ) : (
          <>
          {sections.map(section => (
            <div key={section.key} className="apt-fv-section apt-fv-section-spaced">
              <div className="apt-fv-section-title apt-fv-section-title-strong">{section.label}</div>
              <table className="apt-fv-table apt-fv-table-full apt-fv-table-custom">
                <caption className="apt-sr-only">
                  {section.label} fields with access audience, confidentiality, and update authority rules.
                </caption>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Key</th>
                    <th>Type</th>
                    <th>Access</th>
                    <th>Confidentiality</th>
                    <th>Update Authority</th>
                  </tr>
                </thead>
                <tbody>
                  {section.fields.map(field => (
                    <tr key={field.key}>
                      <td>{field.label}</td>
                      <td><code>{field.key}</code></td>
                      <td><span className={`apt-fv-type apt-fv-type-${field.type}`}>{field.type}</span></td>
                      <td>{describeList(field.access, accessLevelLabels)}</td>
                      <td>{confidentialityLevelLabels[field.confidentiality] || field.confidentiality || "—"}</td>
                      <td>{describeList(field.updateAuthority, updateAuthorityLabels)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  );
}

export default AdminPassportTypeFields;
