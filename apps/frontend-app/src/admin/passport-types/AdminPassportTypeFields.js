import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function getSemanticModelLabel(modelKey) {
  if (modelKey === "battery_pass_din_spec_99100") return "Battery Pass Data Model";
  return "No semantic model";
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
        const res = await fetch(`${API}/api/passport-types/${typeName}`);
        if (!res.ok) throw new Error("Passport type not found");
        const data = await res.json();
        setTypeDef({ ...data, type_name: typeName });
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

  const sections = typeDef.fields_json?.sections || []; 
  const fieldCount = sections.reduce((sum, s) => sum + (s.fields?.length || 0), 0);

  return (
    <div className="apt-page">
      <div className="apt-toolbar admin-toolbar-compact">
        <button className="apt-create-btn apt-create-btn-back" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div>
          <h2 className="apt-title">Fields for {typeDef.display_name || typeName}</h2>
          <p className="apt-subtitle">{fieldCount} field{fieldCount === 1 ? "" : "s"} in {sections.length} section{sections.length === 1 ? "" : "s"}.</p>
          <p className="apt-subtitle">Semantic model: {getSemanticModelLabel(typeDef.semantic_model_key)}</p>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="alert alert-info">No field sections are defined.</div>
      ) : (
        <div className="apt-fields-viewer apt-fields-viewer-plain">
          {sections.map(section => (
            <div key={section.key} className="apt-fv-section apt-fv-section-spaced">
              <div className="apt-fv-section-title apt-fv-section-title-strong">{section.label}</div>
              <table className="apt-fv-table apt-fv-table-full">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Key</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {section.fields.map(field => (
                    <tr key={field.key}>
                      <td>{field.label}</td>
                      <td><code>{field.key}</code></td>
                      <td><span className={`apt-fv-type apt-fv-type-${field.type}`}>{field.type}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdminPassportTypeFields;
