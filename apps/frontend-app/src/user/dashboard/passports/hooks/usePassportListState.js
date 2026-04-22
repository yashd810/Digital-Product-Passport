import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { applyTableControls, getNextSortDirection } from "../../../../shared/table/tableControls";
import { authHeaders } from "../../../../shared/api/authHeaders";
import { normalizePassportStatus } from "../../../../passports/utils/passportStatus";
import { buildPreviewPassportPath, buildPublicPassportPath } from "../../../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import {
  calcCompleteness,
  formatPassportTypeLabel,
  getPassportGroupKey,
  sortPassportsByVersionDesc,
} from "../utils/passportListHelpers";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function usePassportListState({ user, companyId, filterByUser }) {
  const { passportType, productKey, umbrellaKey } = useParams();

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
  const [sortConfig, setSortConfig] = useState({ key: "created_at", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [allPassportTypes, setAllPassportTypes] = useState([]);
  const [pinnedGuids, setPinnedGuids] = useState(new Set());

  const activeType = passportType || null;
  const activeProductCategory = productKey
    ? decodeURIComponent(productKey)
    : umbrellaKey
      ? decodeURIComponent(umbrellaKey)
      : null;

  const activeTypeData = useMemo(
    () => allPassportTypes.find((type) => type.type_name === activeType),
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
    if (!passport?.guid) return null;

    const normalizedStatus = normalizePassportStatus(passport.release_status);
    if (!forcePreview && normalizedStatus === "released" && passport.product_id) {
      return buildPublicPassportPath({
        companyName: user?.company_name,
        modelName: passport.model_name,
        productId: passport.product_id,
      });
    }

    return buildPreviewPassportPath({
      companyName: user?.company_name,
      modelName: passport.model_name,
      productId: passport.product_id,
      previewId: passport.guid,
    });
  }, [user?.company_name]);

  const openPassportViewer = useCallback((passport, options = {}) => {
    const path = getViewerPath(passport, options);
    if (!path) return;
    const url = options.forcePreview ? `${window.location.origin}${path}` : buildPublicViewerUrl(path);
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

  const togglePin = useCallback((guid) => {
    if (!companyId || !user?.id) return;

    const storageKey = `passport_pins_${companyId}_${user.id}`;
    setPinnedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
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
    setSortConfig({ key: "created_at", direction: "desc" });
    setColumnFilters({});
  }, [filterByUser, passportType, productKey, umbrellaKey]);

  useEffect(() => {
    if (!companyId) return;

    fetch(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
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
          const params = new URLSearchParams({ passportType: type.type_name });
          if (searchText) params.append("search", searchText);
          if (filterStatus) params.append("status", filterStatus);

          const response = await fetch(`${API}/api/companies/${companyId}/passports?${params}`, {
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
        const typeResponse = await fetch(`${API}/api/companies/${companyId}/passport-types`, {
          headers: authHeaders(),
        });
        const types = typeResponse.ok ? await typeResponse.json() : [];
        const all = (await fetchForTypes(Array.isArray(types) ? types : []))
          .filter((passport) => passport.created_by === user?.id)
          .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
        setPassports(all);
        return;
      }

      if (activeProductCategory) {
        const typeResponse = await fetch(`${API}/api/companies/${companyId}/passport-types`, {
          headers: authHeaders(),
        });
        const types = typeResponse.ok ? await typeResponse.json() : [];
        const all = await fetchForTypes(
          (Array.isArray(types) ? types : []).filter((type) => type.umbrella_category === activeProductCategory)
        );
        all.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
        setPassports(all);
        return;
      }

      const params = new URLSearchParams({ passportType: activeType });
      if (searchText) params.append("search", searchText);
      if (filterStatus) params.append("status", filterStatus);

      const response = await fetch(`${API}/api/companies/${companyId}/passports?${params}`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error();

      const data = await response.json();
      data.sort((left, right) => {
        if (left.guid !== right.guid) return left.guid.localeCompare(right.guid);
        return right.version_number - left.version_number;
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
        ? `${activeTypeData?.display_name || formatPassportTypeLabel(activeType)} Passports`
        : "Passports";

  const displayedPassports = useMemo(() => (
    [...passports].sort((left, right) => {
      const leftPinWeight = pinnedGuids.has(left.guid) ? 0 : 1;
      const rightPinWeight = pinnedGuids.has(right.guid) ? 0 : 1;
      return leftPinWeight - rightPinWeight;
    })
  ), [passports, pinnedGuids]);

  const groupedPassports = useMemo(() => {
    const groups = [];
    const groupsByKey = new Map();

    displayedPassports.forEach((passport) => {
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
  }, [displayedPassports]);

  const tableColumns = useMemo(() => {
    const columns = [
      { key: "version_number", type: "number", getValue: (group) => group.latest?.version_number },
      { key: "product_id", type: "string", getValue: (group) => group.latest?.product_id || "" },
      { key: "model_name", type: "string", getValue: (group) => group.latest?.model_name || "" },
      { key: "created_at", type: "date", getValue: (group) => group.latest?.created_at },
      { key: "release_status", type: "string", getValue: (group) => group.latest?.release_status || "" },
      { key: "completeness", type: "number", getValue: (group) => calcCompleteness(group.latest, allPassportTypes) ?? -1 },
    ];

    if (filterByUser) {
      columns.splice(3, 0, {
        key: "passport_type",
        type: "string",
        getValue: (group) => group.latest?.passport_type || activeType || "",
      });
    } else {
      columns.push({
        key: "created_by",
        type: "string",
        getValue: (group) => (
          group.latest?.first_name && group.latest?.last_name
            ? `${group.latest.first_name} ${group.latest.last_name}`
            : group.latest?.created_by_email || ""
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
  const selectedPassportList = passports.filter((passport) => selectedPassports.has(`${passport.guid}-${passport.version_number}`));

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
      keys.push(`${group.latest.guid}-${group.latest.version_number}`);
      if (expandedPassportGroups.has(group.key)) {
        group.olderVersions.forEach((version) => {
          keys.push(`${version.guid}-${version.version_number}`);
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

  const toggleSelectPassport = useCallback((guid, version) => {
    const key = `${guid}-${version}`;
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
