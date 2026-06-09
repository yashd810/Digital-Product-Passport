import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { buildCompanyAnalyticsPath } from "../utils/companyRoutes";
import "../styles/AdminDashboard.css";

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
  const [companyForm, setCompanyForm] = useState(INITIAL_COMPANY_FORM);
  const [createdCompany, setCreatedCompany] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [trustMenuOpen, setTrustMenuOpen] = useState(false);
  const trustMenuRef = useRef(null);

  const selectedTrustLevel = useMemo(
    () => TRUST_LEVEL_OPTIONS.find((option) => option.value === companyForm.customerTrustLevel) || TRUST_LEVEL_OPTIONS[0],
    [companyForm.customerTrustLevel]
  );

  useEffect(() => {
    if (!trustMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (trustMenuRef.current && !trustMenuRef.current.contains(event.target)) {
        setTrustMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setTrustMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [trustMenuOpen]);

  const handleCompanyFormChange = (field, value) => {
    setCompanyForm((prev) => ({ ...prev, [field]: value }));
    setCreatedCompany(null);
  };

  const handleCreateCompany = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMsg("");
    setIsLoading(true);

    if (!String(companyForm.companyName || "").trim()) {
      setError("Company name is required");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetchWithAuth(`${API}/api/admin/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...companyForm,
          country: companyForm.country.trim().toUpperCase(),
          websiteDomain: companyForm.websiteDomain.trim(),
          verificationStatus: "unverified",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to create company");

      setCreatedCompany(data.company);
      setCompanyForm(INITIAL_COMPANY_FORM);
      setSuccessMsg(`Created ${data.company.companyName}`);
    } catch (err) {
      setError(err.message || "Failed to create company");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreatedCompany = () => {
    if (!createdCompany) return;
    navigate(buildCompanyAnalyticsPath(createdCompany), {
      state: { companyId: createdCompany.id },
    });
  };

  const inviteCreatedCompany = () => {
    if (!createdCompany) return;
    navigate("/admin/invite", {
      state: { preselectedCompanyId: String(createdCompany.id) },
    });
  };

  return (
    <div className="companies-section">
      <h2>Company Management</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="create-company-card">
        <h3>Create New Company</h3>
        <form onSubmit={handleCreateCompany} className="company-form">
          <div className="company-form-grid">
            <div className="form-group">
              <label htmlFor="companyName">Company Name</label>
              <input
                id="companyName"
                type="text"
                value={companyForm.companyName}
                onChange={(event) => handleCompanyFormChange("companyName", event.target.value)}
                placeholder="ABC Supplier"
                required
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="legalName">Legal Name</label>
              <input
                id="legalName"
                type="text"
                value={companyForm.legalName}
                onChange={(event) => handleCompanyFormChange("legalName", event.target.value)}
                placeholder="ABC Supplier AB"
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="country">Country</label>
              <input
                id="country"
                type="text"
                value={companyForm.country}
                onChange={(event) => handleCompanyFormChange("country", event.target.value)}
                placeholder="SE"
                maxLength={2}
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="companyRegistrationNumber">Registration Number</label>
              <input
                id="companyRegistrationNumber"
                type="text"
                value={companyForm.companyRegistrationNumber}
                onChange={(event) => handleCompanyFormChange("companyRegistrationNumber", event.target.value)}
                placeholder="556xxx-xxxx"
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="vatNumber">VAT Number</label>
              <input
                id="vatNumber"
                type="text"
                value={companyForm.vatNumber}
                onChange={(event) => handleCompanyFormChange("vatNumber", event.target.value)}
                placeholder="SE556xxxxxxx01"
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="websiteDomain">Website Domain</label>
              <input
                id="websiteDomain"
                type="text"
                value={companyForm.websiteDomain}
                onChange={(event) => handleCompanyFormChange("websiteDomain", event.target.value)}
                placeholder="abc.se"
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="customerTrustLevel">Trust Level</label>
              <div className="admin-select" ref={trustMenuRef}>
                <button
                  id="customerTrustLevel"
                  type="button"
                  className={`admin-select-trigger${trustMenuOpen ? " open" : ""}`}
                  onClick={() => !isLoading && setTrustMenuOpen((prev) => !prev)}
                  disabled={isLoading}
                  aria-haspopup="listbox"
                  aria-expanded={trustMenuOpen}
                >
                  <span className="admin-select-trigger-label">{selectedTrustLevel.label}</span>
                  <span className="admin-select-trigger-caret" aria-hidden="true">▾</span>
                </button>
                {trustMenuOpen && (
                  <div className="admin-select-menu" role="listbox" aria-labelledby="customerTrustLevel">
                    {TRUST_LEVEL_OPTIONS.map((option) => {
                      const selected = option.value === companyForm.customerTrustLevel;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`admin-select-option${selected ? " selected" : ""}`}
                          onClick={() => {
                            handleCompanyFormChange("customerTrustLevel", option.value);
                            setTrustMenuOpen(false);
                          }}
                        >
                          <span className="admin-select-option-label">{option.label}</span>
                          {selected && <span className="admin-select-option-check" aria-hidden="true">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="authorizedContactName">Authorized Contact</label>
              <input
                id="authorizedContactName"
                type="text"
                value={companyForm.authorizedContactName}
                onChange={(event) => handleCompanyFormChange("authorizedContactName", event.target.value)}
                placeholder="Anna Andersson"
                disabled={isLoading}
              />
            </div>
            <div className="form-group company-form-span">
              <label htmlFor="authorizedContactEmail">Authorized Contact Email</label>
              <input
                id="authorizedContactEmail"
                type="email"
                value={companyForm.authorizedContactEmail}
                onChange={(event) => handleCompanyFormChange("authorizedContactEmail", event.target.value)}
                placeholder="anna@abc.se"
                disabled={isLoading}
              />
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
                <strong className="company-code-result-value">{createdCompany.companyName}</strong>
              </div>
              <div className="company-code-result-item">
                <span className="company-code-result-label">Legal Name</span>
                <strong className="company-code-result-value">{createdCompany.legalName || "Not set"}</strong>
              </div>
              <div className="company-code-result-item">
                <span className="company-code-result-label">Identity Level</span>
                <strong className="company-code-result-value">{createdCompany.customerTrustLevel || "BASIC"}</strong>
              </div>
              <div className="company-code-result-item">
                <span className="company-code-result-label">Verification</span>
                <strong className="company-code-result-value">{createdCompany.verificationStatus || "unverified"}</strong>
              </div>
            </div>

            <div className="company-code-result-actions">
              <button type="button" className="manage-btn" onClick={openCreatedCompany}>
                Open Company
              </button>
              <button type="button" className="manage-btn manage-btn-secondary" onClick={inviteCreatedCompany}>
                Invite User
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminCompanies;
