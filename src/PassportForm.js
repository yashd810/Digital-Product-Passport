import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { PASSPORT_SECTIONS_MAP } from "./PassportFields";
import { authHeaders } from "./authHeaders";
import "./CreatePass.css";

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

  // Support both static PASSPORT_SECTIONS_MAP and dynamic type definitions from DB
  const [dynamicSections, setDynamicSections] = useState(null);
  const [loadingType,     setLoadingType]     = useState(false);

  const SECTIONS    = dynamicSections || PASSPORT_SECTIONS_MAP[passportType] || {};
  const sectionKeys = Object.keys(SECTIONS);

  const [expanded,       setExpanded]       = useState({});
  const [modelName,      setModelName]      = useState("");
  const [productId,      setProductId]      = useState("");
  const [formData,       setFormData]       = useState({});
  const [fileSelections, setFileSelections] = useState({});
  const [uploadProgress, setUploadProgress] = useState({});
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
    ]);
    const cleanData = Object.fromEntries(
      Object.entries(formData).filter(([k]) => !NON_SCHEMA.has(k))
    );
    return { passportType, product_id: productId || null, ...cleanData };
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

  const saveEditChanges = async ({ navigateAfterSave = false, showSuccessMessage = false } = {}) => {
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
          setSuccess(navigateAfterSave ? "✓ Changes saved! Redirecting…" : "✓ Changes saved automatically");
        }
      }
      if (navigateAfterSave) {
        setTimeout(() => navigate(`/dashboard/passports/${passportType}`), 2000);
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
  }, [mode, guid, passportType, companyId, productId, formData, fileSelections, isLoading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setIsSaving(true);

    try {
      let passportGuid = guid;

      if (mode === "create") {
        const body = {
          passport_type: passportType, model_name: modelName,
          product_id: productId || null, ...formData,
        };
        const r = await fetch(`${API}/api/companies/${companyId}/passports`, {
          method:"POST", headers:authHeaders({"Content-Type":"application/json"}),
          body: JSON.stringify(body),
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed to create"); }
        const { passport } = await r.json();
        passportGuid = passport.guid;
      } else {
        const saved = await saveEditChanges({ navigateAfterSave: true, showSuccessMessage: true });
        if (!saved) throw new Error("Failed to update");
      }

      if (mode === "create") {
        for (const [key, file] of Object.entries(fileSelections)) {
          if (file) await uploadFile(key, file, passportGuid);
        }
        setFileSelections({});
        // For create mode: scroll up and show success message, don't navigate
        window.scrollTo({ top: 0, behavior: "smooth" });
        setSuccess("✓ Passport created successfully");
        setTimeout(() => setSuccess(""), 4000);
        // Reset form
        setModelName("");
        setProductId("");
        setFormData({});
      } else {
        // For edit mode: show success and navigate after 2 seconds
        setSuccess("✓ Changes saved! Redirecting…");
        setTimeout(() => navigate(`/dashboard/passports/${passportType}`), 2000);
      }
    } catch (e) {
      setError(e.message);
    } finally { setIsSaving(false); }
  };

  const renderField = (field) => {
    const val      = formData[field.key] ?? "";
    const disabled = isSaving || (mode==="edit" && isLoading);

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
      const existingUrl = typeof val==="string" && val.startsWith("http") ? val : null;
      const selectedFile= fileSelections[field.key];
      const progress    = uploadProgress[field.key];
      return (
        <div className="file-upload-widget">
          {existingUrl && !selectedFile && (
            <div className="file-existing">
              <a href={existingUrl} target="_blank" rel="noopener noreferrer" className="file-existing-link">
                📄 {`${modelName}_${field.key}`}
              </a>
              <button type="button" className="file-clear-btn"
                onClick={() => handleField(field.key,"")}>✕ Remove</button>
            </div>
          )}
          {(!existingUrl || selectedFile) && (
            <>
              <label className="file-upload-label" htmlFor={`f-${field.key}`}>
                {selectedFile
                  ? <span className="file-selected">📄 {selectedFile.name}
                      <span className="file-size"> ({(selectedFile.size/1024/1024).toFixed(2)} MB)</span>
                    </span>
                  : <span className="file-placeholder">⬆ Upload PDF — {field.label}</span>}
              </label>
              <input id={`f-${field.key}`} type="file" accept="application/pdf"
                className="file-input-hidden"
                onChange={e => handleFile(field.key, e.target.files[0])} disabled={disabled} />
              {selectedFile && (
                <button type="button" className="file-clear-btn"
                  onClick={() => setFileSelections(p=>({...p,[field.key]:null}))}>✕ Remove</button>
              )}
            </>
          )}
          {existingUrl && !selectedFile && (
            <>
              <label className="file-upload-label file-replace-label" htmlFor={`f-replace-${field.key}`}>
                <span className="file-placeholder">↺ Replace PDF</span>
              </label>
              <input id={`f-replace-${field.key}`} type="file" accept="application/pdf"
                className="file-input-hidden"
                onChange={e => handleFile(field.key,e.target.files[0])} disabled={disabled} />
            </>
          )}
          {progress==="uploading" && <span className="upload-status uploading">Uploading…</span>}
          {progress==="done"      && <span className="upload-status done">✓ Uploaded</span>}
        </div>
      );
    }

    if (field.type === "textarea") {
      return <textarea value={val} disabled={disabled}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        onChange={e => handleField(field.key,e.target.value)} />;
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
              <label htmlFor="modelName">
                Model Name
                {mode==="edit" && <span className="field-locked-badge">locked</span>}
              </label>
              <input id="modelName" type="text" value={modelName}
                className={`passport-model-input${mode==="edit" ? " passport-model-locked":""}`}
                readOnly={mode==="edit"} disabled={mode==="edit"}
                placeholder="Enter model name (optional)" onChange={e => setModelName(e.target.value)} />
            </div>
            <div className="passport-field-group">
              <label htmlFor="productId">Product ID</label>
              <input id="productId" type="text" value={productId}
                className="passport-model-input"
                placeholder="Enter product ID (optional)"
                onChange={e => { markDirty(); setProductId(e.target.value); }} disabled={isSaving} />
            </div>
            <div className="passport-field-group">
              <label>Passport Type</label>
              <div className="type-badge" style={{ padding:"11px 14px", display:"inline-block" }}>
                {typeLabel.toUpperCase()}
              </div>
            </div>
          </div>

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
                        {section.fields.map(f => (
                          <div key={f.key}
                            className={`form-group${f.type==="textarea"||f.type==="file"?" full-width":""}`}>
                            {f.type !== "boolean" && (
                              <label htmlFor={f.type==="file" ? `f-${f.key}` : f.key}>{f.label}</label>
                            )}
                            {renderField(f)}
                          </div>
                        ))}
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
    </div>
  );
}

export default PassportForm;
