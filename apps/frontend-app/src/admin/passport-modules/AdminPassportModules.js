import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { formatSemanticModelLabel } from "../passport-types/semanticTermCatalog";
import "../styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const getSemanticModelLabel = formatSemanticModelLabel;

function buildDictionaryPath(model) {
  if (!model?.family || !model?.version) return null;
  return `/admin/dictionary/${encodeURIComponent(model.family)}/${encodeURIComponent(model.version)}`;
}

function AdminPassportModules() {
  const navigate = useNavigate();
  const [moduleTemplates, setModuleTemplates] = useState([]);
  const [semanticModels, setSemanticModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [seedGuideModule, setSeedGuideModule] = useState(null);

  const showMsg = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  };

  const fetchModules = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [modulesResponse, modelsResponse] = await Promise.all([
        fetchWithAuth(`${api}/api/admin/passport-type-modules`, {
          headers: authHeaders(),
        }),
        fetchWithAuth(`${api}/api/semantic-models`, {
          headers: authHeaders(),
        }),
      ]);
      if (!modulesResponse.ok) throw new Error("Failed to fetch passport modules");
      const modules = await modulesResponse.json();
      const models = modelsResponse.ok ? await modelsResponse.json() : [];
      setModuleTemplates(Array.isArray(modules) ? modules : []);
      setSemanticModels(Array.isArray(models) ? models : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const handleCopySeedCommand = async (command) => {
    try {
      await navigator.clipboard.writeText(`cd apps/backend-api && ${command}`);
      showMsg("Seed command copied.");
    } catch {
      showMsg(`Seed from backend directory: ${command}`);
    }
  };

  const moduleWithProfilesCount = moduleTemplates.filter((moduleTemplate) => (moduleTemplate.profileCount || 0) > 0).length;
  const totalProfileCount = moduleTemplates.reduce(
    (count, moduleTemplate) => count + (moduleTemplate.profileCount || 0),
    0,
  );
  const semanticModelByKey = new Map(
    semanticModels.map((model) => [model.semanticModelKey || model.key, model])
  );

  if (loading) return <div className="loading">Loading passport modules…</div>;

  return (
    <div className="apt-page">
      <div className="apt-toolbar">
        <div>
          <h2 className="apt-title">🧩 Passport Modules</h2>
          <p className="apt-subtitle">
            Comprehensive code-defined vocabularies. Create one or more selected passport-type profiles from each module.
          </p>
        </div>
        <div className="apt-toolbar-actions">
          <button
            type="button"
            className="apt-create-btn apt-toolbar-secondary-btn"
            onClick={() => navigate("/admin/passport-types")}
          >
            ← Back to Passport Types
          </button>
          <button type="button" className="apt-create-btn" onClick={fetchModules}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="apt-moduleTemplates-panel">
        <div className="apt-moduleTemplates-header">
          <div>
            <h3 className="apt-moduleTemplates-title">Registered Code Modules</h3>
            <p className="apt-moduleTemplates-hint">
              Module files remain canonical. Passport types choose the fields, requirements, confidentiality, and chart presentation they need.
            </p>
          </div>
          <span className="apt-moduleTemplates-count">
            {totalProfileCount} type{totalProfileCount === 1 ? "" : "s"} across {moduleWithProfilesCount}/{moduleTemplates.length} module{moduleTemplates.length === 1 ? "" : "s"}
          </span>
        </div>

        {moduleTemplates.length === 0 ? (
          <div className="apt-moduleTemplates-empty">No passport modules are registered in code.</div>
        ) : (
          <div className="apt-cards apt-moduleTemplates-grid">
            {moduleTemplates.map((moduleTemplate) => {
              const dictionaryModel = semanticModelByKey.get(moduleTemplate.semanticModelKey);
              const dictionaryPath = buildDictionaryPath(dictionaryModel);
              return (
                <div
                  key={moduleTemplate.moduleKey}
                  className={`apt-card apt-moduleTemplate-card ${(moduleTemplate.profileCount || 0) > 0 ? "" : "apt-card-inactive"}`}
                >
                  <div className="apt-card-header">
                    <div>
                      <div className="apt-card-display-name">{moduleTemplate.displayName}</div>
                      <code className="apt-card-type-name">{moduleTemplate.moduleKey}</code>
                    </div>
                    <div className="admin-inline-stack">
                      <span className={`apt-badge ${(moduleTemplate.profileCount || 0) > 0 ? "apt-badge-active" : "apt-badge-draft"}`}>
                        {(moduleTemplate.profileCount || 0) > 0
                          ? `${moduleTemplate.profileCount} type${moduleTemplate.profileCount === 1 ? "" : "s"}`
                          : "No types yet"}
                      </span>
                    </div>
                  </div>

                  <div className="apt-card-meta">
                    <span className="apt-card-meta-primary">
                      {moduleTemplate.fieldCount || 0} fields in the registered module
                    </span>
                    <span className="apt-card-meta-secondary">
                      Product category: {moduleTemplate.productCategory || "Uncategorized"}
                    </span>
                    <span className="apt-card-meta-secondary">
                      Semantic model: {getSemanticModelLabel(moduleTemplate.semanticModelKey)}
                    </span>
                    <span className="apt-card-meta-secondary">
                      Default full-profile type: {moduleTemplate.typeName || "Not configured"}
                    </span>
                    {(moduleTemplate.profileTypes || []).map((profileType) => (
                      <span key={profileType.id || profileType.typeName} className="apt-card-meta-secondary">
                        {profileType.typeName} · {profileType.fieldCount || 0} selected fields{profileType.isActive ? "" : " · inactive"}
                      </span>
                    ))}
                  </div>

                  <div className="apt-card-actions apt-moduleTemplate-actions">
                    <button
                      type="button"
                      className="apt-create-btn"
                      onClick={() => navigate("/admin/passport-types/new", {
                        state: { sourceModuleKey: moduleTemplate.moduleKey },
                      })}
                    >
                      Create Passport Type
                    </button>
                    <button
                      type="button"
                      className="apt-view-fields-btn"
                      onClick={() => handleCopySeedCommand(moduleTemplate.seedCommand)}
                    >
                      Copy Seed
                    </button>
                    <button
                      type="button"
                      className="apt-view-fields-btn"
                      onClick={() => setSeedGuideModule(moduleTemplate)}
                    >
                      Open Guide
                    </button>
                    {dictionaryPath && (
                      <button
                        type="button"
                        className="apt-view-fields-btn"
                        onClick={() => navigate(dictionaryPath)}
                      >
                        Dictionary
                      </button>
                    )}
                  </div>

                  <div className="apt-immutable-note apt-moduleTemplate-command-note">
                    <code className="apt-moduleTemplate-command">{moduleTemplate.seedCommand}</code>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {seedGuideModule && (
        <div className="apt-modal-overlay" onClick={() => setSeedGuideModule(null)}>
          <div className="apt-modal apt-seed-guide-modal" onClick={e => e.stopPropagation()}>
            <h3 className="apt-modal-title">Seed Passport Module</h3>
            <p className="apt-modal-warning">
              <strong>{seedGuideModule.displayName}</strong> is defined in code as <code>{seedGuideModule.moduleKey}</code>.
              Use the Admin builder to create selected passport types. Seeding only creates the default full-profile type when it does not already exist; it never overwrites an Admin-selected profile.
            </p>
            <div className="apt-seed-guide-grid">
              <div>
                <span className="apt-seed-guide-label">Module</span>
                <code>{seedGuideModule.moduleKey}</code>
              </div>
              <div>
                <span className="apt-seed-guide-label">Type name</span>
                <code>{seedGuideModule.typeName}</code>
              </div>
              <div>
                <span className="apt-seed-guide-label">Semantic model</span>
                <code>{seedGuideModule.semanticModelKey || "none"}</code>
              </div>
              <div>
                <span className="apt-seed-guide-label">Status</span>
                <strong>{seedGuideModule.profileCount || 0} type{seedGuideModule.profileCount === 1 ? "" : "s"} currently use this module</strong>
              </div>
            </div>
            <div className="apt-seed-guide-commands">
              <div>
                <span className="apt-seed-guide-label">Seed only this module</span>
                <code>cd apps/backend-api && {seedGuideModule.seedCommand}</code>
              </div>
              <div>
                <span className="apt-seed-guide-label">Seed and grant one company access</span>
                <code>cd apps/backend-api && {seedGuideModule.seedCommand} --company-id=&lt;companyId&gt;</code>
              </div>
              <div>
                <span className="apt-seed-guide-label">Seed and grant all active companies</span>
                <code>cd apps/backend-api && {seedGuideModule.seedCommand} --grant-all-active-companies</code>
              </div>
            </div>
            <div className="apt-modal-actions">
              <button type="button" className="cancel-btn" onClick={() => setSeedGuideModule(null)}>
                Close
              </button>
              <button
                type="button"
                className="apt-modal-confirm-btn"
                onClick={() => handleCopySeedCommand(seedGuideModule.seedCommand)}
              >
                Copy Basic Seed Command
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPassportModules;
