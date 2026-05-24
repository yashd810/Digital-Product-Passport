import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { applyTableControls, getNextSortDirection } from "../../../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { isObsoletePassportStatus, normalizePassportStatus } from "../../../../passports/utils/passportStatus";
import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../../../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import {
  calcCompleteness,
  formatPassportTypeLabel,
  getPassportDateTimestamp,
  getPassportDateValue,
  getPassportGroupKey,
  getPassportSerialNumberForType,
  sortPassportsByVersionDesc,
} from "../utils/passportListHelpers";

const API = import.meta.env.VITE_API_URL || "";

export function usePassportListState({ user, companyId, filterByUser }) {
  const { passportType, productKey, productCategoryKey } = useParams();

  const [passports, setPassports] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [printQrModalOpen, setPrintQrModalOpen] = useState(false);
  const [qrExporting, setQrExporting] = useState(false);
  const [releaseModal, setReleaseModal] = useState(null);
  const [csvModal, setCsvModal] = useState(null);
  const [deviceModal, setDeviceModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [bulkReviseOpen, setBulkReviseOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [bulkWorkflowOpen, setBulkWorkflowOpen] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const [selectedPassports, setSelectedPassports] = useState(new Set());
  const [expandedPassportGroups, setExpandedPassportGroups] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [allPassportTypes, setAllPassportTypes] = useState([]);
  const [pinnedGuids, setPinnedGuids] = useState(new Set());

  const activeType = passportType || null;
  const activeProductCategory = productKey
    ? decodeURIComponent(productKey)
    : productCategoryKey
      ? decodeURIComponent(productCategoryKey)
      : null;

  const activeTypeData = useMemo(
    () => allPassportTypes.find((type) => type.typeName === activeType),
    [activeType, allPassportTypes]
  );

  const showSuccess = useCallback((msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  }, []);

  const showError = useCallback((msg) => {
    setError(msg);
    setTimeout(() => setError(""), 5000);
  }, []);

  const getViewerPath = useCallback((passport, { forcePreview = false } = {}) => {
    if (!passport?.dppId) return null;

    const normalizedStatus = normalizePassportStatus(passport.releaseStatus);
    if (!forcePreview && normalizedStatus === "released" && passport.internalAliasId) {
      return buildPublicPassportPath({
        companyName: user?.companyName,
        modelName: passport.modelName,
        internalAliasId: passport.internalAliasId,
      });
    }

    if (!forcePreview && isObsoletePassportStatus(normalizedStatus) && passport.internalAliasId && passport.versionNumber != null) {
      return buildInactivePassportPath({
        companyName: user?.companyName,
        modelName: passport.modelName,
        internalAliasId: passport.internalAliasId,
        versionNumber: passport.versionNumber,
      });
    }

    return buildPreviewPassportPath({
      companyName: user?.companyName,
      modelName: passport.modelName,
      internalAliasId: passport.internalAliasId,
      previewId: passport.dppId,
    });
  }, [user?.companyName]);

  const openPassportViewer = useCallback((passport, options = {}) => {
    const path = getViewerPath(passport, options);
    if (!path) return;
    const normalizedStatus = normalizePassportStatus(passport?.releaseStatus);
    const isPublicRoute = !options.forcePreview && (normalizedStatus === "released" || isObsoletePassportStatus(normalizedStatus));
    const url = isPublicRoute ? buildPublicViewerUrl(path) : `${window.location.origin}${path}`;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [getViewerPath]);

  useEffect(() => {
    if (!companyId || !user?.id) return;

    try {
      const raw = localStorage.getItem(`passport_pins_${companyId}_${user.id}`);
      setPinnedGuids(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setPinnedGuids(new Set());
    }
  }, [companyId, user?.id]);

  const togglePin = useCallback((dppId) => {
    if (!companyId || !user?.id) return;

    const storageKey = `passport_pins_${companyId}_${user.id}`;
    setPinnedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(dppId)) next.delete(dppId);
      else next.add(dppId);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setOpenMenuId(null);
  }, [companyId, user?.id]);

  useEffect(() => {
    setSearchText("");
    setFilterStatus("");
    setOpenMenuId(null);
    setSelectionMode(false);
    setSelectedPassports(new Set());
    setExpandedPassportGroups(new Set());
    setShowFilters(false);
    setSortConfig({ key: "createdAt", direction: "desc" });
    setColumnFilters({});
  }, [filterByUser, passportType, productKey, productCategoryKey]);

  useEffect(() => {
    if (!companyId) return;

    fetchWithAuth(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setAllPassportTypes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [companyId]);

  const fetchPassports = useCallback(async () => {
    if (!activeType && !filterByUser && !activeProductCategory) return;

    try {
      setIsLoading(true);
      setError("");

      const fetchForTypes = async (types) => {
        let all = [];

        for (const type of types) {
          const params = new URLSearchParams({ passportType: type.typeName });
          if (searchText) params.append("search", searchText);
          if (filterStatus) params.append("status", filterStatus);

          const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports?${params}`, {
            headers: authHeaders(),
          });
          if (response.ok) {
            const data = await response.json();
            all = [...all, ...data];
          }
        }

        return all;
      };

      if (filterByUser) {
        const typeResponse = await fetchWithAuth(`${API}/api/companies/${companyId}/passport-types`, {
          headers: authHeaders(),
        });
        const types = typeResponse.ok ? await typeResponse.json() : [];
        const all = (await fetchForTypes(Array.isArray(types) ? types : []))
          .filter((passport) => passport.createdBy === user?.id)
          .sort((left, right) => getPassportDateTimestamp(right) - getPassportDateTimestamp(left));
        setPassports(all);
        return;
      }

      if (activeProductCategory) {
        const typeResponse = await fetchWithAuth(`${API}/api/companies/${companyId}/passport-types`, {
          headers: authHeaders(),
        });
        const types = typeResponse.ok ? await typeResponse.json() : [];
        const all = await fetchForTypes(
          (Array.isArray(types) ? types : []).filter((type) => type.productCategory === activeProductCategory)
        );
        all.sort((left, right) => getPassportDateTimestamp(right) - getPassportDateTimestamp(left));
        setPassports(all);
        return;
      }

      const params = new URLSearchParams({ passportType: activeType });
      if (searchText) params.append("search", searchText);
      if (filterStatus) params.append("status", filterStatus);

      const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports?${params}`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error();

      const data = await response.json();
      data.sort((left, right) => {
        if (left.dppId !== right.dppId) return left.dppId.localeCompare(right.dppId);
        return right.versionNumber - left.versionNumber;
      });
      setPassports(data);
    } catch {
      setError("Failed to load passports");
    } finally {
      setIsLoading(false);
    }
  }, [activeProductCategory, activeType, companyId, filterByUser, filterStatus, searchText, user?.id]);

  useEffect(() => {
    fetchPassports();
  }, [fetchPassports]);

  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = (event) => {
      if (event.target.closest(".kebab-menu-btn") || event.target.closest(".kebab-menu-container")) return;
      if (event.target.closest("tr.passport-row-clickable")) return;
      setOpenMenuId(null);
      setMenuAnchorRect(null);
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openMenuId]);

  const pageTitle = filterByUser
    ? "My Passports"
    : activeProductCategory
      ? activeProductCategory
      : activeType
        ? `${activeTypeData?.displayName || formatPassportTypeLabel(activeType)} Passports`
        : "Passports";

  const displayedPassports = useMemo(() => (
    [...passports].sort((left, right) => {
      const leftPinWeight = pinnedGuids.has(left.dppId) ? 0 : 1;
      const rightPinWeight = pinnedGuids.has(right.dppId) ? 0 : 1;
      return leftPinWeight - rightPinWeight;
    })
  ), [passports, pinnedGuids]);

  const groupedPassports = useMemo(() => {
    const groups = [];
    const groupsByKey = new Map();

    displayedPassports.forEach((passport) => {
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
  }, [displayedPassports]);

  const tableColumns = useMemo(() => {
    const columns = [
      { key: "versionNumber", type: "number", getValue: (group) => group.latest?.versionNumber },
      { key: "serialNumber", type: "string", getValue: (group) => getPassportSerialNumberForType(group.latest, allPassportTypes) },
      { key: "modelName", type: "string", getValue: (group) => group.latest?.modelName || "" },
      { key: "createdAt", type: "date", getValue: (group) => getPassportDateValue(group.latest) },
      { key: "releaseStatus", type: "string", getValue: (group) => group.latest?.releaseStatus || "" },
      { key: "completeness", type: "number", getValue: (group) => calcCompleteness(group.latest, allPassportTypes) ?? -1 },
    ];

    if (filterByUser) {
      columns.splice(3, 0, {
        key: "passportType",
        type: "string",
        getValue: (group) => group.latest?.passportType || activeType || "",
      });
    } else {
      columns.push({
        key: "createdBy",
        type: "string",
        getValue: (group) => (
          group.latest?.createdByName || group.latest?.createdByEmail || ""
        ),
      });
    }

    return columns;
  }, [activeType, allPassportTypes, filterByUser]);

  const filteredAndSortedPassports = useMemo(
    () => applyTableControls(groupedPassports, tableColumns, sortConfig, columnFilters),
    [columnFilters, groupedPassports, sortConfig, tableColumns]
  );

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedPassports.length / rowsPerPage));

  const paginatedPassports = useMemo(() => {
    if (searchText || filterStatus || Object.values(columnFilters).some(Boolean)) {
      return filteredAndSortedPassports;
    }

    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredAndSortedPassports.slice(startIndex, startIndex + rowsPerPage);
  }, [columnFilters, currentPage, filterStatus, filteredAndSortedPassports, rowsPerPage, searchText]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterStatus, columnFilters, sortConfig, activeType, activeProductCategory, filterByUser, selectionMode]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const updateColumnFilter = useCallback((key, value) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSort = useCallback((key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  }, [sortConfig]);

  const isFiltering = !!(searchText || filterStatus || Object.values(columnFilters).some(Boolean));
  const selectedPassportList = passports.filter((passport) => selectedPassports.has(`${passport.dppId}-${passport.versionNumber}`));

  const togglePassportGroup = useCallback((groupKey) => {
    setExpandedPassportGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const getVisiblePassportKeys = useCallback((groups) => {
    const keys = [];
    groups.forEach((group) => {
      if (!group?.latest) return;
      keys.push(`${group.latest.dppId}-${group.latest.versionNumber}`);
      if (expandedPassportGroups.has(group.key)) {
        group.olderVersions.forEach((version) => {
          keys.push(`${version.dppId}-${version.versionNumber}`);
        });
      }
    });
    return keys;
  }, [expandedPassportGroups]);

  const toggleSelectAll = useCallback(() => {
    const visibleKeys = getVisiblePassportKeys(paginatedPassports);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedPassports.has(key));

    if (allVisibleSelected) {
      const next = new Set(selectedPassports);
      visibleKeys.forEach((key) => next.delete(key));
      setSelectedPassports(next);
      return;
    }

    const next = new Set(selectedPassports);
    visibleKeys.forEach((key) => next.add(key));
    setSelectedPassports(next);
  }, [getVisiblePassportKeys, paginatedPassports, selectedPassports]);

  const toggleSelectPassport = useCallback((dppId, version) => {
    const key = `${dppId}-${version}`;
    const next = new Set(selectedPassports);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedPassports(next);
  }, [selectedPassports]);

  const openMenu = useCallback((event, menuId) => {
    event.stopPropagation();
    event.preventDefault();

    if (openMenuId === menuId) {
      setOpenMenuId(null);
      setMenuAnchorRect(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAnchorRect({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    });
    setOpenMenuId(menuId);
  }, [openMenuId]);

  return {
    activeType,
    allPassportTypes,
    archiveConfirm,
    bulkActionLoading,
    bulkCreateOpen,
    bulkReviseOpen,
    bulkWorkflowOpen,
    columnFilters,
    csvModal,
    currentPage,
    deviceModal,
    error,
    expandedPassportGroups,
    exportModalOpen,
    fetchPassports,
    filteredAndSortedPassports,
    filterStatus,
    getViewerPath,
    getVisiblePassportKeys,
    historyModal,
    isFiltering,
    isLoading,
    menuAnchorRect,
    openMenu,
    openMenuId,
    openPassportViewer,
    pageTitle,
    paginatedPassports,
    passports,
    pinnedGuids,
    printQrModalOpen,
    qrExporting,
    releaseModal,
    rowsPerPage,
    searchText,
    selectedPassportList,
    selectedPassports,
    selectionMode,
    setArchiveConfirm,
    setBulkActionLoading,
    setBulkCreateOpen,
    setBulkReviseOpen,
    setBulkWorkflowOpen,
    setColumnFilters,
    setCsvModal,
    setCurrentPage,
    setDeviceModal,
    setExpandedPassportGroups,
    setExportModalOpen,
    setFilterStatus,
    setHistoryModal,
    setMenuAnchorRect,
    setOpenMenuId,
    setPassports,
    setPrintQrModalOpen,
    setQrExporting,
    setReleaseModal,
    setRowsPerPage,
    setSearchText,
    setSelectedPassports,
    setSelectionMode,
    setShowFilters,
    showError,
    showFilters,
    showSuccess,
    sortConfig,
    successMsg,
    togglePassportGroup,
    togglePin,
    toggleSelectAll,
    toggleSelectPassport,
    toggleSort,
    totalPages,
    updateColumnFilter,
  };
}
