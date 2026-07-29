import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { countSchemaFields } from "../../shared/passports/passportSchemaUtils";
import "../styles/AdminDashboard.css";

function CompanyAccess() {
  const navigate = useNavigate();
  const { companyId } = useParams();
  const apiBaseUrl = import.meta.env.VITE_API_URL || "";
  const [companyData,    setCompanyData]    = useState(null);
  const [grantedTypeIds, setGrantedTypeIds] = useState([]);
  const [allTypes,       setAllTypes]       = useState([]);
  const [isLoading,      setIsLoading]      = useState(true);
  const [error,          setError]          = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [savingTypeId,   setSavingTypeId]   = useState(null);

  useEffect(() => {
    if (!companyId) { setError("Company ID is missing from URL"); setIsLoading(false); return; }

    const fetchData = async () => {
      try {
        setIsLoading(true);

        const response = await fetchWithAuth(
          `${apiBaseUrl}/api/admin/companies/${encodeURIComponent(companyId)}/passport-type-access`,
          { headers: authHeaders() }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to fetch passport type access");

        const types = Array.isArray(data.passportTypes)
          ? data.passportTypes.map((type) => ({ ...type, id: Number(type.id) }))
          : [];
        setAllTypes(types);
        setCompanyData(data.company || null);
        setGrantedTypeIds(types.filter((type) => type.accessGranted).map((type) => type.id));
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [apiBaseUrl, companyId]);

  const handleToggleAccess = async (type) => {
    const typeId = Number(type.id);
    const displayName = type.displayName || type.typeName;
    const isGranted = grantedTypeIds.includes(typeId);
    if (!isGranted && !type.isActive) {
      setError("Activate this passport type before granting it to a company.");
      return;
    }
    try {
      setSavingTypeId(typeId);
      setError("");

      if (isGranted) {
        const r = await fetchWithAuth(
          `${apiBaseUrl}/api/admin/company-access/${companyId}/${typeId}`,
          { method: "DELETE", headers: authHeaders() }
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Failed to revoke access");
        setGrantedTypeIds(ids => ids.filter(id => id !== typeId));
        setAllTypes((types) => types.map((entry) => (
          entry.id === typeId ? { ...entry, accessGranted: false, grantedAt: null } : entry
        )));
        setSuccessMessage(`Revoked ${displayName} from ${companyData?.companyName || "company"}.`);
      } else {
        const r = await fetchWithAuth(`${apiBaseUrl}/api/admin/company-access`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ companyId: Number(companyId), passportTypeId: typeId }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Failed to grant access");
        }
        setGrantedTypeIds(ids => [...new Set([...ids, typeId])]);
        setAllTypes((types) => types.map((entry) => (
          entry.id === typeId ? { ...entry, accessGranted: true, grantedAt: data.access?.grantedAt || null } : entry
        )));
        setSuccessMessage(`Granted ${displayName} to ${companyData?.companyName || "company"}.`);
      }

      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.message || "Operation failed");
    } finally {
      setSavingTypeId(null);
    }
  };

  // Group types by product category
  const grouped = allTypes.reduce((acc, t) => {
    const key = t.productCategory;
    if (!acc[key]) acc[key] = { icon: t.productIcon, types: [] };
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
        <button className="back-btn" onClick={() => navigate("/admin/companies")} title="Back to companies">← Back</button>
        <h1>Manage Company Access</h1>
      </header>

      <main className="access-main">
        <div className="access-container">
          {companyData && (
            <div className="company-info">
              <h2>{companyData.companyName}</h2>
              <p><strong>Company ID:</strong> {companyData.id}</p>
            </div>
          )}

          {error          && <div className="alert alert-error">{error}</div>}
          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          <div className="access-section">
            <h3>🔐 Passport Type Access</h3>
            <p className="section-description">
              Grant or revoke the passport types this company can use.
              Revoking access preserves existing passport data and can be reversed later.
            </p>

            {allTypes.length === 0 ? (
              <div className="alert alert-info admin-alert-top">
                No passport types have been created yet.{" "}
                <button className="link-btn" onClick={() => navigate("/admin/passport-types/new")}>
                  Create the first type →
                </button>
              </div>
            ) : (
              Object.entries(grouped).map(([productCategory, { icon, types }]) => (
                <div key={productCategory} className="access-productCategory-group">
                  <div className="access-productCategory-header">
                    <span className="access-productCategory-icon">{icon}</span>
                    <span className="access-productCategory-name">{productCategory}</span>
                  </div>

                  <div className="types-grid">
                    {types.map(type => {
                      const granted = grantedTypeIds.includes(type.id);
                      return (
                        <div key={type.id} className={`type-card ${granted ? "granted" : "not-granted"}`}>
                          <div className="access-type-meta">
                            <h4 className="access-type-title">{type.displayName}</h4>
                            <code className="access-type-code">{type.typeName}</code>
                          </div>
                          <div className="access-type-count">
                            {countSchemaFields(type.fieldsJson?.sections || [])} fields
                          </div>
                          <div className={`access-grant-status ${granted ? "granted" : "not-granted"}`}>
                            {granted ? "Access granted" : "No access"}
                            {!type.isActive && " · Type inactive"}
                          </div>
                          <button
                            className={`toggle-btn ${granted ? "active" : ""}`}
                            onClick={() => handleToggleAccess(type)}
                            disabled={savingTypeId !== null || (!granted && !type.isActive)}
                          >
                            {savingTypeId === type.id
                              ? "Saving…"
                              : granted
                                ? "Revoke access"
                                : type.isActive
                                  ? "Grant access"
                                  : "Activate type first"}
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
                ? allTypes.filter(t => grantedTypeIds.includes(t.id)).map(t => t.displayName).join(", ")
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
