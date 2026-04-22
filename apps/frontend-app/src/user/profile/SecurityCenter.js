import React, { useEffect, useState } from "react";
import { authHeaders } from "../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";

function SecurityCenter({ user, companyId }) {
  const resolvedCompanyId = companyId || user?.companyId || user?.company_id || "";
  const canManageCompanyKeys = user?.role === "company_admin" || user?.role === "super_admin";

  const [message, setMessage] = useState({ type: "", text: "" });

  const [bearerToken, setBearerToken] = useState("");
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [loadingBearerToken, setLoadingBearerToken] = useState(false);
  const [copyBearerFeedback, setCopyBearerFeedback] = useState("");

  const [apiKeys, setApiKeys] = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  useEffect(() => {
    if (!bearerToken) {
      fetchBearerToken();
    }
  }, []);

  useEffect(() => {
    if (canManageCompanyKeys && resolvedCompanyId) {
      fetchApiKeys();
    }
  }, [canManageCompanyKeys, resolvedCompanyId]);

  const flash = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(flash._timeout);
    flash._timeout = window.setTimeout(() => setMessage({ type: "", text: "" }), 4000);
  };

  const fetchBearerToken = async (forceRefresh = false) => {
    if (loadingBearerToken) return;
    if (bearerToken && !forceRefresh) return;
    setLoadingBearerToken(true);
    try {
      const r = await fetch(`${API}/api/users/me/token`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to load bearer token");
      if (!d.token) throw new Error("No bearer token returned");
      setBearerToken(d.token);
      if (forceRefresh) flash("success", "Bearer token refreshed.");
    } catch (err) {
      flash("error", err.message || "Failed to load bearer token");
    } finally {
      setLoadingBearerToken(false);
    }
  };

  const copyBearerToken = async () => {
    if (!bearerToken) {
      setCopyBearerFeedback("error");
      window.setTimeout(() => setCopyBearerFeedback(""), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(bearerToken);
      setCopyBearerFeedback("success");
      window.setTimeout(() => setCopyBearerFeedback(""), 3000);
    } catch {
      setCopyBearerFeedback("error");
      window.setTimeout(() => setCopyBearerFeedback(""), 3000);
    }
  };

  const fetchApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to fetch company API keys");
      setApiKeys(await r.json());
    } catch (err) {
      flash("error", err.message || "Failed to fetch company API keys");
    } finally {
      setLoadingKeys(false);
    }
  };

  const generateApiKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setGeneratingKey(true);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: keyName.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to generate key");
      setNewKey({ name: d.name, key: d.key });
      setKeyName("");
      setCopiedApiKey(false);
      await fetchApiKeys();
      flash("success", `Created company API key "${d.name}".`);
    } catch (err) {
      flash("error", err.message || "Failed to generate key");
    } finally {
      setGeneratingKey(false);
    }
  };

  const revokeApiKey = async (keyId, name) => {
    if (!window.confirm(`Revoke "${name}"? Any integrations using it will stop working immediately.`)) return;
    setRevokingId(keyId);
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/api-keys/${keyId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to revoke key");
      await fetchApiKeys();
      flash("success", `Revoked company API key "${name}".`);
    } catch (err) {
      flash("error", err.message || "Failed to revoke key");
    } finally {
      setRevokingId(null);
    }
  };

  const bearerExample = `curl -X GET ${API}/api/users/me \\
  -H "Authorization: Bearer YOUR_TOKEN_HERE"`;

  const companyApiExample = `curl -X GET ${API}/api/v1/passports?status=released \\
  -H "X-API-Key: YOUR_COMPANY_API_KEY_HERE"`;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h2 className="profile-title">Security</h2>
        <p className="profile-sub">Manage bearer tokens, company API keys, and integration access from one place.</p>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type === "success" ? "success" : "error"} dashboard-alert-spaced`}>
          {message.text}
        </div>
      )}

      <div className="profile-right">
        <div className="profile-card">
          <h4 className="card-section-title">🔑 Bearer Token</h4>
          <p className="profile-helper-text">
            Use this token for authenticated internal API calls in the <code>Authorization: Bearer &lt;token&gt;</code> header.
            It is separate from the company <code>X-API-Key</code> and should not be shared with external read-only consumers.
          </p>

          <div className="token-section">
            <div className="token-input-group">
              <input
                type={showBearerToken ? "text" : "password"}
                value={bearerToken}
                readOnly
                className="token-input"
                placeholder={loadingBearerToken ? "Loading token..." : "No bearer token available"}
              />
              <button
                type="button"
                onClick={() => setShowBearerToken(prev => !prev)}
                className="btn-token-toggle"
                title={showBearerToken ? "Hide token" : "Show token"}
                disabled={!bearerToken}
              >
                {showBearerToken ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                onClick={() => fetchBearerToken(true)}
                className="btn-token-toggle"
                disabled={loadingBearerToken}
                title="Refresh bearer token"
              >
                {loadingBearerToken ? "Loading..." : "Refresh"}
              </button>
            </div>

            <button
              type="button"
              onClick={copyBearerToken}
              className={`btn-copy-token ${copyBearerFeedback === "success" ? "btn-copy-success" : copyBearerFeedback === "error" ? "btn-copy-error" : ""}`}
            >
              {copyBearerFeedback === "success" ? "✓ Copied!" : copyBearerFeedback === "error" ? "Failed to copy" : "Copy Token"}
            </button>
          </div>

          <div className="token-usage-guide">
            <h5>Usage Example (cURL):</h5>
            <code className="code-block">{bearerExample}</code>
            <p className="profile-helper-text" style={{ marginTop: 14 }}>
              If the token field is empty, use <strong>Refresh</strong> to issue a fresh bearer token for this browser session.
            </p>
          </div>
        </div>

        <div className="profile-card">
          <h4 className="card-section-title">🏢 Company API Keys</h4>
          <p className="profile-helper-text">
            Company API keys are used only for the public read-only <code>/api/v1/passports</code> endpoints.
            Send them in the <code>X-API-Key</code> header. They are different from bearer tokens, device keys, and public passport access keys.
          </p>

          {!resolvedCompanyId && (
            <div className="alert alert-error dashboard-alert-spaced">No company is assigned to this account.</div>
          )}

          {resolvedCompanyId && !canManageCompanyKeys && (
            <div className="alert alert-error dashboard-alert-spaced">
              Company API key management is available to company admins. Your account can still use the bearer token above for authenticated internal APIs.
            </div>
          )}

          {resolvedCompanyId && canManageCompanyKeys && (
            <>
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
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(newKey.key); setCopiedApiKey(true); }}
                      style={{ padding: "8px 14px", background: copiedApiKey ? "rgba(16, 185, 129, 0.25)" : "var(--accent)", color: "#ffffff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font)" }}
                    >
                      {copiedApiKey ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setNewKey(null); setCopiedApiKey(false); }}
                    style={{ marginTop: 12, background: "none", border: "none", color: "#86efac", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "var(--font)", padding: 0 }}
                  >
                    I&apos;ve saved the key — dismiss
                  </button>
                </div>
              )}

              <form onSubmit={generateApiKey} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Key name (e.g. Production Integration)"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  disabled={generatingKey}
                  maxLength={100}
                  className="token-input"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button
                  type="submit"
                  disabled={generatingKey || !keyName.trim()}
                  className="btn-copy-token"
                >
                  {generatingKey ? "Generating..." : "+ Generate Key"}
                </button>
              </form>

              {loadingKeys ? (
                <p className="profile-helper-text">Loading company API keys...</p>
              ) : apiKeys.length === 0 ? (
                <p className="profile-helper-text">No company API keys yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {apiKeys.map((key) => (
                    <div
                      key={key.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        background: key.is_active ? "rgba(13, 181, 176, 0.1)" : "rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        border: `1px solid ${key.is_active ? "rgba(13, 181, 176, 0.2)" : "rgba(13, 181, 176, 0.08)"}`,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{key.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, fontFamily: "monospace" }}>
                          {key.key_prefix}...
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
                        <div>Created {new Date(key.created_at).toLocaleDateString()}</div>
                        <div>{key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}` : "Never used"}</div>
                      </div>
                      {key.is_active ? (
                        <button
                          type="button"
                          onClick={() => revokeApiKey(key.id, key.name)}
                          disabled={revokingId === key.id}
                          style={{ padding: "6px 14px", background: "rgba(220, 38, 38, 0.15)", color: "#fca5a5", border: "1px solid rgba(220, 38, 38, 0.3)", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)" }}
                        >
                          {revokingId === key.id ? "Revoking..." : "Revoke"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Revoked</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="token-usage-guide">
                <h5>Usage Example (cURL):</h5>
                <code className="code-block">{companyApiExample}</code>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SecurityCenter;
