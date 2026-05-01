import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

function CompanyKebabMenu({ pos, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="kebab-dropdown-menu" style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}>
      {children}
    </div>,
    document.body
  );
}

const API = import.meta.env.VITE_API_URL || "";

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
  const [policyTarget,   setPolicyTarget]   = useState(null);
  const [policyForm,     setPolicyForm]     = useState(null);
  const [policyError,    setPolicyError]    = useState("");
  const [policyLoading,  setPolicyLoading]  = useState(false);
  const [policySaving,   setPolicySaving]   = useState(false);
  const [sortConfig,     setSortConfig]     = useState({ key: "created_at", direction: "desc" });
  const [columnFilters,  setColumnFilters]  = useState({});
  const [showFilters,    setShowFilters]    = useState(false);
  const [openKebabId,    setOpenKebabId]    = useState(null);
  const [kebabPos,       setKebabPos]       = useState({ top: 0, left: 0 });
  const [assetConfirm,   setAssetConfirm]   = useState(null); // company to confirm asset toggle

  const openKebab = (e, id) => {
    e.stopPropagation();
    if (openKebabId === id) { setOpenKebabId(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    const left = Math.max(4, rect.right - menuWidth);
    if (spaceBelow < 240) {
      // Not enough space below — anchor menu bottom to button top
      setKebabPos({ bottom: window.innerHeight - rect.top + 4, top: undefined, left });
    } else {
      setKebabPos({ top: rect.bottom + 4, bottom: undefined, left });
    }
    setOpenKebabId(id);
  };

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
      const r = await fetchWithAuth(`${API}/api/admin/companies`,
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
      const r = await fetchWithAuth(`${API}/api/admin/companies`, {
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
      const r = await fetchWithAuth(`${API}/api/admin/companies/${deleteTarget.id}`, {
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
      const r = await fetchWithAuth(`${API}/api/admin/companies/${company.id}/asset-management`, {
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

  const openPolicyEditor = async (company) => {
    try {
      setPolicyTarget(company);
      setPolicyError("");
      setPolicyLoading(true);
      const response = await fetchWithAuth(`${API}/api/admin/companies/${company.id}/dpp-policy`, {
        headers: { ...authHeaders() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load company DPP policy");
      setPolicyForm({
        default_granularity: data.default_granularity || "item",
        allow_granularity_override: !!data.allow_granularity_override,
        mint_model_dids: !!data.mint_model_dids,
        mint_item_dids: !!data.mint_item_dids,
        mint_facility_dids: !!data.mint_facility_dids,
        vc_issuance_enabled: !!data.vc_issuance_enabled,
        jsonld_export_enabled: !!data.jsonld_export_enabled,
        claros_battery_dictionary_enabled: !!data.claros_battery_dictionary_enabled,
      });
    } catch (e) {
      setPolicyError(e.message || "Failed to load company DPP policy");
    } finally {
      setPolicyLoading(false);
    }
  };

  const handlePolicyFieldChange = (field, value) => {
    setPolicyForm((prev) => ({ ...(prev || {}), [field]: value }));
    setPolicyError("");
  };

  const savePolicy = async (e) => {
    e.preventDefault();
    if (!policyTarget || !policyForm) return;
    try {
      setPolicySaving(true);
      const response = await fetchWithAuth(`${API}/api/admin/companies/${policyTarget.id}/dpp-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(policyForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save company DPP policy");
      setSuccessMsg(`Updated DPP policy for ${policyTarget.company_name}`);
      setPolicyTarget(null);
      setPolicyForm(null);
      setPolicyError("");
      await fetchCompanies();
    } catch (e) {
      setPolicyError(e.message || "Failed to save company DPP policy");
    } finally {
      setPolicySaving(false);
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
                    className="kebab-menu-btn"
                    onClick={(e) => openKebab(e, company.id)}
                    disabled={isTogglingAssetId === company.id || isDeletingId === company.id}
                  >
                    ⋮
                  </button>
                  {openKebabId === company.id && (
                    <CompanyKebabMenu pos={kebabPos} onClose={() => setOpenKebabId(null)}>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); setAssetConfirm(company); }}
                        disabled={isTogglingAssetId === company.id}
                      >
                        {company.asset_management_enabled ? "⛔ Revoke Asset" : "💼 Enable Asset"}
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); navigate(`/admin/company/${company.id}/access`); }}
                      >
                        🔐 Access
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); navigate(`/admin/company/${company.id}/profile`); }}
                      >
                        🎨 Branding
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => {
                          setOpenKebabId(null);
                          openPolicyEditor(company);
                        }}
                      >
                        ⚙️ DPP Policy
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); navigate("/admin/invite", { state: { preselectedCompanyId: String(company.id) } }); }}
                      >
                        ✉️ Invite
                      </button>
                      <button
                        className="menu-item menu-item-danger"
                        onClick={() => { setOpenKebabId(null); handleDeleteCompany(company); }}
                        disabled={isDeletingId === company.id}
                      >
                        {isDeletingId === company.id ? "Deleting…" : "🗑 Delete"}
                      </button>
                    </CompanyKebabMenu>
                  )}
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

      {assetConfirm && (
        <div className="apt-modal-overlay" onClick={() => !isTogglingAssetId && setAssetConfirm(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">
              {assetConfirm.asset_management_enabled ? "Revoke Asset Management" : "Enable Asset Management"}
            </h3>
            <p className="apt-modal-warning" style={{ background: assetConfirm.asset_management_enabled ? undefined : "rgba(13,181,176,0.08)", borderColor: assetConfirm.asset_management_enabled ? undefined : "rgba(13,181,176,0.28)", color: assetConfirm.asset_management_enabled ? undefined : "var(--text-primary)" }}>
              {assetConfirm.asset_management_enabled
                ? <>This will revoke Asset Management access for <strong>{assetConfirm.company_name}</strong>. Their existing asset data will be preserved but they will no longer be able to use the Asset platform.</>
                : <>This will enable Asset Management for <strong>{assetConfirm.company_name}</strong>. They will gain access to the Asset platform immediately.</>}
            </p>
            <div className="apt-modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setAssetConfirm(null)}
                disabled={!!isTogglingAssetId}
              >
                Cancel
              </button>
              <button
                type="button"
                className={assetConfirm.asset_management_enabled ? "apt-modal-delete-btn" : "apt-modal-confirm-btn"}
                disabled={!!isTogglingAssetId}
                onClick={async () => {
                  const company = assetConfirm;
                  setAssetConfirm(null);
                  await handleToggleAssetManagement(company);
                }}
              >
                {isTogglingAssetId
                  ? "Updating…"
                  : assetConfirm.asset_management_enabled
                    ? "Revoke Access"
                    : "Enable Access"}
              </button>
            </div>
          </div>
        </div>
      )}

      {policyTarget && (
        <div className="apt-modal-overlay" onClick={() => !policySaving && setPolicyTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">DPP Policy</h3>
            <p className="apt-modal-warning" style={{ background: "rgba(13,181,176,0.08)", borderColor: "rgba(13,181,176,0.28)", color: "var(--text-primary)" }}>
              Configure DPP issuance behavior for <strong>{policyTarget.company_name}</strong>.
            </p>
            {policyLoading ? (
              <div className="loading">Loading policy…</div>
            ) : (
              <form onSubmit={savePolicy} className="company-form">
                {policyError && <div className="alert alert-error admin-alert-inline-wide">{policyError}</div>}
                <div className="form-group">
                  <label htmlFor="defaultGranularity">Default Granularity</label>
                  <select
                    id="defaultGranularity"
                    value={policyForm?.default_granularity || "item"}
                    onChange={(e) => handlePolicyFieldChange("default_granularity", e.target.value)}
                    disabled={policySaving}
                  >
                    <option value="item">Item</option>
                    <option value="batch">Batch</option>
                    <option value="model">Model</option>
                  </select>
                </div>

                {[
                  ["allow_granularity_override", "Allow granularity override"],
                  ["mint_model_dids", "Mint model DIDs"],
                  ["mint_item_dids", "Mint item DIDs"],
                  ["mint_facility_dids", "Mint facility DIDs"],
                  ["vc_issuance_enabled", "Enable VC issuance"],
                  ["jsonld_export_enabled", "Enable JSON-LD export"],
                  ["claros_battery_dictionary_enabled", "Enable Claros battery dictionary"],
                ].map(([field, label]) => (
                  <label key={field} className="checkbox-label" style={{ marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!policyForm?.[field]}
                      onChange={(e) => handlePolicyFieldChange(field, e.target.checked)}
                      disabled={policySaving}
                    />
                    <span>{label}</span>
                  </label>
                ))}

                <div className="apt-modal-actions">
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => setPolicyTarget(null)}
                    disabled={policySaving}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="apt-modal-confirm-btn" disabled={policySaving}>
                    {policySaving ? "Saving…" : "Save Policy"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminCompanies;
