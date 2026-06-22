import React, { useState, useEffect, useRef, useCallback } from "react";
import { NavLink, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../../shared/api/authHeaders";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import "./CompanyRepository.css";

const API = import.meta.env.VITE_API_URL || "";

function copyText(value) {
  const text = String(value || "");
  if (!text) return Promise.reject(new Error("Nothing to copy"));
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!ok) throw new Error("Copy command failed");
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// ─── Symbols Tab ─────────────────────────────────────────────────────────────
function SymbolsTab({ companyId }) {
  const [symbols,       setSymbols]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [uploading,     setUploading]     = useState(false);
  const [deletingId,    setDeletingId]    = useState(null);
  const [confirmSym,    setConfirmSym]    = useState(null);
  const [previewSym,    setPreviewSym]    = useState(null);
  const [renamingId,    setRenamingId]    = useState(null);
  const [renameValue,   setRenameValue]   = useState("");
  const [msg,           setMsg]           = useState("");
  const [error,         setError]         = useState("");
  const [breadcrumbs,   setBreadcrumbs]   = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName,    setFolderName]    = useState("");
  const [folderSaving,  setFolderSaving]  = useState(false);

  const [name,     setName]     = useState("");
  const [file,     setFile]     = useState(null);
  const [preview,  setPreview]  = useState(null);
  const fileRef = useRef(null);
  const canGoBack = breadcrumbs.length > 0;
  const currentFolderName = breadcrumbs[breadcrumbs.length - 1]?.name || "Symbols root";

  const flash = (text, isErr = false) => {
    isErr ? setError(text) : setMsg(text);
    setTimeout(() => isErr ? setError("") : setMsg(""), 4000);
  };

  const fetchSymbols = useCallback(async (parentId = currentFolder) => {
    setLoading(true);
    try {
      const qs = parentId != null ? `?parentId=${parentId}` : "";
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/symbols${qs}`);
      if (r.ok) setSymbols(await r.json());
    } catch {}
    finally { setLoading(false); }
  }, [companyId, currentFolder]);

  useEffect(() => { fetchSymbols(); }, [fetchSymbols]);

  const navigate = (folder) => {
    if (folder === null) {
      setBreadcrumbs([]);
      setCurrentFolder(null);
    } else {
      const idx = breadcrumbs.findIndex((crumb) => crumb.id === folder.id);
      if (idx >= 0) {
        setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
      } else {
        setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
      }
      setCurrentFolder(folder.id);
    }
    setSymbols([]);
  };

  const goBack = () => {
    if (!breadcrumbs.length) {
      navigate(null);
      return;
    }
    if (breadcrumbs.length === 1) {
      navigate(null);
      return;
    }
    navigate(breadcrumbs[breadcrumbs.length - 2]);
  };

  useEffect(() => { fetchSymbols(currentFolder); }, [currentFolder]); // eslint-disable-line

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!name.trim()) { flash("Enter a symbol name", true); return; }
    if (!file)        { flash("Choose a file", true); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      if (currentFolder != null) fd.append("parentId", currentFolder);
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/symbols/upload`, {
        method: "POST",
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      flash(`"${name.trim()}" uploaded`);
      setName(""); setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchSymbols();
    } catch (err) { flash(err.message, true); }
    finally { setUploading(false); }
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    setFolderSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/symbols/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName.trim(), parentId: currentFolder }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setFolderName("");
      setShowFolderForm(false);
      flash(`Folder "${data.name}" created`);
      fetchSymbols();
    } catch (err) { flash(err.message, true); }
    finally { setFolderSaving(false); }
  };

  const startRename = (sym) => { setRenamingId(sym.id); setRenameValue(sym.name); };
  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };

  const handleRename = async (symId) => {
    if (!renameValue.trim()) return;
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/${symId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      cancelRename(); flash("Renamed"); fetchSymbols();
    } catch (err) { flash(err.message, true); }
  };

  const handleDelete = async (sym) => {
    setDeletingId(sym.id);
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/${sym.id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      fetchSymbols();
    } catch (err) { flash(err.message, true); }
    finally { setDeletingId(null); setConfirmSym(null); }
  };

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {msg   && <div className="alert alert-success">{msg}</div>}

      <div className="repo-toolbar" style={{ marginBottom: 16 }}>
        <button className="repo-btn repo-btn-secondary" onClick={() => { setShowFolderForm((open) => !open); setFolderName(""); }}>
          {showFolderForm ? "✕ Cancel" : "+ New Folder"}
        </button>
      </div>

      {showFolderForm && (
        <form className="repo-folder-form" onSubmit={handleCreateFolder}>
          <input
            autoFocus
            className="repo-folder-input"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Folder name…"
          />
          <button type="submit" className="repo-btn repo-btn-primary" disabled={folderSaving || !folderName.trim()}>
            {folderSaving ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      <nav className="repo-breadcrumb">
        <button className="repo-crumb" onClick={() => navigate(null)}>🏠 Symbols</button>
        {breadcrumbs.map((crumb) => (
          <React.Fragment key={crumb.id}>
            <span className="repo-crumb-sep">/</span>
            <button className="repo-crumb" onClick={() => navigate(crumb)}>{crumb.name}</button>
          </React.Fragment>
        ))}
      </nav>

      <div className="repo-folder-nav">
        <button
          className="repo-btn repo-btn-secondary repo-folder-back"
          onClick={goBack}
          disabled={!canGoBack}
        >
          ← Back
        </button>
        <div className="repo-folder-context">
          <span className="repo-folder-label">Current folder</span>
          <span className="repo-folder-name">{currentFolderName}</span>
        </div>
      </div>

      {/* Upload card */}
      <div className="sym-card sym-upload-card">
        <h3 className="sym-card-title">Upload New Symbol</h3>
        <form onSubmit={handleUpload} className="sym-upload-form">
          <div className="sym-upload-preview-col">
            <div className="sym-preview-box">
              {preview
                ? <img src={preview} alt="preview" className="sym-preview-img" />
                : <span className="sym-preview-empty">🖼</span>
              }
            </div>
            <label className="sym-file-btn">
              {file ? "Change file" : "Choose file"}
              <input ref={fileRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp"
                style={{ display: "none" }} onChange={handleFileChange} />
            </label>
            <p className="sym-file-hint">SVG, PNG, JPG, WebP · max 2 MB</p>
          </div>
          <div className="sym-upload-fields">
            <div className="sym-field-group">
              <label className="sym-label">Name *</label>
              <input
                type="text" value={name} maxLength={100}
                placeholder="e.g. CE Mark, Recycling Symbol"
                className="sym-input"
                onChange={e => setName(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div className="sym-upload-actions">
              <button type="submit" className="repo-btn repo-btn-primary" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload Symbol"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading" style={{ padding: 40 }}>Loading…</div>
      ) : symbols.length === 0 ? (
        <div className="repo-empty"><p>{currentFolder ? "This folder is empty." : "No symbols yet — upload one above or create a folder to get started."}</p></div>
      ) : (
        <div className="repo-card-grid">
          {symbols.map(sym => (
            <div key={sym.id} className={`repo-card ${sym.type === "folder" ? "folder" : "sym-card-item"}`}>
              <div className={`repo-card-body${sym.type !== "folder" && sym.fileUrl ? " repo-card-body-clickable" : ""}`} onClick={() => {
                if (sym.type === "folder") navigate(sym);
                else if (!renamingId) setPreviewSym(sym);
              }}>
                {sym.type === "folder" ? (
                  <div className="repo-card-icon">📁</div>
                ) : (
                  <div className="sym-card-img-wrap">
                    <img src={sym.fileUrl} alt={sym.name} className="sym-card-img" loading="lazy" />
                  </div>
                )}
                <div className="repo-card-info">
                  {renamingId === sym.id ? (
                    <input
                      autoFocus className="repo-rename-input" value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleRename(sym.id); if (e.key === "Escape") cancelRename(); }}
                    />
                  ) : (
                    <span className="repo-card-name" title={sym.name}>{sym.name}</span>
                  )}
                  {sym.type !== "folder" && (
                    <span className="repo-card-meta">
                      {sym.createdAt && new Date(sym.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="repo-card-footer">
                {renamingId === sym.id ? (
                  <>
                    <button className="repo-card-btn repo-card-btn-ok" onClick={() => handleRename(sym.id)}>✓ Save</button>
                    <button className="repo-card-btn repo-card-btn-cancel" onClick={cancelRename}>Cancel</button>
                  </>
                ) : (
                  <>
                    {sym.type !== "folder" && sym.fileUrl && (
                      <button className="repo-card-btn repo-card-btn-copy" onClick={() => {
                        copyText(sym.fileUrl).then(() => flash("Link copied")).catch(() => flash("Copy failed", true));
                      }}>Copy Link</button>
                    )}
                    <button className="repo-card-btn repo-card-btn-rename" onClick={() => startRename(sym)}>Rename</button>
                    <button className="repo-card-btn repo-card-btn-remove"
                      disabled={deletingId === sym.id}
                      onClick={() => setConfirmSym(sym)}>
                      {deletingId === sym.id ? "…" : "Remove"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewSym && <PreviewDialog item={previewSym} onClose={() => setPreviewSym(null)} />}

      {confirmSym && (
        <ConfirmDialog
          message={`Remove "${confirmSym.name}"${confirmSym.type === "folder" ? " (folder must be empty)" : ""}?`}
          onConfirm={() => handleDelete(confirmSym)}
          onCancel={() => setConfirmSym(null)}
        />
      )}
    </div>
  );
}

// ─── Preview Dialog ───────────────────────────────────────────────────────────
function PreviewDialog({ item, onClose }) {
  const isPdf = item.mimeType === "application/pdf" || item.fileUrl?.toLowerCase().endsWith(".pdf");
  return (
    <div className="repo-preview-overlay" onClick={onClose}>
      <div className="repo-preview-box" onClick={e => e.stopPropagation()}>
        <div className="repo-preview-header">
          <span className="repo-preview-title">{item.name}</span>
          <button className="repo-preview-close" onClick={onClose}>✕</button>
        </div>
        <div className="repo-preview-body">
          {isPdf ? (
            <iframe
              src={item.fileUrl}
              title={item.name}
              className="repo-preview-pdf"
            />
          ) : (
            <img
              src={item.fileUrl}
              alt={item.name}
              className="repo-preview-img"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="repo-confirm-overlay" onClick={onCancel}>
      <div className="repo-confirm-box" onClick={e => e.stopPropagation()}>
        <p className="repo-confirm-msg">{message}</p>
        <div className="repo-confirm-actions">
          <button className="repo-btn repo-btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="repo-btn repo-btn-danger" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ─── Files Tab ────────────────────────────────────────────────────────────────
function FilesTab({ companyId }) {
  const [items,         setItems]         = useState([]);
  const [breadcrumbs,   setBreadcrumbs]   = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [msg,           setMsg]           = useState("");

  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName,     setFolderName]     = useState("");
  const [folderSaving,   setFolderSaving]   = useState(false);

  const [renamingId,   setRenamingId]   = useState(null);
  const [renameValue,  setRenameValue]  = useState("");
  const [confirmItem,  setConfirmItem]  = useState(null);
  const [previewItem,  setPreviewItem]  = useState(null);

  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const canGoBack = breadcrumbs.length > 0;
  const currentFolderName = breadcrumbs[breadcrumbs.length - 1]?.name || "Repository root";

  const flash = (text, isErr = false) => {
    isErr ? setError(text) : setMsg(text);
    setTimeout(() => isErr ? setError("") : setMsg(""), 4000);
  };

  const fetchItems = useCallback(async (parentId = currentFolder) => {
    setLoading(true);
    try {
      const qs = parentId != null ? `?parentId=${parentId}` : "";
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository${qs}`);
      if (!r.ok) throw new Error();
      // Exclude image files (those are shown in Symbols tab)
      const data = await r.json();
      setItems(data.filter(item => item.type === "folder" || !item.mimeType?.startsWith("image/")));
    } catch { flash("Failed to load repository", true); }
    finally { setLoading(false); }
  }, [companyId, currentFolder]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const navigate = (folder) => {
    if (folder === null) {
      setBreadcrumbs([]);
      setCurrentFolder(null);
    } else {
      const idx = breadcrumbs.findIndex(b => b.id === folder.id);
      if (idx >= 0) {
        setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
      } else {
        setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
      }
      setCurrentFolder(folder.id);
    }
    setItems([]);
  };

  const goBack = () => {
    if (!breadcrumbs.length) {
      navigate(null);
      return;
    }
    if (breadcrumbs.length === 1) {
      navigate(null);
      return;
    }
    navigate(breadcrumbs[breadcrumbs.length - 2]);
  };

  useEffect(() => { fetchItems(currentFolder); }, [currentFolder]); // eslint-disable-line

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    setFolderSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName.trim(), parentId: currentFolder }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setFolderName(""); setShowFolderForm(false);
      flash(`Folder "${data.name}" created`);
      fetchItems();
    } catch (e) { flash(e.message, true); }
    finally { setFolderSaving(false); }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") { flash("Only PDF files allowed", true); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("displayName", file.name);
      if (currentFolder != null) fd.append("parentId", currentFolder);
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      flash(`"${data.name}" uploaded`);
      fetchItems();
    } catch (e) { flash(e.message, true); }
    finally { setUploading(false); }
  };

  const startRename = (item) => { setRenamingId(item.id); setRenameValue(item.name); };
  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };

  const handleRename = async (itemId) => {
    if (!renameValue.trim()) return;
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      cancelRename(); flash("Renamed");
      fetchItems();
    } catch (e) { flash(e.message, true); }
  };

  const handleDelete = async (item) => {
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/${item.id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      flash("Removed"); fetchItems();
    } catch (e) { flash(e.message, true); }
    finally { setConfirmItem(null); }
  };

  const formatSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div>
      <div className="repo-toolbar" style={{ marginBottom: 16 }}>
        <button className="repo-btn repo-btn-secondary" onClick={() => { setShowFolderForm(o => !o); setFolderName(""); }}>
          {showFolderForm ? "✕ Cancel" : "+ New Folder"}
        </button>
        <button className="repo-btn repo-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? "⏳ Uploading…" : "⬆ Upload PDF"}
        </button>
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleUpload} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg   && <div className="alert alert-success">{msg}</div>}

      {showFolderForm && (
        <form className="repo-folder-form" onSubmit={handleCreateFolder}>
          <input
            autoFocus className="repo-folder-input" value={folderName}
            onChange={e => setFolderName(e.target.value)} placeholder="Folder name…"
          />
          <button type="submit" className="repo-btn repo-btn-primary" disabled={folderSaving || !folderName.trim()}>
            {folderSaving ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      <nav className="repo-breadcrumb">
        <button className="repo-crumb" onClick={() => navigate(null)}>🏠 Repository</button>
        {breadcrumbs.map((crumb) => (
          <React.Fragment key={crumb.id}>
            <span className="repo-crumb-sep">/</span>
            <button className="repo-crumb" onClick={() => navigate(crumb)}>{crumb.name}</button>
          </React.Fragment>
        ))}
      </nav>

      <div className="repo-folder-nav">
        <button
          className="repo-btn repo-btn-secondary repo-folder-back"
          onClick={goBack}
          disabled={!canGoBack}
        >
          ← Back
        </button>
        <div className="repo-folder-context">
          <span className="repo-folder-label">Current folder</span>
          <span className="repo-folder-name">{currentFolderName}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading" style={{ padding: 40 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="repo-empty">
          <p>{currentFolder ? "This folder is empty." : "No files yet — upload a PDF or create a folder to get started."}</p>
        </div>
      ) : (
        <div className="repo-card-grid">
          {items.map(item => (
            <div key={item.id} className={`repo-card ${item.type}`}>
              <div className={`repo-card-body${item.type !== "folder" && item.fileUrl ? " repo-card-body-clickable" : ""}`} onClick={() => { if (item.type === "folder") navigate(item); else if (item.fileUrl && !renamingId) setPreviewItem(item); }}>
                <div className="repo-card-icon">{item.type === "folder" ? "📁" : "📄"}</div>
                <div className="repo-card-info">
                  {renamingId === item.id ? (
                    <input
                      autoFocus className="repo-rename-input" value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleRename(item.id); if (e.key === "Escape") cancelRename(); }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="repo-card-name">{item.name}</span>
                  )}
                  {item.type === "file" && (
                    <span className="repo-card-meta">
                      {formatSize(item.sizeBytes)}
                      {item.createdAt && ` · ${new Date(item.createdAt).toLocaleDateString()}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="repo-card-footer" onClick={e => e.stopPropagation()}>
                {renamingId === item.id ? (
                  <>
                    <button className="repo-card-btn repo-card-btn-ok" onClick={() => handleRename(item.id)}>✓ Save</button>
                    <button className="repo-card-btn repo-card-btn-cancel" onClick={cancelRename}>Cancel</button>
                  </>
                ) : (
                  <>
                    {item.type === "file" && item.fileUrl && (
                      <button className="repo-card-btn repo-card-btn-copy" onClick={() => {
                        copyText(item.fileUrl).then(() => flash("Link copied")).catch(() => flash("Copy failed", true));
                      }}>Copy Link</button>
                    )}
                    <button className="repo-card-btn repo-card-btn-rename" onClick={() => startRename(item)}>Rename</button>
                    <button className="repo-card-btn repo-card-btn-remove" onClick={() => setConfirmItem(item)}>Remove</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewItem && <PreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} />}

      {confirmItem && (
        <ConfirmDialog
          message={`Remove "${confirmItem.name}"${confirmItem.type === "folder" ? " (folder must be empty)" : ""}?`}
          onConfirm={() => handleDelete(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
function CompanyRepository({ companyId, activeTab = "files" }) {
  const { companySlug } = useParams();
  const filesPath = buildDashboardPath({ companySlug, companyId, subpath: "repository/files" });
  const symbolsPath = buildDashboardPath({ companySlug, companyId, subpath: "repository/symbols" });

  return (
    <div className="repo-page">
      <div className="repo-header">
        <div>
          <h2 className="repo-title">📁 Company Repository</h2>
          <p className="repo-subtitle">
            Store and organise your documents and symbols. Link them directly into passports.
          </p>
        </div>
      </div>

      <div className="repo-tabs">
        <NavLink to={filesPath}
          className={({ isActive }) => `repo-tab${isActive ? " active" : ""}`}>
          📄 Files
        </NavLink>
        <NavLink to={symbolsPath}
          className={({ isActive }) => `repo-tab${isActive ? " active" : ""}`}>
          🔣 Symbols
        </NavLink>
      </div>

      <div className="repo-tab-body">
        {activeTab === "files"   && <FilesTab companyId={companyId} />}
        {activeTab === "symbols" && <SymbolsTab companyId={companyId} />}
      </div>
    </div>
  );
}

export { SymbolsTab, FilesTab };
export default CompanyRepository;
