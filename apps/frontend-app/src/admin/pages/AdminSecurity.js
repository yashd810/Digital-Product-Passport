import React, { useState, useEffect, useMemo, useRef } from "react";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function AdminSecurity({ user }) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const alertRef = useRef(null);

  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [accessTarget, setAccessTarget] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const adminColumns = useMemo(() => ([
    { key: "email", type: "string", getValue: (admin) => admin.email || "" },
    { key: "name", type: "string", getValue: (admin) => [admin.first_name, admin.last_name].filter(Boolean).join(" ") || "" },
    { key: "status", type: "string", getValue: (admin) => admin.is_active ? "active" : "revoked" },
    { key: "last_login_at", type: "date", getValue: (admin) => admin.last_login_at || "" },
  ]), []);

  const filteredAdmins = useMemo(
    () => applyTableControls(admins, adminColumns, sortConfig, columnFilters),
    [admins, adminColumns, sortConfig, columnFilters]
  );

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
      const response = await fetchWithAuth(`${API}/api/admin/super-admins`, {
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
      const response = await fetchWithAuth(`${API}/api/admin/super-admins/invite`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to send invitation");
      if (data.emailSent === false) {
        const manualLinkCopy = data.registerUrl ? ` Manual link: ${data.registerUrl}` : "";
        flash("success", `${data.message || `Super admin invite created for ${inviteEmail.trim()}.`}${manualLinkCopy}`, 9000);
      } else {
        flash("success", `${data.message || `Super admin invitation sent to ${inviteEmail.trim()}`}`, 5000);
      }
      setInviteEmail("");
    } catch (err) {
      flash("error", `${err.message || "Failed to send invitation"}`, 5000);
    } finally {
      setInviting(false);
    }
  };

  const handleToggleAccess = async (admin) => {
    setAccessTarget(admin);
  };

  const confirmToggleAccess = async () => {
    if (!accessTarget) return;
    const admin = accessTarget;
    const nextActive = !admin.is_active;

    try {
      setTogglingId(admin.id);
      const response = await fetchWithAuth(`${API}/api/admin/super-admins/${admin.id}/access`, {
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

      <div className="create-company-card admin-card-spaced">
        <h3>Invite Super Admin</h3>
        <p className="admin-intro-copy">
          Send a secure one-time registration link for platform-level super admin access.
          This invite is not tied to any company and expires in <strong>48 hours</strong>.
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
            {inviting ? "Sending…" : "✉️ Send Super Admin Invite"}
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
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("last_login_at")}>Last Login{sortIndicator(sortConfig, "last_login_at") && ` ${sortIndicator(sortConfig, "last_login_at")}`}</button></th>
                  <th>Actions</th>
                </tr>
                {showFilters && (
                  <tr className="table-filter-row">
                    <th><input className="table-filter-input" value={columnFilters.email || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, email: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.name || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, name: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.status || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.last_login_at || ""} onChange={(e) => setColumnFilters((prev) => ({ ...prev, last_login_at: e.target.value }))} placeholder="Filter" /></th>
                    <th></th>
                  </tr>
                )}
              </thead>
              <tbody>
                {filteredAdmins.map((admin) => (
                  <tr key={admin.id}>
                    <td className="name-cell">{admin.email}</td>
                    <td className="date-cell">
                      {[admin.first_name, admin.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td>
                      <span className={`admin-role-pill ${admin.is_active ? "active" : "inactive"}`}>
                        {admin.is_active ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="date-cell">
                      {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : "Never"}
                    </td>
                    <td className="actions-cell">
                      <button
                        className={`manage-btn ${admin.is_active ? "manage-btn-danger" : ""}`}
                        onClick={() => handleToggleAccess(admin)}
                        disabled={togglingId === admin.id}
                      >
                        {togglingId === admin.id
                          ? "Updating…"
                          : admin.is_active
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
              {accessTarget.is_active ? "Revoke Super Admin Access" : "Restore Super Admin Access"}
            </h3>
            <p className="apt-modal-warning">
              {accessTarget.is_active ? (
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
                className={`manage-btn ${accessTarget.is_active ? "manage-btn-danger" : "manage-btn-access"}`}
                onClick={confirmToggleAccess}
                disabled={togglingId === accessTarget.id}
              >
                {togglingId === accessTarget.id
                  ? "Updating…"
                  : accessTarget.is_active
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
