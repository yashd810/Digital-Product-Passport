import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { buildCompanyAnalyticsPath } from "../utils/companyRoutes";

const API = import.meta.env.VITE_API_URL || "";

function CompanyKebabMenu({ pos, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="kebab-dropdown-menu"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  );
}

function AdminCompanyActions({
  company,
  includeAnalytics = false,
  onCompanyDeleted,
  onCompanyUpdated,
  onMessage,
  hideKebabTrigger = false,
  hideDeleteMenuItem = false,
  inlineActions = [],
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [kebabPos, setKebabPos] = useState({ top: 0, left: 0 });

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [policyTarget, setPolicyTarget] = useState(null);
  const [policyForm, setPolicyForm] = useState(null);
  const [policyError, setPolicyError] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);

  const companyId = company?.id;
  const companyName = company?.companyName || `Company ${companyId || ""}`;

  const notify = (type, text) => {
    if (onMessage) onMessage(type, text);
  };

  const closeMenu = () => setMenuOpen(false);

  const openKebab = (event) => {
    event.stopPropagation();
    if (!companyId) return;
    if (menuOpen) {
      closeMenu();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 190;
    const spaceBelow = window.innerHeight - rect.bottom;
    const left = Math.max(4, rect.right - menuWidth);
    if (spaceBelow < 260) {
      setKebabPos({ bottom: window.innerHeight - rect.top + 4, top: undefined, left });
    } else {
      setKebabPos({ top: rect.bottom + 4, bottom: undefined, left });
    }
    setMenuOpen(true);
  };

  const openAnalytics = () => {
    closeMenu();
    navigate(buildCompanyAnalyticsPath(company), { state: { companyId } });
  };

  const openEditCompany = async () => {
    closeMenu();
    navigate(`/admin/company/${companyId}/edit`, {
      state: {
        company,
        returnTo: location.pathname,
      },
    });
  };

  const openPolicyEditor = async () => {
    closeMenu();
    if (!companyId) return;
    try {
      setPolicyTarget({ ...(company || {}), id: companyId, companyName });
      setPolicyError("");
      setPolicyLoading(true);
      const response = await fetchWithAuth(`${API}/api/admin/companies/${companyId}/dpp-policy`, {
        headers: { ...authHeaders() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load company DPP policy");
      setPolicyForm({
        defaultGranularity: data.defaultGranularity || "item",
        allowGranularityOverride: !!data.allowGranularityOverride,
        mintModelDids: !!data.mintModelDids,
        mintItemDids: !!data.mintItemDids,
        mintFacilityDids: !!data.mintFacilityDids,
        vcIssuanceEnabled: !!data.vcIssuanceEnabled,
        jsonldExportEnabled: !!data.jsonldExportEnabled,
        semanticDictionaryEnabled: !!data.semanticDictionaryEnabled,
      });
    } catch (error) {
      setPolicyError(error.message || "Failed to load company DPP policy");
    } finally {
      setPolicyLoading(false);
    }
  };

  const handlePolicyFieldChange = (field, value) => {
    setPolicyForm((prev) => ({ ...(prev || {}), [field]: value }));
    setPolicyError("");
  };

  const savePolicy = async (event) => {
    event.preventDefault();
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
      notify("success", `Updated DPP policy for ${policyTarget.companyName}`);
      setPolicyTarget(null);
      setPolicyForm(null);
      setPolicyError("");
      onCompanyUpdated?.(policyTarget);
    } catch (error) {
      setPolicyError(error.message || "Failed to save company DPP policy");
    } finally {
      setPolicySaving(false);
    }
  };

  const openDeleteCompany = () => {
    closeMenu();
    setDeleteTarget({ ...(company || {}), id: companyId, companyName });
    setDeletePassword("");
    setDeleteError("");
  };

  const renderInlineActionButton = (action) => {
    if (action === "edit") {
      return (
        <button
          key="edit"
          type="button"
          className="manage-btn admin-company-action-inline-btn admin-company-action-inline-btn-primary"
          onClick={openEditCompany}
        >
          Edit
        </button>
      );
    }

    if (action === "policy") {
      return (
        <button
          key="policy"
          type="button"
          className="manage-btn manage-btn-secondary admin-company-action-inline-btn"
          onClick={openPolicyEditor}
          disabled={policyLoading || policySaving}
        >
          DPP Policy
        </button>
      );
    }

    if (action === "delete") {
      return (
        <button
          key="delete"
          type="button"
          className="manage-btn manage-btn-danger admin-company-action-inline-btn admin-company-action-inline-btn-danger"
          onClick={openDeleteCompany}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting…" : "Delete Company"}
        </button>
      );
    }

    return null;
  };

  const confirmDeleteCompany = async (event) => {
    event.preventDefault();
    if (!deleteTarget) return;
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("Admin password is required.");
      return;
    }

    try {
      setIsDeleting(true);
      const response = await fetchWithAuth(`${API}/api/admin/companies/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to delete company");

      notify("success", `Deleted ${deleteTarget.companyName} and all related company data.`);
      setDeleteTarget(null);
      setDeletePassword("");
      setDeleteError("");
      onCompanyDeleted?.(deleteTarget, data);

      if (data.deletedCurrentSessionUser) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (error) {
      setDeleteError(error.message || "Failed to delete company");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!companyId) return null;

  return (
    <>
      {inlineActions.length > 0 && (
        <div className="admin-company-actions-inline">
          {inlineActions.map((action) => renderInlineActionButton(action))}
        </div>
      )}

      {!hideKebabTrigger && (
        <button
          type="button"
          className="kebab-menu-btn"
          onClick={openKebab}
          disabled={isDeleting}
          aria-label={`Company actions for ${companyName}`}
          title={`Company actions for ${companyName}`}
        >
          ⋮
        </button>
      )}

      {menuOpen && (
        <CompanyKebabMenu pos={kebabPos} onClose={closeMenu}>
          {includeAnalytics && (
            <button className="menu-item" onClick={openAnalytics}>
              📊 Analytics
            </button>
          )}
          <button className="menu-item" onClick={openEditCompany}>
            📝 Edit Company Info
          </button>
          <button className="menu-item" onClick={openPolicyEditor}>
            ⚙️ DPP Policy
          </button>
          {!hideDeleteMenuItem && (
            <button className="menu-item menu-item-danger" onClick={openDeleteCompany} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "🗑 Delete"}
            </button>
          )}
        </CompanyKebabMenu>
      )}

      {deleteTarget && (
        <div className="apt-modal-overlay" onClick={() => !isDeleting && setDeleteTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(event) => event.stopPropagation()}>
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
                onChange={(event) => {
                  setDeletePassword(event.target.value);
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
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button type="submit" className="apt-modal-delete-btn" disabled={isDeleting}>
                  {isDeleting ? "Deleting…" : "Delete Company"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {policyTarget && (
        <div className="apt-modal-overlay" onClick={() => !policySaving && setPolicyTarget(null)}>
          <div className="apt-modal companies-delete-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="apt-modal-title">DPP Policy</h3>
            <p className="apt-modal-warning apt-modal-warning-info">
              Configure DPP issuance behavior for <strong>{policyTarget.companyName}</strong>.
            </p>
            {policyLoading ? (
              <div className="loading">Loading policy…</div>
            ) : (
              <form onSubmit={savePolicy} className="company-form">
                {policyError && <div className="alert alert-error admin-alert-inline-wide">{policyError}</div>}
                <div className="form-group">
                  <label htmlFor={`defaultGranularity-${policyTarget.id}`}>Default Granularity</label>
                  <select
                    id={`defaultGranularity-${policyTarget.id}`}
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

    </>
  );
}

export default AdminCompanyActions;
