import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

// ── Inline bulk create modal (reused from PassportList / TemplatesPage) ──
function BulkModal({ passportType, typeLabel, companyId, templateId, templateName, onClose, onDone }) {
  const [count,      setCount]      = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  const [result,     setResult]     = useState(null);

  const handleCreate = async () => {
    const n = parseInt(count, 10);
    if (!Number.isInteger(n) || n < 1 || n > 500) { setError("Enter a number between 1 and 500."); return; }
    setError("");
    setSubmitting(true);
    try {
      let prefill = {};
      if (templateId) {
        const tr = await fetchWithAuth(`${API}/api/companies/${companyId}/templates/${templateId}`, { headers: authHeaders() });
        if (tr.ok) {
          const tmpl = await tr.json();
          for (const f of tmpl.fields || []) { if (f.field_value) prefill[f.field_key] = f.field_value; }
        }
      }
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          passport_type: passportType,
          passports: Array.from({ length: n }, () => ({ ...prefill })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Bulk create failed");
      setResult(data.summary || { created: n });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        {result ? (
          <>
            <h3 className="dashboard-modal-title">Passports Created</h3>
            <div className="tmpl-bulk-summary">
              <div className="tmpl-bulk-stat tmpl-bulk-created">
                <span className="tmpl-bulk-num">{result.created ?? 0}</span><span>created</span>
              </div>
              {result.skipped > 0 && <div className="tmpl-bulk-stat tmpl-bulk-skipped"><span className="tmpl-bulk-num">{result.skipped}</span><span>skipped</span></div>}
              {result.failed  > 0 && <div className="tmpl-bulk-stat tmpl-bulk-failed"><span className="tmpl-bulk-num">{result.failed}</span><span>failed</span></div>}
            </div>
            {templateName && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>Pre-filled from template <strong>{templateName}</strong>.</p>}
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-primary" onClick={() => onDone()}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="dashboard-modal-title">Bulk Create {typeLabel} Passports</h3>
            {templateName && (
              <p className="dashboard-modal-subtitle">
                Pre-filling from template <strong>{templateName}</strong>. Model data fields will be locked on each draft.
              </p>
            )}
            <p className="dashboard-modal-subtitle">
              How many draft passports do you want to create? (max 500)
            </p>
            <label className="device-manual-label">Number of Passports</label>
            <input type="number" min="1" max="500" step="1"
              value={count} onChange={e => setCount(e.target.value)}
              className="device-manual-input" disabled={submitting} autoFocus />
            <p className="bulk-create-note">Drafts can be renamed and filled in after creation.</p>
            {error && <div className="dashboard-inline-error">{error}</div>}
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="dashboard-btn dashboard-btn-primary" onClick={handleCreate} disabled={submitting}>
                {submitting ? "Creating…" : "Create Passports"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Method card ──
function MethodCard({ icon, title, description, tag, tagColor, onClick, disabled }) {
  return (
    <button
      className={`ch-method-card${disabled ? " ch-method-disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="ch-method-icon">{icon}</div>
      <div className="ch-method-body">
        <div className="ch-method-header">
          <span className="ch-method-title">{title}</span>
          {tag && <span className={`ch-method-tag ch-tag-${tagColor || "default"}`}>{tag}</span>}
        </div>
        <p className="ch-method-desc">{description}</p>
      </div>
      {!disabled && <span className="ch-method-arrow">→</span>}
    </button>
  );
}

// ── Template picker inside the hub ──
function TemplatePicker({ templates, onSelect, onCancel }) {
  const [search, setSearch] = useState("");
  const filtered = templates.filter(t =>
    `${t.name} ${t.description || ""}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="ch-tmpl-picker">
      <div className="ch-tmpl-picker-header">
        <h3 className="ch-tmpl-picker-title">Choose a Template</h3>
        <button className="tmpl-editor-close" onClick={onCancel}>✕</button>
      </div>
      <input className="tmpl-search" type="text" placeholder="Search templates…"
        value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      <div className="ch-tmpl-list">
        {filtered.length === 0 ? (
          <div className="tmpl-empty">No templates found. Create one in the Templates page first.</div>
        ) : filtered.map(t => (
          <div key={t.id} className="ch-tmpl-item" onClick={() => onSelect(t)}>
            <div className="ch-tmpl-item-icon">📋</div>
            <div>
              <div className="ch-tmpl-item-name">{t.name}</div>
              {t.description && <div className="ch-tmpl-item-desc">{t.description}</div>}
              {parseInt(t.model_field_count) > 0 && (
                <div className="ch-tmpl-item-meta">📌 {t.model_field_count} model data field{t.model_field_count !== "1" ? "s" : ""}</div>
              )}
            </div>
            <span className="ch-method-arrow">→</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CreateHub({ user, companyId }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedType = searchParams.get("type");

  const [passportTypes,    setPassportTypes]    = useState([]);
  const [selectedType,     setSelectedType]     = useState(null);
  const [templates,        setTemplates]        = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [step,             setStep]             = useState("type");   // "type" | "method"
  const [subStep,          setSubStep]          = useState(null);     // "template-pick" | "bulk-plain" | "bulk-template"
  const [chosenTemplate,   setChosenTemplate]   = useState(null);
  const [bulkModal,        setBulkModal]        = useState(null);     // { templateId?, templateName? }

  // Load passport types
  useEffect(() => {
    fetchWithAuth(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(types => {
        setPassportTypes(types);
        if (preselectedType) {
          const match = types.find(t => t.type_name === preselectedType);
          if (match) { setSelectedType(match); setStep("method"); }
        }
      })
      .catch(() => {});
  }, [companyId, preselectedType]);

  // Load templates when type is selected
  const loadTemplates = useCallback((type) => {
    if (!type) return;
    setLoadingTemplates(true);
    fetchWithAuth(`${API}/api/companies/${companyId}/templates?passport_type=${type.type_name}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [companyId]);

  const selectType = (type) => {
    setSelectedType(type);
    setSubStep(null);
    setChosenTemplate(null);
    loadTemplates(type);
    setStep("method");
  };

  const typeLabel = selectedType?.display_name || selectedType?.type_name || "";
  const grouped = passportTypes.reduce((acc, pt) => {
    const cat = pt.umbrella_category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pt);
    return acc;
  }, {});

  return (
    <div className="ch-page">
      {/* Page header */}
      <div className="ch-header">
        <div>
          <h2 className="ch-title">Create Passport</h2>
          <p className="ch-subtitle">Choose a passport type and how you want to create it.</p>
        </div>
      </div>

      <div className="ch-body">
        {/* ── Step 1: Type selector ── */}
        <div className={`ch-step ${step === "method" ? "ch-step-compact" : ""}`}>
          <div className="ch-step-label">
            <span className="ch-step-num">1</span>
            Passport Type
            {step === "method" && selectedType && (
              <button className="ch-change-btn" onClick={() => { setStep("type"); setSubStep(null); }}>
                Change
              </button>
            )}
          </div>

          {step === "type" ? (
            <div className="ch-type-grid">
              {Object.entries(grouped).map(([cat, types]) => (
                <div key={cat} className="ch-type-group">
                  <div className="ch-type-group-label">{cat}</div>
                  {types.map(pt => (
                    <button key={pt.id} className="ch-type-card" onClick={() => selectType(pt)}>
                      <span className="ch-type-icon">{pt.umbrella_icon || "📋"}</span>
                      <span className="ch-type-name">{pt.display_name || pt.type_name}</span>
                      <span className="ch-method-arrow">→</span>
                    </button>
                  ))}
                </div>
              ))}
              {passportTypes.length === 0 && (
                <div className="tmpl-empty">No passport types available for your company yet.</div>
              )}
            </div>
          ) : (
            <div className="ch-selected-type">
              <span className="ch-type-icon">{selectedType?.umbrella_icon || "📋"}</span>
              <strong>{typeLabel}</strong>
            </div>
          )}
        </div>

        {/* ── Step 2: Creation method ── */}
        {step === "method" && (
          <div className="ch-step">
            <div className="ch-step-label">
              <span className="ch-step-num">2</span>
              Creation Method
            </div>

            {subStep === "template-pick" ? (
              <TemplatePicker
                templates={templates}
                onSelect={(t) => {
                  setChosenTemplate(t);
                  setSubStep("template-chosen");
                }}
                onCancel={() => setSubStep(null)}
              />
            ) : subStep === "template-chosen" && chosenTemplate ? (
              <div className="ch-template-chosen">
                <div className="ch-tmpl-chosen-banner">
                  <span style={{ fontSize: 22 }}>📋</span>
                  <div>
                    <div className="ch-tmpl-chosen-name">{chosenTemplate.name}</div>
                    {chosenTemplate.description && <div className="ch-tmpl-chosen-desc">{chosenTemplate.description}</div>}
                    {parseInt(chosenTemplate.model_field_count) > 0 && (
                      <div className="ch-tmpl-chosen-meta">📌 {chosenTemplate.model_field_count} model data fields will be pre-filled and locked</div>
                    )}
                  </div>
                  <button className="ch-change-btn" style={{ marginLeft: "auto" }} onClick={() => setSubStep("template-pick")}>Change</button>
                </div>
                <div className="ch-template-actions">
                  <MethodCard
                    icon="✏️"
                    title="Create single passport"
                    description="Opens the passport form with model data pre-filled from this template. You fill in the unit-specific fields."
                    tag="One at a time"
                    tagColor="mint"
                    onClick={() => navigate(`/create/${selectedType.type_name}?templateId=${chosenTemplate.id}`)}
                  />
                  <MethodCard
                    icon="⚡"
                    title="Bulk create from template"
                    description="Creates multiple draft passports at once, all pre-filled with this template's model data. You edit each draft to add unit-specific fields."
                    tag="Many at once"
                    tagColor="purple"
                    onClick={() => setBulkModal({ templateId: chosenTemplate.id, templateName: chosenTemplate.name })}
                  />
                </div>
              </div>
            ) : (
              <div className="ch-methods">
                <MethodCard
                  icon="✏️"
                  title="Fill the form"
                  description="Create one passport at a time using the structured form. Best for individual records or when you want full control over each field."
                  tag="One at a time"
                  tagColor="mint"
                  onClick={() => navigate(`/create/${selectedType.type_name}`)}
                />
                <MethodCard
                  icon="📋"
                  title="Create from a template"
                  description={`Use a saved model template so common fields (manufacturer, specs, category) are pre-filled and locked. ${templates.length > 0 ? `${templates.length} template${templates.length !== 1 ? "s" : ""} available for ${typeLabel}.` : "Create templates in the Templates page first."}`}
                  tag={templates.length > 0 ? `${templates.length} available` : "No templates yet"}
                  tagColor={templates.length > 0 ? "mint" : "muted"}
                  onClick={() => setSubStep("template-pick")}
                  disabled={loadingTemplates}
                />
                <MethodCard
                  icon="⚡"
                  title="Bulk create (empty drafts)"
                  description="Generates multiple empty draft passports in one click. Use this when you know how many units you need but will fill them in later individually or via CSV."
                  tag="Many at once"
                  tagColor="purple"
                  onClick={() => setBulkModal({})}
                />
                <MethodCard
                  icon="📊"
                  title="Import from CSV"
                  description="Create passports by uploading a spreadsheet. Download the template CSV first, fill in one column per passport, then upload. Best for large batches with structured data."
                  tag="Spreadsheet"
                  tagColor="blue"
                  onClick={() => navigate(`/csv-import/${selectedType.type_name}`)}
                />
                <MethodCard
                  icon="🔧"
                  title="Import / update via JSON or CSV"
                  description="Upload a JSON array or a CSV file to create new passports or update existing drafts. If a DPP ID is present in the file, the matching draft is updated instead of a new one created."
                  tag="Create + Update"
                  tagColor="blue"
                  onClick={() => navigate(`/csv-import/${selectedType.type_name}/update-csv`)}
                />
              </div>
            )}

            {/* Help box */}
            <div className="ch-help-box">
              <span className="ch-help-icon">💡</span>
              <div>
                <strong>Not sure which to use?</strong>
                <ul className="ch-help-list">
                  <li><strong>One passport</strong> → Fill the form</li>
                  <li><strong>Repeated model (same specs, different units)</strong> → Create a template first, then use it</li>
                  <li><strong>Many units at once</strong> → Bulk create, then export CSV to fill in unit-level fields and re-import</li>
                  <li><strong>Data already in a spreadsheet</strong> → CSV import</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk modal */}
      {bulkModal && selectedType && (
        <BulkModal
          passportType={selectedType.type_name}
          typeLabel={typeLabel}
          companyId={companyId}
          templateId={bulkModal.templateId}
          templateName={bulkModal.templateName}
          onClose={() => setBulkModal(null)}
          onDone={() => {
            setBulkModal(null);
            navigate(`/dashboard/passports/${selectedType.type_name}`);
          }}
        />
      )}
    </div>
  );
}
