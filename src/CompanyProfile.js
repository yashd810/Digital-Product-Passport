import React, { useState, useEffect } from "react";
import IntroductionUpload from "./IntroductionUpload";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function CompanyProfile({ companyId, user }) {
  const resolvedCompanyId = companyId;
  const isAdmin = user?.role === "company_admin" || user?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [logoPreview, setLogoPreview] = useState(null);
  const [introText, setIntroText] = useState("");
  const [companyName, setCompanyName] = useState("");

  // API Keys state
  const [apiKeys,       setApiKeys]       = useState([]);
  const [loadingKeys,   setLoadingKeys]   = useState(false);
  const [keyName,       setKeyName]       = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revokingId,    setRevokingId]    = useState(null);
  const [newKey,        setNewKey]        = useState(null);  // { name, key } — shown once
  const [copied,        setCopied]        = useState(false);

  useEffect(() => {
    fetchCompanyProfile();
    if (isAdmin) fetchApiKeys();
  }, [resolvedCompanyId, isAdmin]);

  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
        headers: { Authorization: "Bearer cookie-session" },
      });
      if (r.ok) setApiKeys(await r.json());
    } catch {}
    finally { setLoadingKeys(false); }
  };

  const generateApiKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setGeneratingKey(true);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer cookie-session" },
        body: JSON.stringify({ name: keyName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to generate key");
      setNewKey({ name: d.name, key: d.key });
      setKeyName("");
      setCopied(false);
      fetchApiKeys();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
      setTimeout(() => setMessage({ type: "", text: "" }), 4000);
    } finally {
      setGeneratingKey(false);
    }
  };

  const revokeApiKey = async (keyId, keyName) => {
    if (!window.confirm(`Revoke "${keyName}"? Any integrations using it will immediately stop working.`)) return;
    setRevokingId(keyId);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys/${keyId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer cookie-session" },
      });
      if (r.ok) fetchApiKeys();
    } catch {}
    finally { setRevokingId(null); }
  };

  const fetchCompanyProfile = async () => {
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        headers: { Authorization: "Bearer cookie-session" },
      });
      if (r.ok) {
        const d = await r.json();
        setLogoPreview(d.company_logo || null);
        setIntroText(d.introduction_text || "");
        setCompanyName(d.company_name || "");
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true);
      setMessage({ type: "", text: "" });

      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer cookie-session" },
        body: JSON.stringify({ company_logo: logoPreview, introduction_text: introText }),
      });

      if (!r.ok) throw new Error("Failed");
      setMessage({ type: "success", text: "✅ Company profile updated!" });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } catch (error) {
      setMessage({ type: "error", text: "❌ Failed to save profile." });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return <div className="loading" style={{ padding: 40 }}>Loading company profile...</div>;
  }

  return (
    <div className="company-profile-wrapper">
      <div className="profile-header">
        <h2>🏢 Company Profile</h2>
        <p>Manage your company information and branding</p>
      </div>

      {message.text && <div className={`profile-message ${message.type}`}>{message.text}</div>}

      <div className="profile-content">
        <div className="profile-card">
          <h3>Company Information</h3>
          <div className="info-group">
            <label>Company Name</label>
            <input
              type="text"
              value={companyName}
              disabled
              className="info-input disabled"
            />
            <small style={{ color: "var(--text-secondary)", marginTop: 4 }}>Company name is managed by administrators</small>
          </div>
        </div>

        <div className="profile-card">
          <h3>Branding & Introduction</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
            Customize the logo and introduction text that will be displayed to consumers viewing your passports.
          </p>
          <IntroductionUpload
            logoPreview={logoPreview}
            introText={introText}
            onLogoChange={setLogoPreview}
            onTextChange={setIntroText}
          />
          <button className="profile-save-btn" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? "💾 Saving..." : "💾 Save Profile"}
          </button>
        </div>

        {isAdmin && (
          <div className="profile-card">
            <h3>API Keys</h3>
            <p style={{ color: "var(--charcoal)", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
              Private API keys allow programmatic read access to your company's passport data via
              the <code style={{ background: "var(--mint)", padding: "1px 6px", borderRadius: 4, fontSize: 13 }}>/api/v1/</code> endpoints.
              Send the key in every request using the <code style={{ background: "var(--mint)", padding: "1px 6px", borderRadius: 4, fontSize: 13 }}>X-API-Key</code> header.
              Keys are shown only once at creation — store them securely.
            </p>

            {/* One-time new key display */}
            {newKey && (
              <div style={{ background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#86efac", fontSize: 14 }}>
                  Key created: {newKey.name}
                </p>
                <p style={{ margin: "0 0 10px", color: "#86efac", fontSize: 13 }}>
                  This is the only time this key will be shown. Copy it now.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <code style={{ flex: 1, background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: 6, padding: "8px 12px", fontSize: 13, fontFamily: "monospace", wordBreak: "break-all", color: "var(--text-primary)" }}>
                    {newKey.key}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(newKey.key); setCopied(true); }}
                    style={{ padding: "8px 14px", background: copied ? "rgba(16, 185, 129, 0.25)" : "var(--accent)", color: "#ffffff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font)" }}>
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => { setNewKey(null); setCopied(false); }}
                  style={{ marginTop: 12, background: "none", border: "none", color: "#86efac", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "var(--font)", padding: 0 }}>
                  I've saved the key — dismiss
                </button>
              </div>
            )}

            {/* Generate form */}
            <form onSubmit={generateApiKey} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Key name (e.g. Production Integration)"
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                disabled={generatingKey}
                maxLength={100}
                style={{ flex: 1, minWidth: 200, padding: "9px 12px", border: "1px solid rgba(13, 181, 176, 0.24)", borderRadius: 8, fontSize: 14, fontFamily: "var(--font)", color: "var(--text-primary)", background: "rgba(20, 35, 55, 0.6)" }}
              />
              <button
                type="submit"
                disabled={generatingKey || !keyName.trim()}
                style={{ padding: "9px 18px", background: "linear-gradient(135deg, var(--jet) 0%, var(--onyx) 100%)", color: "var(--mint)", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)", opacity: generatingKey || !keyName.trim() ? 0.6 : 1 }}>
                {generatingKey ? "Generating…" : "+ Generate Key"}
              </button>
            </form>

            {/* Keys list */}
            {loadingKeys ? (
              <p style={{ color: "var(--charcoal)", fontSize: 14 }}>Loading keys…</p>
            ) : apiKeys.length === 0 ? (
              <p style={{ color: "var(--steel)", fontSize: 13 }}>No API keys yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {apiKeys.map(k => (
                  <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: k.is_active ? "rgba(13, 181, 176, 0.1)" : "rgba(255, 255, 255, 0.04)", borderRadius: 8, border: `1px solid ${k.is_active ? "rgba(13, 181, 176, 0.2)" : "rgba(13, 181, 176, 0.08)"}`, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{k.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, fontFamily: "monospace" }}>
                        {k.key_prefix}…
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
                      <div>Created {new Date(k.created_at).toLocaleDateString()}</div>
                      <div>{k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}</div>
                    </div>
                    {k.is_active && (
                      <button
                        onClick={() => revokeApiKey(k.id, k.name)}
                        disabled={revokingId === k.id}
                        style={{ padding: "6px 14px", background: "rgba(220, 38, 38, 0.15)", color: "#fca5a5", border: "1px solid rgba(220, 38, 38, 0.3)", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)" }}>
                        {revokingId === k.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                    {!k.is_active && (
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Revoked</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(240, 165, 0, 0.1)", border: "1px solid rgba(240, 165, 0, 0.2)", borderRadius: 8, fontSize: 12, color: "#f0a500", lineHeight: 1.6 }}>
              <strong>Endpoints available with an API key:</strong><br />
              <code style={{ background: "rgba(240, 165, 0, 0.15)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>GET /api/v1/passports?type=&lt;type&gt;&amp;status=released</code> — list passports<br />
              <code style={{ background: "rgba(240, 165, 0, 0.15)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>GET /api/v1/passports/:guid</code> — get a single passport
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CompanyProfile;
