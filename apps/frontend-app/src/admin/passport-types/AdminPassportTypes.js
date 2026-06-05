import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { buildProductCategoryOptions } from "./builderHelpers";
import { formatSemanticModelLabel } from "./semanticTermCatalog";
import "../styles/AdminDashboard.css";

function TypeKebabMenu({ pos, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="kebab-dropdown-menu" style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>,
    document.body
  );
}

const API = import.meta.env.VITE_API_URL || "";

const ICON_PRESETS = ["📋","⚡","🧵","🏗️","🎮","🏢","📦","🔋","🌿","🛡️","🔬","⚙️","🌊","🔥","🌱"];

const getSemanticModelLabel = formatSemanticModelLabel;

function AdminPassportTypes() {
  const navigate = useNavigate();
  const [types,      setTypes]      = useState([]);
  const [productCategories,  setProductCategories]  = useState([]);
  const [draftType,  setDraftType]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [msg,        setMsg]        = useState("");

  // Kebab menu
  const [openKebabId, setOpenKebabId] = useState(null);
  const [kebabPos,    setKebabPos]    = useState({ top: 0, left: 0 });

  const openKebab = (e, id) => {
    e.stopPropagation();
    if (openKebabId === id) { setOpenKebabId(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setKebabPos({ top: rect.bottom + 4, left: rect.right - 160 });
    setOpenKebabId(id);
  };

  const handleCloneType = (t) => {
    setOpenKebabId(null);
    navigate("/admin/passport-types/new", { state: { cloneData: t } });
  };

  const handleEditMetadata = (t) => {
    setOpenKebabId(null);
    navigate(`/admin/passport-types/${t.typeName}/edit`, { state: { editData: t } });
  };

  // Delete passport type
  const [deleteTarget,   setDeleteTarget]   = useState(null);  // null | type object
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError,    setDeleteError]    = useState("");
  const [deleting,       setDeleting]       = useState(false);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState(null);
  const [deleteCategoryPassword, setDeleteCategoryPassword] = useState("");
  const [deleteCategoryError, setDeleteCategoryError] = useState("");
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);

  const handleDeleteType = async (e) => {
    e.preventDefault();
    setDeleteError("");
    if (!deletePassword) return setDeleteError("Password is required.");
    setDeleting(true);
    try {
      const r = await fetchWithAuth(`${API}/api/admin/passport-types/${deleteTarget.id}`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to delete");
      setDeleteTarget(null);
      setDeletePassword("");
      showMsg(`"${deleteTarget.displayName}" deleted permanently.`);
      fetchAll();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // New product category form state
  const [showProductCategoryForm, setShowProductCategoryForm] = useState(false);
  const [newCatName,       setNewCatName]       = useState("");
  const [newCatIcon,       setNewCatIcon]       = useState("📋");
  const [umbSaving,        setCatSaving]        = useState(false);
  const [umbError,         setCatError]         = useState("");

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [typesRes, umbRes, draftRes] = await Promise.all([
        fetchWithAuth(`${API}/api/admin/passport-types`,       { headers: authHeaders() }),
        fetchWithAuth(`${API}/api/admin/product-categories`,  { headers: authHeaders() }),
        fetchWithAuth(`${API}/api/admin/passport-type-draft`,  { headers: authHeaders() }),
      ]);
      if (!typesRes.ok) throw new Error("Failed to fetch passport types");
      setTypes(await typesRes.json());
      if (umbRes.ok) setProductCategories(await umbRes.json());
      if (draftRes.ok) {
        const row = await draftRes.json();
        setDraftType(row?.draft_json ? { savedAt: row.updatedAt, ...row.draft_json } : null);
      } else if (draftRes.status === 404) {
        setDraftType(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const showMsg = (text) => { setMsg(text); setTimeout(() => setMsg(""), 3000); };

  const handleToggle = async (type) => {
    const action = type.isActive ? "deactivate" : "activate";
    try {
      const r = await fetchWithAuth(`${API}/api/admin/passport-types/${type.id}/${action}`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`Failed to ${action} type`);
      showMsg(`${type.displayName} ${action}d.`);
      fetchAll();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAddProductCategory = async (e) => {
    e.preventDefault();
    setCatError("");
    if (!newCatName.trim()) return setCatError("Name is required.");
    setCatSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/api/admin/product-categories`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: newCatName.trim(), icon: newCatIcon }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to create");
      setNewCatName(""); setNewCatIcon("📋");
      setShowProductCategoryForm(false);
        showMsg(`Product category "${data.name}" created.`);
      fetchAll();
    } catch (e) {
      setCatError(e.message);
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteProductCategory = async (umb) => {
    setDeleteCategoryTarget(umb);
    setDeleteCategoryPassword("");
    setDeleteCategoryError("");
  };

  const confirmDeleteCategory = async (e) => {
    e.preventDefault();
    setDeleteCategoryError("");
    if (!deleteCategoryPassword) return setDeleteCategoryError("Password is required.");
    try {
      setDeletingCategory(true);
      const r = await fetchWithAuth(`${API}/api/admin/product-categories/${deleteCategoryTarget.id}`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ password: deleteCategoryPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to delete");
      showMsg(`Product category "${deleteCategoryTarget.name}" deleted.`);
      setDeleteCategoryTarget(null);
      setDeleteCategoryPassword("");
      fetchAll();
    } catch (e) {
      setDeleteCategoryError(e.message);
    } finally {
      setDeletingCategory(false);
    }
  };

  const handleDiscardDraft = async () => {
    try {
      setDiscardingDraft(true);
      const r = await fetchWithAuth(`${API}/api/admin/passport-type-draft`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to discard draft");
      setDraftType(null);
      showMsg("Draft passport type discarded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setDiscardingDraft(false);
    }
  };

  // Group types by product category
  const grouped = types.reduce((acc, t) => {
    const key = t.productCategory;
    if (!acc[key]) acc[key] = { icon: t.productIcon, types: [] };
    acc[key].types.push(t);
    return acc;
  }, {});

  const draftGroupKey = draftType?.productCategory?.trim() || "";
  const draftGroupIcon = draftType?.productIcon || "📋";
  const visibleProductCategories = buildProductCategoryOptions({
    savedCategories: productCategories,
    passportTypes: types,
    draftType,
  });
  const groupedEntries = Object.entries(grouped);

  if (draftType && !grouped[draftGroupKey]) {
    groupedEntries.unshift([draftGroupKey || "Draft", { icon: draftGroupIcon, types: [] }]);
  }

  if (loading) return <div className="loading">Loading passport types…</div>;

  return (
    <div className="apt-page">

      {/* ── Toolbar ── */}
      <div className="apt-toolbar">
        <div>
          <h2 className="apt-title">📋 Passport Types</h2>
          <p className="apt-subtitle">
            Create custom passport types grouped under product categories.
            Types are <strong>immutable after creation</strong> — new fields require a new type.
          </p>
        </div>
        <button className="apt-create-btn" onClick={() => navigate("/admin/passport-types/new")}>
          + Create New Type
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg   && <div className="alert alert-success">{msg}</div>}

      {/* ── Product Categories Management ── */}
      <div className="apt-productCategories-panel">
        <div className="apt-productCategories-header">
          <div>
            <h3 className="apt-productCategories-title">Product Categories</h3>
            <p className="apt-productCategories-hint">
              Group related passport types. Can only delete a category if no types use it.
            </p>
          </div>
          <button className="apt-add-productCategory-btn" onClick={() => { setShowProductCategoryForm(o => !o); setCatError(""); }}>
            {showProductCategoryForm ? "✕ Cancel" : "+ Add Category"}
          </button>
        </div>

        {showProductCategoryForm && (
          <form className="apt-productCategory-form" onSubmit={handleAddProductCategory}>
            {umbError && <div className="alert alert-error admin-alert-inline">{umbError}</div>}
            <div className="apt-productCategory-form-row">
              <input
                type="text"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="Category name, e.g. Appliance"
                className="apt-productCategory-name-input"
                autoFocus
              />
              <div className="apt-productCategory-icon-row">
                <input
                  type="text"
                  value={newCatIcon}
                  onChange={e => setNewCatIcon(e.target.value)}
                  className="apt-productCategory-icon-input"
                  maxLength={4}
                />
                {ICON_PRESETS.map(ic => (
                  <button key={ic} type="button"
                    className={`apt-icon-preset-btn ${newCatIcon === ic ? "selected" : ""}`}
                    onClick={() => setNewCatIcon(ic)}>{ic}</button>
                ))}
              </div>
              <button type="submit" className="apt-create-btn" disabled={umbSaving}>
                {umbSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        )}

        <div className="apt-productCategory-chips">
          {visibleProductCategories.length === 0 && (
            <span className="apt-productCategory-empty">No product categories yet. Create a passport type or add one above.</span>
          )}
          {visibleProductCategories.map(umb => {
            const inUse = !!grouped[umb.name];
            const canDelete = umb.managed && !inUse;
            return (
              <div key={umb.id} className={`apt-productCategory-chip ${inUse ? "apt-productCategory-chip-used" : ""}`}>
                <span className="apt-productCategory-chip-icon">{umb.icon}</span>
                <span className="apt-productCategory-chip-name">{umb.name}</span>
                {inUse
                  ? <span className="apt-productCategory-chip-count">{grouped[umb.name].types.length} type{grouped[umb.name].types.length !== 1 ? "s" : ""}</span>
                  : canDelete ? (
                    <>
                      <button className="apt-productCategory-chip-delete" onClick={() => handleDeleteProductCategory(umb)} title="Delete">✕</button>
                      <button
                        type="button"
                        className="apt-productCategory-delete-btn"
                        onClick={() => handleDeleteProductCategory(umb)}
                      >
                        Delete
                      </button>
                    </>
                  ) : <span className="apt-productCategory-chip-count">Derived</span>
                }
              </div>
            );
          })}
        </div>
      </div>

      {groupedEntries.length === 0 ? (
        <div className="apt-empty">
          <div className="apt-empty-icon">📋</div>
          <h3>No passport types yet</h3>
          <p>Create your first custom passport type to get started.</p>
          <button className="apt-create-btn" onClick={() => navigate("/admin/passport-types/new")}>
            + Create First Type
          </button>
        </div>
      ) : (
        <div className="apt-groups">
          {groupedEntries.map(([productCategory, { icon, types: umbTypes }]) => (
            <div key={productCategory} className="apt-group">
              <div className="apt-group-header">
                <span className="apt-group-icon">{icon}</span>
                <h3 className="apt-group-name">{productCategory || "Draft Category"}</h3>
                <span className="apt-group-count">
                  {umbTypes.length + (draftType && productCategory === draftGroupKey ? 1 : 0)} type
                  {umbTypes.length + (draftType && productCategory === draftGroupKey ? 1 : 0) !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="apt-cards">
                {draftType && productCategory === draftGroupKey && (
                  <div className="apt-card apt-draft-card-inline">
                    <div className="apt-card-header">
                      <div>
                        <div className="apt-card-display-name">
                          {draftType.displayName?.trim() || "Untitled Passport Type Draft"}
                        </div>
                        <code className="apt-card-type-name apt-draft-card-code">
                          {draftType.typeName?.trim() || "Type key will be generated when you continue editing"}
                        </code>
                      </div>
                      <div className="admin-inline-stack">
                        <span className="apt-badge apt-badge-draft">Draft</span>
                      </div>
                    </div>

                    <div className="apt-card-meta">
                      <span className="apt-card-meta-primary">
                        {draftType.sections?.reduce((count, section) => count + (section.fields?.length || 0), 0) || 0} fields
                        {" "}across {draftType.sections?.length || 0} sections
                      </span>
                      <span className="apt-card-meta-secondary">
                        Last saved {draftType.savedAt ? new Date(draftType.savedAt).toLocaleString() : "just now"}
                      </span>
                    </div>

                    <div className="apt-card-actions">
                      <button
                        className="apt-draft-edit-btn"
                        onClick={() => navigate("/admin/passport-types/new", { state: { resumeDraft: true } })}
                      >
                        Edit
                      </button>
                      <button
                        className="apt-draft-discard-btn-card"
                        onClick={handleDiscardDraft}
                        disabled={discardingDraft}
                      >
                        {discardingDraft ? "Discarding…" : "Discard"}
                      </button>
                    </div>
                  </div>
                )}

                {umbTypes.map(t => (
                  <div key={t.id} className={`apt-card ${t.isActive ? "" : "apt-card-inactive"}`}>
                    <div className="apt-card-header">
                      <div>
                        <div className="apt-card-display-name">{t.displayName}</div>
                        <code className="apt-card-type-name">{t.typeName}</code>
                      </div>
                      <div className="admin-inline-stack">
                        <span className={`apt-badge ${t.isActive ? "apt-badge-active" : "apt-badge-inactive"}`}>
                          {t.isActive ? "Active" : "Inactive"}
                        </span>
                        <button className="kebab-menu-btn admin-no-shrink" onClick={e => openKebab(e, t.id)}>⋮</button>
                      </div>
                    </div>
                    {openKebabId === t.id && (
                      <TypeKebabMenu pos={kebabPos} onClose={() => setOpenKebabId(null)}>
                        <button className="menu-item" onClick={() => handleEditMetadata(t)}>
                          ✏️ Edit Metadata
                        </button>
                        <button className="menu-item" onClick={() => handleCloneType(t)}>
                          🔁 Clone Type
                        </button>
                        <button className="menu-item menu-item-danger" onClick={() => { setOpenKebabId(null); setDeleteTarget(t); setDeletePassword(""); setDeleteError(""); }}>
                          🗑️ Delete Type
                        </button>
                      </TypeKebabMenu>
                    )}

                    <div className="apt-card-meta">
                      <span className="apt-card-meta-primary">
                        {t.fieldsJson?.sections?.reduce((n, s) => n + (s.fields?.length || 0), 0) || 0} fields
                        across {t.fieldsJson?.sections?.length || 0} sections
                      </span>
                      <span className="apt-card-meta-secondary">Semantic model: {getSemanticModelLabel(t.semanticModelKey)}</span>
                      <span className="apt-card-meta-secondary">Created {new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>

                    <div className="apt-card-actions">
                      <button
                        className="apt-view-fields-btn"
                        onClick={() => navigate(`/admin/passport-types/${t.typeName}/fields`, { state: { passportType: t } })}
                      >
                        ▼ View Fields
                      </button>
                      <button
                        className={`apt-toggle-btn ${t.isActive ? "apt-toggle-deactivate" : "apt-toggle-activate"}`}
                        onClick={() => handleToggle(t)}
                      >
                        {t.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <span className="apt-immutable-note">🔒 Fields locked after creation</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Delete passport type modal ── */}
      {deleteTarget && (
        <div className="apt-modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="apt-modal" onClick={e => e.stopPropagation()}>
            <h3 className="apt-modal-title">Delete Passport Type</h3>
            <p className="apt-modal-warning">
              ⚠️ This will permanently delete <strong>{deleteTarget.displayName}</strong> ({deleteTarget.typeName}) and <strong>all passport data</strong> inside it. This cannot be undone.
            </p>
            <form onSubmit={handleDeleteType}>
              {deleteError && <div className="alert alert-error admin-alert-inline-wide">{deleteError}</div>}
              <label className="apt-modal-label">Enter your admin password to confirm</label>
              <input
                type="password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteError(""); }}
                placeholder="Your login password"
                className="apt-modal-input"
                autoFocus
              />
              <div className="apt-modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                  Cancel
                </button>
                <button type="submit" className="apt-modal-delete-btn" disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete Permanently"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCategoryTarget && (
        <div className="apt-modal-overlay" onClick={() => !deletingCategory && setDeleteCategoryTarget(null)}>
          <div className="apt-modal" onClick={e => e.stopPropagation()}>
            <h3 className="apt-modal-title">Delete Product Category</h3>
            <p className="apt-modal-warning">
              ⚠️ This will delete <strong>{deleteCategoryTarget.name}</strong> if no passport types are using it. Enter your admin password to confirm.
            </p>
            <form onSubmit={confirmDeleteCategory}>
              {deleteCategoryError && <div className="alert alert-error admin-alert-inline-wide">{deleteCategoryError}</div>}
              <label className="apt-modal-label">Enter your admin password to confirm</label>
              <input
                type="password"
                value={deleteCategoryPassword}
                onChange={e => { setDeleteCategoryPassword(e.target.value); setDeleteCategoryError(""); }}
                placeholder="Your login password"
                className="apt-modal-input"
                autoFocus
              />
              <div className="apt-modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setDeleteCategoryTarget(null)} disabled={deletingCategory}>
                  Cancel
                </button>
                <button type="submit" className="apt-modal-delete-btn" disabled={deletingCategory}>
                  {deletingCategory ? "Deleting…" : "Delete Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPassportTypes;
