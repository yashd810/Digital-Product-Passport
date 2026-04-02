import React, { useState, useEffect, useRef } from "react";
import { authHeaders } from "./authHeaders";
import "./AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function AdminSymbolRepository() {
  const [symbols,     setSymbols]     = useState([]);
  const [categories,  setCategories]  = useState([]);
  const [filterCat,   setFilterCat]   = useState("");
  const [loading,     setLoading]     = useState(true);
  const [uploading,   setUploading]   = useState(false);
  const [deletingId,  setDeletingId]  = useState(null);
  const [msg,         setMsg]         = useState({ type: "", text: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Upload form
  const [name,     setName]     = useState("");
  const [category, setCategory] = useState("");
  const [file,     setFile]     = useState(null);
  const [preview,  setPreview]  = useState(null);
  const fileRef = useRef(null);
  const alertRef = useRef(null);

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: "", text: "" }), 4000);
  };

  useEffect(() => {
    if (!msg.text || !alertRef.current) return;
    alertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [msg]);

  const fetchSymbols = async () => {
    setLoading(true);
    try {
      const params = filterCat ? `?category=${encodeURIComponent(filterCat)}` : "";
      const [symRes, catRes] = await Promise.all([
        fetch(`${API}/api/symbols${params}`,            { headers: authHeaders() }),
        fetch(`${API}/api/symbols/categories`,           { headers: authHeaders() }),
      ]);
      if (symRes.ok) setSymbols(await symRes.json());
      if (catRes.ok) setCategories(await catRes.json());
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSymbols(); }, [filterCat]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    // Auto-fill name from filename if empty
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      flash("error", "Enter a symbol name in this field.");
      return;
    }
    if (!file) {
      flash("error", "Choose a symbol file in this field.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      fd.append("category", category.trim() || "General");

      const r = await fetch(`${API}/api/admin/symbols`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");

      flash("success", `"${name.trim()}" uploaded successfully`);
      setName(""); setCategory(""); setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchSymbols();
    } catch (err) {
      flash("error", err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (sym) => {
    setDeleteTarget(sym);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      const r = await fetch(`${API}/api/admin/symbols/${deleteTarget.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to remove symbol");
      setDeleteTarget(null);
      fetchSymbols();
    } catch (err) {
      flash("error", err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // Group symbols by category for the grid display
  const grouped = symbols.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {});

  return (
    <div className="sym-page">
      <div className="sym-header">
        <div>
          <h2 className="sym-title">Symbol Repository</h2>
          <p className="sym-sub">
            Upload symbols (logos, compliance marks, recycling icons, etc.) that users can select when creating passports.
          </p>
        </div>
        <span className="sym-count">{symbols.length} symbol{symbols.length !== 1 ? "s" : ""}</span>
      </div>

      {msg.text && (
        <div ref={alertRef} className={`alert alert-${msg.type}`}>{msg.text}</div>
      )}

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
                className="admin-hidden-input" onChange={handleFileChange} />
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
            <div className="sym-field-group">
              <label className="sym-label">Category</label>
              <input
                type="text" value={category} maxLength={50}
                placeholder="e.g. Compliance, Safety, Recycling"
                className="sym-input"
                list="cat-suggestions"
                onChange={e => setCategory(e.target.value)}
                disabled={uploading}
              />
              <datalist id="cat-suggestions">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
              <span className="sym-hint">Leave blank to use "General"</span>
            </div>
            <div className="sym-upload-actions">
              <button type="submit" className="sym-btn-primary" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload Symbol"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Filter bar */}
      <div className="sym-filter-bar">
        <span className="sym-filter-label">Filter by category:</span>
        <button
          className={`sym-cat-btn${!filterCat ? " active" : ""}`}
          onClick={() => setFilterCat("")}>
          All
        </button>
        {categories.map(c => (
          <button
            key={c}
            className={`sym-cat-btn${filterCat === c ? " active" : ""}`}
            onClick={() => setFilterCat(c)}>
            {c}
          </button>
        ))}
      </div>

      {/* Symbol grid */}
      {loading ? (
        <p className="sym-loading">Loading symbols…</p>
      ) : symbols.length === 0 ? (
        <div className="sym-empty">
          <p>No symbols yet. Upload the first one above.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, syms]) => (
          <div key={cat} className="sym-group">
            <h4 className="sym-group-title">{cat}</h4>
            <div className="sym-grid">
              {syms.map(sym => (
                <div key={sym.id} className="sym-tile">
                  <div className="sym-tile-img-wrap">
                    <img src={sym.file_url} alt={sym.name} className="sym-tile-img" loading="lazy" />
                  </div>
                  <div className="sym-tile-name" title={sym.name}>{sym.name}</div>
                  <button
                    className="sym-tile-delete"
                    onClick={() => handleDelete(sym)}
                    disabled={deletingId === sym.id}
                    title="Remove from repository">
                    {deletingId === sym.id ? "…" : "✕"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {deleteTarget && (
        <div className="apt-modal-overlay" onClick={() => !deletingId && setDeleteTarget(null)}>
          <div className="apt-modal symbols-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="apt-modal-title">Delete Symbol</h3>
            <p className="apt-modal-warning">
              Remove <strong>{deleteTarget.name}</strong> from the repository? It will no longer appear in the symbol picker,
              but any passports already using it will keep the image.
            </p>
            <div className="apt-modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setDeleteTarget(null)}
                disabled={!!deletingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="apt-modal-delete-btn"
                onClick={confirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? "Deleting…" : "Delete Symbol"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminSymbolRepository;
