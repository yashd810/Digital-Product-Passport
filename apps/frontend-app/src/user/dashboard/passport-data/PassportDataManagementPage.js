import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import "../../../shared/styles/Dashboard.css";
import "./PassportDataManagement.css";

const API = import.meta.env.VITE_API_URL || "";

const META_KEYS = new Set([
  "id", "companyId", "releaseStatus", "versionNumber", "isEditable", "createdAt", "updatedAt",
  "updatedBy", "deletedAt", "qrCode", "createdBy", "fieldLabel", "createdByEmail",
  "firstName", "lastName", "_templateId", "_templateName", "_modelLockedKeys",
]);

const BASE_FIELDS = [
  { key: "dppId", label: "DPP ID", type: "text", system: true },
  { key: "internalAliasId", label: "Internal Alias ID", type: "text", system: true },
  { key: "modelName", label: "Model Name", type: "text", system: true },
];

const DEFAULT_SOURCE_CONFIG = {
  url: "",
  method: "GET",
  recordPath: "",
  headers: "{}",
  body: "",
};

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getRowIdentifier(row) {
  return row?.dppId || row?.internalAliasId || row?.matchProductId || row?.modelName || "New row";
}

function isRowEditable(row) {
  if (row?.isEditable === true || row?.isEditable === "true") return true;
  if (!row?.dppId) return true;
  return ["draft", "in_revision"].includes(normalizeText(row?.releaseStatus));
}

function getRowStatus(row) {
  if (!row?.dppId) return "new";
  return row?.releaseStatus || (isRowEditable(row) ? "editable" : "locked");
}

function serializeCell(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseCsvRows(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      current.push(value);
      if (current.some((cell) => String(cell).trim())) rows.push(current);
      current = [];
      value = "";
    } else {
      value += char;
    }
  }

  current.push(value);
  if (current.some((cell) => String(cell).trim())) rows.push(current);
  if (!rows.length) return [];

  const headers = rows[0].map((cell) => String(cell || "").trim()).filter(Boolean);
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => headers.reduce((acc, header, index) => {
      acc[header] = row[index] ?? "";
      return acc;
    }, {}));
}

function exportRowsToCsv(rows, fields, filename) {
  const esc = (value) => `"${serializeCell(value).replace(/"/g, "\"\"")}"`;
  const lines = [
    fields.map((field) => esc(field.key)).join(","),
    ...rows.map((row) => fields.map((field) => esc(row[field.key] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseJsonText(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function buildFieldList(schemaFields = [], rows = []) {
  const fieldMap = new Map();
  BASE_FIELDS.forEach((field) => fieldMap.set(field.key, field));
  schemaFields.forEach((field) => {
    if (field?.key && !META_KEYS.has(field.key)) {
      fieldMap.set(field.key, {
        key: field.key,
        label: field.label || field.key,
        type: field.type || "text",
        system: !!field.system,
      });
    }
  });
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!META_KEYS.has(key) && !fieldMap.has(key)) {
        fieldMap.set(key, { key, label: key, type: "text" });
      }
    });
  });
  return [...fieldMap.values()];
}

function buildSerializableRows(rows) {
  return rows.map((row) => Object.entries(row || {}).reduce((acc, [key, value]) => {
    if (META_KEYS.has(key) || value === undefined) return acc;
    acc[key] = value;
    return acc;
  }, {})).filter((row) => Object.keys(row).length > 0);
}

function buildTemplatePrefill(template) {
  const values = {};
  const modelKeys = new Set();
  (template?.fields || []).forEach((field) => {
    if (!field?.fieldKey) return;
    values[field.fieldKey] = field.fieldValue ?? "";
    if (field.isModelData) modelKeys.add(field.fieldKey);
  });
  return { values, modelKeys };
}

function valueForSort(row, key) {
  if (key === "__status") return getRowStatus(row);
  return row?.[key] ?? "";
}

function PassportDataManagementPage({ companyId, user }) {
  const fileInputRef = useRef(null);
  const [passportTypes, setPassportTypes] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [schemaFields, setSchemaFields] = useState([]);
  const [rows, setRows] = useState([]);
  const [baselineRows, setBaselineRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDetail, setTemplateDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [filters, setFilters] = useState({ search: "", status: "all", fields: [], fieldValue: "" });
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "" });
  const [activeView, setActiveView] = useState("all");
  const [showSources, setShowSources] = useState(false);
  const [sourceConfig, setSourceConfig] = useState(DEFAULT_SOURCE_CONFIG);
  const [sourceFieldMap, setSourceFieldMap] = useState([{ source: "serialNumber", target: "internalAliasId" }]);
  const [erpPresets, setErpPresets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [jobForm, setJobForm] = useState({ name: "", startAt: "", intervalMinutes: "", isActive: true });
  const [batchCount, setBatchCount] = useState("10");
  const [serialPaste, setSerialPaste] = useState("");
  const [jsonPaste, setJsonPaste] = useState("");

  const canManagePassportData = ["editor", "company_admin", "super_admin"].includes(user?.role);
  const showReadOnlyNotice = Boolean(user?.role) && !canManagePassportData;
  const apiBase = `${API}/api/companies/${companyId}/passport-data-management`;

  const templatePrefill = useMemo(() => buildTemplatePrefill(templateDetail), [templateDetail]);
  const fields = useMemo(() => buildFieldList(schemaFields, rows), [schemaFields, rows]);
  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const baselineMap = useMemo(() => {
    const map = new Map();
    baselineRows.forEach((row) => {
      const key = row?.dppId ? `dpp:${row.dppId}` : row?.internalAliasId ? `alias:${row.internalAliasId}` : "";
      if (key) map.set(key, row);
    });
    return map;
  }, [baselineRows]);

  const rowChangeInfo = useMemo(() => {
    const changedRows = new Set();
    const changedCells = new Set();
    rows.forEach((row, index) => {
      if (!row?.dppId) {
        changedRows.add(index);
        fields.forEach((field) => changedCells.add(`${index}:${field.key}`));
        return;
      }
      const baseline = baselineMap.get(`dpp:${row.dppId}`);
      if (!baseline) return;
      fields.forEach((field) => {
        if (serializeCell(row[field.key]) !== serializeCell(baseline[field.key])) {
          changedRows.add(index);
          changedCells.add(`${index}:${field.key}`);
        }
      });
    });
    return { changedRows, changedCells };
  }, [baselineMap, fields, rows]);

  const previewDetailByRow = useMemo(() => {
    const map = new Map();
    (preview?.details || []).forEach((detail) => {
      const rowIndex = Number(detail.rowIndex ?? detail.row_index);
      if (Number.isFinite(rowIndex)) map.set(rowIndex - 1, detail);
    });
    return map;
  }, [preview]);

  const loadJobsAndRuns = useCallback(async () => {
    if (!companyId) return;
    const [jobsResponse, runsResponse] = await Promise.all([
      fetchWithAuth(`${apiBase}/jobs`, { headers: authHeaders() }),
      fetchWithAuth(`${apiBase}/runs`, { headers: authHeaders() }),
    ]);
    if (jobsResponse.ok) {
      const payload = await jobsResponse.json();
      setJobs(payload.jobs || []);
    }
    if (runsResponse.ok) {
      const payload = await runsResponse.json();
      setRuns(payload.runs || []);
    }
  }, [apiBase, companyId]);

  const loadTemplates = useCallback(async (typeName) => {
    if (!typeName) return;
    const response = await fetchWithAuth(`${API}/api/companies/${companyId}/templates?passportType=${encodeURIComponent(typeName)}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      setTemplates([]);
      return;
    }
    setTemplates(await response.json());
  }, [companyId]);

  const loadTemplateDetail = useCallback(async (templateId) => {
    if (!templateId) {
      setTemplateDetail(null);
      return;
    }
    const response = await fetchWithAuth(`${API}/api/companies/${companyId}/templates/${templateId}`, {
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Failed to load template");
    setTemplateDetail(payload);
  }, [companyId]);

  const loadPassports = useCallback(async (typeName) => {
    if (!typeName) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth(`${apiBase}/passports?passportType=${encodeURIComponent(typeName)}`, {
        headers: authHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to load passport data");
      const nextRows = (payload.passports || []).map((row) => ({ ...row }));
      setRows(nextRows);
      setBaselineRows(nextRows);
      setSchemaFields(payload.fields || []);
      setDisplayName(payload.displayName || payload.passportType || typeName);
      setPreview(null);
      setMessage(`Loaded ${nextRows.length} passport rows.`);
      setJobForm((current) => ({
        ...current,
        name: current.name || `${payload.displayName || typeName} data sync`,
      }));
    } catch (err) {
      setError(err.message || "Failed to load passport data");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetchWithAuth(`${apiBase}/bootstrap`, { headers: authHeaders() })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Failed to load Passport Data Management");
        const types = payload.passportTypes || [];
        setPassportTypes(types);
        setErpPresets(payload.erpPresets || []);
        const firstType = types[0]?.typeName || "";
        setSelectedType((current) => current || firstType);
      })
      .catch((err) => setError(err.message || "Failed to load Passport Data Management"))
      .finally(() => setLoading(false));
  }, [apiBase, companyId]);

  useEffect(() => {
    if (!selectedType) return;
    setSelectedTemplateId("");
    setTemplateDetail(null);
    loadPassports(selectedType);
    loadTemplates(selectedType);
    loadJobsAndRuns();
  }, [loadJobsAndRuns, loadPassports, loadTemplates, selectedType]);

  useEffect(() => {
    loadTemplateDetail(selectedTemplateId).catch((err) => setError(err.message));
  }, [loadTemplateDetail, selectedTemplateId]);

  const viewCounts = useMemo(() => {
    const counts = { all: rows.length, new: 0, changed: 0, errors: 0, locked: 0, ready: 0 };
    rows.forEach((row, index) => {
      if (!row.dppId) counts.new += 1;
      if (rowChangeInfo.changedRows.has(index)) counts.changed += 1;
      if (!isRowEditable(row)) counts.locked += 1;
      const detail = previewDetailByRow.get(index);
      if (detail?.status === "failed") counts.errors += 1;
      if (detail?.status === "ready") counts.ready += 1;
    });
    return counts;
  }, [previewDetailByRow, rowChangeInfo.changedRows, rows]);

  const visibleFields = useMemo(() => {
    if (!filters.fields.length) return fields;
    const selected = new Set(filters.fields);
    return fields.filter((field) => selected.has(field.key));
  }, [fields, filters.fields]);

  const visibleRows = useMemo(() => {
    const search = normalizeText(filters.search);
    const fieldValue = normalizeText(filters.fieldValue);
    let entries = rows.map((row, index) => ({ row, index }));

    entries = entries.filter(({ row, index }) => {
      if (activeView === "new" && row.dppId) return false;
      if (activeView === "changed" && !rowChangeInfo.changedRows.has(index)) return false;
      if (activeView === "errors" && previewDetailByRow.get(index)?.status !== "failed") return false;
      if (activeView === "locked" && isRowEditable(row)) return false;
      if (activeView === "ready" && previewDetailByRow.get(index)?.status !== "ready") return false;

      if (filters.status !== "all") {
        const status = normalizeText(getRowStatus(row));
        if (filters.status === "editable" && !isRowEditable(row)) return false;
        if (filters.status === "locked" && isRowEditable(row)) return false;
        if (!["editable", "locked"].includes(filters.status) && status !== filters.status) return false;
      }

      if (search) {
        const haystack = Object.values(row || {}).map(serializeCell).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (fieldValue && filters.fields.length) {
        if (!filters.fields.some((fieldKey) => normalizeText(row[fieldKey]).includes(fieldValue))) return false;
      }

      return true;
    });

    if (sortConfig.key && sortConfig.direction) {
      entries = [...entries].sort((a, b) => {
        const aValue = normalizeText(valueForSort(a.row, sortConfig.key));
        const bValue = normalizeText(valueForSort(b.row, sortConfig.key));
        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return entries;
  }, [activeView, filters, previewDetailByRow, rowChangeInfo.changedRows, rows, sortConfig]);

  const summary = preview?.summary || {};
  const readyCount = Number(summary.ready || 0);
  const failedCount = Number(summary.failed || 0);
  const selectedFieldSet = useMemo(() => new Set(filters.fields), [filters.fields]);
  const fieldChooserLabel = filters.fields.length ? `${filters.fields.length} selected` : `All ${fields.length} fields`;
  const fieldChooserHint = filters.fields.length
    ? visibleFields.slice(0, 2).map((field) => field.label || field.key).join(", ")
    : "Showing every passport column";

  const setVisibleFieldKeys = (fieldKeys) => {
    const allKeys = fields.map((field) => field.key);
    const nextKeys = Array.from(new Set(fieldKeys)).filter((key) => allKeys.includes(key));
    setFilters((current) => ({
      ...current,
      fields: nextKeys.length === allKeys.length ? [] : nextKeys,
    }));
  };

  const toggleVisibleField = (fieldKey) => {
    const allKeys = fields.map((field) => field.key);
    const currentKeys = filters.fields.length ? filters.fields : allKeys;
    const nextKeys = currentKeys.includes(fieldKey)
      ? currentKeys.filter((key) => key !== fieldKey)
      : [...currentKeys, fieldKey];
    setVisibleFieldKeys(nextKeys.length ? nextKeys : [fieldKey]);
  };

  const showKeyFields = () => {
    const keyFields = ["dppId", "internalAliasId", "modelName"].filter((key) => fieldMap.has(key));
    setVisibleFieldKeys(keyFields.length ? keyFields : fields.slice(0, 4).map((field) => field.key));
  };

  const setRowValue = (rowIndex, key, value) => {
    if (!canManagePassportData) return;
    setRows((current) => current.map((row, index) => index === rowIndex ? { ...row, [key]: value } : row));
    setPreview(null);
  };

  const removeRow = (rowIndex) => {
    if (!canManagePassportData) return;
    setRows((current) => current.filter((_, index) => index !== rowIndex));
    setPreview(null);
  };

  const addBlankRow = () => {
    if (!canManagePassportData) return;
    const base = selectedTemplateId
      ? { ...templatePrefill.values, _templateId: selectedTemplateId, _templateName: templateDetail?.name || "", _modelLockedKeys: [...templatePrefill.modelKeys] }
      : {};
    setRows((current) => [...current, { ...base, dppId: "", internalAliasId: "", modelName: base.modelName || "" }]);
    setPreview(null);
  };

  const addBatchRows = () => {
    if (!canManagePassportData) return;
    const parsedCount = Number.parseInt(batchCount, 10);
    const serials = serialPaste
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    const count = serials.length || parsedCount;
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      setError("Enter 1 to 1000 rows, or paste up to 1000 internal IDs.");
      return;
    }
    const base = selectedTemplateId
      ? { ...templatePrefill.values, _templateId: selectedTemplateId, _templateName: templateDetail?.name || "", _modelLockedKeys: [...templatePrefill.modelKeys] }
      : {};
    const nextRows = Array.from({ length: count }, (_, index) => ({
      ...base,
      dppId: "",
      internalAliasId: serials[index] || "",
      modelName: base.modelName || templateDetail?.name || "",
    }));
    setRows((current) => [...nextRows, ...current]);
    setPreview(null);
    setMessage(`Added ${nextRows.length} new rows${templateDetail?.name ? ` from ${templateDetail.name}` : ""}.`);
    setSerialPaste("");
  };

  const importCsvFile = async (event) => {
    if (!canManagePassportData) return;
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const importedRows = parseCsvRows(await file.text());
      setRows(importedRows);
      setPreview(null);
      setMessage(`Imported ${importedRows.length} row-based CSV records.`);
      setError("");
    } catch (err) {
      setError(err.message || "CSV import failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyJsonPaste = () => {
    if (!canManagePassportData) return;
    try {
      const parsed = JSON.parse(jsonPaste);
      const importedRows = Array.isArray(parsed) ? parsed : parsed?.records;
      if (!Array.isArray(importedRows)) throw new Error("JSON must be an array or { records: [...] }.");
      setRows(importedRows.map((row) => ({ ...row })));
      setPreview(null);
      setMessage(`Imported ${importedRows.length} JSON records.`);
      setError("");
    } catch (err) {
      setError(err.message || "JSON import failed");
    }
  };

  const validateRows = async () => {
    if (!canManagePassportData) return;
    if (!selectedType) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithAuth(`${apiBase}/preview`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ passportType: selectedType, records: buildSerializableRows(rows) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Validation failed");
      setPreview(payload);
      setMessage(`Validation complete: ${payload.summary?.ready || 0} ready, ${payload.summary?.failed || 0} failed.`);
    } catch (err) {
      setError(err.message || "Validation failed");
    } finally {
      setBusy(false);
    }
  };

  const applyChanges = async () => {
    if (!canManagePassportData) return;
    if (!preview?.generatedPayload?.records?.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithAuth(`${apiBase}/push`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ generatedPayload: preview.generatedPayload, sourceKind: showSources ? "api" : "manual" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Apply failed");
      setMessage(`Applied: ${payload.summary?.passportsCreated || 0} created, ${payload.summary?.passportsUpdated || 0} updated, ${payload.summary?.skipped || 0} skipped.`);
      await loadPassports(selectedType);
      await loadJobsAndRuns();
    } catch (err) {
      setError(err.message || "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadPreviewJson = () => {
    if (!preview?.generatedPayload) return;
    const blob = new Blob([JSON.stringify(preview.generatedPayload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedType || "passport-data"}-preview.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const applyPreset = (presetKey) => {
    if (!canManagePassportData) return;
    const preset = erpPresets.find((item) => item.key === presetKey);
    if (!preset) return;
    const config = preset.sourceConfig || {};
    setSourceConfig({
      url: sourceConfig.url,
      method: config.method || "GET",
      recordPath: config.recordPath || "",
      headers: config.headers ? JSON.stringify(config.headers, null, 2) : "{}",
      body: config.body ? JSON.stringify(config.body, null, 2) : "",
    });
    setSourceFieldMap(Object.entries(config.fieldMap || {}).map(([source, target]) => ({ source, target })));
  };

  const currentSourceConfig = () => ({
    url: sourceConfig.url.trim(),
    method: sourceConfig.method,
    recordPath: sourceConfig.recordPath.trim(),
    headers: parseJsonText(sourceConfig.headers, {}),
    body: parseJsonText(sourceConfig.body, ""),
    fieldMap: sourceFieldMap.reduce((acc, row) => {
      if (row.source && row.target) acc[row.source] = row.target;
      return acc;
    }, {}),
  });

  const fetchSourceRows = async () => {
    if (!canManagePassportData) return;
    setBusy(true);
    setError("");
    try {
      const config = currentSourceConfig();
      const response = await fetchWithAuth(`${apiBase}/source/fetch`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ sourceConfig: config }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Source fetch failed");
      setRows((payload.records || []).map((row) => ({ ...row })));
      setPreview(null);
      setMessage(`Fetched ${payload.count || 0} rows from source.`);
    } catch (err) {
      setError(err.message || "Source fetch failed");
    } finally {
      setBusy(false);
    }
  };

  const saveJob = async () => {
    if (!canManagePassportData) return;
    if (!jobForm.name.trim()) {
      setError("Give the source job a name.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetchWithAuth(`${apiBase}/jobs`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          passportType: selectedType,
          name: jobForm.name.trim(),
          sourceKind: sourceConfig.url.trim() ? "api" : "manual",
          sourceConfig: sourceConfig.url.trim() ? currentSourceConfig() : {},
          records: sourceConfig.url.trim() ? [] : buildSerializableRows(rows),
          startAt: jobForm.startAt || null,
          intervalMinutes: jobForm.intervalMinutes || null,
          isActive: jobForm.isActive,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to save job");
      setMessage("Saved source job.");
      await loadJobsAndRuns();
    } catch (err) {
      setError(err.message || "Failed to save job");
    } finally {
      setBusy(false);
    }
  };

  const runJob = async (jobId) => {
    if (!canManagePassportData) return;
    setBusy(true);
    try {
      const response = await fetchWithAuth(`${apiBase}/jobs/${jobId}/run`, { method: "POST", headers: authHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to run job");
      setMessage(`Job finished with status ${payload.status || "complete"}.`);
      await loadJobsAndRuns();
      await loadPassports(selectedType);
    } catch (err) {
      setError(err.message || "Failed to run job");
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (key) => {
    const direction = getNextSortDirection(sortConfig, key);
    setSortConfig(direction ? { key, direction } : { key: "", direction: "" });
  };

  const renderValueInput = (row, rowIndex, field) => {
    const lockedByTemplate = Array.isArray(row._modelLockedKeys) && row._modelLockedKeys.includes(field.key);
    const disabled = !canManagePassportData || lockedByTemplate || (row.dppId && !isRowEditable(row));
    const value = row[field.key] ?? "";

    if (field.type === "boolean") {
      return (
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(event) => setRowValue(rowIndex, field.key, event.target.value)}
        >
          <option value="">Blank</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    if (field.type === "textarea" || field.type === "table") {
      return (
        <textarea
          rows={2}
          value={serializeCell(value)}
          disabled={disabled}
          placeholder={field.type === "table" ? "[{\"columnKey\":\"value\"}]" : ""}
          onChange={(event) => setRowValue(rowIndex, field.key, event.target.value)}
        />
      );
    }

    return (
      <input
        type={field.type === "date" ? "date" : "text"}
        value={serializeCell(value)}
        disabled={disabled}
        onChange={(event) => setRowValue(rowIndex, field.key, event.target.value)}
      />
    );
  };

  return (
    <div className="pdm-page">
      <div className="pdm-header">
        <div>
          <h2 className="pdm-title">Passport Data Management</h2>
          <p className="pdm-subtitle">Create, update, validate, and sync passport data in a row-based workspace.</p>
        </div>
        <div className="pdm-header-actions">
          <button
            type="button"
            className="dashboard-btn dashboard-btn-ghost"
            onClick={() => setShowSources((value) => !value)}
            disabled={!canManagePassportData}
          >
            {showSources ? "Hide Sources" : "Sources & Jobs"}
          </button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={validateRows} disabled={!canManagePassportData || busy || !rows.length}>
            {busy ? "Working..." : "Validate"}
          </button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={applyChanges} disabled={!canManagePassportData || busy || !readyCount || failedCount > 0}>
            Apply Changes
          </button>
        </div>
      </div>

      {showReadOnlyNotice && (
        <div className="pdm-alert pdm-alert-info">
          Read-only access. Editors and admins can validate, import, and apply changes.
        </div>
      )}

      {(message || error) && (
        <div className={`pdm-alert ${error ? "pdm-alert-error" : "pdm-alert-success"}`}>
          {error || message}
        </div>
      )}

      <div className={`pdm-shell${showSources ? " pdm-shell-with-sources" : ""}`}>
        <section className="pdm-main">
          <div className="pdm-control-strip">
            <label>
              <span>Passport type</span>
              <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
                {passportTypes.map((type) => (
                  <option key={type.id || type.typeName} value={type.typeName}>
                    {type.displayName || type.typeName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Template</span>
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={!canManagePassportData}>
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Batch rows</span>
              <input value={batchCount} onChange={(event) => setBatchCount(event.target.value)} type="number" min="1" max="1000" disabled={!canManagePassportData} />
            </label>
            <div className="pdm-strip-actions">
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={addBlankRow} disabled={!canManagePassportData}>Add Row</button>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={addBatchRows} disabled={!canManagePassportData}>Add Batch</button>
            </div>
          </div>

          <div className="pdm-batch-input">
            <textarea
              value={serialPaste}
              onChange={(event) => setSerialPaste(event.target.value)}
              placeholder="Paste internal IDs or serial numbers here, one per line, then Add Batch."
              rows={2}
              disabled={!canManagePassportData}
            />
          </div>

          <div className="pdm-stats-row">
            {[
              ["all", "All", viewCounts.all],
              ["new", "New", viewCounts.new],
              ["changed", "Changed", viewCounts.changed],
              ["errors", "Errors", viewCounts.errors],
              ["locked", "Locked", viewCounts.locked],
              ["ready", "Ready", viewCounts.ready],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={`pdm-stat-btn${activeView === key ? " active" : ""}`}
                onClick={() => setActiveView(key)}
              >
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>

          <div className="pdm-toolbar">
            <label>
              <span>Search</span>
              <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="ID, model, field value" />
            </label>
            <label>
              <span>Status</span>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="all">All rows</option>
                <option value="editable">Editable only</option>
                <option value="locked">Locked only</option>
                <option value="draft">Draft</option>
                <option value="in_revision">In revision</option>
                <option value="released">Released</option>
                <option value="in_review">In review</option>
                <option value="new">New</option>
              </select>
            </label>
            <label>
              <span>Field value</span>
              <input value={filters.fieldValue} onChange={(event) => setFilters((current) => ({ ...current, fieldValue: event.target.value }))} placeholder="Filter selected fields" />
            </label>
            <div className="pdm-field-picker">
              <span>Fields</span>
              <details className="pdm-field-menu">
                <summary>
                  <strong>{fieldChooserLabel}</strong>
                  <small>{fieldChooserHint}</small>
                </summary>
                <div className="pdm-field-menu-panel">
                  <div className="pdm-field-menu-actions">
                    <button type="button" className="pdm-chip-btn" onClick={() => setFilters((current) => ({ ...current, fields: [] }))}>All fields</button>
                    <button type="button" className="pdm-chip-btn" onClick={showKeyFields}>Key fields</button>
                  </div>
                  <div className="pdm-field-options">
                    {fields.map((field) => {
                      const checked = !filters.fields.length || selectedFieldSet.has(field.key);
                      return (
                        <label key={field.key} className="pdm-field-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleVisibleField(field.key)}
                          />
                          <span>{field.label || field.key}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </details>
            </div>
            <div className="pdm-toolbar-actions">
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => setFilters({ search: "", status: "all", fields: [], fieldValue: "" })}>Clear</button>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => exportRowsToCsv(rows, fields, `${selectedType || "passport-data"}-rows.csv`)}>Export All</button>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => exportRowsToCsv(visibleRows.map((entry) => entry.row), visibleFields, `${selectedType || "passport-data"}-filtered.csv`)}>Export View</button>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => exportRowsToCsv([], fields, `${selectedType || "passport-data"}-template.csv`)}>Blank CSV</button>
              <label className={`dashboard-btn dashboard-btn-ghost pdm-file-btn${!canManagePassportData ? " disabled" : ""}`}>
                Import CSV
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={importCsvFile} disabled={!canManagePassportData} />
              </label>
            </div>
          </div>

          <div className="pdm-grid-meta">
            Showing {visibleRows.length} of {rows.length} rows, {visibleFields.length} of {fields.length} fields for {displayName || selectedType || "passport data"}.
          </div>

          <div className="pdm-grid-wrap">
            {loading ? (
              <div className="pdm-empty">Loading passport data...</div>
            ) : !rows.length ? (
              <div className="pdm-empty">Choose a passport type, import rows, or add a batch to start.</div>
            ) : (
              <table className="pdm-table">
                <thead>
                  <tr>
                    <th className="pdm-sticky-col pdm-row-col">
                      <button type="button" onClick={() => toggleSort("__status")}>Row {sortIndicator(sortConfig, "__status")}</button>
                    </th>
                    {visibleFields.map((field) => (
                      <th key={field.key}>
                        <button type="button" onClick={() => toggleSort(field.key)}>
                          {field.label || field.key} {sortIndicator(sortConfig, field.key)}
                        </button>
                      </th>
                    ))}
                    <th>Validation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, index }) => {
                    const detail = previewDetailByRow.get(index);
                    const changed = rowChangeInfo.changedRows.has(index);
                    return (
                      <tr key={`${row.dppId || "new"}-${index}`} className={changed ? "pdm-row-changed" : ""}>
                        <td className="pdm-sticky-col pdm-row-col">
                          <span className={`pdm-status-chip pdm-status-${normalizeText(getRowStatus(row)).replace(/_/g, "-")}`}>
                            {index + 1} / {getRowStatus(row)}
                          </span>
                          <small>{getRowIdentifier(row)}</small>
                        </td>
                        {visibleFields.map((field) => (
                          <td key={field.key} className={rowChangeInfo.changedCells.has(`${index}:${field.key}`) ? "pdm-cell-changed" : ""}>
                            {renderValueInput(row, index, field)}
                          </td>
                        ))}
                        <td className={`pdm-validation-cell pdm-validation-${detail?.status || "pending"}`}>
                          {detail?.error || detail?.reason || detail?.action || detail?.status || "Not checked"}
                        </td>
                        <td>
                          <button type="button" className="pdm-mini-btn" onClick={() => removeRow(index)} disabled={!canManagePassportData}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {showSources && (
          <>
          <button
            type="button"
            className="pdm-source-backdrop"
            aria-label="Close Sources and Jobs"
            onClick={() => setShowSources(false)}
          />
          <aside className="pdm-source-panel" aria-label="Sources and Jobs">
            <div className="pdm-source-header">
              <div>
                <h3>Sources & Jobs</h3>
                <p>Connect ERP/API data, import JSON, and schedule sync jobs.</p>
              </div>
              <button type="button" className="pdm-source-close" onClick={() => setShowSources(false)} aria-label="Close Sources and Jobs">Close</button>
            </div>
            <div className="pdm-source-block">
              <label>
                <span>Preset</span>
                <select onChange={(event) => applyPreset(event.target.value)} defaultValue="" disabled={!canManagePassportData}>
                  <option value="">Choose preset</option>
                  {erpPresets.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>URL</span>
                <input value={sourceConfig.url} onChange={(event) => setSourceConfig((current) => ({ ...current, url: event.target.value }))} placeholder="https://erp.example.com/items" disabled={!canManagePassportData} />
              </label>
              <div className="pdm-source-row">
                <label>
                  <span>Method</span>
                  <select value={sourceConfig.method} onChange={(event) => setSourceConfig((current) => ({ ...current, method: event.target.value }))} disabled={!canManagePassportData}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                </label>
                <label>
                  <span>Record path</span>
                  <input value={sourceConfig.recordPath} onChange={(event) => setSourceConfig((current) => ({ ...current, recordPath: event.target.value }))} placeholder="data.items" disabled={!canManagePassportData} />
                </label>
              </div>
              <label>
                <span>Headers JSON</span>
                <textarea rows={3} value={sourceConfig.headers} onChange={(event) => setSourceConfig((current) => ({ ...current, headers: event.target.value }))} disabled={!canManagePassportData} />
              </label>
              <label>
                <span>Body JSON</span>
                <textarea rows={3} value={sourceConfig.body} onChange={(event) => setSourceConfig((current) => ({ ...current, body: event.target.value }))} placeholder="{ }" disabled={!canManagePassportData} />
              </label>
              <div className="pdm-map-head">
                <span>Field map</span>
                <button type="button" className="pdm-mini-btn" onClick={() => setSourceFieldMap((current) => [...current, { source: "", target: "" }])} disabled={!canManagePassportData}>Add</button>
              </div>
              {sourceFieldMap.map((row, index) => (
                <div key={index} className="pdm-map-row">
                  <input value={row.source} onChange={(event) => setSourceFieldMap((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item))} placeholder="ERP field" disabled={!canManagePassportData} />
                  <input value={row.target} onChange={(event) => setSourceFieldMap((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} placeholder="Passport field" disabled={!canManagePassportData} />
                </div>
              ))}
              <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={fetchSourceRows} disabled={!canManagePassportData || busy}>Fetch Source Rows</button>
            </div>

            <div className="pdm-source-block">
              <h4>JSON Import</h4>
              <textarea value={jsonPaste} onChange={(event) => setJsonPaste(event.target.value)} rows={4} placeholder='[{"internalAliasId":"SKU-001"}]' disabled={!canManagePassportData} />
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={applyJsonPaste} disabled={!canManagePassportData}>Apply JSON</button>
            </div>

            <div className="pdm-source-block">
              <h4>Save Job</h4>
              <label><span>Name</span><input value={jobForm.name} onChange={(event) => setJobForm((current) => ({ ...current, name: event.target.value }))} disabled={!canManagePassportData} /></label>
              <label><span>Start at</span><input type="datetime-local" value={jobForm.startAt} onChange={(event) => setJobForm((current) => ({ ...current, startAt: event.target.value }))} disabled={!canManagePassportData} /></label>
              <label><span>Interval minutes</span><input type="number" min="1" value={jobForm.intervalMinutes} onChange={(event) => setJobForm((current) => ({ ...current, intervalMinutes: event.target.value }))} disabled={!canManagePassportData} /></label>
              <label className="pdm-check"><input type="checkbox" checked={jobForm.isActive} onChange={(event) => setJobForm((current) => ({ ...current, isActive: event.target.checked }))} disabled={!canManagePassportData} /> Active</label>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={saveJob} disabled={!canManagePassportData || busy}>Save Job</button>
            </div>

            <div className="pdm-source-block">
              <h4>Saved Jobs</h4>
              {!jobs.length && <p className="pdm-muted">No jobs saved.</p>}
              {jobs.slice(0, 5).map((job) => (
                <div key={job.id} className="pdm-job-row">
                  <div>
                    <strong>{job.name}</strong>
                    <span>{job.passportType || job.passport_type} / {job.sourceKind || job.source_kind}</span>
                  </div>
                  <button type="button" className="pdm-mini-btn" onClick={() => runJob(job.id)} disabled={!canManagePassportData || busy}>Run</button>
                </div>
              ))}
            </div>

            <div className="pdm-source-block">
              <h4>Recent Runs</h4>
              {!runs.length && <p className="pdm-muted">No runs yet.</p>}
              {runs.slice(0, 5).map((run) => (
                <div key={run.id} className="pdm-run-row">
                  <strong>{run.status}</strong>
                  <span>{run.passportType || run.passport_type || "Passport data"} / {new Date(run.createdAt || run.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </aside>
          </>
        )}
      </div>

      <div className="pdm-bottom-bar">
        <div className="pdm-bottom-summary">
          <strong>{rows.length}</strong> rows
          <span>{viewCounts.changed} changed</span>
          <span>{readyCount} ready</span>
          <span>{failedCount} errors</span>
        </div>
        <div className="pdm-bottom-actions">
          <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={downloadPreviewJson} disabled={!preview?.generatedPayload}>Download JSON</button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={validateRows} disabled={!canManagePassportData || busy || !rows.length}>Validate</button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={applyChanges} disabled={!canManagePassportData || busy || !readyCount || failedCount > 0}>Apply Changes</button>
        </div>
      </div>
    </div>
  );
}

export default PassportDataManagementPage;
