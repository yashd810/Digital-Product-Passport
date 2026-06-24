import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import UserProfile from "../../user/profile/UserProfile";
import "../styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

function AdminSecurity({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const alertRef = useRef(null);

  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [approvingInviteId, setApprovingInviteId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [accessTarget, setAccessTarget] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const adminColumns = useMemo(() => ([
    { key: "email", type: "string", getValue: (admin) => admin.email || "" },
    { key: "name", type: "string", getValue: (admin) => [admin.firstName, admin.lastName].filter(Boolean).join(" ") || "" },
    { key: "status", type: "string", getValue: (admin) => admin.isActive ? "active" : "revoked" },
    { key: "lastLoginAt", type: "date", getValue: (admin) => admin.lastLoginAt || "" },
  ]), []);

  const filteredAdmins = useMemo(
    () => applyTableControls(admins, adminColumns, sortConfig, columnFilters),
    [admins, adminColumns, sortConfig, columnFilters]
  );
  const emailInviteAction = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const approveInvite = searchParams.get("approveInvite");
    const declineInvite = searchParams.get("declineInvite");
    if (approveInvite) return { type: "approve", inviteId: approveInvite };
    if (declineInvite) return { type: "decline", inviteId: declineInvite };
    return null;
  }, [location.search]);

  const flash = (type, text, duration = 4000) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: "", text: "" }), duration);
  };

  useEffect(() => {
    if (!msg.text || !alertRef.current) return;
    alertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [msg]);

  const loadSuperAdmins = async () => {
    try {
      setAdminsLoading(true);
      const response = await fetchWithAuth(`${api}/api/admin/super-admins`, {
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch super admins");
      setAdmins(Array.isArray(data) ? data : []);
    } catch (err) {
      flash("error", err.message || "Failed to fetch super admins");
    } finally {
      setAdminsLoading(false);
    }
  };

  useEffect(() => {
    loadSuperAdmins().finally(() => setLoading(false));
  }, []);

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      flash("error", "Enter the recipient email address.", 5000);
      return;
    }
    try {
      setInviting(true);
      const response = await fetchWithAuth(`${api}/api/admin/super-admins/invite`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to send invitation");
      flash("success", `${data.message || `Approval requested for ${inviteEmail.trim()}.`}`, 9000);
      setInviteEmail("");
    } catch (err) {
      flash("error", `${err.message || "Failed to send invitation"}`, 5000);
    } finally {
      setInviting(false);
    }
  };

  const handleApproveInvite = async (inviteId) => {
    try {
      setApprovingInviteId(inviteId);
      const response = await fetchWithAuth(`${api}/api/admin/super-admins/invite-requests/${inviteId}/approve`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to approve invitation");
      flash("success", data.message || "Invitation approved and sent.", 6000);
    } catch (err) {
      flash("error", err.message || "Failed to approve invitation", 6000);
    } finally {
      setApprovingInviteId(null);
    }
  };

  const handleDeclineInvite = async (inviteId) => {
    try {
      setApprovingInviteId(inviteId);
      const response = await fetchWithAuth(`${api}/api/admin/super-admins/invite-requests/${inviteId}/decline`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to decline invitation");
      flash("success", data.message || "Invitation request declined.", 6000);
    } catch (err) {
      flash("error", err.message || "Failed to decline invitation", 6000);
    } finally {
      setApprovingInviteId(null);
    }
  };

  const clearEmailInviteAction = () => {
    navigate("/admin/admin-management", { replace: true });
  };

  const confirmEmailInviteAction = async () => {
    if (!emailInviteAction?.inviteId) return;
    if (emailInviteAction.type === "approve") {
      await handleApproveInvite(emailInviteAction.inviteId);
    } else {
      await handleDeclineInvite(emailInviteAction.inviteId);
    }
    clearEmailInviteAction();
  };

  const handleToggleAccess = async (admin) => {
    setAccessTarget(admin);
  };

  const confirmToggleAccess = async () => {
    if (!accessTarget) return;
    const admin = accessTarget;
    const nextActive = !admin.isActive;

    try {
      setTogglingId(admin.id);
      const response = await fetchWithAuth(`${api}/api/admin/super-admins/${admin.id}/access`, {
        method: "PATCH",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ active: nextActive }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to update access");
      flash("success", `${nextActive ? "Restored" : "Revoked"} access for ${admin.email}`, 5000);
      setAccessTarget(null);
      await loadSuperAdmins();

      if (data.revokedCurrentSessionUser) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      flash("error", `${err.message || "Failed to update access"}`, 5000);
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) return <div className="sec-loading">Loading…</div>;

  return (
    <div className="sec-page">
      <h2 className="sec-title">Admin Management</h2>
      <p className="sec-sub">
        Manage super admin access and security options for your account: <strong>{user?.email}</strong>
      </p>

      {msg.text && (
        <div ref={alertRef} className={`sec-alert sec-alert-${msg.type}`}>{msg.text}</div>
      )}

      {emailInviteAction && (
        <div className="create-company-card admin-card-spaced">
          <h3>{emailInviteAction.type === "approve" ? "Approve Super Admin Invite" : "Decline Super Admin Invite"}</h3>
          <p className="admin-intro-copy">
            {emailInviteAction.type === "approve"
              ? "Confirm approval to send the super admin invitation email."
              : "Confirm decline to cancel this pending super admin invitation request."}
          </p>
          <div className="apt-modal-actions">
            <button
              type="button"
              className={`manage-btn ${emailInviteAction.type === "approve" ? "manage-btn-access" : "manage-btn-danger"}`}
              onClick={confirmEmailInviteAction}
              disabled={Boolean(approvingInviteId)}
            >
              {approvingInviteId
                ? (emailInviteAction.type === "approve" ? "Approving…" : "Declining…")
                : (emailInviteAction.type === "approve" ? "Approve & Send" : "Decline Request")}
            </button>
            <button type="button" className="cancel-btn" onClick={clearEmailInviteAction} disabled={Boolean(approvingInviteId)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sec-profile-stack">
        <UserProfile
          user={user}
          showHeader={false}
          showPersonalInfo={false}
          showWorkflowDefaults={false}
          showLanguageSelector={false}
        />
      </div>

      <div className="create-company-card admin-card-spaced">
        <h3>Invite Super Admin</h3>
        <p className="admin-intro-copy">
          Request a secure one-time registration link for platform-level super admin access.
          The invite is held in pending approval until one active super admin approves it, then the email is sent.
        </p>
        <form onSubmit={handleInvite} className="company-form">
          <div className="form-group">
            <label htmlFor="superAdminEmail">Recipient Email Address</label>
            <input
              id="superAdminEmail"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="admin@example.com"
              disabled={inviting}
              required
            />
          </div>
          <button type="submit" className="create-btn" disabled={inviting}>
            {inviting ? "Submitting…" : "✉️ Request Super Admin Invite"}
          </button>
        </form>
      </div>

      <div className="companies-list admin-card-spaced">
        <h3>Current Super Admins ({admins.length})</h3>
        {adminsLoading ? (
          <div className="loading">Loading super admins…</div>
        ) : (
          <>
            <div className="table-tools-row">
              <button
                type="button"
                className={`table-filter-toggle-btn${showFilters ? " active" : ""}`}
                onClick={() => setShowFilters((prev) => !prev)}
              >
                Filter
              </button>
            </div>
            <table className="companies-table">
              <thead>
                <tr>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("email")}>Email{sortIndicator(sortConfig, "email") && ` ${sortIndicator(sortConfig, "email")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("name")}>Name{sortIndicator(sortConfig, "name") && ` ${sortIndicator(sortConfig, "name")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("status")}>Status{sortIndicator(sortConfig, "status") && ` ${sortIndicator(sortConfig, "status")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("lastLoginAt")}>Last Login{sortIndicator(sortConfig, "lastLoginAt") && ` ${sortIndicator(sortConfig, "lastLoginAt")}`}</button></th>
                  <th>Actions</th>
                </tr>
                {showFilters && (
                  <tr className="table-filter-row">
                    <th><input className="table-filter-input" value={columnFilters.email || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, email: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.name || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, name: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.status || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.lastLoginAt || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, lastLoginAt: e.target.value }))} placeholder="Filter" /></th>
                    <th></th>
                  </tr>
                )}
              </thead>
              <tbody>
                {filteredAdmins.map((admin) => (
                  <tr key={admin.id}>
                    <td className="name-cell">{admin.email}</td>
                    <td className="date-cell">
                      {[admin.firstName, admin.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td>
                      <span className={`admin-role-pill ${admin.isActive ? "active" : "inactive"}`}>
                        {admin.isActive ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="date-cell">
                      {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="actions-cell">
                      <button
                        className={`manage-btn ${admin.isActive ? "manage-btn-danger" : ""}`}
                        onClick={() => handleToggleAccess(admin)}
                        disabled={togglingId === admin.id}
                      >
                        {togglingId === admin.id
                          ? "Updating…"
                          : admin.isActive
                            ? "🚫 Revoke Access"
                            : "✅ Restore Access"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {accessTarget && (
        <div className="apt-modal-overlay" onClick={() => togglingId ? null : setAccessTarget(null)}>
          <div className="apt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">
              {accessTarget.isActive ? "Revoke Super Admin Access" : "Restore Super Admin Access"}
            </h3>
            <p className="apt-modal-warning">
              {accessTarget.isActive ? (
                <>
                  ⚠️ Are you sure you want to revoke access for <strong>{accessTarget.email}</strong>?
                </>
              ) : (
                <>
                  ✅ Are you sure you want to restore access for <strong>{accessTarget.email}</strong>?
                </>
              )}
            </p>
            <div className="apt-modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setAccessTarget(null)}
                disabled={togglingId === accessTarget.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`manage-btn ${accessTarget.isActive ? "manage-btn-danger" : "manage-btn-access"}`}
                onClick={confirmToggleAccess}
                disabled={togglingId === accessTarget.id}
              >
                {togglingId === accessTarget.id
                  ? "Updating…"
                  : accessTarget.isActive
                    ? "Revoke Access"
                    : "Restore Access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminSecurity;
