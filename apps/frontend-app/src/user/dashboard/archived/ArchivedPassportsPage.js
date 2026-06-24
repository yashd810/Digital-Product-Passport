import React, { useState, useEffect, useCallback, useMemo } from "react";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { buildPassportJsonLdExport } from "../../../shared/utils/semanticPassportExport";
import { formatPassportStatus, isPublishedPassportStatus, normalizePassportStatus } from "../../../passports/utils/passportStatus";
import { buildPublicViewerUrl } from "../../../passports/utils/publicViewerUrl";
import { renderPassportQrToCanvas } from "../../../passport-viewer/utils/QRcode";
import { getPassportSerialNumberForType } from "../passports/utils/passportListHelpers";
import "../../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

// ─────────────────────────────────────────────────────────────────────────────
// Archived Passport Collection Helpers
// ─────────────────────────────────────────────────────────────────────────────
function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.versionNumber || 0) - Number(a?.versionNumber || 0);
  if (versionDiff !== 0) return versionDiff;
  return new Date(b?.archivedAt || b?.updatedAt || b?.createdAt || 0).getTime()
    - new Date(a?.archivedAt || a?.updatedAt || a?.createdAt || 0).getTime();
}

function getPassportGroupKey(passport) {
  if (passport?.lineageId) return `lineage:${passport.lineageId}`;
  if (passport?.internalAliasId) return `product:${passport.passportType || "passport"}:${passport.internalAliasId}`;
  return `dppId:${passport?.dppId || ""}`;
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
  const [sortConfig, setSortConfig] = useState({ key: "archivedAt", direction: "desc" });
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
    `${passport?.dppId || ""}:${passport?.versionNumber || ""}:${passport?.publicVersionNumber || ""}`
  ), []);
  const getArchivedPublicVersionNumber = useCallback((passport) => {
    if (
      isPublishedPassportStatus(passport?.releaseStatus) &&
      passport?.isPublic !== false
    ) {
      const currentVersion = Number.parseInt(passport?.versionNumber, 10);
      if (Number.isFinite(currentVersion) && currentVersion > 0) return currentVersion;
    }
    const parsed = Number.parseInt(passport?.publicVersionNumber, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return null;
  }, []);
  const canOpenArchivedPublicVersion = useCallback((passport) => (
    !!passport?.internalAliasId && !!getArchivedPublicVersionNumber(passport)
  ), [getArchivedPublicVersionNumber]);

  // Data loading
  const resolveArchivedPassportPath = useCallback(async (passport) => {
    if (!passport?.dppId) return null;

    const cacheKey = getArchivedPathCacheKey(passport);
    if (historyPathCache[cacheKey]) return historyPathCache[cacheKey];

    const publicVersionNumber = getArchivedPublicVersionNumber(passport);
    if (!publicVersionNumber) return null;

    const response = await fetchWithAuth(
      `${api}/api/companies/${companyId}/passports/${passport.dppId}/history`,
      { headers: authHeaders() }
    );
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const matchingEntry = history.find((entry) => Number(entry.versionNumber ?? entry.versionNumber) === Number(publicVersionNumber));
    const resolvedPath = matchingEntry?.isCurrent
      ? matchingEntry?.publicPath
      : matchingEntry?.inactivePath;

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
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/archived?${params}`, { headers: authHeaders() });
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
    fetchWithAuth(`${api}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setPassportTypes(Array.isArray(d) ? d : []))
      .catch((error) => console.warn("Ignored async error", error));
  }, [companyId]);

  // Row and bulk actions
  const handleUnarchive = async (dppId) => {
    if (!window.confirm("Restore this passport from the archive?")) return;
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/${dppId}/unarchive`, {
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
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/bulk-unarchive`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dppIds: selected.map(p => p.dppId) }),
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
      const selectedVersions = selectedGroups.flatMap(group => group.versions);
      const groupedByType = selectedVersions.reduce((acc, passport) => {
        const passportType = passport.passportType;
        if (!acc[passportType]) acc[passportType] = [];
        acc[passportType].push(passport);
        return acc;
      }, {});

      let exportedCount = 0;
      const fileCount = Object.keys(groupedByType).length;
      for (const [passportType, passportsForType] of Object.entries(groupedByType)) {
        const typeResponse = await fetchWithAuth(`${api}/api/passport-types/${passportType}`);
        if (!typeResponse.ok) throw new Error(`Failed to fetch field definitions for ${passportType}`);
        const typeData = await typeResponse.json();
        const semanticModelKey = typeData.semanticModelKey || "";
        const semanticModel = typeData.semanticModel || null;

        const exported = [];
        for (const passport of passportsForType) {
          const query = new URLSearchParams({
            passportType,
            representation: "full",
          });
          if (passport.versionNumber !== null && passport.versionNumber !== undefined && passport.versionNumber !== "") {
            query.set("versionNumber", String(passport.versionNumber));
          }
          const response = await fetchWithAuth(
            `${api}/api/companies/${companyId}/passports/${passport.dppId}?${query.toString()}`,
            { headers: authHeaders() }
          );
          if (!response.ok) continue;
          exported.push(await response.json());
        }

        if (!exported.length) continue;

        const exportPayload = buildPassportJsonLdExport(exported, passportType, { semanticModelKey, semanticModel, typeDef: typeData });
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/ld+json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const filenamePrefix = fileCount > 1 ? `${passportType}-` : "";
        a.download = `${filenamePrefix}archived-passports-${new Date().toISOString().slice(0, 10)}.jsonld`;
        a.click();
        URL.revokeObjectURL(a.href);
        exportedCount += exported.length;
      }

      if (!exportedCount) {
        throw new Error("Could not fetch any archived passport data.");
      }

      showSuccess(`Exported ${exportedCount} archived passport${exportedCount !== 1 ? "s" : ""} as JSON-LD`);
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
        await renderPassportQrToCanvas(canvas, {
          url: archivedUrl,
          granularity: p.granularity || "item",
          width: 300,
          margin: 2,
        });
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `archived_${p.dppId || "passport"}_v${getArchivedPublicVersionNumber(p)}.png`;
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
        const group = { key: groupKey, dppId: passport.dppId, versions: [] };
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
    { key: "versionNumber", type: "number", getValue: group => group.latest?.versionNumber },
    { key: "serialNumber", type: "string", getValue: group => getPassportSerialNumberForType(group.latest, passportTypes) },
    { key: "modelName", type: "string", getValue: group => group.latest?.modelName || "" },
    { key: "passportType", type: "string", getValue: group => group.latest?.passportType || "" },
    { key: "releaseStatus", type: "string", getValue: group => group.latest?.releaseStatus || "" },
    { key: "archivedAt", type: "date", getValue: group => group.latest?.archivedAt },
    { key: "archivedByName", type: "string", getValue: group => group.latest?.archivedByName || group.latest?.archivedByEmail || "" },
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
      key={`${passport.dppId}-${passport.versionNumber}${isHistorical ? "-history" : ""}`}
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
          <span className="version-badge">v{passport.versionNumber}</span>
        </div>
      </td>
      <td>{getPassportSerialNumberForType(passport, passportTypes) ? <span className="product-id-badge">{getPassportSerialNumberForType(passport, passportTypes)}</span> : <span className="no-product-id">—</span>}</td>
      <td>{passport.modelName || "—"}</td>
      <td><span className="type-badge passport-type-badge">{passport.passportType}</span></td>
      <td>
        <div className="passport-status-cell">
          <span className={`status-badge ${normalizePassportStatus(passport.releaseStatus)}`}>
            {formatPassportStatus(passport.releaseStatus)}
          </span>
        </div>
      </td>
      <td>{new Date(passport.archivedAt).toLocaleDateString()}</td>
      <td className="small-text">
        {passport.archivedByName || passport.archivedByEmail || "—"}
      </td>
      {user?.role !== "viewer" && (
        <td className="options-cell" onClick={e => e.stopPropagation()}>
          {!isHistorical && (
            <button className="archive-restore-btn" onClick={() => handleUnarchive(passport.dppId)}>
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
            <option key={t.typeName} value={t.typeName}>{t.displayName || t.typeName}</option>
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
                    <th className="passport-version-col"><button type="button" className="table-sort-btn" onClick={() => toggleSort("versionNumber")}>Ver.{sortIndicator(sortConfig, "versionNumber") && ` ${sortIndicator(sortConfig, "versionNumber")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("serialNumber")}>Serial Number{sortIndicator(sortConfig, "serialNumber") && ` ${sortIndicator(sortConfig, "serialNumber")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("modelName")}>Model{sortIndicator(sortConfig, "modelName") && ` ${sortIndicator(sortConfig, "modelName")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("passportType")}>Type{sortIndicator(sortConfig, "passportType") && ` ${sortIndicator(sortConfig, "passportType")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("releaseStatus")}>Last Status{sortIndicator(sortConfig, "releaseStatus") && ` ${sortIndicator(sortConfig, "releaseStatus")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("archivedAt")}>Archived{sortIndicator(sortConfig, "archivedAt") && ` ${sortIndicator(sortConfig, "archivedAt")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("archivedByName")}>Archived By{sortIndicator(sortConfig, "archivedByName") && ` ${sortIndicator(sortConfig, "archivedByName")}`}</button></th>
                    {user?.role !== "viewer" && <th>Actions</th>}
                  </tr>
                  {showFilters && <tr className="table-filter-row">
                    {selectionMode && <th></th>}
                    <th><input className="table-filter-input" value={columnFilters.versionNumber || ""} onChange={e => setColumnFilters(prev => ({ ...prev, versionNumber: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.serialNumber || ""} onChange={e => setColumnFilters(prev => ({ ...prev, serialNumber: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.modelName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, modelName: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.passportType || ""} onChange={e => setColumnFilters(prev => ({ ...prev, passportType: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.releaseStatus || ""} onChange={e => setColumnFilters(prev => ({ ...prev, releaseStatus: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.archivedAt || ""} onChange={e => setColumnFilters(prev => ({ ...prev, archivedAt: e.target.value }))} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.archivedByName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, archivedByName: e.target.value }))} placeholder="Filter" /></th>
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
