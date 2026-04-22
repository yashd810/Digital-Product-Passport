import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authHeaders } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function AdminInvite() {
  const location = useLocation();
  const navigate = useNavigate();

  const [companies,       setCompanies]       = useState([]);
  const [inviteEmail,     setInviteEmail]     = useState("");
  const [inviteCompanyId, setInviteCompanyId] = useState("");
  const [inviteLoading,   setInviteLoading]   = useState(false);
  const [inviteMsg,       setInviteMsg]       = useState({ type: "", text: "" });
  const [loadingCompanies,setLoadingCompanies]= useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/admin/companies`,
          { headers: authHeaders() });
        const data = await r.json();
        setCompanies(data);

        // Pre-select company if navigated from companies page via state
        const preselected = location.state?.preselectedCompanyId;
        if (preselected) {
          setInviteCompanyId(preselected);
        } else if (data.length > 0) {
          setInviteCompanyId(String(data[0].id));
        }
      } catch {}
      finally { setLoadingCompanies(false); }
    })();
  }, [location.state]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteCompanyId) return;
    setInviteLoading(true);
    setInviteMsg({ type: "", text: "" });
    try {
      const r = await fetch(`${API}/api/companies/${inviteCompanyId}/invite`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim() }),
      });
      const data = await r.json();
      if (r.ok) {
        setInviteMsg({ type: "success", text: `Invitation sent to ${inviteEmail}` });
        setInviteEmail("");
      } else {
        setInviteMsg({ type: "error", text: `${data.error || "Failed to send invitation"}` });
      }
    } catch {
      setInviteMsg({ type: "error", text: "Network error. Please try again." });
    } finally {
      setInviteLoading(false);
      setTimeout(() => setInviteMsg({ type: "", text: "" }), 5000);
    }
  };

  return (
    <div className="companies-section">
      <div className="aca-header">
        <button className="back-link" onClick={() => navigate("/admin/companies")}>
          ← Back to Companies
        </button>
        <h2>Invite a User</h2>
      </div>

      <div className="create-company-card">
        <h3>Send Invitation Email</h3>
        <p className="admin-intro-copy">
          The invited user will receive a secure one-time link by email. The link expires in
          {" "}<strong>48 hours</strong> and can only be used once. They will be automatically
          registered under the selected company — no company code required.
        </p>

        {loadingCompanies ? (
          <div className="loading">Loading companies…</div>
        ) : (
          <form onSubmit={handleInvite} className="company-form">

            {/* Company selector */}
            <div className="form-group">
              <label htmlFor="inviteCompany">Select Company</label>
              <select
                id="inviteCompany"
                value={inviteCompanyId}
                onChange={e => setInviteCompanyId(e.target.value)}
                disabled={inviteLoading}
                required
                className="admin-select-input"
              >
                <option value="">— Select a company —</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>

            {/* Email */}
            <div className="form-group">
              <label htmlFor="inviteEmail">Recipient Email Address</label>
              <input
                id="inviteEmail" type="email" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                required disabled={inviteLoading}
              />
            </div>

            <button type="submit" className="create-btn"
              disabled={inviteLoading || !inviteEmail.trim() || !inviteCompanyId}>
              {inviteLoading ? "Sending…" : "✉️ Send Invitation"}
            </button>
          </form>
        )}

        {inviteMsg.text && (
          <div className={`alert alert-${inviteMsg.type === "success" ? "success" : "error"} admin-alert-top`}>
            {inviteMsg.text}
          </div>
        )}

        {/* How it works */}
        <div className="admin-info-panel">
          <p className="admin-info-panel-title">
            How it works:
          </p>
          <ol className="admin-info-list">
            <li>The recipient receives an email with a secure one-time registration link.</li>
            <li>They click the link — their email and company are pre-filled and locked.</li>
            <li>They only need to enter their name and choose a password.</li>
            <li>The link expires after 48 hours and cannot be reused.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default AdminInvite;
