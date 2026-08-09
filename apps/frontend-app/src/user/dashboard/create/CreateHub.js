import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import { useI18n } from "../../../app/providers/i18n";
import "../../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

// ── Inline bulk create modal (reused from PassportList / TemplatesPage) ──
function BulkModal({ passportType, typeLabel, companyId, templateId, templateName, onClose, onDone }) {
  const { t } = useI18n();
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
        const tr = await fetchWithAuth(`${api}/api/companies/${companyId}/templates/${templateId}`, { headers: authHeaders() });
        if (tr.ok) {
          const tmpl = await tr.json();
          for (const f of tmpl.fields || []) { if (f.fieldValue) prefill[f.fieldKey] = f.fieldValue; }
        }
      }
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          passportType,
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
            <h3 className="dashboard-modal-title">{t("passportsCreated")}</h3>
            <div className="tmpl-bulk-summary">
              <div className="tmpl-bulk-stat tmpl-bulk-created">
                <span className="tmpl-bulk-num">{result.created ?? 0}</span><span>{t("created")}</span>
              </div>
              {result.skipped > 0 && <div className="tmpl-bulk-stat tmpl-bulk-skipped"><span className="tmpl-bulk-num">{result.skipped}</span><span>{t("skipped")}</span></div>}
              {result.failed  > 0 && <div className="tmpl-bulk-stat tmpl-bulk-failed"><span className="tmpl-bulk-num">{result.failed}</span><span>{t("failed")}</span></div>}
            </div>
            {templateName && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>{t("preFilledFromTemplate", { template: templateName })}</p>}
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-primary" onClick={() => onDone()}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="dashboard-modal-title">{t("bulkCreatePassports")}: {typeLabel}</h3>
            {templateName && (
              <p className="dashboard-modal-subtitle">
                {t("preFillingFromTemplate", { template: templateName })}
              </p>
            )}
            <p className="dashboard-modal-subtitle">
              {t("draftCountQuestion")}
            </p>
            <label className="device-manual-label">Number of Passports</label>
            <input type="number" min="1" max="500" step="1"
              value={count} onChange={e => setCount(e.target.value)}
              className="device-manual-input" disabled={submitting} autoFocus />
            <p className="bulk-create-note">{t("draftRenameLater")}</p>
            {error && <div className="dashboard-inline-error">{error}</div>}
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="dashboard-btn dashboard-btn-primary" onClick={handleCreate} disabled={submitting}>
                {submitting ? t("creating") : t("createPassports")}
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
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const filtered = templates.filter(t =>
    `${t.name} ${t.description || ""}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="ch-tmpl-picker">
      <div className="ch-tmpl-picker-header">
        <h3 className="ch-tmpl-picker-title">{t("chooseTemplate")}</h3>
        <button className="tmpl-editor-close" onClick={onCancel}>✕</button>
      </div>
      <input className="tmpl-search" type="text" placeholder={t("searchTemplates")}
        value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      <div className="ch-tmpl-list">
        {filtered.length === 0 ? (
          <div className="tmpl-empty">{t("noTemplatesFound")}</div>
        ) : filtered.map((template) => (
          <div key={template.id} className="ch-tmpl-item" onClick={() => onSelect(template)}>
            <div className="ch-tmpl-item-icon">📋</div>
            <div>
              <div className="ch-tmpl-item-name">{template.name}</div>
              {template.description && <div className="ch-tmpl-item-desc">{template.description}</div>}
              {parseInt(template.modelFieldCount) > 0 && (
                <div className="ch-tmpl-item-meta">📌 {t("modelDataFields", { count: template.modelFieldCount, suffix: Number(template.modelFieldCount) !== 1 ? "s" : "" })}</div>
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
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedType = searchParams.get("type");
  const dashboardPath = (subpath = "") => buildDashboardPath({
    companyName: user?.companyName,
    companyId,
    subpath,
  });

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
    fetchWithAuth(`${api}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(types => {
        setPassportTypes(types);
        if (preselectedType) {
          const match = types.find(t => t.typeName === preselectedType);
          if (match) { setSelectedType(match); setStep("method"); }
        }
      })
      .catch((error) => console.warn("Ignored async error", error));
  }, [companyId, preselectedType]);

  // Load templates when type is selected
  const loadTemplates = useCallback((type) => {
    if (!type) return;
    setLoadingTemplates(true);
    fetchWithAuth(`${api}/api/companies/${companyId}/templates?passportType=${type.typeName}`, { headers: authHeaders() })
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

  const typeLabel = selectedType?.displayName || selectedType?.typeName || "";
  const grouped = passportTypes.reduce((acc, pt) => {
    const cat = pt.productCategory || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pt);
    return acc;
  }, {});

  return (
    <div className="ch-page">
      {/* Page header */}
      <div className="ch-header">
        <div>
          <h2 className="ch-title">{t("createPassport")}</h2>
          <p className="ch-subtitle">{t("createPassportSubtitle")}</p>
        </div>
      </div>

      <div className="ch-body">
        {/* ── Step 1: Type selector ── */}
        <div className={`ch-step ${step === "method" ? "ch-step-compact" : ""}`}>
          <div className="ch-step-label">
            <span className="ch-step-num">1</span>
            {t("passportType")}
            {step === "method" && selectedType && (
              <button className="ch-change-btn" onClick={() => { setStep("type"); setSubStep(null); }}>
                {t("change")}
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
                      <span className="ch-type-icon">{pt.productIcon || "📋"}</span>
                      <span className="ch-type-name">{pt.displayName || pt.typeName}</span>
                      <span className="ch-method-arrow">→</span>
                    </button>
                  ))}
                </div>
              ))}
              {passportTypes.length === 0 && (
                <div className="tmpl-empty">{t("noPassportTypes")}</div>
              )}
            </div>
          ) : (
            <div className="ch-selected-type">
              <span className="ch-type-icon">{selectedType?.productIcon || "📋"}</span>
              <strong>{typeLabel}</strong>
            </div>
          )}
        </div>

        {/* ── Step 2: Creation method ── */}
        {step === "method" && (
          <div className="ch-step">
            <div className="ch-step-label">
              <span className="ch-step-num">2</span>
              {t("creationMethod")}
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
                    {parseInt(chosenTemplate.modelFieldCount) > 0 && (
                      <div className="ch-tmpl-chosen-meta">📌 {t("modelDataPreFilledLocked", { count: chosenTemplate.modelFieldCount, suffix: Number(chosenTemplate.modelFieldCount) !== 1 ? "s" : "" })}</div>
                    )}
                  </div>
                  <button className="ch-change-btn" style={{ marginLeft: "auto" }} onClick={() => setSubStep("template-pick")}>{t("change")}</button>
                </div>
                <div className="ch-template-actions">
                  <MethodCard
                    icon="✏️"
                    title={t("createSinglePassport")}
                    description={t("createSinglePassportDescription")}
                    tag={t("oneAtATime")}
                    tagColor="mint"
                    onClick={() => navigate(`/create/${selectedType.typeName}?templateId=${chosenTemplate.id}`)}
                  />
                  <MethodCard
                    icon="⚡"
                    title={t("bulkCreateFromTemplate")}
                    description={t("bulkCreateFromTemplateDescription")}
                    tag={t("manyAtOnce")}
                    tagColor="purple"
                    onClick={() => setBulkModal({ templateId: chosenTemplate.id, templateName: chosenTemplate.name })}
                  />
                </div>
              </div>
            ) : (
              <div className="ch-methods">
                <MethodCard
                  icon="✏️"
                  title={t("fillTheForm")}
                  description={t("fillTheFormDescription")}
                  tag={t("oneAtATime")}
                  tagColor="mint"
                  onClick={() => navigate(`/create/${selectedType.typeName}`)}
                />
                <MethodCard
                  icon="📋"
                  title={t("createFromTemplate")}
                  description={t("createFromTemplateDescription", { availability: templates.length > 0 ? t("templatesAvailableForType", { count: templates.length, suffix: templates.length !== 1 ? "s" : "", type: typeLabel }) : t("createTemplatesFirst") })}
                  tag={templates.length > 0 ? t("templatesAvailable", { count: templates.length }) : t("noTemplatesYet")}
                  tagColor={templates.length > 0 ? "mint" : "muted"}
                  onClick={() => setSubStep("template-pick")}
                  disabled={loadingTemplates}
                />
                <MethodCard
                  icon="⚡"
                  title={t("bulkCreateEmptyDrafts")}
                  description={t("bulkCreateEmptyDraftsDescription")}
                  tag={t("manyAtOnce")}
                  tagColor="purple"
                  onClick={() => setBulkModal({})}
                />
                <MethodCard
                  icon="📊"
                  title={t("importPassportData")}
                  description={t("importPassportDataDescription")}
                  tag={t("csvOrJson")}
                  tagColor="blue"
                  onClick={() => navigate(`/csv-import/${selectedType.typeName}/create-csv`)}
                />
              </div>
            )}

            {/* Help box */}
            <div className="ch-help-box">
              <span className="ch-help-icon">💡</span>
              <div>
                <strong>{t("notSureWhichToUse")}</strong>
                <ul className="ch-help-list">
                  <li><strong>{t("onePassport")}</strong> → {t("helpOnePassport")}</li>
                  <li><strong>{t("repeatedModel")}</strong> → {t("helpRepeatedModel")}</li>
                  <li><strong>{t("manyUnitsAtOnce")}</strong> → {t("helpManyUnits")}</li>
                  <li><strong>{t("spreadsheetData")}</strong> → {t("helpSpreadsheetData")}</li>
                  <li><strong>{t("jsonData")}</strong> → {t("helpJsonData")}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk modal */}
      {bulkModal && selectedType && (
        <BulkModal
          passportType={selectedType.typeName}
          typeLabel={typeLabel}
          companyId={companyId}
          templateId={bulkModal.templateId}
          templateName={bulkModal.templateName}
          onClose={() => setBulkModal(null)}
          onDone={() => {
            setBulkModal(null);
            navigate(dashboardPath(`passports/${selectedType.typeName}`));
          }}
        />
      )}
    </div>
  );
}
