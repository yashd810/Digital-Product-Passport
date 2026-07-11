import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { buildCompanyAnalyticsPath } from "../utils/companyRoutes";
import "../styles/AdminDashboard.css";
import "../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const initialCompanyForm = {
  companyName: "",
  legalName: "",
  country: "",
  companyRegistrationNumber: "",
  vatNumber: "",
  websiteDomain: "",
  customerTrustLevel: "basic",
  authorizedContactName: "",
  authorizedContactEmail: "",
};

const trustLevelOptions = [
  { value: "basic", label: "Small supplier - Basic" },
  { value: "verifiedBusiness", label: "Medium supplier - Verified business" },
  { value: "enterprise", label: "Big customer - Enterprise" },
];

function buildEditForm(company = {}) {
  return {
    companyName: company.companyName || "",
    legalName: company.legalName || "",
    country: company.country || "",
    companyRegistrationNumber: company.companyRegistrationNumber || "",
    vatNumber: company.vatNumber || "",
    websiteDomain: company.websiteDomain || "",
    customerTrustLevel: company.customerTrustLevel || "basic",
    authorizedContactName: company.authorizedContactName || "",
    authorizedContactEmail: company.authorizedContactEmail || "",
  };
}

function buildPolicyForm(policy = {}) {
  return {
    defaultGranularity: policy.defaultGranularity || "item",
    allowGranularityOverride: !!policy.allowGranularityOverride,
    mintModelDids: !!policy.mintModelDids,
    mintItemDids: !!policy.mintItemDids,
    mintFacilityDids: !!policy.mintFacilityDids,
    vcIssuanceEnabled: !!policy.vcIssuanceEnabled,
    jsonldExportEnabled: !!policy.jsonldExportEnabled,
    semanticDictionaryEnabled: !!policy.semanticDictionaryEnabled,
  };
}

function AdminEditCompanyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { companyId } = useParams();

  const [company, setCompany] = useState(location.state?.company || null);
  const [editForm, setEditForm] = useState(buildEditForm(location.state?.company || initialCompanyForm));
  const [loading, setLoading] = useState(!location.state?.company);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });

  const [policyForm, setPolicyForm] = useState(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState("");

  const analyticsPath = useMemo(() => (
    company?.id ? buildCompanyAnalyticsPath(company) : null
  ), [company]);

  const backTarget = useMemo(() => {
    const returnTo = location.state?.returnTo;
    if (typeof returnTo === "string" && returnTo && !returnTo.startsWith("/admin/analytics/")) {
      return returnTo;
    }
    return analyticsPath || "/admin/analytics";
  }, [analyticsPath, location.state]);

  useEffect(() => {
    let ignore = false;

    const loadCompany = async () => {
      if (!companyId) {
        setError("Company ID is missing from the URL.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const response = await fetchWithAuth(`${api}/api/admin/companies/${companyId}`, {
          headers: { ...authHeaders() },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load company details");
        if (ignore) return;
        setCompany(data);
        setEditForm(buildEditForm(data));
      } catch (loadError) {
        if (!ignore) setError(loadError.message || "Failed to load company details");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadCompany();
    return () => {
      ignore = true;
    };
  }, [companyId]);

  useEffect(() => {
    let ignore = false;

    const loadPolicy = async () => {
      if (!companyId) return;

      try {
        setPolicyLoading(true);
        setPolicyError("");
        const response = await fetchWithAuth(`${api}/api/admin/companies/${companyId}/dpp-policy`, {
          headers: { ...authHeaders() },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load company DPP policy");
        if (!ignore) setPolicyForm(buildPolicyForm(data));
      } catch (loadError) {
        if (!ignore) setPolicyError(loadError.message || "Failed to load company DPP policy");
      } finally {
        if (!ignore) setPolicyLoading(false);
      }
    };

    loadPolicy();
    return () => {
      ignore = true;
    };
  }, [companyId]);

  const showFlash = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage({ type: "", text: "" }), type === "success" ? 4000 : 3000);
  };

  const handleEditFormChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const saveEditedCompany = async (event) => {
    event.preventDefault();
    if (!companyId) return;
    if (!String(editForm.companyName || "").trim()) {
      setError("Company name is required");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const response = await fetchWithAuth(`${api}/api/admin/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...editForm,
          companyName: editForm.companyName.trim(),
          country: editForm.country.trim().toUpperCase(),
          websiteDomain: editForm.websiteDomain.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to update company");
      const updatedCompany = data.company || { ...(company || {}), ...editForm, id: Number(companyId) };
      setCompany(updatedCompany);
      setEditForm(buildEditForm(updatedCompany));
      showFlash("success", `Updated ${updatedCompany.companyName}`);
    } catch (saveError) {
      setError(saveError.message || "Failed to update company");
    } finally {
      setSaving(false);
    }
  };

  const handlePolicyFieldChange = (field, value) => {
    setPolicyForm((prev) => ({ ...(prev || {}), [field]: value }));
    setPolicyError("");
  };

  const savePolicy = async (event) => {
    event.preventDefault();
    if (!companyId || !policyForm) return;

    try {
      setPolicySaving(true);
      setPolicyError("");
      const response = await fetchWithAuth(`${api}/api/admin/companies/${companyId}/dpp-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(policyForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save company DPP policy");
      setPolicyForm(buildPolicyForm(data));
      showFlash("success", `Updated DPP policy for ${company?.companyName || "company"}`);
    } catch (saveError) {
      setPolicyError(saveError.message || "Failed to save company DPP policy");
    } finally {
      setPolicySaving(false);
    }
  };

  if (loading) return <div className="loading dashboard-loading-screen">Loading company details…</div>;
  if (error && !company) return <div className="alert alert-error admin-alert-page">{error}</div>;

  return (
    <div className="aca-page">
      <div className="aca-header aca-header-stack">
        <button className="back-link" onClick={() => navigate(backTarget, company?.id ? { state: { companyId: company.id } } : undefined)}>
          ← Back
        </button>
        <div className="aca-header-main">
          <div>
            <h2 className="aca-title">Edit Company Information</h2>
            <p className="aca-subtitle">
              Update tenant identity details for {company?.companyName || `Company ${companyId}`}.
            </p>
          </div>
        </div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type === "success" ? "success" : "error"} admin-alert-bottom`}>
          {message.text}
        </div>
      )}

      <div className="aca-card admin-card-spaced">
        <h3 className="aca-card-title admin-title-reset">Company Details</h3>
        {error && <div className="alert alert-error admin-alert-inline-wide">{error}</div>}
        <form onSubmit={saveEditedCompany} className="company-form">
          <div className="company-form-grid">
            <div className="form-group">
              <label htmlFor="editCompanyName">Company Name</label>
              <input
                id="editCompanyName"
                type="text"
                value={editForm.companyName}
                onChange={(event) => handleEditFormChange("companyName", event.target.value)}
                required
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editLegalName">Legal Name</label>
              <input
                id="editLegalName"
                type="text"
                value={editForm.legalName}
                onChange={(event) => handleEditFormChange("legalName", event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editCountry">Country</label>
              <input
                id="editCountry"
                type="text"
                value={editForm.country}
                onChange={(event) => handleEditFormChange("country", event.target.value)}
                maxLength={2}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editCompanyRegistrationNumber">Registration Number</label>
              <input
                id="editCompanyRegistrationNumber"
                type="text"
                value={editForm.companyRegistrationNumber}
                onChange={(event) => handleEditFormChange("companyRegistrationNumber", event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editVatNumber">VAT Number</label>
              <input
                id="editVatNumber"
                type="text"
                value={editForm.vatNumber}
                onChange={(event) => handleEditFormChange("vatNumber", event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editWebsiteDomain">Website Domain</label>
              <input
                id="editWebsiteDomain"
                type="text"
                value={editForm.websiteDomain}
                onChange={(event) => handleEditFormChange("websiteDomain", event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editCustomerTrustLevel">Trust Level</label>
              <select
                id="editCustomerTrustLevel"
                value={editForm.customerTrustLevel}
                onChange={(event) => handleEditFormChange("customerTrustLevel", event.target.value)}
                disabled={saving}
              >
                {trustLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="editAuthorizedContactName">Authorized Contact</label>
              <input
                id="editAuthorizedContactName"
                type="text"
                value={editForm.authorizedContactName}
                onChange={(event) => handleEditFormChange("authorizedContactName", event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="form-group company-form-span">
              <label htmlFor="editAuthorizedContactEmail">Authorized Contact Email</label>
              <input
                id="editAuthorizedContactEmail"
                type="email"
                value={editForm.authorizedContactEmail}
                onChange={(event) => handleEditFormChange("authorizedContactEmail", event.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="apt-modal-actions">
            <button type="button" className="cancel-btn" onClick={() => navigate(backTarget, company?.id ? { state: { companyId: company.id } } : undefined)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="apt-modal-confirm-btn" disabled={saving}>
              {saving ? "Saving…" : "Save Company"}
            </button>
          </div>
        </form>
      </div>

      <div className="aca-card">
        <h3 className="aca-card-title admin-title-reset">DPP Policy</h3>
        <p className="admin-muted-copy">
          Configure issuance defaults and semantic export behavior for this company.
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
                value={policyForm?.defaultGranularity || "item"}
                onChange={(event) => handlePolicyFieldChange("defaultGranularity", event.target.value)}
                disabled={policySaving}
              >
                <option value="item">Item</option>
                <option value="batch">Batch</option>
                <option value="model">Model</option>
              </select>
            </div>

            {[
              ["allowGranularityOverride", "Allow granularity override"],
              ["mintModelDids", "Mint model DIDs"],
              ["mintItemDids", "Mint item DIDs"],
              ["mintFacilityDids", "Mint facility DIDs"],
              ["vcIssuanceEnabled", "Enable VC issuance"],
              ["jsonldExportEnabled", "Enable JSON-LD export"],
              ["semanticDictionaryEnabled", "Enable semantic dictionaries"],
            ].map(([field, label]) => (
              <label key={field} className="checkbox-label admin-checkbox-spaced">
                <input
                  type="checkbox"
                  checked={!!policyForm?.[field]}
                  onChange={(event) => handlePolicyFieldChange(field, event.target.checked)}
                  disabled={policySaving}
                />
                <span>{label}</span>
              </label>
            ))}

            <div className="apt-modal-actions">
              <button type="submit" className="apt-modal-confirm-btn" disabled={policySaving || policyLoading || !policyForm}>
                {policySaving ? "Saving…" : "Save Policy"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default AdminEditCompanyPage;
