import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { authHeaders } from "./authHeaders";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ── Field renderer (mirrors PassportForm logic, simplified for templates) ──
function TemplateField({ field, value, isModelData, onValueChange, onModelDataToggle }) {
  const renderInput = () => {
    if (field.type === "boolean") {
      return (
        <label className="tmpl-bool-label">
          <input type="checkbox" checked={!!value}
            onChange={e => onValueChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    }
    if (field.type === "textarea") {
      return (
        <textarea
          className="tmpl-field-input"
          value={value || ""}
          placeholder={`Enter ${field.label.toLowerCase()}`}
          onChange={e => onValueChange(e.target.value)}
          rows={2}
        />
      );
    }
    if (field.type === "date") {
      return (
        <input type="date" className="tmpl-field-input"
          value={value || ""}
          onChange={e => onValueChange(e.target.value)} />
      );
    }
    if (field.type === "file" || field.type === "symbol") {
      return (
        <input type="text" className="tmpl-field-input"
          value={value || ""}
          placeholder="Paste URL or leave blank"
          onChange={e => onValueChange(e.target.value)} />
      );
    }
    if (field.type === "table") {
      return (
        <input type="text" className="tmpl-field-input"
          value={value || ""}
          placeholder="Table data (filled on passport creation)"
          onChange={e => onValueChange(e.target.value)} />
      );
    }
    return (
      <input type="text" className="tmpl-field-input"
        value={value || ""}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        onChange={e => onValueChange(e.target.value)} />
    );
  };

  return (
    <div className={`tmpl-field-row${isModelData ? " tmpl-field-model" : ""}`}>
      <div className="tmpl-field-meta">
        <span className="tmpl-field-label">{field.label}</span>
        <label className="tmpl-model-toggle" title="Mark as model data — will be pre-filled and locked when creating a passport from this template">
          <input type="checkbox" checked={!!isModelData}
            onChange={e => onModelDataToggle(e.target.checked)} />
          <span className="tmpl-model-toggle-text">Model data</span>
        </label>
      </div>
      {renderInput()}
    </div>
  );
}

// ── Template editor (create or edit) ──
function TemplateEditor({ companyId, passportTypes, editingTemplate, onSave, onCancel }) {
  const [passportType,  setPassportType]  = useState(editingTemplate?.passport_type || "");
  const [name,          setName]          = useState(editingTemplate?.name || "");
  const [description,   setDescription]  = useState(editingTemplate?.description || "");
  const [sections,      setSections]      = useState(null);
  const [fieldValues,   setFieldValues]   = useState({});   // fieldKey → value
  const [modelDataKeys, setModelDataKeys] = useState(new Set()); // Set of field keys marked as model data
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState("");
  const [loadingFields, setLoadingFields] = useState(false);

  const isEdit = !!editingTemplate;

  // Load passport type field definitions
  useEffect(() => {
    if (!passportType) { setSections(null); return; }
    setLoadingFields(true);
    fetch(`${API}/api/passport-types/${passportType}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.fields_json?.sections) {
          const s = {};
          for (const sec of data.fields_json.sections) {
            s[sec.key] = { label: sec.label, fields: sec.fields || [] };
          }
          setSections(s);
        } else {
          setSections(null);
        }
      })
      .catch(() => setSections(null))
      .finally(() => setLoadingFields(false));
  }, [passportType]);

  // Pre-fill values when editing
  useEffect(() => {
    if (!editingTemplate?.fields) return;
    const vals = {};
    const model = new Set();
    for (const f of editingTemplate.fields) {
      vals[f.field_key] = f.field_value || "";
      if (f.is_model_data) model.add(f.field_key);
    }
    setFieldValues(vals);
    setModelDataKeys(model);
  }, [editingTemplate]);

  const setFieldValue   = (key, val) => setFieldValues(p => ({ ...p, [key]: val }));
  const toggleModelData = (key, on) => setModelDataKeys(p => {
    const next = new Set(p);
    on ? next.add(key) : next.delete(key);
    return next;
  });

  const handleSave = async () => {
    if (!passportType) return setError("Select a passport type");
    if (!name.trim())  return setError("Enter a template name");

    // Build fields array from all sections
    const fields = [];
    if (sections) {
      for (const sec of Object.values(sections)) {
        for (const f of sec.fields) {
          fields.push({
            field_key:    f.key,
            field_value:  fieldValues[f.key] ?? "",
            is_model_data: modelDataKeys.has(f.key),
          });
        }
      }
    }

    setSaving(true); setError("");
    try {
      const url = isEdit
        ? `${API}/api/companies/${companyId}/templates/${editingTemplate.id}`
        : `${API}/api/companies/${companyId}/templates`;
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ passport_type: passportType, name, description, fields }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sectionKeys = sections ? Object.keys(sections) : [];

  return (
    <div className="tmpl-editor">
      <div className="tmpl-editor-header">
        <h3 className="tmpl-editor-title">{isEdit ? "Edit Template" : "New Template"}</h3>
        <button className="tmpl-editor-close" onClick={onCancel}>✕</button>
      </div>

      <div className="tmpl-editor-body">
        {/* Meta */}
        <div className="tmpl-meta-row">
          <div className="tmpl-meta-group">
            <label className="tmpl-label">Passport Type *</label>
            {isEdit ? (
              <div className="tmpl-type-badge">{editingTemplate.passport_type}</div>
            ) : (
              <select className="tmpl-select" value={passportType}
                onChange={e => setPassportType(e.target.value)}>
                <option value="">— Select type —</option>
                {passportTypes.map(pt => (
                  <option key={pt.id} value={pt.type_name}>
                    {pt.display_name || pt.type_name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="tmpl-meta-group tmpl-meta-flex">
            <label className="tmpl-label">Template Name *</label>
            <input className="tmpl-input" type="text" value={name}
              placeholder="e.g. Model name or variant"
              onChange={e => setName(e.target.value)} />
          </div>
        </div>

        <div className="tmpl-meta-group" style={{ marginBottom: 16 }}>
          <label className="tmpl-label">Description (optional)</label>
          <input className="tmpl-input" type="text" value={description}
            placeholder="Short description of this model/variant"
            onChange={e => setDescription(e.target.value)} />
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Model data legend */}
        {passportType && sections && (
          <div className="tmpl-legend">
            <span className="tmpl-legend-icon">📌</span>
            Check <strong>Model data</strong> on fields that are the same for every passport of this model (e.g. manufacturer, vehicle type).
            These will be pre-filled and locked when creating a passport from this template.
          </div>
        )}

        {loadingFields && <div className="tmpl-loading">Loading fields…</div>}

        {/* Field sections */}
        {sections && sectionKeys.map(sk => {
          const sec = sections[sk];
          return (
            <div key={sk} className="tmpl-section">
              <div className="tmpl-section-title">{sec.label}</div>
              <div className="tmpl-fields-grid">
                {sec.fields.map(f => (
                  <TemplateField
                    key={f.key}
                    field={f}
                    value={fieldValues[f.key] ?? ""}
                    isModelData={modelDataKeys.has(f.key)}
                    onValueChange={val => setFieldValue(f.key, val)}
                    onModelDataToggle={on => toggleModelData(f.key, on)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {passportType && !sections && !loadingFields && (
          <div className="tmpl-loading">No field definitions found for this passport type.</div>
        )}
      </div>

      <div className="tmpl-editor-footer">
        <button className="tmpl-cancel-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="tmpl-save-btn" onClick={handleSave} disabled={saving || !passportType || !name.trim()}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Template"}
        </button>
      </div>
    </div>
  );
}

// ── Bulk create modal ──
function BulkCreateFromTemplateModal({ template, companyId, onClose, onDone }) {
  const [count,       setCount]       = useState("10");
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState("");
  const [results,     setResults]     = useState(null); // summary after done

  const handleCreate = async () => {
    const n = parseInt(count, 10);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setError("Enter a number between 1 and 500.");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      // Build the pre-fill data from model-data fields
      const prefill = {};
      for (const f of template.fields || []) {
        if (f.field_value) prefill[f.field_key] = f.field_value;
      }

      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          passport_type: template.passport_type,
          passports: Array.from({ length: n }, () => ({ ...prefill })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Bulk create failed");
      setResults(data.summary || { created: n });
    } catch (e) {
      setError(e.message || "Bulk create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        {results ? (
          <>
            <h3 className="dashboard-modal-title">Passports Created</h3>
            <div className="tmpl-bulk-summary">
              <div className="tmpl-bulk-stat tmpl-bulk-created">
                <span className="tmpl-bulk-num">{results.created ?? 0}</span>
                <span>created</span>
              </div>
              {results.skipped > 0 && (
                <div className="tmpl-bulk-stat tmpl-bulk-skipped">
                  <span className="tmpl-bulk-num">{results.skipped}</span>
                  <span>skipped</span>
                </div>
              )}
              {results.failed > 0 && (
                <div className="tmpl-bulk-stat tmpl-bulk-failed">
                  <span className="tmpl-bulk-num">{results.failed}</span>
                  <span>failed</span>
                </div>
              )}
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>
              Passports were created from template <strong>{template.name}</strong> with model data pre-filled.
              You can now open each draft to fill in the remaining fields.
            </p>
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-primary" onClick={() => onDone()}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="dashboard-modal-title">Bulk Create from Template</h3>
            <p className="dashboard-modal-subtitle">
              Create multiple draft passports pre-filled with data from <strong>{template.name}</strong>.
              Each passport will have the template's model data applied automatically.
            </p>
            <label className="device-manual-label">Number of Passports</label>
            <input
              type="number" min="1" max="500" step="1"
              value={count}
              onChange={e => setCount(e.target.value)}
              className="device-manual-input"
              disabled={submitting}
              autoFocus
            />
            <p className="bulk-create-note">Max 500 per request. Drafts can be edited and renamed after creation.</p>
            {error && <div className="dashboard-inline-error">{error}</div>}
            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
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

// ── Main templates page ──
export default function TemplatesPage({ user, companyId }) {
  const navigate = useNavigate();
  const [templates,     setTemplates]     = useState([]);
  const [passportTypes, setPassportTypes] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [view,          setView]          = useState("list"); // "list" | "create" | "edit"
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [search,        setSearch]        = useState("");
  const [filterType,    setFilterType]    = useState("all");
  const [deleting,      setDeleting]      = useState(null);
  const [bulkModal,     setBulkModal]     = useState(null); // template object with fields

  const fetchTemplates = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/templates`, { headers: authHeaders() });
      if (r.ok) setTemplates(await r.json());
    } catch {}
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  useEffect(() => {
    fetch(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setPassportTypes)
      .catch(() => {});
  }, [companyId]);

  const openEdit = async (tmpl) => {
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/templates/${tmpl.id}`, { headers: authHeaders() });
      if (r.ok) { setEditingTemplate(await r.json()); setView("edit"); }
    } catch {}
  };

  const openBulk = async (tmpl) => {
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/templates/${tmpl.id}`, { headers: authHeaders() });
      if (r.ok) setBulkModal(await r.json());
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this template? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await fetch(`${API}/api/companies/${companyId}/templates/${id}`, {
        method: "DELETE", headers: authHeaders(),
      });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch {}
    finally { setDeleting(null); }
  };

  const handleSaved = () => {
    setView("list");
    setEditingTemplate(null);
    fetchTemplates();
  };

  const handleCancel = () => {
    setView("list");
    setEditingTemplate(null);
  };

  // Group templates by passport type
  const allTypes = [...new Set(templates.map(t => t.passport_type))];

  const filtered = templates.filter(t => {
    const matchesSearch = search
      ? `${t.name} ${t.description || ""} ${t.passport_type}`.toLowerCase().includes(search.toLowerCase())
      : true;
    const matchesType = filterType === "all" || t.passport_type === filterType;
    return matchesSearch && matchesType;
  });

  const grouped = filtered.reduce((acc, t) => {
    if (!acc[t.passport_type]) acc[t.passport_type] = [];
    acc[t.passport_type].push(t);
    return acc;
  }, {});

  if (view === "create" || view === "edit") {
    return (
      <TemplateEditor
        companyId={companyId}
        passportTypes={passportTypes}
        editingTemplate={view === "edit" ? editingTemplate : null}
        onSave={handleSaved}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="tmpl-page">
      {/* Header */}
      <div className="tmpl-page-header">
        <div>
          <h2 className="tmpl-page-title">Passport Templates</h2>
          <p className="tmpl-page-subtitle">
            Create model-specific templates to speed up passport creation.
            Mark fields as <strong>model data</strong> to pre-fill and lock them on every new passport.
          </p>
        </div>
        <button className="tmpl-new-btn" onClick={() => setView("create")}>
          + New Template
        </button>
      </div>

      {/* Filters */}
      <div className="tmpl-filters">
        <input className="tmpl-search" type="text"
          placeholder="Search templates…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="tmpl-type-filters">
          <button
            className={`tmpl-type-btn${filterType === "all" ? " active" : ""}`}
            onClick={() => setFilterType("all")}>
            All
          </button>
          {allTypes.map(t => (
            <button key={t}
              className={`tmpl-type-btn${filterType === t ? " active" : ""}`}
              onClick={() => setFilterType(t)}>
              {passportTypes.find(pt => pt.type_name === t)?.display_name || t}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="tmpl-empty">Loading templates…</div>
      ) : filtered.length === 0 ? (
        <div className="tmpl-empty-state">
          <div style={{ fontSize: 44, marginBottom: 10 }}>📋</div>
          <h3>No templates yet</h3>
          <p>Create your first template to start pre-filling passport fields for a specific model.</p>
          <button className="tmpl-new-btn" style={{ marginTop: 8 }} onClick={() => setView("create")}>
            + Create your first template
          </button>
        </div>
      ) : (
        Object.entries(grouped).map(([pType, tmpls]) => {
          const typeLabel = passportTypes.find(pt => pt.type_name === pType)?.display_name || pType;
          return (
            <div key={pType} className="tmpl-group">
              <div className="tmpl-group-header">
                <span className="tmpl-group-type">{typeLabel}</span>
                <span className="tmpl-group-count">{tmpls.length} template{tmpls.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="tmpl-cards">
                {tmpls.map(t => (
                  <div key={t.id} className="tmpl-card">
                    <div className="tmpl-card-top">
                      <div className="tmpl-card-icon">📋</div>
                      <div className="tmpl-card-info">
                        <div className="tmpl-card-name">{t.name}</div>
                        {t.description && <div className="tmpl-card-desc">{t.description}</div>}
                      </div>
                    </div>

                    {parseInt(t.model_field_count) > 0 && (
                      <div className="tmpl-card-model-count">
                        📌 {t.model_field_count} model data field{t.model_field_count !== "1" ? "s" : ""}
                      </div>
                    )}

                    <div className="tmpl-card-actions">
                      <button
                        className="tmpl-action-btn tmpl-action-primary"
                        onClick={() => navigate(`/create/${pType}?templateId=${t.id}`)}
                        title="Create a single passport pre-filled from this template"
                      >
                        + Create passport
                      </button>
                      <button
                        className="tmpl-action-btn tmpl-action-bulk"
                        onClick={() => openBulk(t)}
                        title="Create multiple passports at once from this template"
                      >
                        ⚡ Bulk create
                      </button>
                    </div>
                    <div className="tmpl-card-actions tmpl-card-actions-row2">
                      <button className="tmpl-action-btn" onClick={() => openEdit(t)} title="Edit template">
                        ✏️ Edit
                      </button>
                      <button
                        className="tmpl-action-btn tmpl-action-delete"
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {bulkModal && (
        <BulkCreateFromTemplateModal
          template={bulkModal}
          companyId={companyId}
          onClose={() => setBulkModal(null)}
          onDone={() => { setBulkModal(null); fetchTemplates(); }}
        />
      )}
    </div>
  );
}
