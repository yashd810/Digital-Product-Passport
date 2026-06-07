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

const INITIAL_COMPANY_FORM = {
  companyName: "",
  legalName: "",
  country: "",
  companyRegistrationNumber: "",
  vatNumber: "",
  websiteDomain: "",
  customerTrustLevel: "BASIC",
  authorizedContactName: "",
  authorizedContactEmail: "",
};

const TRUST_LEVEL_OPTIONS = [
  { value: "BASIC", label: "Small supplier - Basic" },
  { value: "VERIFIED_BUSINESS", label: "Medium supplier - Verified business" },
  { value: "ENTERPRISE", label: "Big customer - Enterprise" },
];

function AdminCompanies() {
  const navigate = useNavigate();

  const [companies,      setCompanies]      = useState([]);
  const [companyForm,    setCompanyForm]    = useState(INITIAL_COMPANY_FORM);
  const [createdCompany, setCreatedCompany] = useState(null);
  const [isLoading,      setIsLoading]      = useState(false);
  const [isDeletingId,   setIsDeletingId]   = useState(null);
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
  const [sortConfig,     setSortConfig]     = useState({ key: "createdAt", direction: "desc" });
  const [columnFilters,  setColumnFilters]  = useState({});
  const [showFilters,    setShowFilters]    = useState(false);
  const [openKebabId,    setOpenKebabId]    = useState(null);
  const [kebabPos,       setKebabPos]       = useState({ top: 0, left: 0 });
  const [editTarget,     setEditTarget]     = useState(null);
  const [editForm,       setEditForm]       = useState(INITIAL_COMPANY_FORM);
  const [editError,      setEditError]      = useState("");
  const [editSaving,     setEditSaving]     = useState(false);

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
	    { key: "companyName", type: "string", getValue: (company) => company.companyName || "" },
	    { key: "legalName", type: "string", getValue: (company) => company.legalName || "" },
	    { key: "customerTrustLevel", type: "string", getValue: (company) => company.customerTrustLevel || "" },
	    { key: "grantedTypeNames", type: "string", getValue: (company) => (company.grantedTypeNames || []).join(" ") },
	    { key: "createdAt", type: "date", getValue: (company) => company.createdAt },
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
	    if (!String(companyForm.companyName || "").trim()) {
	      setError("Company name is required");
	      setIsLoading(false);
	      return;
	    }
	    try {
	      const r = await fetchWithAuth(`${API}/api/admin/companies`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json", ...authHeaders() },
	        body: JSON.stringify({
	          ...companyForm,
	          country: companyForm.country.trim().toUpperCase(),
	          websiteDomain: companyForm.websiteDomain.trim(),
	          verificationStatus: "unverified",
	        }),
	      });
	      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed to create company"); }
	      const data = await r.json();
	      setCreatedCompany(data.company);
	      setCompanyForm(INITIAL_COMPANY_FORM);
	      setSuccessMsg(`Created ${data.company.companyName}`);
	      fetchCompanies();
	    } catch (e) { setError(e.message || "Failed to create company"); }
	    finally { setIsLoading(false); }
	  };

	  const handleCompanyFormChange = (field, value) => {
	    setCompanyForm((prev) => ({ ...prev, [field]: value }));
	    setCreatedCompany(null);
	  };

  const openEditCompany = (company) => {
    setEditTarget(company);
    setEditError("");
    setEditForm({
      companyName: company.companyName || "",
      legalName: company.legalName || "",
      country: company.country || "",
      companyRegistrationNumber: company.companyRegistrationNumber || "",
      vatNumber: company.vatNumber || "",
      websiteDomain: company.websiteDomain || "",
      customerTrustLevel: company.customerTrustLevel || "BASIC",
      authorizedContactName: company.authorizedContactName || "",
      authorizedContactEmail: company.authorizedContactEmail || "",
    });
  };

  const handleEditFormChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setEditError("");
  };

  const saveEditedCompany = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    if (!String(editForm.companyName || "").trim()) {
      setEditError("Company name is required");
      return;
    }
    try {
      setEditSaving(true);
      const response = await fetchWithAuth(`${API}/api/admin/companies/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...editForm,
          country: editForm.country.trim().toUpperCase(),
          websiteDomain: editForm.websiteDomain.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to update company");
      setSuccessMsg(`Updated ${data.company.companyName}`);
      setEditTarget(null);
      await fetchCompanies();
    } catch (e) {
      setEditError(e.message || "Failed to update company");
    } finally {
      setEditSaving(false);
    }
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
      setSuccessMsg(`Deleted ${deleteTarget.companyName} and all related company data.`);
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
        semantic_dictionary_enabled: !!data.semantic_dictionary_enabled,
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
      setSuccessMsg(`Updated DPP policy for ${policyTarget.companyName}`);
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
	          <div className="company-form-grid">
	            <div className="form-group">
	              <label htmlFor="companyName">Company Name</label>
	              <input id="companyName" type="text" value={companyForm.companyName}
	                onChange={e => handleCompanyFormChange("companyName", e.target.value)}
	                placeholder="ABC Supplier" required disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="legalName">Legal Name</label>
	              <input id="legalName" type="text" value={companyForm.legalName}
	                onChange={e => handleCompanyFormChange("legalName", e.target.value)}
	                placeholder="ABC Supplier AB" disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="country">Country</label>
	              <input id="country" type="text" value={companyForm.country}
	                onChange={e => handleCompanyFormChange("country", e.target.value)}
	                placeholder="SE" maxLength={2} disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="companyRegistrationNumber">Registration Number</label>
	              <input id="companyRegistrationNumber" type="text" value={companyForm.companyRegistrationNumber}
	                onChange={e => handleCompanyFormChange("companyRegistrationNumber", e.target.value)}
	                placeholder="556xxx-xxxx" disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="vatNumber">VAT Number</label>
	              <input id="vatNumber" type="text" value={companyForm.vatNumber}
	                onChange={e => handleCompanyFormChange("vatNumber", e.target.value)}
	                placeholder="SE556xxxxxxx01" disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="websiteDomain">Website Domain</label>
	              <input id="websiteDomain" type="text" value={companyForm.websiteDomain}
	                onChange={e => handleCompanyFormChange("websiteDomain", e.target.value)}
	                placeholder="abc.se" disabled={isLoading} />
	            </div>
	            <div className="form-group">
	              <label htmlFor="customerTrustLevel">Trust Level</label>
	              <select id="customerTrustLevel" value={companyForm.customerTrustLevel}
	                onChange={e => handleCompanyFormChange("customerTrustLevel", e.target.value)}
	                disabled={isLoading}>
	                {TRUST_LEVEL_OPTIONS.map((option) => (
	                  <option key={option.value} value={option.value}>{option.label}</option>
	                ))}
	              </select>
	            </div>
	            <div className="form-group">
	              <label htmlFor="authorizedContactName">Authorized Contact</label>
	              <input id="authorizedContactName" type="text" value={companyForm.authorizedContactName}
	                onChange={e => handleCompanyFormChange("authorizedContactName", e.target.value)}
	                placeholder="Anna Andersson" disabled={isLoading} />
	            </div>
	            <div className="form-group company-form-span">
	              <label htmlFor="authorizedContactEmail">Authorized Contact Email</label>
	              <input id="authorizedContactEmail" type="email" value={companyForm.authorizedContactEmail}
	                onChange={e => handleCompanyFormChange("authorizedContactEmail", e.target.value)}
	                placeholder="anna@abc.se" disabled={isLoading} />
	            </div>
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
	                  {createdCompany.companyName}
	                </strong>
	              </div>
	              <div className="company-code-result-item">
	                <span className="company-code-result-label">Legal Name</span>
	                <strong className="company-code-result-value">
	                  {createdCompany.legalName || "Not set"}
	                </strong>
	              </div>
	              <div className="company-code-result-item">
	                <span className="company-code-result-label">Identity Level</span>
	                <strong className="company-code-result-value">
	                  {createdCompany.customerTrustLevel || "BASIC"}
	                </strong>
	              </div>
	              <div className="company-code-result-item">
	                <span className="company-code-result-label">Verification</span>
	                <strong className="company-code-result-value">
	                  {createdCompany.verificationStatus || "unverified"}
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
	              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("companyName")}>Company Name{sortIndicator(sortConfig, "companyName") && ` ${sortIndicator(sortConfig, "companyName")}`}</button></th>
	              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("legalName")}>Legal Identity{sortIndicator(sortConfig, "legalName") && ` ${sortIndicator(sortConfig, "legalName")}`}</button></th>
	              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("customerTrustLevel")}>Trust{sortIndicator(sortConfig, "customerTrustLevel") && ` ${sortIndicator(sortConfig, "customerTrustLevel")}`}</button></th>
	              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("grantedTypeNames")}>Access{sortIndicator(sortConfig, "grantedTypeNames") && ` ${sortIndicator(sortConfig, "grantedTypeNames")}`}</button></th>
              <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("createdAt")}>Created{sortIndicator(sortConfig, "createdAt") && ` ${sortIndicator(sortConfig, "createdAt")}`}</button></th>
              <th>Actions</th>
            </tr>
            {showFilters && <tr className="table-filter-row">
              <th><input className="table-filter-input" value={columnFilters.id || ""} onChange={e => setColumnFilters(prev => ({ ...prev, id: e.target.value }))} placeholder="Filter" /></th>
	              <th><input className="table-filter-input" value={columnFilters.companyName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, companyName: e.target.value }))} placeholder="Filter" /></th>
	              <th><input className="table-filter-input" value={columnFilters.legalName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, legalName: e.target.value }))} placeholder="Filter" /></th>
	              <th><input className="table-filter-input" value={columnFilters.customerTrustLevel || ""} onChange={e => setColumnFilters(prev => ({ ...prev, customerTrustLevel: e.target.value }))} placeholder="Filter" /></th>
	              <th><input className="table-filter-input" value={columnFilters.grantedTypeNames || ""} onChange={e => setColumnFilters(prev => ({ ...prev, grantedTypeNames: e.target.value }))} placeholder="Filter" /></th>
              <th><input className="table-filter-input" value={columnFilters.createdAt || ""} onChange={e => setColumnFilters(prev => ({ ...prev, createdAt: e.target.value }))} placeholder="Filter" /></th>
              <th></th>
            </tr>}
          </thead>
          <tbody>
            {filteredCompanies.map(company => (
              <tr key={company.id}>
	                <td className="id-cell">{company.id}</td>
	                <td className="name-cell">{company.companyName}</td>
	                <td>
	                  <div className="company-identity-cell">
	                    <strong>{company.legalName || company.companyName}</strong>
	                    <span>{[company.country, company.companyRegistrationNumber].filter(Boolean).join(" · ") || "Identity pending"}</span>
	                  </div>
	                </td>
	                <td>
	                  <span className="company-access-pill">
	                    {company.customerTrustLevel || "BASIC"}
	                  </span>
	                </td>
	                <td>
                  <div className="company-access-list">
                    {(company.grantedTypeNames || []).length > 0 ? (
                      (company.grantedTypeNames || []).map((typeName) => (
                        <span key={typeName} className="company-access-pill">{typeName}</span>
                      ))
                    ) : (
                      <span className="company-access-empty">No access assigned</span>
                    )}
                  </div>
                </td>
                <td className="date-cell">{new Date(company.createdAt).toLocaleDateString()}</td>
                <td className="actions-cell">
                  <button
                    className="kebab-menu-btn"
                    onClick={(e) => openKebab(e, company.id)}
                    disabled={isDeletingId === company.id}
                  >
                    ⋮
                  </button>
                  {openKebabId === company.id && (
                    <CompanyKebabMenu pos={kebabPos} onClose={() => setOpenKebabId(null)}>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); navigate(`/admin/company/${company.id}/access`); }}
                      >
                        🔐 Access
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => { setOpenKebabId(null); openEditCompany(company); }}
                      >
                        📝 Edit Company Info
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
              This will permanently delete <strong>{deleteTarget.companyName}</strong> and all related users, passports,
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

      {policyTarget && (
        <div className="apt-modal-overlay" onClick={() => !policySaving && setPolicyTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">DPP Policy</h3>
            <p className="apt-modal-warning" style={{ background: "rgba(13,181,176,0.08)", borderColor: "rgba(13,181,176,0.28)", color: "var(--text-primary)" }}>
              Configure DPP issuance behavior for <strong>{policyTarget.companyName}</strong>.
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
                  ["semantic_dictionary_enabled", "Enable semantic dictionaries"],
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

      {editTarget && (
        <div className="apt-modal-overlay" onClick={() => !editSaving && setEditTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">Edit Company Information</h3>
            <p className="apt-modal-warning" style={{ background: "rgba(13,181,176,0.08)", borderColor: "rgba(13,181,176,0.28)", color: "var(--text-primary)" }}>
              Update company identity details for <strong>{editTarget.companyName}</strong>. Only company name is mandatory.
            </p>
            <form onSubmit={saveEditedCompany} className="company-form">
              {editError && <div className="alert alert-error admin-alert-inline-wide">{editError}</div>}
              <div className="company-form-grid">
                <div className="form-group">
                  <label htmlFor="editCompanyName">Company Name</label>
                  <input id="editCompanyName" type="text" value={editForm.companyName} onChange={e => handleEditFormChange("companyName", e.target.value)} required disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editLegalName">Legal Name</label>
                  <input id="editLegalName" type="text" value={editForm.legalName} onChange={e => handleEditFormChange("legalName", e.target.value)} disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editCountry">Country</label>
                  <input id="editCountry" type="text" value={editForm.country} onChange={e => handleEditFormChange("country", e.target.value)} maxLength={2} disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editCompanyRegistrationNumber">Registration Number</label>
                  <input id="editCompanyRegistrationNumber" type="text" value={editForm.companyRegistrationNumber} onChange={e => handleEditFormChange("companyRegistrationNumber", e.target.value)} disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editVatNumber">VAT Number</label>
                  <input id="editVatNumber" type="text" value={editForm.vatNumber} onChange={e => handleEditFormChange("vatNumber", e.target.value)} disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editWebsiteDomain">Website Domain</label>
                  <input id="editWebsiteDomain" type="text" value={editForm.websiteDomain} onChange={e => handleEditFormChange("websiteDomain", e.target.value)} disabled={editSaving} />
                </div>
                <div className="form-group">
                  <label htmlFor="editCustomerTrustLevel">Trust Level</label>
                  <select id="editCustomerTrustLevel" value={editForm.customerTrustLevel} onChange={e => handleEditFormChange("customerTrustLevel", e.target.value)} disabled={editSaving}>
                    {TRUST_LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="editAuthorizedContactName">Authorized Contact</label>
                  <input id="editAuthorizedContactName" type="text" value={editForm.authorizedContactName} onChange={e => handleEditFormChange("authorizedContactName", e.target.value)} disabled={editSaving} />
                </div>
                <div className="form-group company-form-span">
                  <label htmlFor="editAuthorizedContactEmail">Authorized Contact Email</label>
                  <input id="editAuthorizedContactEmail" type="email" value={editForm.authorizedContactEmail} onChange={e => handleEditFormChange("authorizedContactEmail", e.target.value)} disabled={editSaving} />
                </div>
              </div>
              <div className="apt-modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setEditTarget(null)} disabled={editSaving}>
                  Cancel
                </button>
                <button type="submit" className="apt-modal-confirm-btn" disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Company"}
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
