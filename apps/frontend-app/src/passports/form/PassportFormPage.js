import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { PASSPORT_SECTIONS_MAP } from "../config/PassportFields";
import { authHeaders } from "../../shared/api/authHeaders";
import RepositoryPicker from "./components/RepositoryPicker";
import "../../assets/styles/CreatePass.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const EDIT_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const EDIT_HEARTBEAT_MS = 60 * 1000;
const AUTOSAVE_DEBOUNCE_MS = 2000;

function PassportForm({ token, user, companyId, mode = "create", passportType: typeProp }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { guid, passportType: typeParam } = useParams();

  const passportType = typeProp || typeParam ||
    new URLSearchParams(location.search).get("passportType");
  const templateId = new URLSearchParams(location.search).get("templateId");

  // Support both static PASSPORT_SECTIONS_MAP and dynamic type definitions from DB
  const [dynamicSections, setDynamicSections] = useState(null);
  const [loadingType,     setLoadingType]     = useState(false);

  const SECTIONS    = dynamicSections || PASSPORT_SECTIONS_MAP[passportType] || {};
  const sectionKeys = Object.keys(SECTIONS);

  const [expanded,       setExpanded]       = useState({});
  const [modelName,      setModelName]      = useState("");
  const [productId,      setProductId]      = useState("");
  const [formData,       setFormData]       = useState({});
  const [modelDataKeys,  setModelDataKeys]  = useState(new Set()); // fields locked from template
  const [templateName,   setTemplateName]   = useState("");
  const [fileSelections, setFileSelections] = useState({});
  const [uploadProgress, setUploadProgress] = useState({});
  const [repoPicker,     setRepoPicker]     = useState(null);  // field.key being picked, or null
  const [symbolPicker,   setSymbolPicker]   = useState(null);  // field.key being picked, or null
  const [symbols,        setSymbols]        = useState([]);
  const [isLoading,      setIsLoading]      = useState(mode === "edit");
  const [isSaving,       setIsSaving]       = useState(false);
  const [error,          setError]          = useState("");
  const [success,        setSuccess]        = useState("");
  const [displayName,    setDisplayName]    = useState("");
  const [activeEditors,  setActiveEditors]  = useState([]);
  const [autoSaveState,  setAutoSaveState]  = useState("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [lastSavedAt,    setLastSavedAt]    = useState(null);

  const lastInteractionRef = useRef(Date.now());
  const autoSaveTimerRef   = useRef(null);
  const dirtyRef           = useRef(false);
  const saveInFlightRef    = useRef(false);
  const sessionActiveRef   = useRef(false);
  const mountedRef         = useRef(true);

  const markDirty = () => {
    dirtyRef.current = true;
    if (mode === "edit") setAutoSaveState("pending");
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load symbols from company repository
  useEffect(() => {
    if (!companyId) return;
    fetch(`${API}/api/companies/${companyId}/repository/symbols`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setSymbols)
      .catch(() => {});
  }, [companyId]);

  // Load dynamic type definition from server if not in static map
  useEffect(() => {
    if (!passportType) return;
    if (PASSPORT_SECTIONS_MAP[passportType]) {
      setDynamicSections(null); // Use static map
      return;
    }
    // Try fetching from server
    setLoadingType(true);
    fetch(`${API}/api/passport-types/${passportType}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.fields_json?.sections) {
          // Convert server format to component format
          const sections = {};
          for (const section of data.fields_json.sections) {
            sections[section.key] = {
              label: section.label,
              fields: section.fields || [],
            };
          }
          setDynamicSections(sections);
          setDisplayName(data.display_name || passportType);
          // Expand first section by default
          if (data.fields_json.sections.length > 0) {
            setExpanded({ [data.fields_json.sections[0].key]: true });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingType(false));
  }, [passportType]);

  // Set first section expanded by default when sections load
  useEffect(() => {
    if (sectionKeys.length > 0 && Object.keys(expanded).length === 0) {
      setExpanded({ [sectionKeys[0]]: true });
    }
  }, [sectionKeys.join(",")]);

  // Load template pre-fill on create mode
  useEffect(() => {
    if (mode !== "create" || !templateId || !companyId) return;
    fetch(`${API}/api/companies/${companyId}/templates/${templateId}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(tmpl => {
        if (!tmpl) return;
        setTemplateName(tmpl.name || "");
        const vals = {};
        const modelKeys = new Set();
        for (const f of tmpl.fields || []) {
          if (f.field_value) vals[f.field_key] = f.field_value;
          if (f.is_model_data) modelKeys.add(f.field_key);
        }
        setFormData(vals);
        setModelDataKeys(modelKeys);
      })
      .catch(() => {});
  }, [mode, templateId, companyId]);

  useEffect(() => {
    if (mode !== "edit" || !guid || !passportType) return;
    (async () => {
      try {
        const r = await fetch(
          `${API}/api/companies/${companyId}/passports/${guid}?passportType=${passportType}`,
          { headers: authHeaders() }
        );
        if (!r.ok) throw new Error("Failed to load passport");
        const data = await r.json();
        setModelName(data.model_name || "");
        setProductId(data.product_id || "");
        setFormData(data);
        dirtyRef.current = false;
        setLastSavedAt(data.updated_at || null);
      } catch (e) { setError(e.message); }
      finally { setIsLoading(false); }
    })();
  }, [guid, mode, passportType, companyId, token]);

  const toggle      = (k)        => setExpanded(p => ({ ...p, [k]: !p[k] }));
  const handleField = (key, val) => {
    markDirty();
    setFormData(p => ({ ...p, [key]: val }));
  };

  const handleFile = (key, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Only PDF files allowed."); return; }
    if (file.size > 20 * 1024 * 1024)   { setError("Max file size is 20 MB."); return; }
    setError("");
    markDirty();
    setFileSelections(p => ({ ...p, [key]: file }));
  };

  const uploadFile = async (key, file, guidToUse) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("fieldKey", key); fd.append("passportType", passportType);
    setUploadProgress(p => ({ ...p, [key]: "uploading" }));
    const r = await fetch(
      `${API}/api/companies/${companyId}/passports/${guidToUse}/upload`,
      { method:"POST", headers: authHeaders(), body:fd }
    );
    if (!r.ok) throw new Error("Upload failed");
    const { url } = await r.json();
    setUploadProgress(p => ({ ...p, [key]: "done" }));
    return url;
  };

  const buildEditableBody = () => {
    const NON_SCHEMA = new Set([
      "id","guid","company_id","created_by","created_at","passport_type",
      "version_number","release_status","deleted_at","qr_code",
      "created_by_email","first_name","last_name","updated_by","updated_at",
      "model_name","product_id",  // handled explicitly below — must not be overridden by cleanData
    ]);
    const cleanData = Object.fromEntries(
      Object.entries(formData)
        .filter(([k]) => !NON_SCHEMA.has(k))
        .map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v])
    );
    return {
      passportType,
      model_name: modelName.trim() || null,
      product_id: productId.trim() || null,
      ...cleanData,
    };
  };

  const refreshEditPresence = async (method = "GET") => {
    if (mode !== "edit" || !guid || !passportType || !companyId) return;
    const init = method === "POST"
      ? {
          method,
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ passportType }),
        }
      : {
          method,
          headers: authHeaders(),
        };
    const r = await fetch(`${API}/api/companies/${companyId}/passports/${guid}/edit-session`, init);
    if (!r.ok) throw new Error("Failed to update edit presence");
    const data = await r.json();
    if (mountedRef.current) {
      setActiveEditors(Array.isArray(data.editors) ? data.editors : []);
    }
    sessionActiveRef.current = method === "DELETE" ? false : true;
    return data;
  };

  const releaseEditPresence = async () => {
    if (mode !== "edit" || !guid || !companyId || !sessionActiveRef.current) return;
    try {
      await fetch(`${API}/api/companies/${companyId}/passports/${guid}/edit-session`, {
        method: "DELETE",
        headers: authHeaders(),
      });
    } catch {}
    sessionActiveRef.current = false;
  };

  const saveEditChanges = async ({ showSuccessMessage = false } = {}) => {
    if (mode !== "edit" || !guid || !passportType || saveInFlightRef.current) return false;

    saveInFlightRef.current = true;
    if (mountedRef.current) setAutoSaveState("saving");

    try {
      const body = buildEditableBody();
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${guid}`, {
        method:"PATCH",
        headers: authHeaders({ "Content-Type":"application/json" }),
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update");
      }

      const uploadedKeys = [];
      for (const [key, file] of Object.entries(fileSelections)) {
        if (file) {
          await uploadFile(key, file, guid);
          uploadedKeys.push(key);
        }
      }
      if (uploadedKeys.length) {
        setFileSelections(prev => {
          const next = { ...prev };
          uploadedKeys.forEach((key) => delete next[key]);
          return next;
        });
      }

      dirtyRef.current = false;
      const nowIso = new Date().toISOString();
      if (mountedRef.current) {
        setLastSavedAt(nowIso);
        setAutoSaveState("saved");
        if (showSuccessMessage) {
          setSuccess("Changes saved automatically");
        }
      }
      return true;
    } catch (e) {
      if (mountedRef.current) {
        setError(e.message);
        setAutoSaveState("error");
      }
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (mode !== "edit" || !guid || !passportType || !companyId || isLoading) return;

    refreshEditPresence("POST").catch(() => {});

    const handleActivity = () => {
      lastInteractionRef.current = Date.now();
      if (sessionExpired) {
        setSessionExpired(false);
        refreshEditPresence("POST").catch(() => {});
      }
    };

    const heartbeat = setInterval(async () => {
      const inactiveFor = Date.now() - lastInteractionRef.current;
      if (inactiveFor >= EDIT_SESSION_TIMEOUT_MS) {
        if (dirtyRef.current) {
          await saveEditChanges();
        }
        await releaseEditPresence();
        if (mountedRef.current) {
          setSessionExpired(true);
          setActiveEditors([]);
          setSuccess("✓ Edit session ended after 12 hours of inactivity. Saved changes were kept.");
        }
        return;
      }
      refreshEditPresence("POST").catch(() => {});
    }, EDIT_HEARTBEAT_MS);

    window.addEventListener("pointerdown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("scroll", handleActivity, { passive: true });

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      releaseEditPresence();
    };
  }, [mode, guid, passportType, companyId, isLoading, sessionExpired]);

  useEffect(() => {
    if (mode !== "edit" || !guid || !passportType || isLoading || !dirtyRef.current) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveEditChanges();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autoSaveTimerRef.current);
  }, [mode, guid, passportType, companyId, modelName, productId, formData, fileSelections, isLoading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setIsSaving(true);

    try {
      let passportGuid = guid;
      const trimmedProductId = productId.trim();

      if (mode === "create") {
        if (!trimmedProductId) {
          throw new Error("Serial Number is required");
        }
        const serializedData = Object.fromEntries(
          Object.entries(formData).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v])
        );
        const body = {
          passport_type: passportType,
          model_name: modelName.trim() || null,
          product_id: trimmedProductId,
          ...serializedData,
        };
        const r = await fetch(`${API}/api/companies/${companyId}/passports`, {
          method:"POST", headers:authHeaders({"Content-Type":"application/json"}),
          body: JSON.stringify(body),
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed to create"); }
        const { passport } = await r.json();
        passportGuid = passport.guid;
      } else {
        const saved = await saveEditChanges({ showSuccessMessage: false });
        if (!saved) throw new Error("Failed to update");
      }

      if (mode === "create") {
        for (const [key, file] of Object.entries(fileSelections)) {
          if (file) await uploadFile(key, file, passportGuid);
        }
        setFileSelections({});
        window.scrollTo({ top: 0, behavior: "smooth" });
        setSuccess("Passport created successfully");
        setTimeout(() => setSuccess(""), 4000);
        setModelName("");
        setProductId("");
        setFormData({});
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setSuccess("Changes saved successfully");
        setTimeout(() => setSuccess(""), 4000);
      }
    } catch (e) {
      setError(e.message);
    } finally { setIsSaving(false); }
  };

  const renderField = (field) => {
    const val      = formData[field.key] ?? "";
    const isLocked = mode === "create" && modelDataKeys.has(field.key);
    const disabled = isSaving || (mode==="edit" && isLoading) || isLocked;

    if (field.type === "boolean") {
      return (
        <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
          <input type="checkbox" checked={!!val}
            onChange={e => handleField(field.key, e.target.checked)} disabled={disabled} />
          <span style={{ fontSize:14, color:"var(--text-primary)", fontFamily:"var(--font)" }}>{field.label}</span>
        </label>
      );
    }

    if (field.type === "file") {
      const linkedUrl  = typeof val === "string" && val.startsWith("http") ? val : null;
      const fileName   = linkedUrl ? linkedUrl.split("/").pop() : null;
      return (
        <div className="file-upload-widget">
          {linkedUrl ? (
            <div className="file-existing">
              <a href={linkedUrl} target="_blank" rel="noopener noreferrer" className="file-existing-link">
                📄 {decodeURIComponent(fileName || "Document")}
              </a>
              <button type="button" className="file-clear-btn" disabled={disabled}
                onClick={() => handleField(field.key, "")}>✕ Remove</button>
            </div>
          ) : (
            <button type="button" className="file-upload-label" disabled={disabled}
              onClick={() => setRepoPicker(field.key)}>
              <span className="file-placeholder">📁 Link PDF from Repository</span>
            </button>
          )}
          {linkedUrl && (
            <button type="button" className="file-upload-label file-replace-label" disabled={disabled}
              onClick={() => setRepoPicker(field.key)}>
              <span className="file-placeholder">↺ Change</span>
            </button>
          )}
          <div className="file-link-paste">
            <input
              type="text"
              className="file-link-input"
              placeholder="Or paste a repository link here…"
              disabled={disabled}
              value={linkedUrl && document.activeElement?.dataset?.fieldKey !== field.key ? "" : undefined}
              data-field-key={field.key}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (text.startsWith("http")) { e.preventDefault(); handleField(field.key, text); }
              }}
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text.startsWith("http")) { handleField(field.key, text); e.target.value = ""; }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const text = e.target.value.trim();
                  if (text.startsWith("http")) { handleField(field.key, text); e.target.value = ""; }
                }
              }}
            />
          </div>
        </div>
      );
    }

    if (field.type === "symbol") {
      const linkedUrl = typeof val === "string" && val.startsWith("http") ? val : null;
      const picked    = linkedUrl ? symbols.find(s => s.file_url === linkedUrl) : null;
      return (
        <div className="file-upload-widget">
          {linkedUrl ? (
            <div className="file-existing">
              <img src={linkedUrl} alt={picked?.name || "symbol"} className="pf-symbol-thumb" />
              <span className="file-existing-link">{picked?.name || "Symbol"}</span>
              <button type="button" className="file-clear-btn" disabled={disabled}
                onClick={() => handleField(field.key, "")}>✕ Remove</button>
            </div>
          ) : (
            <button type="button" className="file-upload-label" disabled={disabled}
              onClick={() => setSymbolPicker(field.key)}>
              <span className="file-placeholder">🔣 Link Symbol from Repository</span>
            </button>
          )}
          {linkedUrl && (
            <button type="button" className="file-upload-label file-replace-label" disabled={disabled}
              onClick={() => setSymbolPicker(field.key)}>
              <span className="file-placeholder">↺ Change</span>
            </button>
          )}
          <div className="file-link-paste">
            <input
              type="text"
              className="file-link-input"
              placeholder="Or paste a repository link here…"
              disabled={disabled}
              data-field-key={field.key}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (text.startsWith("http")) { e.preventDefault(); handleField(field.key, text); }
              }}
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text.startsWith("http")) { handleField(field.key, text); e.target.value = ""; }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const text = e.target.value.trim();
                  if (text.startsWith("http")) { handleField(field.key, text); e.target.value = ""; }
                }
              }}
            />
          </div>
        </div>
      );
    }

    if (field.type === "table") {
      const cols     = field.table_cols || 2;
      const colNames = field.table_columns?.length ? field.table_columns : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
      let parsed = val;
      if (typeof val === "string" && val.startsWith("[")) {
        try { parsed = JSON.parse(val); } catch { parsed = null; }
      }
      const defaultRows = Array.isArray(field.table_default_rows) && field.table_default_rows.length
        ? field.table_default_rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ""))
        : [Array(cols).fill("")];
      const rows = Array.isArray(parsed) && parsed.length ? parsed : defaultRows;

      const updateCell = (ri, ci, v) => {
        const next = rows.map(r => [...r]);
        next[ri][ci] = v;
        handleField(field.key, next);
      };
      const addRow    = () => handleField(field.key, [...rows, Array(cols).fill("")]);
      const removeRow = (ri) => {
        const next = rows.filter((_, i) => i !== ri);
        handleField(field.key, next.length ? next : [Array(cols).fill("")]);
      };

      return (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                {colNames.map((name, ci) => <th key={ci}>{name}</th>)}
                <th className="pf-table-action-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {Array(cols).fill(null).map((_, ci) => (
                    <td key={ci}>
                      <input
                        type="text"
                        value={row[ci] ?? ""}
                        disabled={disabled}
                        placeholder="—"
                        onChange={e => updateCell(ri, ci, e.target.value)}
                        className="pf-table-cell-input"
                      />
                    </td>
                  ))}
                  <td className="pf-table-action-col">
                    <button type="button" className="pf-table-remove-row" onClick={() => removeRow(ri)} disabled={disabled} title="Remove row">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="pf-table-add-row" onClick={addRow} disabled={disabled}>+ Add Row</button>
        </div>
      );
    }

    if (field.type === "textarea") {
      return <textarea value={val} disabled={disabled}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        onChange={e => handleField(field.key,e.target.value)} />;
    }

    if (field.type === "date") {
      // Store as YYYY-MM-DD (native date format); convert DD/MM/YYYY on load
      const toInput = (v) => {
        if (!v) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const [d, m, y] = v.split("/");
        return d && m && y ? `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}` : "";
      };
      const fromInput = (v) => v; // keep YYYY-MM-DD internally
      return (
        <div className="pf-date-wrap">
          <input
            type="date"
            value={toInput(val)}
            disabled={disabled}
            onChange={e => handleField(field.key, fromInput(e.target.value))}
            className="pf-date-input"
          />
          <span className="pf-date-hint">DD/MM/YYYY</span>
        </div>
      );
    }

    return <input type="text" value={val} disabled={disabled}
      placeholder={`Enter ${field.label.toLowerCase()}`}
      onChange={e => handleField(field.key,e.target.value)} />;
  };

  if (isLoading || loadingType) return (
    <div className="createpass-page">
      <div className="loading" style={{ padding:60 }}>Loading passport…</div>
    </div>
  );

  const typeLabel = displayName || (passportType
    ? passportType.charAt(0).toUpperCase() + passportType.slice(1)
    : "");

  return (
    <div className="createpass-page">
      <header className="createpass-header">
        <button className="back-btn" onClick={() => navigate(`/dashboard/passports/${passportType}`)}>
          ← Back
        </button>
        <h1>{mode==="create" ? "Create New" : "Edit"} {typeLabel} Passport</h1>
      </header>

      <main className="createpass-main">
        <div className="createpass-container">
          {mode === "edit" && (
            <div className="edit-session-banner">
              <div className="edit-session-copy">
                <strong>Edit session notice:</strong> this edit session ends automatically after 12 hours of inactivity, and saved changes are kept automatically.
              </div>
              <div className="edit-session-meta">
                {activeEditors.length > 0
                  ? `${activeEditors.map((editor) => editor.name).join(", ")} ${activeEditors.length === 1 ? "is" : "are"} editing now`
                  : "Only you are editing right now"}
                {autoSaveState === "saving" && <span className="edit-session-status">Saving…</span>}
                {autoSaveState === "saved" && lastSavedAt && <span className="edit-session-status">Saved automatically</span>}
                {sessionExpired && <span className="edit-session-status">Session expired after inactivity</span>}
              </div>
            </div>
          )}

          {/* Identity row */}
          <div className="passport-identity-row">
            <div className="passport-field-group">
              <label htmlFor="productId">Serial Number</label>
              <input id="productId" type="text" value={productId}
                className="passport-model-input"
                placeholder="Enter serial number"
                onChange={e => { markDirty(); setProductId(e.target.value); }} disabled={isSaving}
                required />
            </div>
            <div className="passport-field-group">
              <label htmlFor="modelName">Model Name</label>
              <input id="modelName" type="text" value={modelName}
                className="passport-model-input"
                placeholder="Enter model name (optional)"
                onChange={e => { markDirty(); setModelName(e.target.value); }} />
            </div>
            <div className="passport-field-group">
              <label>Passport Type</label>
              <div className="type-badge" style={{ padding:"11px 14px", display:"inline-block" }}>
                {typeLabel.toUpperCase()}
              </div>
            </div>
          </div>

          {templateName && (
            <div className="pf-template-banner">
              <span className="pf-template-banner-icon">📋</span>
              <span>
                Creating from template <strong>{templateName}</strong>.
                Fields marked <strong>📌 Model data</strong> are pre-filled and locked.
              </span>
            </div>
          )}
          {error   && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleSubmit} className="createpass-form">
            {sectionKeys.map(sk => {
              const section = SECTIONS[sk];
              return (
                <div key={sk} className="form-section">
                  <div className="section-header" onClick={() => toggle(sk)}>
                    <span className="section-title">{section.label}</span>
                    <span className={`toggle-icon${expanded[sk]?" expanded":""}`}>▼</span>
                  </div>
                  {expanded[sk] && (
                    <div className="section-content">
                      {sk==="compliance" && (
                        <p className="section-hint">
                          Upload official PDF documents. Stored securely and shown in the passport viewer.
                        </p>
                      )}
                      <div className="form-grid">
                        {section.fields.map(f => {
                          const isLocked = mode === "create" && modelDataKeys.has(f.key);
                          return (
                            <div key={f.key}
                              className={`form-group${f.type==="textarea"||f.type==="file"?" full-width":""}${isLocked?" form-group-locked":""}`}>
                              {f.type !== "boolean" && (
                                <label htmlFor={f.type==="file" ? `f-${f.key}` : f.key}>
                                  {f.label}
                                  {isLocked && <span className="pf-model-badge">📌 Model data</span>}
                                </label>
                              )}
                              {renderField(f)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="form-actions">
              <button type="button" className="cancel-btn"
                onClick={() => navigate(`/dashboard/passports/${passportType}`)} disabled={isSaving}>
                Cancel
              </button>
              <button type="submit" className="submit-btn" disabled={isSaving}>
                {isSaving ? "Saving…" : mode==="create" ? "Create Passport" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </main>

      <footer className="createpass-footer">
        <p>© 2024 Digital Product Passport System.</p>
      </footer>

      {/* ── Repository PDF Picker ── */}
      {repoPicker && (
        <RepositoryPicker
          token={token}
          companyId={companyId}
          onSelect={(url) => { handleField(repoPicker, url); setRepoPicker(null); }}
          onClose={() => setRepoPicker(null)}
        />
      )}

      {/* ── Symbol Picker ── */}
      {symbolPicker && (
        <div className="rp-overlay" onClick={e => e.target === e.currentTarget && setSymbolPicker(null)}>
          <div className="rp-modal">
            <div className="rp-modal-header">
              <h3>🔣 Pick a Symbol</h3>
              <button className="rp-close-btn" onClick={() => setSymbolPicker(null)}>✕</button>
            </div>
            <div className="pf-symbol-grid">
              {symbols.length === 0 ? (
                <div className="rp-empty">No symbols in repository yet.</div>
              ) : symbols.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`pf-symbol-item${formData[symbolPicker] === s.file_url ? " selected" : ""}`}
                  onClick={() => { handleField(symbolPicker, s.file_url); setSymbolPicker(null); }}
                >
                  <img src={s.file_url} alt={s.name} className="pf-symbol-grid-img" />
                  <span className="pf-symbol-name">{s.name}</span>
                  {s.category && <span className="pf-symbol-cat">{s.category}</span>}
                </button>
              ))}
            </div>
            <div className="rp-footer">
              <button className="rp-cancel-btn" onClick={() => setSymbolPicker(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PassportForm;
