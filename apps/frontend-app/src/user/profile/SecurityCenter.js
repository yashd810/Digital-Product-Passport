import React, { useEffect, useMemo, useRef, useState } from "react";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";

const api = import.meta.env.VITE_API_URL || "";

function formatDate(value) {
  if (!value) return "Not used";
  return new Date(value).toLocaleDateString();
}

function normalizeList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
}

function flattenRestrictedFields(typeDef) {
  return (typeDef?.fieldsJson?.sections || [])
    .flatMap((section) => (section.fields || []).map((field) => ({
      ...field,
      sectionKey: section.key || null,
      sectionLabel: section.label || section.key || "Fields",
    })))
    .filter((field) => field?.key && String(field.confidentiality || "public").toLowerCase() === "restricted");
}

function SecurityCenter({ user, companyId }) {
  const resolvedCompanyId = companyId || user?.companyId || "";
  const canManageCompanyKeys = user?.role === "companyAdmin" || user?.role === "superAdmin";

  const [message, setMessage] = useState({ type: "", text: "" });
  const flashTimeoutRef = useRef(null);

  const [bearerToken, setBearerToken] = useState("");
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [loadingBearerToken, setLoadingBearerToken] = useState(false);
  const [copyBearerFeedback, setCopyBearerFeedback] = useState("");

  const [passportTypes, setPassportTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [securityGroups, setSecurityGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedPassportType, setSelectedPassportType] = useState("");
  const [scopeType, setScopeType] = useState("passportType");
  const [selectedFieldKeys, setSelectedFieldKeys] = useState([]);
  const [passports, setPassports] = useState([]);
  const [selectedPassportDppIds, setSelectedPassportDppIds] = useState([]);
  const [loadingPassports, setLoadingPassports] = useState(false);
  const [generatingGroup, setGeneratingGroup] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const categories = useMemo(() => {
    return [...new Set(passportTypes.map((type) => type.productCategory || "Uncategorized"))].sort();
  }, [passportTypes]);

  const passportTypesForCategory = useMemo(() => {
    if (!selectedCategory) return [];
    return passportTypes.filter((type) => (type.productCategory || "Uncategorized") === selectedCategory);
  }, [passportTypes, selectedCategory]);

  const selectedTypeDef = useMemo(() => {
    return passportTypes.find((type) => type.typeName === selectedPassportType) || null;
  }, [passportTypes, selectedPassportType]);

  const restrictedFields = useMemo(() => flattenRestrictedFields(selectedTypeDef), [selectedTypeDef]);

  useEffect(() => {
    if (!canManageCompanyKeys || !resolvedCompanyId) return;
    fetchPassportTypes();
    fetchSecurityGroups();
  }, [canManageCompanyKeys, resolvedCompanyId]);

  useEffect(() => () => {
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
  }, []);

  useEffect(() => {
    setSelectedFieldKeys([]);
    setSelectedPassportDppIds([]);
    setPassports([]);
    if (!selectedPassportType || scopeType !== "passports" || !resolvedCompanyId) return;
    fetchPassportsForType(selectedPassportType);
  }, [selectedPassportType, scopeType, resolvedCompanyId]);

  const flash = (type, text) => {
    setMessage({ type, text });
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setMessage({ type: "", text: "" }), 4000);
  };

  const fetchBearerToken = async (forceRefresh = false) => {
    if (loadingBearerToken) return;
    if (bearerToken && !forceRefresh) return;
    setLoadingBearerToken(true);
    try {
      const r = await fetchWithAuth(`${api}/api/users/me/token`, {
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

  const fetchPassportTypes = async () => {
    setLoadingTypes(true);
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/passport-types`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to fetch passport types");
      const data = await r.json();
      setPassportTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      flash("error", err.message || "Failed to fetch passport types");
    } finally {
      setLoadingTypes(false);
    }
  };

  const fetchSecurityGroups = async () => {
    setLoadingGroups(true);
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/api-keys`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to fetch security groups");
      const data = await r.json();
      setSecurityGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      flash("error", err.message || "Failed to fetch security groups");
    } finally {
      setLoadingGroups(false);
    }
  };

  const fetchPassportsForType = async (passportType) => {
    setLoadingPassports(true);
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/api-keys/passport-type/${encodeURIComponent(passportType)}/passports`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to fetch passports for this type");
      const data = await r.json();
      setPassports(Array.isArray(data) ? data : []);
    } catch (err) {
      flash("error", err.message || "Failed to fetch passports for this type");
    } finally {
      setLoadingPassports(false);
    }
  };

  const toggleSelectedValue = (value, selected, setter) => {
    setter(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]
    );
  };

  const resetGroupForm = () => {
    setGroupName("");
    setSelectedCategory("");
    setSelectedPassportType("");
    setScopeType("passportType");
    setSelectedFieldKeys([]);
    setSelectedPassportDppIds([]);
    setPassports([]);
  };

  const copyNewApiKey = async () => {
    if (!newKey?.key) return;
    try {
      await navigator.clipboard.writeText(newKey.key);
      setCopiedApiKey(true);
    } catch {
      setCopiedApiKey(false);
      flash("error", "Failed to copy the API key. Select the key text and copy it manually.");
    }
  };

  const generateSecurityGroup = async (event) => {
    event.preventDefault();
    if (!groupName.trim() || !selectedPassportType || selectedFieldKeys.length === 0) return;
    if (scopeType === "passports" && selectedPassportDppIds.length === 0) return;
    setGeneratingGroup(true);
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/api-keys`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: groupName.trim(),
          passportType: selectedPassportType,
          scopeType,
          fieldKeys: selectedFieldKeys,
          passportDppIds: scopeType === "passports" ? selectedPassportDppIds : [],
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to create security group");
      setNewKey({
        name: d.name,
        key: d.key,
        passportType: d.passportType,
        scopeType: d.scopeType,
        fieldKeys: normalizeList(d.fieldKeys),
        passportDppIds: normalizeList(d.passportDppIds),
      });
      setCopiedApiKey(false);
      resetGroupForm();
      await fetchSecurityGroups();
      flash("success", `Created security group "${d.name}".`);
    } catch (err) {
      flash("error", err.message || "Failed to create security group");
    } finally {
      setGeneratingGroup(false);
    }
  };

  const revokeSecurityGroup = async (keyId, name) => {
    if (!window.confirm(`Revoke "${name}"? Anyone using this API key will lose restricted-field access immediately.`)) return;
    setRevokingId(keyId);
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/api-keys/${keyId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to revoke security group");
      await fetchSecurityGroups();
      flash("success", `Revoked security group "${name}".`);
    } catch (err) {
      flash("error", err.message || "Failed to revoke security group");
    } finally {
      setRevokingId(null);
    }
  };

  const selectedTypeLabel = selectedTypeDef?.displayName || selectedPassportType || "Select passport type";
  const groupSubmitDisabled = generatingGroup
    || !groupName.trim()
    || !selectedPassportType
    || selectedFieldKeys.length === 0
    || (scopeType === "passports" && selectedPassportDppIds.length === 0);
  const bearerExample = `curl -X POST ${api}/api/companies/your-company-name/integrations/v1/passports \\
  -H "Authorization: Bearer yourTokenHere" \\
  -H "Content-Type: application/json" \\
  -d '{"passportType":"yourPassportType","productIdentifier":"yourProductIdentifier"}'`;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h2 className="profile-title">Security</h2>
        <p className="profile-sub">Manage bearer tokens and restricted-field security groups.</p>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type === "success" ? "success" : "error"} dashboard-alert-spaced`}>
          {message.text}
        </div>
      )}

      <div className="profile-right">
        <div className="profile-card">
          <h4 className="card-section-title">Bearer Token</h4>
          <p className="profile-helper-text">
            Use this token for authenticated company integration calls in the <code>Authorization: Bearer &lt;token&gt;</code> header.
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
              {copyBearerFeedback === "success" ? "Copied" : copyBearerFeedback === "error" ? "Failed to copy" : "Copy Token"}
            </button>
          </div>

          <div className="token-usage-guide">
            <h5>Usage Example (cURL):</h5>
            <code className="code-block">{bearerExample}</code>
          </div>
        </div>

        <div className="profile-card">
          <h4 className="card-section-title">Security Groups</h4>
          <p className="profile-helper-text">
            Security groups generate API keys for the public passport viewer. A key grants access only to the restricted fields selected for its passport type or selected unique passports.
          </p>

          {!resolvedCompanyId && (
            <div className="alert alert-error dashboard-alert-spaced">No company is assigned to this account.</div>
          )}

          {resolvedCompanyId && !canManageCompanyKeys && (
            <div className="alert alert-error dashboard-alert-spaced">
              Security group management is available to company admins.
            </div>
          )}

          {resolvedCompanyId && canManageCompanyKeys && (
            <>
              {newKey && (
                <div className="security-key-reveal">
                  <p className="security-key-reveal-title">Security group created: {newKey.name}</p>
                  <p className="security-key-reveal-copy">This is the only time this API key will be shown. Copy it now.</p>
                  <p className="security-key-reveal-meta">
                    {newKey.passportType} · {newKey.scopeType === "passports" ? `${newKey.passportDppIds.length} selected passport${newKey.passportDppIds.length === 1 ? "" : "s"}` : "All passports of this type"} · {newKey.fieldKeys.length} restricted field{newKey.fieldKeys.length === 1 ? "" : "s"}
                  </p>
                  <div className="security-key-reveal-actions">
                    <code className="security-key-reveal-code">{newKey.key}</code>
                    <button
                      type="button"
                      onClick={copyNewApiKey}
                      className={`security-key-reveal-copy-btn${copiedApiKey ? " copied" : ""}`}
                    >
                      {copiedApiKey ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setNewKey(null); setCopiedApiKey(false); }}
                    className="security-key-reveal-dismiss"
                  >
                    I have saved the key
                  </button>
                </div>
              )}

              <form onSubmit={generateSecurityGroup} className="security-group-form">
                <div className="security-group-grid">
                  <label className="security-group-field">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Supplier audit access"
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      disabled={generatingGroup}
                      maxLength={100}
                      className="token-input"
                    />
                  </label>

                  <label className="security-group-field">
                    <span>Category</span>
                    <select
                      value={selectedCategory}
                      onChange={(event) => {
                        setSelectedCategory(event.target.value);
                        setSelectedPassportType("");
                      }}
                      disabled={generatingGroup || loadingTypes}
                      className="token-input"
                    >
                      <option value="">{loadingTypes ? "Loading categories..." : "Select category"}</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </label>

                  <label className="security-group-field">
                    <span>Passport Type</span>
                    <select
                      value={selectedPassportType}
                      onChange={(event) => setSelectedPassportType(event.target.value)}
                      disabled={generatingGroup || !selectedCategory}
                      className="token-input"
                    >
                      <option value="">{selectedCategory ? "Select passport type" : "Select category first"}</option>
                      {passportTypesForCategory.map((type) => (
                        <option key={type.typeName} value={type.typeName}>{type.displayName || type.typeName}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="security-group-segmented" role="group" aria-label="Security group scope">
                  <button
                    type="button"
                    className={scopeType === "passportType" ? "active" : ""}
                    onClick={() => setScopeType("passportType")}
                    disabled={generatingGroup}
                  >
                    All passports of type
                  </button>
                  <button
                    type="button"
                    className={scopeType === "passports" ? "active" : ""}
                    onClick={() => setScopeType("passports")}
                    disabled={generatingGroup}
                  >
                    Selected unique passports
                  </button>
                </div>

                {scopeType === "passports" && selectedPassportType && (
                  <div className="security-group-panel">
                    <div className="security-group-panel-head">
                      <strong>Unique passports</strong>
                      <span>{selectedPassportDppIds.length} selected</span>
                    </div>
                    {loadingPassports ? (
                      <p className="profile-helper-text">Loading passports...</p>
                    ) : passports.length === 0 ? (
                      <p className="profile-helper-text">No passports found for {selectedTypeLabel}.</p>
                    ) : (
                      <div className="security-group-passport-list">
                        {passports.map((passport) => (
                          <label key={passport.dppId} className="security-group-passport-item">
                            <input
                              type="checkbox"
                              checked={selectedPassportDppIds.includes(passport.dppId)}
                              onChange={() => toggleSelectedValue(passport.dppId, selectedPassportDppIds, setSelectedPassportDppIds)}
                              disabled={generatingGroup}
                            />
                            <span>
                              <strong>{passport.modelName || passport.internalAliasId || passport.dppId}</strong>
                              <small>{passport.internalAliasId || passport.dppId} · v{passport.versionNumber || 1} · {passport.archived ? "archived" : (passport.releaseStatus || "draft")}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedPassportType && (
                  <div className="security-group-panel">
                    <div className="security-group-panel-head">
                      <strong>Restricted fields</strong>
                      <span>{selectedFieldKeys.length} selected</span>
                    </div>
                    {restrictedFields.length === 0 ? (
                      <p className="profile-helper-text">This passport type has no restricted fields.</p>
                    ) : (
                      <div className="security-group-table-wrap">
                        <table className="security-group-table">
                          <thead>
                            <tr>
                              <th>Select</th>
                              <th>Field</th>
                              <th>Key</th>
                              <th>Section</th>
                              <th>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {restrictedFields.map((field) => (
                              <tr key={field.key}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedFieldKeys.includes(field.key)}
                                    onChange={() => toggleSelectedValue(field.key, selectedFieldKeys, setSelectedFieldKeys)}
                                    disabled={generatingGroup}
                                  />
                                </td>
                                <td>{field.label || field.key}</td>
                                <td><code>{field.key}</code></td>
                                <td>{field.sectionLabel}</td>
                                <td>{field.type || "text"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={groupSubmitDisabled}
                  className="btn-copy-token security-group-submit"
                >
                  {generatingGroup ? "Creating..." : "Finish and Generate API Key"}
                </button>
              </form>

              <div className="security-group-list-section">
                <h5>Existing Security Groups</h5>
                {loadingGroups ? (
                  <p className="profile-helper-text">Loading security groups...</p>
                ) : securityGroups.length === 0 ? (
                  <p className="profile-helper-text">No security groups yet.</p>
                ) : (
                  <div className="security-group-list">
                    {securityGroups.map((group) => (
                      <div key={group.id} className={`security-group-card${group.isActive ? "" : " revoked"}`}>
                        <div className="security-group-card-main">
                          <div>
                            <strong>{group.name}</strong>
                            <code>{group.keyPrefix}...</code>
                          </div>
                          <p>
                            {group.passportType || "No passport type"} · {group.scopeType === "passports" ? `${group.passportDppIds?.length || 0} selected passport${(group.passportDppIds?.length || 0) === 1 ? "" : "s"}` : "All passports of type"} · {group.fieldKeys?.length || 0} field{(group.fieldKeys?.length || 0) === 1 ? "" : "s"}
                          </p>
                          <small>Created {formatDate(group.createdAt)} · Last used {formatDate(group.lastUsedAt)}</small>
                        </div>
                        {group.isActive ? (
                          <button
                            type="button"
                            onClick={() => revokeSecurityGroup(group.id, group.name)}
                            disabled={revokingId === group.id}
                            className="security-group-revoke"
                          >
                            {revokingId === group.id ? "Revoking..." : "Revoke"}
                          </button>
                        ) : (
                          <span className="security-group-revoked-label">Revoked</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SecurityCenter;
