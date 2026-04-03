import React, { useState, useEffect, useMemo, useRef } from "react";
import { applyTableControls, getNextSortDirection, sortIndicator } from "./tableControls";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const ROLES = [
  { key: "company_admin", label: "Admin",  desc: "Full access — manage team, all passports",    badge: "role-admin"  },
  { key: "editor",        label: "Editor", desc: "Create, edit, release passports; invite viewers", badge: "role-editor" },
  { key: "viewer",        label: "Viewer", desc: "Read-only access to all passports",            badge: "role-viewer" },
];

function RoleBadge({ role }) {
  const info = ROLES.find(r => r.key === role) || { label: role, badge: "role-viewer" };
  return <span className={`team-badge ${info.badge}`}>{info.label}</span>;
}

function ManageTeam({ user, companyId }) {
  const [members,      setMembers]      = useState([]);
  const [pending,      setPending]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [inviteEmail,  setInviteEmail]  = useState("");
  const [inviteRole,   setInviteRole]   = useState("editor");
  const [inviteLoading,setInviteLoading]= useState(false);
  const [editingId,    setEditingId]    = useState(null);
  const [editRole,     setEditRole]     = useState("");
  const [msg,          setMsg]          = useState({ type:"", text:"" });
  const [sortConfig,   setSortConfig]   = useState({ key: "created_at", direction: "desc" });
  const [columnFilters,setColumnFilters]= useState({});
  const [showFilters,  setShowFilters]  = useState(false);
  const alertRef = useRef(null);

  const isAdmin = user?.role === "company_admin" || user?.role === "super_admin";

  const teamColumns = useMemo(() => ([
    { key: "member", type: "string", getValue: (m) => `${m.first_name || ""} ${m.last_name || ""} ${m.email || ""}`.trim() },
    { key: "role", type: "string", getValue: (m) => m.role || "" },
    { key: "passport_count", type: "number", getValue: (m) => m.passport_count || 0 },
    { key: "created_at", type: "date", getValue: (m) => m.created_at },
  ]), []);

  const filteredMembers = useMemo(
    () => applyTableControls(members, teamColumns, sortConfig, columnFilters),
    [members, teamColumns, sortConfig, columnFilters]
  );

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  useEffect(() => { fetchMembers(); }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/users`, {
        headers: { Authorization: "Bearer cookie-session" },
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setMembers(data.filter(u => u.is_active !== false));
      setPending(data.filter(u => u.is_pending));
    } catch { }
    finally { setLoading(false); }
  };

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type:"", text:"" }), 4000);
  };

  useEffect(() => {
    if (!msg.text || !alertRef.current) return;
    alertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [msg]);

  // Invite
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      flash("error", "Enter the team member email address.");
      return;
    }
    // Viewers can only invite other viewers (role already set above)
    const roleToSend = isAdmin ? inviteRole : "viewer";
    setInviteLoading(true);
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer cookie-session" },
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim(), roleToAssign: roleToSend }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      flash("success", `Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (err) {
      flash("error", err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  // Change role
  const handleRoleChange = async (userId) => {
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer cookie-session" },
        body: JSON.stringify({ role: editRole }),
      });
      if (!r.ok) throw new Error();
      flash("success", "Role updated");
      setEditingId(null);
      fetchMembers();
    } catch {
      flash("error", "Failed to update role");
    }
  };

  // Deactivate
  const handleDeactivate = async (userId, name) => {
    if (!window.confirm(`Deactivate ${name}? They will no longer be able to log in.`)) return;
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/users/${userId}/deactivate`, {
        method: "PATCH",
        headers: { Authorization: "Bearer cookie-session" },
      });
      if (!r.ok) throw new Error();
      flash("success", "User deactivated");
      fetchMembers();
    } catch {
      flash("error", "Failed to deactivate user");
    }
  };

  return (
    <div className="team-page">
      <div className="team-header">
        <h2>👥 Manage Team</h2>
        <p>{members.length} member{members.length !== 1 ? "s" : ""} in your organisation</p>
      </div>

      {msg.text && (
        <div ref={alertRef} className={`alert alert-${msg.type === "success" ? "success" : "error"}`}>
          {msg.text}
        </div>
      )}

      {/* Role legend */}
      <div className="role-legend">
        {ROLES.map(r => (
          <div key={r.key} className="legend-item">
            <span className={`team-badge ${r.badge}`}>{r.label}</span>
            <span className="legend-desc">{r.desc}</span>
          </div>
        ))}
      </div>

      {/* Invite card */}
      <div className="team-card invite-card-team">
        <h4>✉️ Invite a team member</h4>
        {!isAdmin && (
          <p className="invite-note">
            As an editor, you can invite <strong>viewers</strong> to your team.
          </p>
        )}
        <form onSubmit={handleInvite} className="invite-row">
          <input
            type="email" placeholder="colleague@company.com"
            value={inviteEmail} disabled={inviteLoading}
            onChange={e => setInviteEmail(e.target.value)}
            className="invite-email-input" required
          />
          {isAdmin && (
            <select value={inviteRole} disabled={inviteLoading}
              onChange={e => setInviteRole(e.target.value)}
              className="invite-role-select">
              {ROLES.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          )}
          <button type="submit" className="invite-send-btn"
            disabled={inviteLoading}>
            {inviteLoading ? "Sending…" : "Send Invite"}
          </button>
        </form>
      </div>

      {/* Members table */}
      <div className="team-card">
        <h4>Team Members</h4>
        {loading ? (
          <div className="loading">Loading…</div>
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
          <table className="team-table">
            <thead>
              <tr>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("member")}>Member{sortIndicator(sortConfig, "member") && ` ${sortIndicator(sortConfig, "member")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("role")}>Role{sortIndicator(sortConfig, "role") && ` ${sortIndicator(sortConfig, "role")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("passport_count")}>Passports{sortIndicator(sortConfig, "passport_count") && ` ${sortIndicator(sortConfig, "passport_count")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("created_at")}>Joined{sortIndicator(sortConfig, "created_at") && ` ${sortIndicator(sortConfig, "created_at")}`}</button></th>
                {isAdmin && <th>Actions</th>}
              </tr>
              {showFilters && <tr className="table-filter-row">
                <th><input className="table-filter-input" value={columnFilters.member || ""} onChange={e => setColumnFilters(prev => ({ ...prev, member: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.role || ""} onChange={e => setColumnFilters(prev => ({ ...prev, role: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.passport_count || ""} onChange={e => setColumnFilters(prev => ({ ...prev, passport_count: e.target.value }))} placeholder="Filter" /></th>
                <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={e => setColumnFilters(prev => ({ ...prev, created_at: e.target.value }))} placeholder="Filter" /></th>
                {isAdmin && <th></th>}
              </tr>}
            </thead>
            <tbody>
              {filteredMembers.map(m => {
                const isSelf = m.id === user?.id;
                const isSuperAdmin = m.role === "super_admin";
                return (
                  <tr key={m.id} className={isSelf ? "self-row" : ""}>
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">
                          {m.avatar_url
                            ? <img src={m.avatar_url} alt="" />
                            : <span>{(m.first_name?.[0] || "?").toUpperCase()}</span>
                          }
                        </div>
                        <div>
                          <div className="member-name">
                            {m.first_name} {m.last_name}
                            {isSelf && <span className="you-tag">You</span>}
                          </div>
                          <div className="member-email">{m.email}</div>
                          {m.job_title && <div className="member-title">{m.job_title}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {isAdmin && editingId === m.id && !isSelf && !isSuperAdmin ? (
                        <div className="role-edit">
                          <select value={editRole} onChange={e => setEditRole(e.target.value)}
                            className="role-select-inline">
                            {ROLES.map(r => (
                              <option key={r.key} value={r.key}>{r.label}</option>
                            ))}
                          </select>
                          <button className="btn-save-role" onClick={() => handleRoleChange(m.id)}>✓</button>
                          <button className="btn-cancel-role" onClick={() => setEditingId(null)}>✕</button>
                        </div>
                      ) : (
                        <div className="team-role-actions">
                          <RoleBadge role={m.role} />
                          {isAdmin && !isSelf && !isSuperAdmin && (
                            <button className="btn-edit-role"
                              onClick={() => { setEditingId(m.id); setEditRole(m.role); }}
                              title="Change role">✏️</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{m.passport_count || 0}</td>
                    <td>{new Date(m.created_at).toLocaleDateString()}</td>
                    {isAdmin && (
                      <td>
                        {!isSelf && !isSuperAdmin && (
                          <button className="btn-deactivate"
                            onClick={() => handleDeactivate(m.id, `${m.first_name} ${m.last_name}`)}>
                            Deactivate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </>
        )}
      </div>
    </div>
  );
}

export default ManageTeam;
