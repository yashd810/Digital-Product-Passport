import React, { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "../../../shared/api/authHeaders";
import "../../../assets/styles/CreatePass.css";

const API = import.meta.env.VITE_API_URL || "";

function SymbolRepositoryPicker({ token, companyId, onSelect, onClose }) {
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canGoBack = breadcrumbs.length > 0;
  const currentFolderName = breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1].name : "Symbols root";

  const fetchItems = useCallback(async (parentId) => {
    setLoading(true);
    setError("");
    try {
      const qs = parentId != null ? `?parentId=${parentId}` : "";
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/repository/symbols${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      setItems(await r.json());
    } catch {
      setError("Failed to load symbol repository");
    } finally {
      setLoading(false);
    }
  }, [companyId, token]);

  useEffect(() => { fetchItems(null); }, [fetchItems]);

  const navigateTo = (folder) => {
    if (folder === null) {
      setBreadcrumbs([]);
      setCurrentFolder(null);
      fetchItems(null);
    } else {
      const idx = breadcrumbs.findIndex((crumb) => crumb.id === folder.id);
      if (idx >= 0) {
        setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
      } else {
        setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
      }
      setCurrentFolder(folder.id);
      fetchItems(folder.id);
    }
  };

  const goBack = () => {
    if (!breadcrumbs.length) return;
    if (breadcrumbs.length === 1) {
      navigateTo(null);
      return;
    }
    navigateTo(breadcrumbs[breadcrumbs.length - 2]);
  };

  const pick = (item) => {
    if (item.type !== "file" || !item.file_url) return;
    onSelect(item.file_url, item.name);
  };

  return (
    <div className="rp-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rp-modal">
        <div className="rp-modal-header">
          <h3>🔣 Pick a Symbol</h3>
          <button className="rp-close-btn" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert alert-error" style={{ margin: "0 16px 12px" }}>{error}</div>}

        <nav className="rp-breadcrumb">
          <button className="rp-crumb" onClick={() => navigateTo(null)}>🏠 Symbols</button>
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.id}>
              <span className="rp-crumb-sep">/</span>
              <button className="rp-crumb" onClick={() => navigateTo(crumb)}>{crumb.name}</button>
            </React.Fragment>
          ))}
        </nav>

        <div className="rp-nav-bar">
          <button type="button" className="rp-back-btn" onClick={goBack} disabled={!canGoBack}>
            ← Back
          </button>
          <div className="rp-folder-state">
            <span className="rp-folder-label">Current folder</span>
            <strong className="rp-folder-name">{currentFolderName}</strong>
          </div>
        </div>

        <div className="rp-list">
          {loading ? (
            <div className="rp-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="rp-empty">
              {currentFolder ? "This folder is empty." : "No symbols in repository yet."}
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`rp-item ${item.type} ${item.type === "file" && item.file_url ? "selectable" : ""}`}
                onClick={() => item.type === "folder" ? navigateTo(item) : pick(item)}
              >
                <span className="rp-item-icon">{item.type === "folder" ? "📁" : "🔣"}</span>
                <span className="rp-item-name">{item.name}</span>
                {item.type === "file" && item.file_url && (
                  <span className="rp-pick-hint">Click to link</span>
                )}
                {item.type === "folder" && (
                  <span className="rp-pick-hint">Open folder →</span>
                )}
              </div>
            ))
          )}
        </div>

        <div className="rp-footer">
          <span className="rp-footer-note">
            Click a symbol to link it — the file stays in the repository.
          </span>
          <button className="rp-cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default SymbolRepositoryPicker;
