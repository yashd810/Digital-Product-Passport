import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../shared/table/tableControls";
import { authHeaders } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function AdminCompanies() {
  const navigate = useNavigate();

  const [companies,      setCompanies]      = useState([]);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [createdCompany, setCreatedCompany] = useState(null);
  const [isLoading,      setIsLoading]      = useState(false);
  const [isDeletingId,   setIsDeletingId]   = useState(null);
  const [isTogglingAssetId, setIsTogglingAssetId] = useState(null);
  const [error,          setError]          = useState("");
  const [successMsg,     setSuccessMsg]     = useState("");
  const [deleteTarget,   setDeleteTarget]   = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError,    setDeleteError]    = useState("");
  const [sortConfig,     setSortConfig]     = useState({ key: "created_at", direction: "desc" });
  const [columnFilters,  setColumnFilters]  = useState({});
  const [showFilters,    setShowFilters]    = useState(false);

  const companyColumns = useMemo(() => ([
    { key: "id", type: "number", getValue: (company) => company.id },
    { key: "company_name", type: "string", getValue: (company) => company.company_name || "" },
    { key: "granted_type_names", type: "string", getValue: (company) => (company.granted_type_names || []).join(" ") },
    { key: "asset_management_enabled", type: "string", getValue: (company) => company.asset_management_enabled ? "enabled" : "disabled" },
    { key: "created_at", type: "date", getValue: (company) => company.created_at },
  ]), []);

  const filteredCompanies = useMemo(
    () => applyTableControls(companies, companyColumns, sortConfig, columnFilters),
    [companies, companyColumns, sortConfig, columnFilters]
  );

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  useEffect(() => { fetchCompanies(); }, []);

  const fetchCompanies = async () => {
    try {
      const r = await fetch(`${API}/api/admin/companies`,
        { headers: { ...authHeaders() } });
      if (!r.ok) throw new Error("Failed to fetch companies");
      setCompanies(await r.json());
    } catch (e) { setError(e.message); }
  };

  const handleCreateCompany = async (e) => {
    e.preventDefault();
    setError(""); setSuccessMsg(""); setIsLoading(true);
    if (!newCompanyName.trim()) { setError("Company name is required"); setIsLoading(false); return; }
    try {
      const r = await fetch(`${API}/api/admin/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ companyName: newCompanyName }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed to create company"); }
      const data = await r.json();
      setCreatedCompany(data.company);
      setNewCompanyName("");
      setSuccessMsg(`Created ${data.company.company_name}`);
      fetchCompanies();
    } catch (e) { setError(e.message || "Failed to create company"); }
    finally { setIsLoading(false); }
  };

  const handleDeleteCompany = async (company) => {
    setError("");
    setSuccessMsg("");
    setDeleteTarget(company);
    setDeletePassword("");
    setDeleteError("");
  };

  const confirmDeleteCompany = async (e) => {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("Admin password is required.");
      return;
    }

    try {
      setIsDeletingId(deleteTarget.id);
      const r = await fetch(`${API}/api/admin/companies/${deleteTarget.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to delete company");

      setCreatedCompany(null);
      setSuccessMsg(`Deleted ${deleteTarget.company_name} and all related company data.`);
      setDeleteTarget(null);
      setDeletePassword("");
      setDeleteError("");
      await fetchCompanies();

      if (data.deletedCurrentSessionUser) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (e) {
      setDeleteError(e.message || "Failed to delete company");
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleToggleAssetManagement = async (company) => {
    try {
      setError("");
      setSuccessMsg("");
      setIsTogglingAssetId(company.id);
      const nextEnabled = !company.asset_management_enabled;
      const r = await fetch(`${API}/api/admin/companies/${company.id}/asset-management`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to update Asset Management access");
      setSuccessMsg(
        nextEnabled
          ? `Asset Management enabled for ${company.company_name}`
          : `Asset Management revoked for ${company.company_name}`
      );
      await fetchCompanies();
    } catch (e) {
      setError(e.message || "Failed to update Asset Management access");
    } finally {
      setIsTogglingAssetId(null);
    }
  };

  return (
    <div className="companies-section">
      <h2>Company Management</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Create company */}
      <div className="create-company-card">
        <h3>Create New Company</h3>
        <form onSubmit={handleCreateCompany} className="company-form">
          <div className="form-group">
            <label htmlFor="companyName">Company Name</label>
            <input id="companyName" type="text" value={newCompanyName}
              onChange={e => { setNewCompanyName(e.target.value); setCreatedCompany(null); }}
              placeholder="e.g., Acme Corp" required disabled={isLoading} />
          </div>
          <button type="submit" className="create-btn" disabled={isLoading}>
            {isLoading ? "Creating…" : "Create Company"}
          </button>
        </form>

        {createdCompany && (
          <div className="company-code-result">
            <div className="company-code-result-header">
              <span className="company-code-result-icon">✅</span>
              <div>
                <h4>Company created successfully</h4>
                <p className="company-code-result-subtitle">
                  The new company is ready for access setup and user invites.
                </p>
              </div>
            </div>

            <div className="company-code-result-grid">
              <div className="company-code-result-item">
                <span className="company-code-result-label">Company</span>
                <strong className="company-code-result-value">
                  {createdCompany.company_name}
                </strong>
              </div>
            </div>

            <p className="company-code-result-note">
              Next step: use the <strong>Invite</strong> action in the company table below to add users.
            </p>
          </div>
        )}
      </div>

      {/* Companies list */}
      <div className="companies-list">
        <h3>All Companies ({companies.length})</h3>
        <div className="table-tools-row">
          <button
            type="button"
            className={`table-filter-toggle-btn${showFilters ? " active" : ""}`}
            onClick={() => setShowFilters(prev => !prev)}
          >
            Filter
          </button>
        </div>
        <table className="companies-table">
          <thead>
            <tr>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("id")}>ID{sortIndicator(sortConfig, "id") && ` ${sortIndicator(sortConfig, "id")}`}</button></th>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("company_name")}>Company Name{sortIndicator(sortConfig, "company_name") && ` ${sortIndicator(sortConfig, "company_name")}`}</button></th>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("granted_type_names")}>Access{sortIndicator(sortConfig, "granted_type_names") && ` ${sortIndicator(sortConfig, "granted_type_names")}`}</button></th>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("asset_management_enabled")}>Asset Platform{sortIndicator(sortConfig, "asset_management_enabled") && ` ${sortIndicator(sortConfig, "asset_management_enabled")}`}</button></th>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("created_at")}>Created{sortIndicator(sortConfig, "created_at") && ` ${sortIndicator(sortConfig, "created_at")}`}</button></th>
              <th>Actions</th>
            </tr>
            {showFilters && <tr className="table-filter-row">
              <th><input className="table-filter-input" value={columnFilters.id || ""} onChange={e => setColumnFilters(prev => ({ ...prev, id: e.target.value }))} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.company_name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, company_name: e.target.value }))} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.granted_type_names || ""} onChange={e => setColumnFilters(prev => ({ ...prev, granted_type_names: e.target.value }))} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.asset_management_enabled || ""} onChange={e => setColumnFilters(prev => ({ ...prev, asset_management_enabled: e.target.value }))} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={e => setColumnFilters(prev => ({ ...prev, created_at: e.target.value }))} placeholder="Filter" /></th>
              <th></th>
            </tr>}
          </thead>
          <tbody>
            {filteredCompanies.map(company => (
              <tr key={company.id}>
                <td className="id-cell">{company.id}</td>
                <td className="name-cell">{company.company_name}</td>
                <td>
                  <div className="company-access-list">
                    {(company.granted_type_names || []).length > 0 ? (
                      (company.granted_type_names || []).map((typeName) => (
                        <span key={typeName} className="company-access-pill">{typeName}</span>
                      ))
                    ) : (
                      <span className="company-access-empty">No access assigned</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`company-access-pill ${company.asset_management_enabled ? "asset-pill-enabled" : "asset-pill-disabled"}`}>
                    {company.asset_management_enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="date-cell">{new Date(company.created_at).toLocaleDateString()}</td>
                <td className="actions-cell">
                  <button
                    className="manage-btn manage-btn-analytics"
                    onClick={() => handleToggleAssetManagement(company)}
                    disabled={isTogglingAssetId === company.id}
                  >
                    {isTogglingAssetId === company.id
                      ? "Updating..."
                      : company.asset_management_enabled
                        ? "⛔ Revoke Asset"
                        : "💼 Enable Asset"}
                  </button>
                  <button
                    className="manage-btn manage-btn-access"
                    onClick={() => navigate(`/admin/company/${company.id}/access`)}
                  >
                    🔐 Access
                  </button>
                  <button
                    className="manage-btn manage-btn-access"
                    onClick={() => navigate(`/admin/company/${company.id}/profile`)}
                  >
                    🎨 Branding
                  </button>
                  <button
                    className="manage-btn manage-btn-invite"
                    onClick={() => navigate("/admin/invite", { state: { preselectedCompanyId: String(company.id) } })}
                  >
                    ✉️ Invite
                  </button>
                  <button
                    className="manage-btn manage-btn-danger"
                    onClick={() => handleDeleteCompany(company)}
                    disabled={isDeletingId === company.id}
                  >
                    {isDeletingId === company.id ? "Deleting…" : "🗑 Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="apt-modal-overlay" onClick={() => !isDeletingId && setDeleteTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">Delete Company</h3>
            <p className="apt-modal-warning">
              This will permanently delete <strong>{deleteTarget.company_name}</strong> and all related users, passports,
              repository files, workflow records, and company data. This action cannot be undone.
            </p>
            <form onSubmit={confirmDeleteCompany}>
              {deleteError && <div className="alert alert-error admin-alert-inline-wide">{deleteError}</div>}
              <label className="apt-modal-label">Enter your admin password to confirm</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value);
                  setDeleteError("");
                }}
                placeholder="Your login password"
                className="apt-modal-input"
                autoFocus
              />
              <div className="apt-modal-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setDeleteTarget(null)}
                  disabled={!!isDeletingId}
                >
                  Cancel
                </button>
                <button type="submit" className="apt-modal-delete-btn" disabled={!!isDeletingId}>
                  {isDeletingId ? "Deleting…" : "Delete Company"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminCompanies;
