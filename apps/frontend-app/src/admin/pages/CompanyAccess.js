import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { authHeaders } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

function CompanyAccess() {
  const navigate = useNavigate();
  const { companyId } = useParams();
  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
  const [companyData,    setCompanyData]    = useState(null);
  const [grantedTypeIds, setGrantedTypeIds] = useState([]);
  const [allTypes,       setAllTypes]       = useState([]);   // all active passport types from DB
  const [isLoading,      setIsLoading]      = useState(true);
  const [error,          setError]          = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSaving,       setIsSaving]       = useState(false);

  useEffect(() => {
    if (!companyId) { setError("Company ID is missing from URL"); setIsLoading(false); return; }

    const fetchData = async () => {
      try {
        setIsLoading(true);

        // Fetch all active passport types from the dynamic system
        const [typesRes, companiesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin/passport-types`, {
            headers: authHeaders(),
          }),
          fetch(`${API_BASE_URL}/api/admin/companies`, {
            headers: authHeaders(),
          }),
        ]);

        if (!typesRes.ok)     throw new Error("Failed to fetch passport types");
        if (!companiesRes.ok) throw new Error("Failed to fetch companies");

        const types     = await typesRes.json();
        const companies = await companiesRes.json();
        const company   = companies.find(c => String(c.id) === String(companyId));

        if (!company) throw new Error("Company not found");

        setAllTypes(types);
        setCompanyData(company);
        setGrantedTypeIds(company.granted_types || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [companyId, navigate]);

  const handleToggleAccess = async (typeId, displayName) => {
    const isGranted = grantedTypeIds.includes(typeId);
    try {
      setIsSaving(true);
      setError("");

      if (isGranted) {
        const r = await fetch(
          `${API_BASE_URL}/api/admin/company-access/${companyId}/${typeId}`,
          { method: "DELETE", headers: authHeaders() }
        );
        if (!r.ok) throw new Error("Failed to revoke access");
        setGrantedTypeIds(ids => ids.filter(id => id !== typeId));
        setSuccessMessage(`Revoked: ${displayName}`);
      } else {
        const r = await fetch(`${API_BASE_URL}/api/admin/company-access`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ companyId: parseInt(companyId), passportTypeId: parseInt(typeId) }),
        });
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error || "Failed to grant access");
        }
        setGrantedTypeIds(ids => [...ids, typeId]);
        setSuccessMessage(`Granted: ${displayName}`);
      }

      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.message || "Operation failed");
    } finally {
      setIsSaving(false);
    }
  };

  // Group types by umbrella_category
  const grouped = allTypes.reduce((acc, t) => {
    const key = t.umbrella_category;
    if (!acc[key]) acc[key] = { icon: t.umbrella_icon, types: [] };
    acc[key].types.push(t);
    return acc;
  }, {});

  if (isLoading) return (
    <div className="company-access-page">
      <header className="access-header"><h1>Manage Company Access</h1></header>
      <main className="access-main"><div className="loading">Loading…</div></main>
    </div>
  );

  const grantedCount = grantedTypeIds.length;

  return (
    <div className="company-access-page">
      <header className="access-header">
        <button className="back-btn" onClick={() => navigate("/admin")} title="Back to admin">← Back</button>
        <h1>Manage Company Access</h1>
      </header>

      <main className="access-main">
        <div className="access-container">
          {companyData && (
            <div className="company-info">
              <h2>{companyData.company_name}</h2>
              <p><strong>Company ID:</strong> {companyData.id}</p>
            </div>
          )}

          {error          && <div className="alert alert-error">{error}</div>}
          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          <div className="access-section">
            <h3>🔐 Passport Type Access</h3>
            <p className="section-description">
              Grant or revoke access to passport types. When access is granted,
              a dedicated data table is created for this company.
              Revoking access preserves existing passport data.
            </p>

            {allTypes.length === 0 ? (
              <div className="alert alert-info admin-alert-top">
                No passport types have been created yet.{" "}
                <button className="link-btn" onClick={() => navigate("/admin/passport-types/new")}>
                  Create the first type →
                </button>
              </div>
            ) : (
              Object.entries(grouped).map(([umbrella, { icon, types }]) => (
                <div key={umbrella} className="access-umbrella-group">
                  <div className="access-umbrella-header">
                    <span className="access-umbrella-icon">{icon}</span>
                    <span className="access-umbrella-name">{umbrella}</span>
                  </div>

                  <div className="types-grid">
                    {types.map(type => {
                      const granted = grantedTypeIds.includes(type.id);
                      return (
                        <div key={type.id} className={`type-card ${granted ? "granted" : "revoked"}`}>
                          <div className="access-type-meta">
                            <h4 className="access-type-title">{type.display_name}</h4>
                            <code className="access-type-code">{type.type_name}</code>
                          </div>
                          <div className="access-type-count">
                            {type.fields_json?.sections?.reduce((n, s) => n + (s.fields?.length || 0), 0) || 0} fields
                          </div>
                          <button
                            className={`toggle-btn ${granted ? "active" : ""}`}
                            onClick={() => handleToggleAccess(type.id, type.display_name)}
                            disabled={isSaving}
                          >
                            {granted ? "✓ Granted" : "✗ Revoked"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="access-summary">
            <h4>📊 Summary</h4>
            <p>
              <strong>Granted Access:</strong>{" "}
              {grantedCount > 0
                ? allTypes.filter(t => grantedTypeIds.includes(t.id)).map(t => t.display_name).join(", ")
                : "None"}
            </p>
            <p><strong>Total Granted:</strong> {grantedCount} of {allTypes.length}</p>
          </div>
        </div>
      </main>

      <footer className="access-footer">
        <p>&copy; {new Date().getFullYear()} Digital Product Passport System. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default CompanyAccess;
