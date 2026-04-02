import React, { useEffect, useState, useMemo } from "react";
import { applyTableControls, getNextSortDirection, sortIndicator } from "./tableControls";
import "./AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function AdminSuperAdmins({ token }) {
  const [admins, setAdmins] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [msg, setMsg] = useState({ type: "", text: "" });
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

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  const load = async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API}/api/admin/super-admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to fetch super admins");
      setAdmins(Array.isArray(data) ? data : []);
    } catch (e) {
      setMsg({ type: "error", text: e.message || "Failed to fetch super admins" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const showMsg = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: "", text: "" }), 5000);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      setInviting(true);
      const r = await fetch(`${API}/api/admin/super-admins/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to send invitation");
      setInviteEmail("");
      showMsg("success", `✅ Super admin invitation sent to ${inviteEmail.trim()}`);
    } catch (e) {
      showMsg("error", `❌ ${e.message || "Failed to send invitation"}`);
    } finally {
      setInviting(false);
    }
  };

  const handleToggleAccess = async (admin) => {
    const nextActive = !admin.is_active;
    const actionLabel = nextActive ? "restore access for" : "revoke access for";
    const confirmed = window.confirm(`Are you sure you want to ${actionLabel} ${admin.email}?`);
    if (!confirmed) return;

    try {
      setTogglingId(admin.id);
      const r = await fetch(`${API}/api/admin/super-admins/${admin.id}/access`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: nextActive }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to update access");
      showMsg("success", `${nextActive ? "✅ Restored" : "✅ Revoked"} access for ${admin.email}`);
      await load();

      if (data.revokedCurrentSessionUser) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (e) {
      showMsg("error", `❌ ${e.message || "Failed to update access"}`);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="companies-section">
      <h2>Super Admin Management</h2>

      {msg.text && (
        <div className={`alert alert-${msg.type === "success" ? "success" : "error"}`}>
          {msg.text}
        </div>
      )}

      <div className="create-company-card">
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
          <button type="submit" className="create-btn" disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Sending…" : "✉️ Send Super Admin Invite"}
          </button>
        </form>
      </div>

      <div className="companies-list">
        <h3>Current Super Admins ({admins.length})</h3>
        {loading ? (
          <div className="loading">Loading super admins…</div>
        ) : (
          <>
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
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("email")}>Email{sortIndicator(sortConfig, "email") && ` ${sortIndicator(sortConfig, "email")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("name")}>Name{sortIndicator(sortConfig, "name") && ` ${sortIndicator(sortConfig, "name")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("status")}>Status{sortIndicator(sortConfig, "status") && ` ${sortIndicator(sortConfig, "status")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("last_login_at")}>Last Login{sortIndicator(sortConfig, "last_login_at") && ` ${sortIndicator(sortConfig, "last_login_at")}`}</button></th>
                <th>Actions</th>
              </tr>
              {showFilters && <tr className="table-filter-row">
                <th><input className="table-filter-input" value={columnFilters.email || ""} onChange={e => setColumnFilters(prev => ({ ...prev, email: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, name: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.status || ""} onChange={e => setColumnFilters(prev => ({ ...prev, status: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.last_login_at || ""} onChange={e => setColumnFilters(prev => ({ ...prev, last_login_at: e.target.value }))} placeholder="Filter" /></th>
                <th></th>
              </tr>}
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
    </div>
  );
}

export default AdminSuperAdmins;
