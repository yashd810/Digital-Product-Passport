import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LANGUAGES } from "./i18n";
import { authHeaders } from "./authHeaders";
import "./AdminDashboard.css";

// Languages that need translation inputs (all except English, which is the base label)
const TRANS_LANGS = LANGUAGES.filter(l => l.code !== "en");

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Auto-generate a safe slug from any label
const toSlug = (str) =>
  str.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);

// Parse CSV text into [{fieldLabel, sectionLabel}] rows
// Column A = field label, Column B = section name
const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const rows = lines.map(line => {
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });

  // Skip header row if col A looks like a header keyword
  const HEADER_WORDS = /^(field|label|name|section|column|col|header)$/i;
  const start = HEADER_WORDS.test(rows[0]?.[0] || "") ? 1 : 0;

  return rows.slice(start)
    .filter(r => r[0])                        // skip blank rows
    .map(r => ({ fieldLabel: r[0], sectionLabel: r[1]?.trim() || "General" }));
};

// Build sections array from parsed CSV rows (preserves section order)
const buildSectionsFromCSV = (rows) => {
  const map = new Map();  // section label → [fields]
  for (const { fieldLabel, sectionLabel } of rows) {
    if (!map.has(sectionLabel)) map.set(sectionLabel, []);
    map.get(sectionLabel).push(fieldLabel);
  }
  return [...map.entries()].map(([sectionLabel, fieldLabels]) => ({
    _id:    Math.random().toString(36).slice(2),
    key:    toSlug(sectionLabel),
    label:  sectionLabel,
    fields: fieldLabels.map(label => ({
      _id:   Math.random().toString(36).slice(2),
      key:   toSlug(label),
      label,
      type:  "text",
    })),
  }));
};

// Generate a sample CSV template for download
const downloadTemplate = () => {
  const csv = [
    "Field Label,Section",
    "Manufacturer,General",
    "Model Number,General",
    "Serial Number,General",
    "Weight (kg),Technical Specifications",
    "Dimensions,Technical Specifications",
    "Material Composition,Technical Specifications",
    "Recycled Content (%),Sustainability",
    "Carbon Footprint,Sustainability",
    "Compliance Certificate,Compliance Documents",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "passport_type_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
};


const ACCESS_LEVELS = [
  { value: "public",              label: "Public" },
  { value: "notified_bodies",     label: "Notified Bodies" },
  { value: "market_surveillance", label: "Market Surveillance Authorities" },
  { value: "eu_commission",       label: "The EU Commission" },
  { value: "legitimate_interest", label: "Person with Legitimate Interest" },
];

const FIELD_TYPES = [
  { value: "text",     label: "Text (single line)" },
  { value: "textarea", label: "Text (multi-line)" },
  { value: "boolean",  label: "Yes / No" },
  { value: "file",     label: "File upload (PDF)" },
  { value: "table",    label: "Table (rows × columns)" },
  { value: "symbol",   label: "Symbol (from repository)" },
];

const ICON_PRESETS = ["📋","⚡","🧵","🏗️","🎮","🏢","📦","🔋","🌿","🛡️","🔬","⚙️","🌊","🔥","🌱"];

function newSection(label = "") {
  return {
    _id:       Math.random().toString(36).slice(2),
    key:       toSlug(label),
    label,
    label_i18n: {},
    fields:    [],
  };
}

function newField(label = "") {
  return {
    _id:       Math.random().toString(36).slice(2),
    key:       toSlug(label),
    label,
    label_i18n: {},
    type:      "text",
    access:    ["public"],
  };
}

function AdminCreatePassportType() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Meta fields ────────────────────────────────────────────
  const [displayName,    setDisplayName]    = useState("");
  const [umbrella,       setUmbrella]       = useState("");
  const [umbrellaIcon,   setUmbrellaIcon]   = useState("📋");
  const [typeName,       setTypeName]       = useState("");
  const [typeNameManual, setTypeNameManual] = useState(false);
  const cloneSourceTypeName = useRef(null); // tracks original type_name when cloning

  // ── Edit mode (patch existing type metadata) ───────────────
  const initialEditData = useRef(location.state?.editData || null);
  const editMode = !!initialEditData.current;
  const editTypeId = initialEditData.current?.id || null;

  // ── Section builder ────────────────────────────────────────
  const [sections, setSections] = useState([newSection("General")]);

  // ── UI state ───────────────────────────────────────────────
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [csvError, setCsvError] = useState("");
  const [invalidFields, setInvalidFields] = useState([]);  // section/field IDs with errors

  const hasInvalid = (id) => invalidFields.includes(id);

  // ── Draft / save progress (create mode only, not edit/clone) ──────────────
  const DRAFT_API = `${API}/api/admin/passport-type-draft`;
  const draftEnabled = !editMode && !location.state?.cloneData;
  const resumeDraftRequested = Boolean(location.state?.resumeDraft);
  const [draftSaved,  setDraftSaved]  = useState(false); // brief "saved" flash
  const autoSaveTimer = useRef(null);
  const errorAlertRef = useRef(null);
  const successAlertRef = useRef(null);

  useEffect(() => {
    if (!error || !errorAlertRef.current) return;
    errorAlertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  useEffect(() => {
    if (!success || !successAlertRef.current) return;
    successAlertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [success]);

  const applyDraft = (draft) => {
    setDisplayName(draft.displayName || "");
    setUmbrella(draft.umbrella || "");
    setUmbrellaIcon(draft.umbrellaIcon || "📋");
    setTypeName(draft.typeName || "");
    setTypeNameManual(draft.typeNameManual || false);
    const restored = (draft.sections || []).map(sec => ({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    if (restored.length > 0) setSections(restored);
  };

  // Load draft only when the user explicitly chooses to continue it
  useEffect(() => {
    if (!draftEnabled || !resumeDraftRequested) return;
    fetch(DRAFT_API, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(row => { if (row?.draft_json) applyDraft(row.draft_json); })
      .catch(() => {});
  }, [draftEnabled, resumeDraftRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft 1.5s after any change (create mode only)
  useEffect(() => {
    if (!draftEnabled) return;
    const hasContent = displayName.trim() || sections.some(s => s.label || s.fields.length > 0);
    if (!hasContent || !umbrella.trim()) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      fetch(DRAFT_API, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ draft_json: { displayName, umbrella, umbrellaIcon, typeName, typeNameManual, sections } }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [draftEnabled, displayName, umbrella, umbrellaIcon, typeName, typeNameManual, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraft = () => {
    if (!draftEnabled) return;
    if (!umbrella.trim()) {
      setError("Select a product category before saving a draft.");
      setInvalidFields(["umbrella"]);
      return;
    }
    setError("");
    fetch(DRAFT_API, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ draft_json: { displayName, umbrella, umbrellaIcon, typeName, typeNameManual, sections } }),
    })
      .then(r => r.ok ? (
        setSuccess("✅ Draft saved successfully!"),
        setDraftSaved(true),
        setTimeout(() => setDraftSaved(false), 2000)
      ) : null)
      .catch(() => {});
  };

  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    e.target.value = "";  // reset so same file can be re-selected
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setCsvError("Please select a .csv file."); return; }
    setCsvError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (rows.length === 0) { setCsvError("No valid rows found in CSV."); return; }
        const parsed = buildSectionsFromCSV(rows);
        if (parsed.length === 0) { setCsvError("Could not build sections from CSV."); return; }
        setSections(parsed);
      } catch {
        setCsvError("Failed to parse CSV. Check the file format.");
      }
    };
    reader.readAsText(file);
  };

  // Fetch umbrella categories from API
  const [umbrellaOptions, setUmbrellaOptions] = useState([]);
  useEffect(() => {
    fetch(`${API}/api/admin/umbrella-categories`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : [])
      .then(setUmbrellaOptions)
      .catch(() => {});
  }, []);

  // Pre-fill from edit data if navigated with state — read once from navigation state at mount
  useEffect(() => {
    const ed = initialEditData.current;
    if (!ed) return;
    setDisplayName(ed.display_name || "");
    setUmbrella(ed.umbrella_category || "");
    setUmbrellaIcon(ed.umbrella_icon || "📋");
    setTypeName(ed.type_name || "");
    setTypeNameManual(true); // lock type_name, it cannot change
    const editSections = (ed.fields_json?.sections || []).map(sec => ({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    if (editSections.length > 0) setSections(editSections);
  }, []); // runs once

  // Pre-fill from clone data if navigated with state — read once from navigation state at mount
  const initialCloneData = useRef(location.state?.cloneData || null);
  useEffect(() => {
    const cd = initialCloneData.current;
    if (!cd) return;
    cloneSourceTypeName.current = cd.type_name;
    setDisplayName(`Clone of ${cd.display_name || cd.type_name}`);
    setUmbrella(cd.umbrella_category || "");
    setUmbrellaIcon(cd.umbrella_icon || "📋");
    const clonedSections = (cd.fields_json?.sections || []).map(sec => ({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    if (clonedSections.length > 0) setSections(clonedSections);
  }, []); // runs once — initial clone data captured in ref above

  // Auto-generate type_name from display_name unless user has manually overridden it
  useEffect(() => {
    if (!typeNameManual) {
      setTypeName(toSlug(displayName));
    }
  }, [displayName, typeNameManual]);

  // ── Section helpers ────────────────────────────────────────
  const addSection = () =>
    setSections(s => [...s, newSection("")]);

  const removeSection = (id) =>
    setSections(s => s.filter(sec => sec._id !== id));

  const updateSection = (id, patch) =>
    setSections(s => s.map(sec => {
      if (sec._id !== id) return sec;
      const updated = { ...sec, ...patch };
      if ("label" in patch && !sec._keyManual) {
        updated.key = toSlug(patch.label);
      }
      return updated;
    }));

  const setSectionKeyManual = (id) =>
    setSections(s => s.map(sec =>
      sec._id === id ? { ...sec, _keyManual: true } : sec
    ));

  // ── Field helpers ──────────────────────────────────────────
  const addField = (sectionId) =>
    setSections(s => s.map(sec =>
      sec._id === sectionId
        ? { ...sec, fields: [...sec.fields, newField("")] }
        : sec
    ));

  const removeField = (sectionId, fieldId) =>
    setSections(s => s.map(sec =>
      sec._id === sectionId
        ? { ...sec, fields: sec.fields.filter(f => f._id !== fieldId) }
        : sec
    ));

  const updateField = (sectionId, fieldId, patch) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          const updated = { ...f, ...patch };
          if ("label" in patch && !f._keyManual) {
            updated.key = toSlug(patch.label);
          }
          // Switching TO table: set defaults
          if (patch.type === "table" && f.type !== "table") {
            updated.table_rows = 2;
            updated.table_cols = 2;
            updated.table_columns = ["Column 1", "Column 2"];
          }
          // Switching AWAY from table: clear config
          if ("type" in patch && patch.type !== "table") {
            delete updated.table_rows;
            delete updated.table_cols;
            delete updated.table_columns;
          }
          // Cols count changed: resize column names array
          if ("table_cols" in patch) {
            const n = Math.max(1, parseInt(patch.table_cols) || 1);
            const existing = f.table_columns || [];
            updated.table_columns = Array.from({ length: n }, (_, i) => existing[i] || `Column ${i + 1}`);
            updated.table_cols = n;
          }
          return updated;
        }),
      };
    }));

  const setFieldKeyManual = (sectionId, fieldId) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f =>
          f._id === fieldId ? { ...f, _keyManual: true } : f
        ),
      };
    }));

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setInvalidFields([]);

    if (!displayName.trim()) {
      setInvalidFields(["displayName"]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Display name is required.");
    }
    if (!umbrella.trim()) {
      setInvalidFields(["umbrella"]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Umbrella category is required.");
    }
    if (!editMode) {
      if (!typeName.trim()) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name (slug) is required.");
      }
      if (!/^[a-z][a-z0-9_]{1,29}$/.test(typeName)) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name must be lowercase letters/numbers/underscores, 2–30 chars, starting with a letter.");
      }
    }

    const cleanSections = sections.map(sec => {
      const cleanSec = {
        key:    sec.key,
        label:  sec.label,
        fields: sec.fields.map(f => {
          const base = {
            key:    f.key,
            label:  f.label,
            type:   f.type,
            access: f.access && f.access.length > 0 ? f.access : ["public"],
          };
          // Preserve non-empty label translations
          const fi18n = Object.fromEntries(
            Object.entries(f.label_i18n || {}).filter(([, v]) => v?.trim())
          );
          if (Object.keys(fi18n).length > 0) base.label_i18n = fi18n;
          if (f.type === "table") {
            base.table_rows    = f.table_rows    || 2;
            base.table_cols    = f.table_cols    || 2;
            base.table_columns = f.table_columns || ["Column 1", "Column 2"];
          }
          if (f.dynamic)     base.dynamic     = true;
          if (f.composition) base.composition = true;
          if (f.semanticId)  base.semanticId  = f.semanticId;
          return base;
        }),
      };
      // Preserve non-empty section label translations
      const si18n = Object.fromEntries(
        Object.entries(sec.label_i18n || {}).filter(([, v]) => v?.trim())
      );
      if (Object.keys(si18n).length > 0) cleanSec.label_i18n = si18n;
      return cleanSec;
    });

    const invalidSection = cleanSections.find(s => !s.key || !s.label);
    if (invalidSection) {
      setInvalidFields([invalidSection._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All sections must have a key and a name.");
    }

    const invalidField = cleanSections
      .flatMap(s => s.fields.map(f => ({ sectionId: s._id, field: f })))
      .find(x => !x.field.key || !x.field.label);
    if (invalidField) {
      setInvalidFields([invalidField.field._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All fields must have a key and a name.");
    }

    const emptySection = cleanSections.find(s => s.fields.length === 0);
    if (emptySection) {
      setInvalidFields([emptySection._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Each section must have at least one field.");
    }

    // Check for duplicate keys within sections
    const allFieldKeys = cleanSections.flatMap(s => s.fields.map(f => f.key));
    const dupes = allFieldKeys.filter((k, i) => allFieldKeys.indexOf(k) !== i);
    if (dupes.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Duplicate field keys found: ${[...new Set(dupes)].join(", ")}. Each field key must be unique across all sections.`);
    }

    // Clone guard: type_name must differ from the original
    if (cloneSourceTypeName.current && typeName === cloneSourceTypeName.current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Type name "${typeName}" is the same as the original. Change the display name or type name to save as a new type.`);
    }

    try {
      setSaving(true);
      const url    = editMode
        ? `${API}/api/admin/passport-types/${editTypeId}`
        : `${API}/api/admin/passport-types`;
      const method = editMode ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          type_name:         typeName,
          display_name:      displayName,
          umbrella_category: umbrella,
          umbrella_icon:     umbrellaIcon,
          sections:          cleanSections,
        }),
      });

      const data = await r.json();
      if (!r.ok) throw new Error(data.error || (editMode ? "Failed to update passport type" : "Failed to create passport type"));

      setSuccess(editMode ? "✅ Passport type updated successfully!" : "✅ Passport type created successfully!");
      if (draftEnabled) fetch(DRAFT_API, { method: "DELETE", headers: authHeaders() }).catch(() => {});
      setError("");
      setInvalidFields([]);
      if (!editMode) {
        setDisplayName("");
        setUmbrella("");
        setUmbrellaIcon("📋");
        setTypeName("");
        setTypeNameManual(false);
        setSections([newSection("General")]);
      }
    } catch (e) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acpt-page">
      <div className="acpt-header">
        <button className="back-btn" onClick={() => navigate("/admin/passport-types")}>
          ← Back
        </button>
        <div>
          <h2>{editMode ? "✏️ Edit Passport Type Metadata" : "📋 Create New Passport Type"}</h2>
          <p className="acpt-header-note">
            {editMode
              ? "Update display name, flags (dynamic/composition), and access settings. The type name and DB schema cannot change."
              : "Once created and in use, a type cannot be edited. Create a new type for any changes."}
          </p>
        </div>
      </div>

      {editMode && (
        <div className="alert admin-alert-draft-success">
          ✏️ Editing metadata for: <strong>{initialEditData.current?.display_name}</strong> — the type name is locked and cannot change.
        </div>
      )}
      {location.state?.cloneData && (
        <div className="alert admin-alert-draft-info">
          🔁 Cloning from: <strong>{location.state.cloneData.display_name}</strong> — change the display name and/or type name before saving.
        </div>
      )}
      {success && <div ref={successAlertRef} className="alert alert-success admin-alert-bottom admin-alert-compact">{success}</div>}
      {error && <div ref={errorAlertRef} className="alert alert-error admin-alert-bottom admin-alert-compact">{error}</div>}

      <form onSubmit={handleSubmit} className="acpt-form">

        {/* ── Meta card ── */}
        <div className="acpt-card">
          <h3 className="acpt-card-title">Type Identity</h3>

          <div className="acpt-meta-grid">
            {/* Display Name */}
            <div className="acpt-field-group acpt-span2">
              <label>Display Name *</label>
              <input
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setError(""); setInvalidFields([]); }}
                placeholder="e.g. EV Battery Passport"
                className={`acpt-input${hasInvalid("displayName") ? " acpt-input-error" : ""}`}
                required
              />
              <span className="acpt-hint">Shown to companies in their dashboard sidebar</span>
            </div>

            {/* Umbrella Category */}
            <div className="acpt-field-group acpt-span2">
              <label>Umbrella Category *</label>
              {umbrellaOptions.length === 0 ? (
                <div className="acpt-hint acpt-hint-error">
                  No umbrella categories yet.{" "}
                  <a href="/admin/passport-types" className="acpt-hint-link">
                    Go back and add one first.
                  </a>
                </div>
              ) : (
                <select
                  value={umbrella}
                  onChange={e => {
                    const selected = umbrellaOptions.find(o => o.name === e.target.value);
                    setUmbrella(e.target.value);
                    setError("");
                    setInvalidFields([]);
                    if (selected) setUmbrellaIcon(selected.icon);
                  }}
                  className={`acpt-input${hasInvalid("umbrella") ? " acpt-input-error" : ""}`}
                  required
                >
                  <option value="">— Select a category —</option>
                  {umbrellaOptions.map(o => (
                    <option key={o.id} value={o.name}>{o.icon} {o.name}</option>
                  ))}
                </select>
              )}
              <span className="acpt-hint">Group label for analytics and sidebar hierarchy. Manage categories in the Passport Types page.</span>
            </div>

            {/* Umbrella Icon */}
            <div className="acpt-field-group">
              <label>Category Icon</label>
              <div className="acpt-icon-row">
                <input
                  type="text"
                  value={umbrellaIcon}
                  onChange={e => setUmbrellaIcon(e.target.value)}
                  className="acpt-input acpt-icon-input"
                  maxLength={4}
                />
                <div className="acpt-icon-presets">
                  {ICON_PRESETS.map(ic => (
                    <button key={ic} type="button"
                      className={`acpt-icon-btn ${umbrellaIcon === ic ? "selected" : ""}`}
                      onClick={() => setUmbrellaIcon(ic)}>{ic}</button>
                  ))}
                </div>
              </div>
              <span className="acpt-hint">Emoji shown in the sidebar next to category name</span>
            </div>

            {/* Type Name (slug) */}
            <div className="acpt-field-group">
              <label>Internal Type Name (slug) *</label>
              <input
                type="text"
                value={typeName}
                onChange={e => { if (!editMode) { setTypeName(e.target.value.toLowerCase()); setTypeNameManual(true); } }}
                placeholder="e.g. ev_battery"
                readOnly={editMode}
                className={`acpt-input acpt-mono${editMode ? " acpt-input-locked" : ""}${(!editMode && (!/^[a-z][a-z0-9_]{1,29}$/.test(typeName) && typeName)) || hasInvalid("typeName") ? " acpt-input-error" : ""}`}
                pattern={editMode ? undefined : "^[a-z][a-z0-9_]{1,29}$"}
              />
              <span className="acpt-hint">
                {editMode
                  ? "Type name is locked — it maps to database tables and cannot change."
                  : "Used in database table names. Auto-generated from display name. Must be 2–30 chars: lowercase letters, numbers, underscores."}
              </span>
              {!editMode && (
                <div className="acpt-table-preview">
                  Table will be: <code>{typeName || "…"}_passports</code>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Field Builder ── */}
        <div className="acpt-card">
          <div className="acpt-builder-header">
            <div>
              <h3 className="acpt-card-title">Field Builder</h3>
              <p className="acpt-builder-hint">
                Organise fields into sections. Sections become tabs in the passport viewer.
              </p>
            </div>
            <div className="acpt-csv-actions">
              <button type="button" className="acpt-csv-template-btn" onClick={downloadTemplate}
                title="Download a sample CSV to use as a starting point">
                ⬇ Template CSV
              </button>
              <label className="acpt-csv-import-btn" title="Import fields from a CSV file">
                📥 Import CSV
                <input type="file" accept=".csv" className="admin-hidden-input" onChange={handleCSVImport} />
              </label>
            </div>
          </div>
          {csvError && (
            <div className="alert alert-error admin-alert-inline-wide">{csvError}</div>
          )}
          <div className="acpt-csv-hint">
            CSV format: <strong>Column A</strong> = field label &nbsp;|&nbsp; <strong>Column B</strong> = section name.
            Importing replaces the current field builder.
          </div>

          {sections.map((section, si) => (
            <div key={section._id} className="acpt-section">
              <div className="acpt-section-head">
                <div className="acpt-section-meta">
                  <span className="acpt-section-num">Section {si + 1}</span>
                  <div className="acpt-section-name-row">
                    <input
                      type="text"
                      value={section.label}
                      onChange={e => { updateSection(section._id, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                      placeholder="Section name, e.g. General"
                      className={`acpt-section-name-input${hasInvalid(section._id) ? " acpt-input-error" : ""}`}
                    />
                    <div className="acpt-section-key-row">
                      <span className="acpt-key-label">key:</span>
                      <input
                        type="text"
                        value={section.key}
                        onChange={e => { updateSection(section._id, { key: e.target.value.toLowerCase() }); setSectionKeyManual(section._id); }}
                        className="acpt-key-input acpt-mono"
                        placeholder="section_key"
                      />
                    </div>
                    <button
                      type="button"
                      className={`acpt-i18n-toggle${section._i18nOpen ? " open" : ""}`}
                      onClick={() => updateSection(section._id, { _i18nOpen: !section._i18nOpen })}
                      title="Add translations for this section name"
                    >
                      🌐
                    </button>
                  </div>
                  {section._i18nOpen && (
                    <div className="acpt-i18n-panel">
                      {TRANS_LANGS.map(l => (
                        <div key={l.code} className="acpt-i18n-row">
                          <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                          <input
                            type="text"
                            value={(section.label_i18n || {})[l.code] || ""}
                            onChange={e => updateSection(section._id, {
                              label_i18n: { ...(section.label_i18n || {}), [l.code]: e.target.value },
                            })}
                            placeholder={`"${section.label || "Section"}" in ${l.name}`}
                            className="acpt-i18n-input"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {sections.length > 1 && (
                  <button type="button" className="acpt-remove-btn"
                    onClick={() => removeSection(section._id)} title="Remove section">✕</button>
                )}
              </div>

              {/* Fields */}
              <div className="acpt-fields">
                {section.fields.length === 0 && (
                  <div className="acpt-fields-empty">No fields yet — add one below</div>
                )}
                {section.fields.map((field, fi) => (
                  <div key={field._id} className="acpt-field-wrap">
                    <div className="acpt-field-row">
                      <span className="acpt-field-num">{fi + 1}</span>

                      <div className="acpt-field-inputs">
                        <input
                          type="text"
                          value={field.label}
                          onChange={e => { updateField(section._id, field._id, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                          placeholder="Field label, e.g. Manufacturer"
                          className={`acpt-input acpt-field-label-input${hasInvalid(field._id) ? " acpt-input-error" : ""}`}
                        />
                        <div className="acpt-field-key-row">
                          <span className="acpt-key-label">key:</span>
                          <input
                            type="text"
                            value={field.key}
                            onChange={e => { updateField(section._id, field._id, { key: e.target.value.toLowerCase() }); setFieldKeyManual(section._id, field._id); setError(""); setInvalidFields([]); }}
                            className={`acpt-key-input acpt-mono${hasInvalid(field._id) ? " acpt-input-error" : ""}`}
                            placeholder="field_key"
                          />
                          <button
                            type="button"
                            className={`acpt-i18n-toggle${field._i18nOpen ? " open" : ""}`}
                            onClick={() => updateField(section._id, field._id, { _i18nOpen: !field._i18nOpen })}
                            title="Add translations for this field label"
                          >
                            🌐
                          </button>
                        </div>
                        {field._i18nOpen && (
                          <div className="acpt-i18n-panel acpt-i18n-panel-field">
                            {TRANS_LANGS.map(l => (
                              <div key={l.code} className="acpt-i18n-row">
                                <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                                <input
                                  type="text"
                                  value={(field.label_i18n || {})[l.code] || ""}
                                  onChange={e => updateField(section._id, field._id, {
                                    label_i18n: { ...(field.label_i18n || {}), [l.code]: e.target.value },
                                  })}
                                  placeholder={`"${field.label || "Field"}" in ${l.name}`}
                                  className="acpt-i18n-input"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <select
                        value={field.type}
                        onChange={e => updateField(section._id, field._id, { type: e.target.value })}
                        className="acpt-type-select"
                      >
                        {FIELD_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>

                      <button type="button" className="acpt-remove-btn"
                        onClick={() => removeField(section._id, field._id)} title="Remove field">✕</button>
                    </div>

                    {/* ── Access level config (applies to all field types) ── */}
                    <div className="acpt-field-access">
                      <span className="acpt-access-label">🔒 Access:</span>
                      {ACCESS_LEVELS.map(level => {
                        const currentAccess = field.access || ["public"];
                        const isPublicChecked = currentAccess.includes("public");
                        const isChecked  = currentAccess.includes(level.value);
                        // Non-public options are greyed out when Public is checked
                        const isDisabled = level.value !== "public" && isPublicChecked;
                        return (
                          <label key={level.value} className={`acpt-access-check${isDisabled ? " acpt-access-disabled" : ""}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isDisabled}
                              onChange={e => {
                                if (level.value === "public") {
                                  // Checking Public → clear all others and set ["public"]
                                  // Unchecking Public → set [] (user must pick restricted groups)
                                  updateField(section._id, field._id, {
                                    access: e.target.checked ? ["public"] : [],
                                  });
                                } else {
                                  // Toggle this restricted group in/out of the access array
                                  const next = e.target.checked
                                    ? [...currentAccess.filter(a => a !== "public"), level.value]
                                    : currentAccess.filter(a => a !== level.value);
                                  updateField(section._id, field._id, { access: next });
                                }
                              }}
                            />
                            <span>{level.label}</span>
                          </label>
                        );
                      })}
                    </div>

                    {/* ── Composition toggle — for text/textarea/table containing material % ── */}
                    {["text", "textarea", "table"].includes(field.type) && (
                      <div className="acpt-field-composition">
                        <label className="acpt-composition-toggle">
                          <input
                            type="checkbox"
                            checked={!!field.composition}
                            onChange={e => updateField(section._id, field._id, { composition: e.target.checked })}
                          />
                          <span className="acpt-composition-label">
                            Composition (pie chart)
                            <span className="acpt-composition-hint">
                              Field contains material percentages. A pie chart will be shown automatically in the public passport view.
                              {field.type === "table" ? " Use first column for material name, second for percentage." : " Format: \"Steel: 60%, Aluminium: 25%\" or one entry per line."}
                            </span>
                          </span>
                        </label>
                      </div>
                    )}

                    {/* ── AAS Semantic ID — optional, for machine-readable export ── */}
                    <div className="acpt-field-semantic">
                      <label className="acpt-semantic-label">
                        🔗 AAS Semantic ID
                        <span className="acpt-semantic-hint">
                          Optional IRI that links this field to a global standard definition (ECLASS, IEC CDD, IDTA).
                          Used when exporting to Asset Administration Shell (AAS) format.
                          Example: <code>0173-1#02-AAO677#002</code>
                        </span>
                      </label>
                      <input
                        type="text"
                        value={field.semanticId || ""}
                        onChange={e => updateField(section._id, field._id, { semanticId: e.target.value })}
                        placeholder="e.g. 0173-1#02-AAO677#002 or https://admin-shell.io/..."
                        className="acpt-input acpt-mono acpt-input-small"
                      />
                    </div>

                    {/* ── Dynamic (live data) toggle — only for scalar types ── */}
                    {["text", "textarea", "boolean"].includes(field.type) && (
                      <div className="acpt-field-dynamic">
                        <label className="acpt-dynamic-toggle">
                          <input
                            type="checkbox"
                            checked={!!field.dynamic}
                            onChange={e => updateField(section._id, field._id, { dynamic: e.target.checked })}
                          />
                          <span className="acpt-dynamic-label">
                            Dynamic (live data)
                            <span className="acpt-dynamic-hint">
                              Value is pushed by a connected device and updates automatically. Cannot be edited manually once the passport is released.
                            </span>
                          </span>
                        </label>
                      </div>
                    )}

                    {field.type === "table" && (
                      <div className="acpt-table-config">
                        <div className="acpt-table-dims">
                          <label>Rows</label>
                          <input
                            type="number" min="1" max="20"
                            value={field.table_rows || 2}
                            onChange={e => updateField(section._id, field._id, { table_rows: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="acpt-table-num-input"
                          />
                          <label>Columns</label>
                          <input
                            type="number" min="1" max="10"
                            value={field.table_cols || 2}
                            onChange={e => updateField(section._id, field._id, { table_cols: parseInt(e.target.value) || 1 })}
                            className="acpt-table-num-input"
                          />
                        </div>
                        <div className="acpt-table-colnames">
                          <span className="acpt-table-colnames-label">Column names:</span>
                          {(field.table_columns || []).map((col, ci) => (
                            <input
                              key={ci}
                              type="text"
                              value={col}
                              placeholder={`Column ${ci + 1}`}
                              className="acpt-table-col-input"
                              onChange={e => {
                                const cols = [...(field.table_columns || [])];
                                cols[ci] = e.target.value;
                                updateField(section._id, field._id, { table_columns: cols });
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <button type="button" className="acpt-add-field-btn"
                  onClick={() => addField(section._id)}>
                  + Add Field
                </button>
              </div>
            </div>
          ))}

          <button type="button" className="acpt-add-section-btn" onClick={addSection}>
            + Add Section
          </button>
        </div>

        {/* ── Preview ── */}
        <div className="acpt-card acpt-preview-card">
          <h3 className="acpt-card-title">Preview</h3>
          <div className="acpt-preview">
            <div className="acpt-preview-header">
              <span className="acpt-preview-icon">{umbrellaIcon}</span>
              <div>
                <div className="acpt-preview-umbrella">{umbrella || "Umbrella Category"}</div>
                <div className="acpt-preview-indent">└── {displayName || "Type Display Name"}</div>
              </div>
            </div>
            <div className="acpt-preview-tabs">
              {sections.map(s => (
                <span key={s._id} className="acpt-preview-tab">
                  {s.label || "Section"}
                </span>
              ))}
            </div>
            <div className="acpt-preview-fields">
              {sections.map(s =>
                s.fields.slice(0, 3).map(f => (
                  <div key={f._id} className="acpt-preview-field">
                    <span className="acpt-preview-field-label">{f.label || "Field"}</span>
                    <span className="acpt-preview-field-type">{f.type}</span>
                  </div>
                ))
              )}
              {sections.reduce((n, s) => n + s.fields.length, 0) > 9 && (
                <div className="acpt-preview-more">
                  +{sections.reduce((n, s) => n + s.fields.length, 0) - 9} more fields…
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="acpt-actions">
          <button type="button" className="cancel-btn"
            onClick={() => navigate("/admin/passport-types")} disabled={saving}>
            Cancel
          </button>
          {draftEnabled && (
            <button type="button" className="acpt-save-draft-btn" onClick={saveDraft} disabled={saving}>
              {draftSaved ? "✓ Draft Saved" : "Save Draft"}
            </button>
          )}
          <button type="submit" className="submit-btn" disabled={saving}>
            {saving ? (editMode ? "Saving…" : "Creating…") : (editMode ? "Save Changes" : "Create Passport Type")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AdminCreatePassportType;
