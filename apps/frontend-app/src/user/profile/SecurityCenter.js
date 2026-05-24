import React, { useEffect, useState } from "react";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";
const OPERATOR_TYPE_OPTIONS = [
  { value: "economic_operator", label: "Economic Operator" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "authorized_representative", label: "Authorized Representative" },
  { value: "importer", label: "Importer" },
  { value: "distributor", label: "Distributor" },
  { value: "dealer", label: "Dealer" },
  { value: "delegated_operator", label: "Delegated Operator" },
  { value: "professional_repairer", label: "Professional Repairer" },
  { value: "independent_operator", label: "Independent Operator" },
  { value: "recycler", label: "Recycler" },
  { value: "market_surveillance", label: "Market Surveillance" },
  { value: "customs_authority", label: "Customs Authority" },
  { value: "eu_commission", label: "EU Commission" },
  { value: "main_dpp_service_provider", label: "Main DPP Service Provider" },
  { value: "backup_dpp_service_provider", label: "Backup DPP Service Provider" },
  { value: "public", label: "Public" },
];
const ACCESS_MODE_OPTIONS = [
  { value: "read", label: "Read only" },
  { value: "update", label: "Read and update" },
];
const CONFIDENTIALITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "restricted", label: "Restricted" },
  { value: "confidential", label: "Confidential" },
  { value: "trade_secret", label: "Trade secret" },
  { value: "regulated", label: "Regulated" },
];

function humanizeOption(value, options) {
  return options.find((option) => option.value === value)?.label || value || "Not set";
}

function SecurityCenter({ user, companyId }) {
  const resolvedCompanyId = companyId || user?.companyId || "";
  const canManageCompanyKeys = user?.role === "company_admin" || user?.role === "super_admin";

  const [message, setMessage] = useState({ type: "", text: "" });

  const [bearerToken, setBearerToken] = useState("");
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [loadingBearerToken, setLoadingBearerToken] = useState(false);
  const [copyBearerFeedback, setCopyBearerFeedback] = useState("");

  const [apiKeys, setApiKeys] = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [operatorType, setOperatorType] = useState("economic_operator");
  const [accessMode, setAccessMode] = useState("read");
  const [maxConfidentiality, setMaxConfidentiality] = useState("regulated");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

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
      const r = await fetchWithAuth(`${API}/api/users/me/token`, {
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
      const r = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
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
      const r = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/api-keys`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: keyName.trim(),
          operatorType,
          accessMode,
          maxConfidentiality,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to generate key");
      setNewKey({
        name: d.name,
        key: d.key,
        operatorType: d.operatorType,
        accessMode: d.accessMode,
        maxConfidentiality: d.maxConfidentiality,
      });
      setKeyName("");
      setOperatorType("economic_operator");
      setAccessMode("read");
      setMaxConfidentiality("regulated");
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
      const r = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/api-keys/${keyId}`, {
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
          <p className="profile-helper-text">
            Bearer tokens are optional. They are only generated when you explicitly request one below.
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
                title={bearerToken ? "Refresh bearer token" : "Generate bearer token"}
              >
                {loadingBearerToken ? "Loading..." : bearerToken ? "Refresh" : "Generate"}
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
              If the token field is empty, use <strong>Generate</strong> to issue a bearer token for this browser session.
            </p>
          </div>
        </div>

        <div className="profile-card">
          <h4 className="card-section-title">🏢 Company API Keys</h4>
          <p className="profile-helper-text">
            Company API keys are used for external operator integrations on <code>/api/v1/passports</code>.
            Send them in the <code>X-API-Key</code> header. Each key can represent one operator, be read-only or update-enabled, and be capped to a maximum confidentiality level.
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
                <div className="security-key-reveal">
                  <p className="security-key-reveal-title">
                    Key created: {newKey.name}
                  </p>
                  <p className="security-key-reveal-copy">
                    This is the only time this key will be shown. Copy it now.
                  </p>
                  <p className="security-key-reveal-meta">
                    {humanizeOption(newKey.operatorType, OPERATOR_TYPE_OPTIONS)} · {humanizeOption(newKey.accessMode, ACCESS_MODE_OPTIONS)} · Up to {humanizeOption(newKey.maxConfidentiality, CONFIDENTIALITY_OPTIONS)}
                  </p>
                  <div className="security-key-reveal-actions">
                    <code className="security-key-reveal-code">
                      {newKey.key}
                    </code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(newKey.key); setCopiedApiKey(true); }}
                      className={`security-key-reveal-copy-btn${copiedApiKey ? " copied" : ""}`}
                    >
                      {copiedApiKey ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setNewKey(null); setCopiedApiKey(false); }}
                    className="security-key-reveal-dismiss"
                  >
                    I&apos;ve saved the key — dismiss
                  </button>
                </div>
              )}

              <form onSubmit={generateApiKey} style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                <input
                  type="text"
                  placeholder="Key name (e.g. Recycler ABC Production)"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  disabled={generatingKey}
                  maxLength={100}
                  className="token-input"
                  style={{ minWidth: 220 }}
                />
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="profile-helper-text" style={{ margin: 0 }}>Operator type</span>
                    <select
                      value={operatorType}
                      onChange={(e) => setOperatorType(e.target.value)}
                      disabled={generatingKey}
                      className="token-input"
                    >
                      {OPERATOR_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="profile-helper-text" style={{ margin: 0 }}>Access mode</span>
                    <select
                      value={accessMode}
                      onChange={(e) => setAccessMode(e.target.value)}
                      disabled={generatingKey}
                      className="token-input"
                    >
                      {ACCESS_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="profile-helper-text" style={{ margin: 0 }}>Max confidentiality</span>
                    <select
                      value={maxConfidentiality}
                      onChange={(e) => setMaxConfidentiality(e.target.value)}
                      disabled={generatingKey}
                      className="token-input"
                    >
                      {CONFIDENTIALITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={generatingKey || !keyName.trim()}
                  className="btn-copy-token"
                  style={{ justifySelf: "start" }}
                >
                  {generatingKey ? "Generating..." : "+ Generate Operator Key"}
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
                        background: key.isActive ? "rgba(13, 181, 176, 0.1)" : "rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        border: `1px solid ${key.isActive ? "rgba(13, 181, 176, 0.2)" : "rgba(13, 181, 176, 0.08)"}`,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{key.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, fontFamily: "monospace" }}>
                          {key.keyPrefix}...
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                          {humanizeOption(key.operatorType, OPERATOR_TYPE_OPTIONS)} · {humanizeOption(key.accessMode, ACCESS_MODE_OPTIONS)} · Up to {humanizeOption(key.maxConfidentiality, CONFIDENTIALITY_OPTIONS)}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
                        <div>Created {new Date(key.createdAt).toLocaleDateString()}</div>
                        <div>{key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "Never used"}</div>
                      </div>
                      {key.isActive ? (
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
