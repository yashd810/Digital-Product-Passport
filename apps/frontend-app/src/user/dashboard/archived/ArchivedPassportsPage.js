import React, { useState, useEffect, useCallback, useMemo } from "react";
import QRCode from "qrcode";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import { authHeaders } from "../../../shared/api/authHeaders";
import { buildPassportJsonLdExport } from "../../../shared/utils/batterySemanticExport";
import { formatPassportStatus, isPublishedPassportStatus, normalizePassportStatus } from "../../../passports/utils/passportStatus";
import { buildPublicViewerUrl } from "../../../passports/utils/publicViewerUrl";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

// ─────────────────────────────────────────────────────────────────────────────
// Archived Passport Collection Helpers
// ─────────────────────────────────────────────────────────────────────────────
function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.version_number || 0) - Number(a?.version_number || 0);
  if (versionDiff !== 0) return versionDiff;
  return new Date(b?.archived_at || b?.updated_at || b?.created_at || 0).getTime()
    - new Date(a?.archived_at || a?.updated_at || a?.created_at || 0).getTime();
}

function getPassportGroupKey(passport) {
  if (passport?.lineage_id) return `lineage:${passport.lineage_id}`;
  if (passport?.product_id) return `product:${passport.passport_type || "passport"}:${passport.product_id}`;
  return `guid:${passport?.guid || ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Archived Passports Page
// ─────────────────────────────────────────────────────────────────────────────
function ArchivedPassports({ user, companyId }) {
  // UI state
  const [passports, setPassports] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedPassports, setSelectedPassports] = useState(new Set());
  const [expandedPassportGroups, setExpandedPassportGroups] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "archived_at", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [passportTypes, setPassportTypes] = useState([]);
  const [printQrModalOpen, setPrintQrModalOpen] = useState(false);
  const [qrExporting, setQrExporting] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [historyPathCache, setHistoryPathCache] = useState({});

  // Feedback helpers
  const showSuccess = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 4000); };
  const showError = (msg) => { setError(msg); setTimeout(() => setError(""), 5000); };

  // Archived public-path helpers
  const getArchivedPathCacheKey = useCallback((passport) => (
    `${passport?.guid || ""}:${passport?.version_number || ""}:${passport?.public_version_number || ""}`
  ), []);
  const getArchivedPublicVersionNumber = useCallback((passport) => {
    if (
      isPublishedPassportStatus(passport?.release_status) &&
      passport?.is_public !== false
    ) {
      const currentVersion = Number.parseInt(passport?.version_number, 10);
      if (Number.isFinite(currentVersion) && currentVersion > 0) return currentVersion;
    }
    const parsed = Number.parseInt(passport?.public_version_number, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return null;
  }, []);
  const canOpenArchivedPublicVersion = useCallback((passport) => (
    !!passport?.product_id && !!getArchivedPublicVersionNumber(passport)
  ), [getArchivedPublicVersionNumber]);

  // Data loading
  const resolveArchivedPassportPath = useCallback(async (passport) => {
    if (!passport?.guid) return null;

    const cacheKey = getArchivedPathCacheKey(passport);
    if (historyPathCache[cacheKey]) return historyPathCache[cacheKey];

    const publicVersionNumber = getArchivedPublicVersionNumber(passport);
    if (!publicVersionNumber) return null;

    const response = await fetch(
      `${API}/api/companies/${companyId}/passports/${passport.guid}/history`,
      { headers: authHeaders() }
    );
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const matchingEntry = history.find((entry) => Number(entry.version_number) === Number(publicVersionNumber));
    const resolvedPath = matchingEntry?.is_current
      ? matchingEntry?.public_path
      : matchingEntry?.inactive_path;

    if (resolvedPath) {
      setHistoryPathCache((prev) => ({ ...prev, [cacheKey]: resolvedPath }));
    }
    return resolvedPath || null;
  }, [companyId, getArchivedPathCacheKey, getArchivedPublicVersionNumber, historyPathCache]);

  const fetchArchived = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (searchText) params.append("search", searchText);
      if (filterType) params.append("passportType", filterType);
      const r = await fetch(`${API}/api/companies/${companyId}/passports/archived?${params}`, { headers: authHeaders() });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPassports(Array.isArray(data) ? data : []);
    } catch {
      setError("Failed to load archived passports");
    } finally {
      setIsLoading(false);
    }
  }, [companyId, searchText, filterType]);

  useEffect(() => { fetchArchived(); }, [fetchArchived]);

  useEffect(() => {
    if (!companyId) return;
    fetch(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setPassportTypes(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [companyId]);

  // Row and bulk actions
  const handleUnarchive = async (guid) => {
    if (!window.confirm("Restore this passport from the archive?")) return;
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${guid}/unarchive`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Failed"); }
      showSuccess("Passport restored from archive");
      fetchArchived();
    } catch (e) { showError(e.message); }
  };

  const bulkUnarchive = async () => {
    const selected = selectedList;
    if (!selected.length) return;
    if (!window.confirm(`Restore ${selected.length} passport${selected.length !== 1 ? "s" : ""} from archive?`)) return;
    setBulkLoading(true);
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk-unarchive`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ guids: selected.map(p => p.guid) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      showSuccess(`Restored ${d.summary?.restored || 0}, skipped ${d.summary?.skipped || 0}`);
      setSelectedPassports(new Set());
      fetchArchived();
    } catch (e) { showError(e.message); }
    finally { setBulkLoading(false); }
  };

  const bulkExportJson = async () => {
    const selectedGroups = groupedPassports.filter(group => selectedPassports.has(group.key));
    if (!selectedGroups.length) { showError("Select at least one passport."); return; }
    setBulkLoading(true);
    try {
      const exported = selectedGroups.flatMap(group => group.versions).map(p => {
        const rowData = typeof p.row_data === "string" ? JSON.parse(p.row_data) : p.row_data;
        return { guid: p.guid, passport_type: p.passport_type, model_name: p.model_name, product_id: p.product_id, release_status: p.release_status, version_number: p.version_number, archived_at: p.archived_at, ...rowData };
      });
      const exportType = exported.length === 1 ? exported[0].passport_type : null;
      const semanticModelKey = exportType
        ? (passportTypes.find((type) => type.type_name === exportType)?.semantic_model_key || "")
        : "";
      const exportPayload = buildPassportJsonLdExport(exported, exportType, { semanticModelKey });
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/ld+json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `archived-passports-${new Date().toISOString().slice(0, 10)}.jsonld`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSuccess(`Exported ${exported.length} archived passport${exported.length !== 1 ? "s" : ""} as JSON-LD`);
    } catch (e) { showError(e.message); }
    finally { setBulkLoading(false); }
  };

  const downloadQrCodes = async () => {
    const selected = selectedList;
    if (!selected.length) return;
    setQrExporting(true);
    try {
      const exportable = selected.filter(canOpenArchivedPublicVersion);
      const skipped = selected.length - exportable.length;
      if (!exportable.length) {
        throw new Error("No public released version is available for the selected archived passports.");
      }
      for (const p of exportable) {
        const canvas = document.createElement("canvas");
        const resolvedPath = await resolveArchivedPassportPath(p);
        if (!resolvedPath) throw new Error("Archived passport link is unavailable for this QR code");
        const archivedUrl = buildPublicViewerUrl(resolvedPath);
        if (!archivedUrl) throw new Error("Archived passport link is unavailable for this QR code");
        await QRCode.toCanvas(canvas, archivedUrl, { width: 300, margin: 2 });
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `archived_${p.product_id || p.guid}_v${getArchivedPublicVersionNumber(p)}.png`;
        link.click();
        await new Promise(r => setTimeout(r, 100));
      }
      setPrintQrModalOpen(false);
      showSuccess(`Downloaded ${exportable.length} QR code${exportable.length !== 1 ? "s" : ""}${skipped ? `, skipped ${skipped} unavailable version${skipped !== 1 ? "s" : ""}` : ""}`);
    } catch (e) { showError(e.message); }
    finally { setQrExporting(false); }
  };

  // Derived table data
  const groupedPassports = useMemo(() => {
    const groups = [];
    const groupsByKey = new Map();

    passports.forEach((passport) => {
      const groupKey = getPassportGroupKey(passport);
      if (!groupsByKey.has(groupKey)) {
        const group = { key: groupKey, guid: passport.guid, versions: [] };
        groupsByKey.set(groupKey, group);
        groups.push(group);
      }
      groupsByKey.get(groupKey).versions.push(passport);
    });

    return groups.map((group) => {
      const versions = [...group.versions].sort(sortPassportsByVersionDesc);
      return {
        ...group,
        versions,
        latest: versions[0],
        olderVersions: versions.slice(1),
      };
    });
  }, [passports]);

  const selectedList = groupedPassports
    .filter(group => selectedPassports.has(group.key))
    .map(group => group.latest);

  const tableColumns = useMemo(() => [
    { key: "version_number", type: "number", getValue: group => group.latest?.version_number },
    { key: "product_id", type: "string", getValue: group => group.latest?.product_id || "" },
    { key: "model_name", type: "string", getValue: group => group.latest?.model_name || "" },
    { key: "passport_type", type: "string", getValue: group => group.latest?.passport_type || "" },
    { key: "release_status", type: "string", getValue: group => group.latest?.release_status || "" },
    { key: "archived_at", type: "date", getValue: group => group.latest?.archived_at },
    { key: "archived_by_name", type: "string", getValue: group => group.latest?.archived_by_first_name ? `${group.latest.archived_by_first_name} ${group.latest.archived_by_last_name}` : group.latest?.archived_by_email || "" },
  ], []);

  const filteredAndSorted = useMemo(
    () => applyTableControls(groupedPassports, tableColumns, sortConfig, columnFilters),
    [groupedPassports, tableColumns, sortConfig, columnFilters]
  );
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / rowsPerPage));
  const paginatedPassports = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredAndSorted.slice(start, start + rowsPerPage);
  }, [filteredAndSorted, currentPage, rowsPerPage]);

  useEffect(() => { setCurrentPage(1); }, [searchText, filterType, columnFilters, sortConfig]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { setExpandedPassportGroups(new Set()); }, [searchText, filterType]);

  const toggleSort = (key) => {
    const next = getNextSortDirection(sortConfig, key);
    setSortConfig(next ? { key, direction: next } : { key: "", direction: "" });
  };

  const togglePassportGroup = (groupKey) => {
    const next = new Set(expandedPassportGroups);
    if (next.has(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
    setExpandedPassportGroups(next);
  };

  const toggleSelectAll = () => {
    const visibleKeys = paginatedPassports.map(group => group.key);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every(key => selectedPassports.has(key));
    if (allSelected) {
      const next = new Set(selectedPassports);
      visibleKeys.forEach(key => next.delete(key));
      setSelectedPassports(next);
    } else {
      const next = new Set(selectedPassports);
      visibleKeys.forEach(key => next.add(key));
      setSelectedPassports(next);
    }
  };

  const toggleSelect = (groupKey) => {
    const next = new Set(selectedPassports);
    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
    setSelectedPassports(next);
  };

  const isFiltering = !!(searchText || filterType || Object.values(columnFilters).some(Boolean));

  const openArchivedPassport = (passport) => {
    if (!canOpenArchivedPublicVersion(passport)) {
      showError("No public released version is available for this archived passport.");
      return;
    }
    resolveArchivedPassportPath(passport)
      .then((resolvedPath) => {
        if (!resolvedPath) {
          showError("Archived passport link is unavailable for this version.");
          return;
        }
        const archivedUrl = buildPublicViewerUrl(resolvedPath);
        if (!archivedUrl) {
          showError("Archived passport link is unavailable for this version.");
          return;
        }
        window.open(archivedUrl, "_blank", "noopener,noreferrer");
      })
      .catch(() => showError("Failed to open archived passport"));
  };

  const renderArchivedRow = (passport, {
    groupKey,
    isHistorical = false,
    hasOlderVersions = false,
  }) => (
    <tr
      key={`${passport.guid}-${passport.version_number}${isHistorical ? "-history" : ""}`}
      className={`passport-row-clickable${isHistorical ? " passport-row-history" : ""}`}
      onClick={() => {
        if (selectionMode) toggleSelect(groupKey);
        else openArchivedPassport(passport);
      }}
    >
      {selectionMode && (
        <td>
          {!isHistorical ? (
            <input
              type="checkbox"
              checked={selectedPassports.has(groupKey)}
              onChange={() => toggleSelect(groupKey)}
              onClick={e => e.stopPropagation()}
            />
          ) : null}
        </td>
      )}
      <td className="passport-version-col">
        <div className={`passport-version-cell${isHistorical ? " historical" : ""}`}>
          <span className="passport-version-toggle-slot" aria-hidden={!(hasOlderVersions && !isHistorical)}>
            {hasOlderVersions && !isHistorical && (
              <button
                type="button"
                className="passport-version-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePassportGroup(groupKey);
                }}
                aria-expanded={expandedPassportGroups.has(groupKey)}
                aria-label={expandedPassportGroups.has(groupKey) ? "Hide older versions" : "Show older versions"}
              >
                {expandedPassportGroups.has(groupKey) ? "▾" : "▸"}
              </button>
              )}
          </span>
          <span className="version-badge">v{passport.version_number}</span>
        </div>
      </td>
      <td>{passport.product_id ? <span className="product-id-badge">{passport.product_id}</span> : <span className="no-product-id">—</span>}</td>
      <td>{passport.model_name || "—"}</td>
      <td><span className="type-badge passport-type-badge">{passport.passport_type}</span></td>
      <td>
        <div className="passport-status-cell">
          <span className={`status-badge ${normalizePassportStatus(passport.release_status)}`}>
            {formatPassportStatus(passport.release_status)}
          </span>
        </div>
      </td>
      <td>{new Date(passport.archived_at).toLocaleDateString()}</td>
      <td className="small-text">
        {passport.archived_by_first_name && passport.archived_by_last_name
          ? `${passport.archived_by_first_name} ${passport.archived_by_last_name}`
          : passport.archived_by_email || "—"}
      </td>
      {user?.role !== "viewer" && (
        <td className="options-cell" onClick={e => e.stopPropagation()}>
          {!isHistorical && (
            <button className="archive-restore-btn" onClick={() => handleUnarchive(passport.guid)}>
              Restore
            </button>
          )}
        </td>
      )}
    </tr>
  );

  return (
    <div className="passport-list-page">
      <div className="passport-list-header">
        <div>
          <h2 className="passport-list-title">📦 Archived Passports</h2>
          <p className="passport-list-description">View and restore archived passports</p>
        </div>
        {user?.role !== "viewer" && (
          <div className="passport-list-actions">
            <button
              className={`csv-btn template-btn passport-select-toggle${selectionMode ? " active" : ""}`}
              onClick={() => {
                if (selectionMode) { setSelectionMode(false); setSelectedPassports(new Set()); }
                else setSelectionMode(true);
              }}
            >
              {selectionMode ? "Done Selecting" : "Select Passports"}
            </button>
          </div>
        )}
      </div>

      {selectionMode && selectedList.length > 0 && (
        <div className="bulk-actions-bar">
          <span className="bulk-actions-count">{selectedList.length} selected</span>
          <div className="bulk-actions-buttons">
            <button className="bulk-action-btn bulk-action-release" onClick={bulkUnarchive} disabled={bulkLoading}>
              📦 Unarchive
            </button>
            <button className="bulk-action-btn bulk-action-export" onClick={bulkExportJson} disabled={bulkLoading}>
              📦 Export JSON-LD
            </button>
            <button className="bulk-action-btn bulk-action-qr" onClick={() => setPrintQrModalOpen(true)} disabled={bulkLoading}>
              🖨 Print QR
            </button>
          </div>
          {bulkLoading && <span className="bulk-actions-loading">Processing...</span>}
        </div>
      )}

      <div className="search-bar">
        <input type="text" placeholder="Search by serial number or model..."
          value={searchText} onChange={e => setSearchText(e.target.value)} className="search-input" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="filter-select">
          <option value="">All Types</option>
          {passportTypes.map(t => (
            <option key={t.type_name} value={t.type_name}>{t.display_name || t.type_name}</option>
          ))}
        </select>
        {(searchText || filterType) && (
          <button className="clear-filter-btn" onClick={() => { setSearchText(""); setFilterType(""); }}>
            Clear
          </button>
        )}
        <button
          type="button"
          className={`table-filter-toggle-btn search-filter-toggle-btn${showFilters ? " active" : ""}`}
          onClick={() => setShowFilters(prev => !prev)}
        >
          Filter
        </button>
        {!isFiltering && (
          <div className="passport-pagination-size">
            <label htmlFor="archivedRowsPerPage" className="passport-pagination-label">Rows per page</label>
            <select id="archivedRowsPerPage" value={rowsPerPage} onChange={e => setRowsPerPage(Number(e.target.value))} className="filter-select passport-page-size-select">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {isLoading && <div className="loading">Loading archived passports...</div>}

      {!isLoading && (
        <div className="table-container">
          {filteredAndSorted.length === 0 ? (
            <div className="empty-state"><p>
              {searchText || filterType ? "No archived passports match your search/filter." : "No archived passports yet."}
            </p></div>
          ) : (
            <div className="table-scroll-wrapper">
              <table className="passports-table">
                <thead>
                  <tr>
                    {selectionMode && <th className="passport-table-select-col">
                      <input type="checkbox"
                        checked={paginatedPassports.length > 0 && paginatedPassports.every(group => selectedPassports.has(group.key))}
                        onChange={toggleSelectAll} title="Select All" />
                    </th>}
                    <th className="passport-version-col"><button type="button" className="table-sort-btn" onClick={() => toggleSort("version_number")}>Ver.{sortIndicator(sortConfig, "version_number") && ` ${sortIndicator(sortConfig, "version_number")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("product_id")}>Serial Number{sortIndicator(sortConfig, "product_id") && ` ${sortIndicator(sortConfig, "product_id")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("model_name")}>Model{sortIndicator(sortConfig, "model_name") && ` ${sortIndicator(sortConfig, "model_name")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("passport_type")}>Type{sortIndicator(sortConfig, "passport_type") && ` ${sortIndicator(sortConfig, "passport_type")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("release_status")}>Last Status{sortIndicator(sortConfig, "release_status") && ` ${sortIndicator(sortConfig, "release_status")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("archived_at")}>Archived{sortIndicator(sortConfig, "archived_at") && ` ${sortIndicator(sortConfig, "archived_at")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("archived_by_name")}>Archived By{sortIndicator(sortConfig, "archived_by_name") && ` ${sortIndicator(sortConfig, "archived_by_name")}`}</button></th>
                    {user?.role !== "viewer" && <th>Actions</th>}
                  </tr>
                  {showFilters && <tr className="table-filter-row">
                    {selectionMode && <th></th>}
                    <th><input className="table-filter-input" value={columnFilters.version_number || ""} onChange={e => setColumnFilters(prev => ({ ...prev, version_number: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.product_id || ""} onChange={e => setColumnFilters(prev => ({ ...prev, product_id: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.model_name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, model_name: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.passport_type || ""} onChange={e => setColumnFilters(prev => ({ ...prev, passport_type: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.release_status || ""} onChange={e => setColumnFilters(prev => ({ ...prev, release_status: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.archived_at || ""} onChange={e => setColumnFilters(prev => ({ ...prev, archived_at: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.archived_by_name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, archived_by_name: e.target.value }))} placeholder="Filter" /></th>
                    {user?.role !== "viewer" && <th></th>}
                  </tr>}
                </thead>
                <tbody>
                  {paginatedPassports.map((group) => (
                    <React.Fragment key={group.key}>
                      {renderArchivedRow(group.latest, {
                        groupKey: group.key,
                        hasOlderVersions: group.olderVersions.length > 0,
                      })}
                      {expandedPassportGroups.has(group.key) && group.olderVersions.map((version) =>
                        renderArchivedRow(version, {
                          groupKey: group.key,
                          isHistorical: true,
                        })
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isLoading && !isFiltering && filteredAndSorted.length > 0 && (
        <div className="passport-pagination">
          <div className="passport-pagination-summary">
            Showing {(currentPage - 1) * rowsPerPage + 1}-
            {Math.min(currentPage * rowsPerPage, filteredAndSorted.length)} of {filteredAndSorted.length}
          </div>
          <div className="passport-pagination-controls">
            <button type="button" className="passport-page-btn"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
              Previous
            </button>
            <span className="passport-page-indicator">Page {currentPage} of {totalPages}</span>
            <button type="button" className="passport-page-btn"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
              Next
            </button>
          </div>
        </div>
      )}

      {printQrModalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !qrExporting) setPrintQrModalOpen(false); }}>
          <div className="modal-box">
            <div className="modal-header">
              <h3>Print QR Codes</h3>
              <button className="modal-close" onClick={() => !qrExporting && setPrintQrModalOpen(false)}>X</button>
            </div>
            <div className="modal-body">
              <p>Download QR code images for {selectedList.length} selected archived passport{selectedList.length !== 1 ? "s" : ""}.</p>
            </div>
            <div className="modal-footer">
              <button className="submit-btn" onClick={downloadQrCodes} disabled={qrExporting}>
                {qrExporting ? "Generating..." : "Download QR Codes"}
              </button>
              <button className="cancel-btn" onClick={() => !qrExporting && setPrintQrModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArchivedPassports;
