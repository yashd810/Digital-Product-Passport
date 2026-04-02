import React, { useState, useEffect, useRef, useCallback } from "react";
import "./CompanyRepository.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function CompanyRepository({ token, companyId }) {
  const [items,        setItems]        = useState([]);
  const [breadcrumbs,  setBreadcrumbs]  = useState([]);   // [{ id, name }]
  const [currentFolder, setCurrentFolder] = useState(null); // null = root
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState("");
  const [msg,          setMsg]          = useState("");

  // Create folder
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName,     setFolderName]     = useState("");
  const [folderSaving,   setFolderSaving]   = useState(false);

  // Rename
  const [renamingId,   setRenamingId]   = useState(null);
  const [renameValue,  setRenameValue]  = useState("");

  // Upload
  const fileInputRef = useRef(null);
  const [uploading,  setUploading]  = useState(false);

  const flash = (text, isErr = false) => {
    isErr ? setError(text) : setMsg(text);
    setTimeout(() => isErr ? setError("") : setMsg(""), 4000);
  };

  const fetchItems = useCallback(async (parentId = currentFolder) => {
    setLoading(true);
    try {
      const qs = parentId != null ? `?parentId=${parentId}` : "";
      const r = await fetch(`${API}/api/companies/${companyId}/repository${qs}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error();
      setItems(await r.json());
    } catch { flash("Failed to load repository", true); }
    finally { setLoading(false); }
  }, [companyId, token, currentFolder]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const navigate = (folder) => {
    if (folder === null) {
      setBreadcrumbs([]);
      setCurrentFolder(null);
    } else {
      // If already in breadcrumbs, truncate to that level
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

  // Sync fetch when currentFolder changes
  useEffect(() => {
    fetchItems(currentFolder);
  }, [currentFolder]); // eslint-disable-line

  // ── Create folder ────────────────────────────────────────
  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    setFolderSaving(true);
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/repository/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

  // ── Upload file ──────────────────────────────────────────
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
      const r = await fetch(`${API}/api/companies/${companyId}/repository/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      flash(`"${data.name}" uploaded`);
      fetchItems();
    } catch (e) { flash(e.message, true); }
    finally { setUploading(false); }
  };

  // ── Rename ───────────────────────────────────────────────
  const startRename = (item) => { setRenamingId(item.id); setRenameValue(item.name); };
  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };

  const handleRename = async (itemId) => {
    if (!renameValue.trim()) return;
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/repository/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      cancelRename(); flash("Renamed");
      fetchItems();
    } catch (e) { flash(e.message, true); }
  };

  // ── Delete ───────────────────────────────────────────────
  const handleDelete = async (item) => {
    const label = item.type === "folder" ? `folder "${item.name}" (must be empty)` : `"${item.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/repository/${item.id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      flash("Deleted"); fetchItems();
    } catch (e) { flash(e.message, true); }
  };

  const formatSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="repo-page">
      {/* Header */}
      <div className="repo-header">
        <div>
          <h2 className="repo-title">📁 Company Repository</h2>
          <p className="repo-subtitle">
            Store and organise your PDF documents. Link files directly into passports without re-uploading.
          </p>
        </div>
        <div className="repo-toolbar">
          <button className="repo-btn repo-btn-secondary" onClick={() => { setShowFolderForm(o => !o); setFolderName(""); }}>
            {showFolderForm ? "✕ Cancel" : "+ New Folder"}
          </button>
          <button className="repo-btn repo-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "⏳ Uploading…" : "⬆ Upload PDF"}
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleUpload} />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg   && <div className="alert alert-success">{msg}</div>}

      {/* New folder form */}
      {showFolderForm && (
        <form className="repo-folder-form" onSubmit={handleCreateFolder}>
          <input
            autoFocus
            className="repo-folder-input"
            value={folderName}
            onChange={e => setFolderName(e.target.value)}
            placeholder="Folder name…"
          />
          <button type="submit" className="repo-btn repo-btn-primary" disabled={folderSaving || !folderName.trim()}>
            {folderSaving ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {/* Breadcrumb */}
      <nav className="repo-breadcrumb">
        <button className="repo-crumb" onClick={() => navigate(null)}>🏠 Repository</button>
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.id}>
            <span className="repo-crumb-sep">/</span>
            <button className="repo-crumb" onClick={() => navigate(crumb)}>
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {/* File list */}
      {loading ? (
        <div className="loading" style={{ padding: 40 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="repo-empty">
          <p>{currentFolder ? "This folder is empty." : "No files yet — upload a PDF or create a folder to get started."}</p>
        </div>
      ) : (
        <div className="repo-list">
          {items.map(item => (
            <div key={item.id} className={`repo-item ${item.type}`}>
              <div className="repo-item-icon">
                {item.type === "folder" ? "📁" : "📄"}
              </div>

              <div className="repo-item-info" onClick={() => item.type === "folder" && navigate(item)}>
                {renamingId === item.id ? (
                  <input
                    autoFocus
                    className="repo-rename-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleRename(item.id);
                      if (e.key === "Escape") cancelRename();
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="repo-item-name">{item.name}</span>
                )}
                {item.type === "file" && (
                  <span className="repo-item-meta">
                    {formatSize(item.size_bytes)}
                    {item.created_at && ` · ${new Date(item.created_at).toLocaleDateString()}`}
                  </span>
                )}
              </div>

              <div className="repo-item-actions" onClick={e => e.stopPropagation()}>
                {renamingId === item.id ? (
                  <>
                    <button className="repo-action-btn ok" onClick={() => handleRename(item.id)}>✓</button>
                    <button className="repo-action-btn cancel" onClick={cancelRename}>✕</button>
                  </>
                ) : (
                  <>
                    {item.type === "file" && item.file_url && (
                      <a
                        href={item.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-action-btn view"
                        title="View PDF"
                      >👁</a>
                    )}
                    {item.type === "file" && item.file_url && (
                      <a
                        href={item.file_url}
                        download={item.name}
                        className="repo-action-btn download"
                        title="Download"
                      >⬇</a>
                    )}
                    <button className="repo-action-btn rename" onClick={() => startRename(item)} title="Rename">✏️</button>
                    <button className="repo-action-btn delete" onClick={() => handleDelete(item)} title="Delete">🗑️</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CompanyRepository;
