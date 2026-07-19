import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  confidentialityLevelLabels,
  normalizeSystemPassportHeader,
  resolveSystemHeaderEntries,
} from "./builderHelpers";
import { formatSemanticModelLabel } from "./semanticTermCatalog";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { countSchemaFields, normalizeSchemaSections } from "../../shared/passports/passportSchemaUtils";
import "../styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const getSemanticModelLabel = formatSemanticModelLabel;

function countSchemaSections(sections = []) {
  return normalizeSchemaSections(sections).reduce(
    (count, section) => count + 1 + countSchemaSections(section.sections || []),
    0
  );
}

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
        const res = await fetchWithAuth(`${api}/api/internal/passport-types/${typeName}`);
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

  const sections = normalizeSchemaSections(typeDef.fieldsJson?.sections || []);
  const systemHeader = normalizeSystemPassportHeader(typeDef.fieldsJson?.systemHeader);
  const systemHeaderEntries = resolveSystemHeaderEntries(sections, systemHeader);
  const fieldCount = countSchemaFields(sections);
  const sectionCount = countSchemaSections(sections);
  const renderSection = (section, depth = 0, path = []) => {
    const sectionKey = [...path, section.key || section.label || depth].join(".");
    const sectionPath = [...path, section.label || section.key || `Section ${depth + 1}`];
    const childSections = section.sections || [];
    return (
      <div key={sectionKey} className={`apt-fv-section apt-fv-section-spaced apt-fv-section-depth-${Math.min(depth, 3)}`}>
        <div className="apt-fv-section-title apt-fv-section-title-strong">{section.label}</div>
        <div className="apt-fv-section-path">{sectionPath.join(" › ")}</div>
        {(section.fields || []).length > 0 && (
          <table className="apt-fv-table apt-fv-table-full apt-fv-table-custom">
            <caption className="apt-sr-only">
              {section.label} fields with confidentiality rules.
            </caption>
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Type</th>
                <th>Confidentiality</th>
              </tr>
            </thead>
            <tbody>
              {(section.fields || []).map(field => (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  <td><code>{field.key}</code></td>
                  <td><span className={`apt-fv-type apt-fv-type-${field.type}`}>{field.type}</span></td>
                  <td>{confidentialityLevelLabels[field.confidentiality] || field.confidentiality || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {childSections.map((child, childIndex) => (
          renderSection(child, depth + 1, [...path, section.label || section.key || childIndex])
        ))}
      </div>
    );
  };
  return (
    <div className="apt-page">
      <div className="apt-toolbar admin-toolbar-compact">
        <button className="apt-create-btn apt-create-btn-back" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div>
          <h2 className="apt-title">Fields for {typeDef.displayName || typeName}</h2>
          <p className="apt-subtitle">{fieldCount} field{fieldCount === 1 ? "" : "s"} in {sectionCount} section{sectionCount === 1 ? "" : "s"}.</p>
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
          {sections.map((section) => renderSection(section))}
          </>
        )}
      </div>
    </div>
  );
}

export default AdminPassportTypeFields;
