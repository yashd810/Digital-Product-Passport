import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { PASSPORT_SECTIONS_MAP } from "./PassportFields";
import { ReleaseModal } from "./WorkflowDashboard";
import { applyTableControls, getNextSortDirection, sortIndicator } from "./tableControls";
import { authHeaders } from "./authHeaders";
import { formatPassportStatus, isEditablePassportStatus, normalizePassportStatus } from "./passportStatus";
import PassportHistoryModal from "./PassportHistoryModal";
import { buildPreviewPassportPath, buildPublicPassportPath } from "./passportRoutes";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.version_number || 0) - Number(a?.version_number || 0);
  if (versionDiff !== 0) return versionDiff;
  return new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime();
}

function getPassportGroupKey(passport) {
  if (passport?.lineage_id) return `lineage:${passport.lineage_id}`;
  if (passport?.product_id) return `product:${passport.passport_type || "passport"}:${passport.product_id}`;
  return `guid:${passport?.guid || ""}`;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function parseCsvRow(line) {
  line = line.replace(/\r$/, "");
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      cells.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsvText(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(parseCsvRow);
}

// ── CSV Update Modal ──────────────────────────────────────────────────────────
function CsvUpdateModal({ passport, passportType, companyId, onClose, onDone }) {
  const [phase,    setPhase]    = useState("loading"); // loading|upload|confirming|applying
  const [allFields,setAllFields]= useState([]);
  const [parsed,   setParsed]   = useState({});
  const [conflicts,setConflicts]= useState([]);
  const [err,      setErr]      = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/passport-types/${passportType}`)
      .then(r => r.json())
      .then(d => {
        const sections = d.fields_json?.sections || [];
        setAllFields(sections.flatMap(s => s.fields || []).filter(f => f.type !== "table"));
        setPhase("upload");
      })
      .catch(() => { setErr("Failed to load passport type definition"); setPhase("upload"); });
  }, [passportType]);

  const getLabel = (key) => allFields.find(f => f.key === key)?.label || key;

  // Download the passport's current values as a 2-column CSV ready for editing
  const downloadCurrent = () => {
    const rows = [["Field Name", "Value"]];
    rows.push(["model_name", passport.model_name || ""]);
    rows.push(["product_id", passport.product_id || ""]);
    allFields.forEach(f => {
      const v = passport[f.key];
      rows.push([f.label, v === null || v === undefined ? "" : String(v)]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(passport.model_name || passport.guid).replace(/\s+/g, "_")}_update.csv`;
    a.click();
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setErr("");

    let text;
    try { text = await file.text(); }
    catch { setErr("Could not read file"); return; }

    const rows = parseCsvText(text);
    if (rows.length < 2) { setErr("CSV must have at least a header row and one data row"); return; }

    // Column-oriented format: row[0][0] === "Field Name", values in col index 1
    // Simple 2-column format: each row is [label, value]
    const isColOriented = rows[0]?.[0]?.trim().toLowerCase() === "field name";
    const dataRows = isColOriented ? rows.slice(1) : rows;

    const parsedData = {};
    dataRows.forEach(row => {
      const rawLabel = (row[0] || "").trim();
      if (!rawLabel) return;
      const normalized = rawLabel.toLowerCase();
      const value = (row[1] || "").trim();
      if (!value) return;

      const field =
        allFields.find(f => f.label?.trim().toLowerCase() === normalized) ||
        allFields.find(f => f.key?.toLowerCase() === normalized) ||
        (normalized === "model_name" ? { key: "model_name", type: "text" } : null) ||
        (normalized === "product_id" ? { key: "product_id", type: "text" } : null);

      if (!field) return;
      parsedData[field.key] = field.type === "boolean"
        ? (value.toLowerCase() === "true" || value === "1")
        : value;
    });

    if (!Object.keys(parsedData).length) {
      setErr("No recognizable fields found in the CSV. Make sure field names match the template labels.");
      return;
    }

    const conflictKeys = Object.keys(parsedData).filter(key => {
      const v = passport[key];
      return v !== null && v !== undefined && v !== "" && v !== false;
    });

    setParsed(parsedData);
    if (conflictKeys.length) {
      setConflicts(conflictKeys);
      setPhase("confirming");
    } else {
      doApply(parsedData);
    }
  };

  const doApply = async (data) => {
    setPhase("applying");
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${passport.guid}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ passportType, ...data }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Update failed");
      const n = Object.keys(data).length;
      onDone(`"${passport.model_name}" updated — ${n} field${n !== 1 ? "s" : ""} set from CSV`);
    } catch (ex) {
      setErr(ex.message);
      setPhase(conflicts.length ? "confirming" : "upload");
    }
  };

  const handleSkipExisting = () => {
    const filtered = { ...parsed };
    conflicts.forEach(k => delete filtered[k]);
    if (!Object.keys(filtered).length) {
      setErr("All CSV fields already have data in this passport. Choose 'Overwrite all' to replace them, or cancel.");
      return;
    }
    doApply(filtered);
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">

        {/* Loading */}
        {phase === "loading" && (
          <p className="dashboard-modal-status">Loading…</p>
        )}

        {/* Upload phase */}
        {(phase === "upload" || (phase === "loading" && err)) && phase !== "loading" && (
          <>
            <h3 className="dashboard-modal-title">Update data via CSV</h3>
            <p className="dashboard-modal-subtitle">Passport: <strong>{passport.model_name}</strong></p>

            {err && <div className="dashboard-inline-error">{err}</div>}

            <div className="dashboard-info-panel">
              <strong className="dashboard-info-title">How it works:</strong> Only fields you include in the CSV (with a value)
              will be updated. Fields not in the CSV remain unchanged. You can start from the current data below.
            </div>

            <button className="dashboard-btn dashboard-btn-secondary dashboard-btn-block-spaced" onClick={downloadCurrent}>
              📥 Download current data as CSV
            </button>

            <div className="dashboard-upload-dropzone">
              <p className="dashboard-upload-title">Upload your updated CSV</p>
              <label className="dashboard-btn dashboard-btn-primary dashboard-upload-button">
                🗂️ Choose CSV File
                <input ref={fileRef} type="file" accept=".csv" className="dashboard-hidden-input" onChange={handleFile} />
              </label>
            </div>

            <div className="dashboard-modal-actions dashboard-modal-actions-end">
              <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* Conflict confirmation phase */}
        {phase === "confirming" && (
          <>
            <h3 className="dashboard-modal-title dashboard-modal-title-warning">⚠️ Some fields have existing data</h3>
            <p className="dashboard-modal-subtitle dashboard-modal-subtitle-spaced">
              The following <strong>{conflicts.length}</strong> field{conflicts.length !== 1 ? "s" : ""} already
              have data in this passport. Choose how to handle them:
            </p>

            <div className="dashboard-warning-panel">
              {conflicts.map(key => {
                const cur = String(passport[key] ?? "");
                const nxt = String(parsed[key] ?? "");
                return (
                  <div key={key} className="dashboard-warning-item">
                    <strong className="dashboard-warning-label">{getLabel(key)}</strong>
                    <div className="dashboard-warning-copy">
                      Current: <em>"{cur.length > 60 ? cur.substring(0,60)+"…" : cur}"</em>
                      <span className="dashboard-warning-separator">→</span>
                      New: <em>"{nxt.length > 60 ? nxt.substring(0,60)+"…" : nxt}"</em>
                    </div>
                  </div>
                );
              })}
            </div>

            {err && <div className="dashboard-inline-error">{err}</div>}

            <div className="dashboard-note-panel">
              <strong>Overwrite all</strong> — replaces the existing values shown above with the new CSV data.<br />
              <strong>Skip existing</strong> — only fills in fields that are currently empty; the values shown above are kept as-is.
            </div>

            <div className="dashboard-modal-actions">
              <button className="dashboard-btn dashboard-btn-danger" onClick={() => doApply(parsed)}>Overwrite all</button>
              <button className="dashboard-btn dashboard-btn-secondary" onClick={handleSkipExisting}>Skip existing</button>
              <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* Applying */}
        {phase === "applying" && (
          <p className="dashboard-modal-status">Updating passport data…</p>
        )}

      </div>
    </div>,
    document.body
  );
}

function calcCompleteness(passport, typeDefinitions = []) {
  const pType = passport.passport_type;
  if (!pType) return null;

  const dynamicType = typeDefinitions.find(t => t.type_name === pType);
  const dynamicFields = dynamicType?.fields_json?.sections?.flatMap(section => section.fields || []) || [];
  const staticFields = PASSPORT_SECTIONS_MAP[pType]
    ? Object.values(PASSPORT_SECTIONS_MAP[pType]).flatMap(s => s.fields)
    : [];
  const allFields = dynamicFields.length ? dynamicFields : staticFields;

  if (!allFields.length) return null;
  const optional  = allFields.filter(f => f.type !== "file");
  if (!optional.length) return null;
  const filled = optional.filter(f => {
    const v = passport[f.key];
    if (v === null || v === undefined || v === "") return false;
    if (f.type === "boolean") return v === true;
    return String(v).trim() !== "";
  }).length;
  return Math.round((filled / optional.length) * 100);
}

function dedupeLatestReleasedPassports(passports = []) {
  const latestByLineage = new Map();
  passports.forEach((passport) => {
    if (!passport?.guid || normalizePassportStatus(passport.release_status) !== "released") return;
    const key = passport.lineage_id || passport.guid;
    const current = latestByLineage.get(key);
    if (!current || Number(passport.version_number || 0) > Number(current.version_number || 0)) {
      latestByLineage.set(key, passport);
    }
  });
  return [...latestByLineage.values()];
}

function CompletenessBar({ pct }) {
  if (pct === null) return <span className="completeness-empty">—</span>;
  const tone = pct >= 80 ? "high" : pct >= 50 ? "medium" : "low";
  return (
    <div className="completeness-bar">
      <div className="completeness-track">
        <div className={`completeness-fill completeness-fill-${tone}`} style={{ width:`${pct}%` }} />
      </div>
      <span className={`completeness-pill completeness-pill-${tone}`}>{pct}%</span>
    </div>
  );
}

function KebabMenu({ anchorRect, onClose, children }) {
  const ref = useRef(null);
  const [resolvedPos, setResolvedPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handler = (e) => {
      // Don't close if click is on the kebab button itself
      if (e.target.closest('.kebab-menu-btn')) return;
      // Don't close if click is on a row - let row onclick handle menu close
      if (e.target.closest('tr.passport-row-clickable')) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!ref.current || !anchorRect) return;

    const margin = 12;
    const menuRect = ref.current.getBoundingClientRect();
    let nextTop = anchorRect.bottom + 4;
    let nextLeft = anchorRect.right - menuRect.width;

    nextLeft = Math.min(nextLeft, window.innerWidth - menuRect.width - margin);
    nextLeft = Math.max(nextLeft, margin);

    if (nextTop + menuRect.height > window.innerHeight - margin) {
      nextTop = Math.max(margin, anchorRect.top - menuRect.height - 4);
    }

    setResolvedPos((currentPos) => (
      nextTop !== currentPos.top || nextLeft !== currentPos.left
        ? { top: nextTop, left: nextLeft }
        : currentPos
    ));
  }, [anchorRect, children]);

  return createPortal(
    <div ref={ref} className="kebab-dropdown-menu" style={{ top:resolvedPos.top, left:resolvedPos.left }}>
      {children}
    </div>,
    document.body
  );
}

function BulkCreateModal({ passportType, companyId, onClose, onDone }) {
  const [count, setCount] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedCount = parseInt(count, 10);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500) {
      setError("Enter a number between 1 and 500.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          passport_type: passportType,
          passports: Array.from({ length: parsedCount }, () => ({})),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Bulk create failed");
      onDone(data.summary?.created || parsedCount);
    } catch (err) {
      setError(err.message || "Bulk create failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Bulk Create Passports</h3>
        <p className="dashboard-modal-subtitle">
          Enter how many <strong>{passportType}</strong> drafts you want to create. Each one will get its own GUID and a default untitled name.
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <label htmlFor="bulkCreateCount" className="device-manual-label">Number of Passports</label>
          <input
            id="bulkCreateCount"
            type="number"
            min="1"
            max="500"
            step="1"
            value={count}
            onChange={e => setCount(e.target.value)}
            className="device-manual-input"
            disabled={isSubmitting}
            autoFocus
          />
          <p className="bulk-create-note">You can rename and edit the generated drafts later.</p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Drafts"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Export Modal ─────────────────────────────────────────────────────────────
function ExportModal({ passports, filteredPassports, pagePassports, selectedPassports, activeType, allPassportTypes, onClose, onDone }) {
  const [scope,  setScope]  = useState("all");
  const [format, setFormat] = useState("csv");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const selectedList = passports.filter(p => selectedPassports.has(`${p.guid}-${p.version_number}`));

  const scopePassports = {
    selected: selectedList,
    filtered: filteredPassports,
    page:     pagePassports,
    all:      filteredPassports,
  };

  const scopeOptions = [
    { id: "selected", label: "Selected",   description: "Only the passports you have checked.",               count: selectedList.length },
    { id: "filtered", label: "All Pages",  description: "Every passport in the current filtered view.",       count: filteredPassports.length },
    { id: "page",     label: "This Page",  description: "Only the passports visible on the current page.",    count: pagePassports.length },
  ];

  // auto-select best default once
  useEffect(() => {
    if (selectedList.length > 0) setScope("selected");
    else setScope("filtered");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportList = scopePassports[scope] || [];

  const exportTypeToCSV = async (type, list) => {
    const r = await fetch(`${API}/api/passport-types/${type}`);
    if (!r.ok) throw new Error(`Failed to fetch field definitions for ${type}`);
    const data = await r.json();
    const allFields = (data.fields_json?.sections || []).flatMap(s => s.fields || []);
    const rows = [
      ["Field Name", ...list.map(p => p.model_name)],
      ["guid",       ...list.map(p => p.guid)],
      ["model_name", ...list.map(p => p.model_name || "")],
      ["product_id", ...list.map(p => p.product_id || "")],
      ...allFields
        .filter(f => f.type !== "table")
        .map(f => [f.label, ...list.map(p => f.type === "boolean" ? (p[f.key] ? "true" : "false") : (p[f.key] || ""))]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${type}_export.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportTypeToJSON = async (type, list) => {
    const r = await fetch(`${API}/api/passport-types/${type}`);
    if (!r.ok) throw new Error(`Failed to fetch field definitions for ${type}`);
    const data = await r.json();
    const allFields = (data.fields_json?.sections || []).flatMap(s => s.fields || []);
    const output = list.map(p => {
      const obj = { guid: p.guid, model_name: p.model_name, product_id: p.product_id, release_status: p.release_status, version_number: p.version_number };
      allFields.forEach(f => { obj[f.key] = p[f.key] ?? null; });
      return obj;
    });
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${type}_export.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleExport = async () => {
    if (!exportList.length) { setError("No passports in the selected scope."); return; }
    setExporting(true); setError("");
    try {
      const grouped = exportList.reduce((acc, p) => {
        const t = p.passport_type || activeType;
        if (!acc[t]) acc[t] = [];
        acc[t].push(p);
        return acc;
      }, {});
      for (const [type, list] of Object.entries(grouped)) {
        if (format === "csv")  await exportTypeToCSV(type, list);
        if (format === "json") await exportTypeToJSON(type, list);
      }
      onDone(`Exported ${exportList.length} passport${exportList.length !== 1 ? "s" : ""} as ${format.toUpperCase()}`);
    } catch (e) {
      setError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !exporting) onClose(); }}>
      <div className="dashboard-modal-card bulk-revise-modal-card">
        <h3 className="dashboard-modal-title">Export Passports</h3>
        <p className="dashboard-modal-subtitle">Choose which passports to export and the file format.</p>

        {/* Scope */}
        <div className="bulk-revise-scope-grid">
          {scopeOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`bulk-revise-scope-card${scope === opt.id ? " active" : ""}`}
              onClick={() => setScope(opt.id)}
            >
              <strong>{opt.label}</strong>
              <span>{opt.count} passport{opt.count !== 1 ? "s" : ""}</span>
              <small>{opt.description}</small>
            </button>
          ))}
        </div>

        {/* Format */}
        <div className="wf-select-group" style={{ marginTop: 16 }}>
          <label>Format</label>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {["csv", "json"].map(f => (
              <button
                key={f}
                type="button"
                className={`bulk-revise-scope-card${format === f ? " active" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setFormat(f)}
              >
                <strong>{f.toUpperCase()}</strong>
                <small>{f === "csv" ? "Spreadsheet — edit in Excel / Sheets" : "JSON array — for integrations & re-import"}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-note-panel" style={{ marginTop: 16 }}>
          Exporting <strong>{exportList.length}</strong> passport{exportList.length !== 1 ? "s" : ""} as <strong>{format.toUpperCase()}</strong>.
        </div>

        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="dashboard-modal-actions dashboard-modal-actions-end" style={{ marginTop: 20 }}>
          <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="dashboard-btn dashboard-btn-primary" onClick={handleExport} disabled={exporting || !exportList.length}>
            {exporting ? "Exporting…" : `Export ${exportList.length} passport${exportList.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function BulkReviseModal({
  companyId,
  user,
  allPassportTypes,
  passports,
  filteredPassports,
  pagePassports,
  selectedPassports,
  activeType,
  onClose,
  onApplied,
}) {
  const [scope, setScope] = useState("selected");
  const [selectedType, setSelectedType] = useState(activeType || "");
  const [changeRows, setChangeRows] = useState([{ id: 1, key: "", value: "" }]);
  const [revisionNote, setRevisionNote] = useState("");
  const [submitToWorkflow, setSubmitToWorkflow] = useState(false);
  const [teamUsers, setTeamUsers] = useState([]);
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/companies/${companyId}/users`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const eligible = (Array.isArray(data) ? data : []).filter(member =>
          (member.role === "editor" || member.role === "company_admin") && member.id !== user?.id
        );
        setTeamUsers(eligible);
      })
      .catch(() => {});

    fetch(`${API}/api/users/me`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.default_reviewer_id) setReviewerId(String(data.default_reviewer_id));
        if (data?.default_approver_id) setApproverId(String(data.default_approver_id));
      })
      .catch(() => {});
  }, [companyId, user?.id]);

  const selectedSourcePassports = useMemo(
    () => passports.filter(p => selectedPassports.has(`${p.guid}-${p.version_number}`)),
    [passports, selectedPassports]
  );

  const scopePassports = useMemo(() => ({
    selected: dedupeLatestReleasedPassports(selectedSourcePassports),
    filtered: dedupeLatestReleasedPassports(filteredPassports),
    all: dedupeLatestReleasedPassports(pagePassports),
  }), [selectedSourcePassports, filteredPassports, pagePassports]);

  const scopeOptions = useMemo(() => ([
    { id: "selected", label: "Selected", description: "Only the released passports you selected.", count: scopePassports.selected.length },
    { id: "filtered", label: "All (All Pages)", description: "All released passports in this view, across all pages.", count: scopePassports.filtered.length },
    { id: "all", label: "This Page", description: "Only the released passports visible on the current page.", count: scopePassports.all.length },
  ]), [scopePassports]);

  useEffect(() => {
    if (scopePassports.selected.length > 0) setScope("selected");
    else if (scopePassports.filtered.length > 0) setScope("filtered");
    else setScope("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopedPassports = scopePassports[scope] || [];
  const availableTypes = useMemo(
    () => [...new Set(scopedPassports.map(passport => passport.passport_type || activeType).filter(Boolean))],
    [scopedPassports, activeType]
  );

  useEffect(() => {
    if (!availableTypes.length) {
      setSelectedType("");
      return;
    }
    if (availableTypes.length === 1) {
      setSelectedType(availableTypes[0]);
      return;
    }
    if (availableTypes.includes(selectedType)) return;
    if (activeType && availableTypes.includes(activeType)) {
      setSelectedType(activeType);
      return;
    }
    setSelectedType(availableTypes[0]);
  }, [availableTypes, selectedType, activeType]);

  const targetedPassports = useMemo(
    () => scopedPassports.filter(passport => !selectedType || (passport.passport_type || activeType) === selectedType),
    [scopedPassports, selectedType, activeType]
  );

  const typeDef = allPassportTypes.find(type => type.type_name === selectedType);
  const availableFields = useMemo(() => {
    const baseFields = [
      { key: "model_name", label: "Model Name", type: "text" },
      { key: "product_id", label: "Serial Number", type: "text" },
    ];
    const schemaFields = (typeDef?.fields_json?.sections || [])
      .flatMap(section => section.fields || [])
      .filter(field => field?.key && field.type !== "table");

    const seen = new Set();
    return [...baseFields, ...schemaFields].filter(field => {
      if (seen.has(field.key)) return false;
      seen.add(field.key);
      return true;
    });
  }, [typeDef]);

  const addChangeRow = () => {
    setChangeRows(rows => [...rows, { id: Date.now() + Math.random(), key: "", value: "" }]);
  };

  const updateChangeRow = (id, patch) => {
    setChangeRows(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  };

  const removeChangeRow = (id) => {
    setChangeRows(rows => rows.length === 1 ? rows : rows.filter(row => row.id !== id));
  };

  const downloadResultsCsv = () => {
    if (!result?.details?.length) return;
    const rows = [
      ["GUID", "Passport Type", "Status", "Source Version", "New Version", "Message"],
      ...result.details.map(item => [
        item.guid || "",
        item.passport_type || "",
        item.status || "",
        item.source_version_number ?? "",
        item.new_version_number ?? "",
        item.message || "",
      ]),
    ];
    const csv = rows
      .map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bulk-revise-batch-${result.batch?.id || "results"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!targetedPassports.length) {
      setError("No released passports match the selected scope and type.");
      return;
    }

    const parsedChanges = {};
    for (const row of changeRows) {
      if (!row.key) continue;
      const field = availableFields.find(item => item.key === row.key);
      if (!field) continue;

      if (field.type === "boolean") {
        if (row.value !== "true" && row.value !== "false") {
          setError(`Choose true or false for ${field.label}.`);
          return;
        }
        parsedChanges[row.key] = row.value === "true";
        continue;
      }

      if (field.type === "table") {
        const raw = String(row.value || "").trim();
        if (!raw) {
          setError(`Enter a JSON array value for ${field.label}.`);
          return;
        }
        try {
          parsedChanges[row.key] = JSON.parse(raw);
        } catch {
          setError(`${field.label} must be valid JSON.`);
          return;
        }
        continue;
      }

      if (String(row.value ?? "").trim() === "") {
        setError(`Enter a value for ${field.label}.`);
        return;
      }
      parsedChanges[row.key] = row.value;
    }

    if (!Object.keys(parsedChanges).length) {
      setError("Add at least one field change to create revisions.");
      return;
    }

    if (submitToWorkflow && !reviewerId && !approverId) {
      setError("Choose a reviewer or approver to auto-submit revised passports into workflow.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API}/api/companies/${companyId}/passports/bulk-revise`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          items: targetedPassports.map(passport => ({
            guid: passport.guid,
            passport_type: passport.passport_type || activeType,
          })),
          changes: parsedChanges,
          revisionNote: revisionNote.trim(),
          submitToWorkflow,
          reviewerId: reviewerId || null,
          approverId: approverId || null,
          scopeType: scope,
          scopeMeta: {
            selected_count: scopePassports.selected.length,
            filtered_count: scopePassports.filtered.length,
            all_count: scopePassports.all.length,
            targeted_type: selectedType || null,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bulk revise failed");
      setResult(data);
      if (onApplied) await onApplied(data);
    } catch (err) {
      setError(err.message || "Bulk revise failed");
    } finally {
      setSubmitting(false);
    }
  };

  const renderValueField = (row) => {
    const field = availableFields.find(item => item.key === row.key);
    if (!field) {
      return (
        <input
          type="text"
          className="device-manual-input"
          value={row.value}
          onChange={(e) => updateChangeRow(row.id, { value: e.target.value })}
          placeholder="Choose a field first"
          disabled
        />
      );
    }

    if (field.type === "boolean") {
      return (
        <select
          className="device-manual-input"
          value={row.value}
          onChange={(e) => updateChangeRow(row.id, { value: e.target.value })}
        >
          <option value="">Select…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (field.type === "table") {
      return (
        <textarea
          className="bulk-revise-textarea"
          rows={3}
          value={row.value}
          onChange={(e) => updateChangeRow(row.id, { value: e.target.value })}
          placeholder='Enter JSON, e.g. [["Cell 1","Cell 2"]]'
        />
      );
    }

    return (
      <input
        type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
        className="device-manual-input"
        value={row.value}
        onChange={(e) => updateChangeRow(row.id, { value: e.target.value })}
        placeholder={`Enter ${field.label}`}
      />
    );
  };

  const modalBody = result ? (
    <>
      <h3 className="dashboard-modal-title">Bulk Revise Complete</h3>
      <p className="dashboard-modal-subtitle">
        Batch <strong>#{result.batch?.id}</strong> processed {result.summary?.targeted || 0} passport{result.summary?.targeted === 1 ? "" : "s"}.
      </p>

      <div className="tmpl-bulk-summary">
        <div className="tmpl-bulk-stat tmpl-bulk-created">
          <span className="tmpl-bulk-num">{result.summary?.revised || 0}</span>
          <span>revised</span>
        </div>
        <div className="tmpl-bulk-stat tmpl-bulk-skipped">
          <span className="tmpl-bulk-num">{result.summary?.skipped || 0}</span>
          <span>skipped</span>
        </div>
        <div className="tmpl-bulk-stat tmpl-bulk-failed">
          <span className="tmpl-bulk-num">{result.summary?.failed || 0}</span>
          <span>failed</span>
        </div>
      </div>

      <div className="bulk-revise-result-list">
        {result.details?.map((item, index) => (
            <div key={`${item.guid}-${index}`} className={`bulk-revise-result-item ${item.status || "default"}`}>
            <div className="bulk-revise-result-topline">
              <strong>{item.guid?.slice(0, 8)}…</strong>
              <span>{item.passport_type}</span>
              <span className={`bulk-revise-result-status ${item.status || "default"}`}>
                {item.status}
              </span>
            </div>
            <div className="bulk-revise-result-copy">
              {item.source_version_number ? `v${item.source_version_number}` : "—"}
              {item.new_version_number ? ` -> v${item.new_version_number}` : ""}
              {item.message ? ` · ${item.message}` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-modal-actions dashboard-modal-actions-end">
        <button type="button" className="dashboard-btn dashboard-btn-secondary" onClick={downloadResultsCsv}>
          ⬇ Download Results CSV
        </button>
        <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  ) : (
    <>
      <h3 className="dashboard-modal-title">Bulk Revise Released Passports</h3>
      <p className="dashboard-modal-subtitle">
        Create new <strong>In Revision</strong> versions for many released passports at once. The latest released version for each GUID is used automatically.
      </p>

      <form onSubmit={handleSubmit} className="bulk-create-form">
        <div className="bulk-revise-scope-grid">
          {scopeOptions.map(option => (
            <button
              key={option.id}
              type="button"
              className={`bulk-revise-scope-card${scope === option.id ? " active" : ""}`}
              onClick={() => setScope(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.count} released</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        {availableTypes.length > 1 && (
          <div className="wf-select-group">
            <label>Passport type</label>
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
              {availableTypes.map(typeName => {
                const typeMeta = allPassportTypes.find(type => type.type_name === typeName);
                return (
                  <option key={typeName} value={typeName}>
                    {typeMeta?.display_name || typeName}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div className="dashboard-note-panel">
          Targeting <strong>{targetedPassports.length}</strong> released passport{targetedPassports.length === 1 ? "" : "s"}.
        </div>

        <div className="bulk-revise-change-list">
          {changeRows.map((row, index) => {
            const usedKeys = new Set(changeRows.filter(item => item.id !== row.id).map(item => item.key).filter(Boolean));
            return (
              <div key={row.id} className="bulk-revise-change-row">
                <div className="bulk-revise-field-select">
                  <label>Field {index + 1}</label>
                  <select
                    className="device-manual-input"
                    value={row.key}
                    onChange={(e) => updateChangeRow(row.id, { key: e.target.value, value: "" })}
                  >
                    <option value="">Choose field…</option>
                    {availableFields.map(field => (
                      <option key={field.key} value={field.key} disabled={usedKeys.has(field.key)}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bulk-revise-field-value">
                  <label>New value</label>
                  {renderValueField(row)}
                </div>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn-ghost bulk-revise-remove-btn"
                  onClick={() => removeChangeRow(row.id)}
                  disabled={changeRows.length === 1}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        <div className="dashboard-modal-actions">
          <button type="button" className="dashboard-btn dashboard-btn-secondary" onClick={addChangeRow}>
            + Add Another Field
          </button>
        </div>

        <div className="wf-select-group">
          <label>Revision note <span className="wf-opt">(optional)</span></label>
          <textarea
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="Describe why these passports are being revised."
          />
        </div>

        <label className="bulk-revise-checkbox">
          <input
            type="checkbox"
            checked={submitToWorkflow}
            onChange={(e) => setSubmitToWorkflow(e.target.checked)}
          />
          <span>Auto-submit all created revisions to workflow</span>
        </label>

        {submitToWorkflow && (
          <>
            <div className="wf-select-group">
              <label>Reviewer <span className="wf-opt">(optional if approver selected)</span></label>
              <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} disabled={submitting}>
                <option value="">— Skip review —</option>
                {teamUsers.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name} — {member.role}
                  </option>
                ))}
              </select>
            </div>
            <div className="wf-select-group">
              <label>Approver <span className="wf-opt">(optional if reviewer selected)</span></label>
              <select value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={submitting}>
                <option value="">— Skip approval —</option>
                {teamUsers
                  .filter(member => !reviewerId || String(member.id) !== reviewerId)
                  .map(member => (
                    <option key={member.id} value={member.id}>
                      {member.first_name} {member.last_name} — {member.role}
                    </option>
                  ))}
              </select>
            </div>
          </>
        )}

        {error && <div className="dashboard-inline-error">{error}</div>}

        <div className="dashboard-modal-actions dashboard-modal-actions-end">
          <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={submitting || !targetedPassports.length}>
            {submitting ? "Creating revisions…" : submitToWorkflow ? "Create & Submit" : "Create Revisions"}
          </button>
        </div>
      </form>
    </>
  );

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="dashboard-modal-card bulk-revise-modal-card">
        {modalBody}
      </div>
    </div>,
    document.body
  );
}

function PrintQrModal({ selectedCount, onClose, onConfirm, isExporting }) {
  const [widthMm, setWidthMm] = useState("50");
  const [heightMm, setHeightMm] = useState("70");
  const [format, setFormat] = useState("png");
  const [colorMode, setColorMode] = useState("color");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const width = Number(widthMm);
    const height = Number(heightMm);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setError("Enter a valid width and height in millimetres.");
      return;
    }
    if (width < 20 || height < 20) {
      setError("Use at least 20 mm for both width and height.");
      return;
    }
    setError("");
    onConfirm({ widthMm: width, heightMm: height, format, colorMode });
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isExporting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Print Passport QR Code</h3>
        <p className="dashboard-modal-subtitle">
          Export {selectedCount} selected passport QR code{selectedCount !== 1 ? "s" : ""}. Each passport will download as its own image file.
        </p>
        <form onSubmit={handleSubmit} className="bulk-create-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>Width (mm)</label>
              <input
                type="number"
                min="20"
                step="1"
                value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)}
                disabled={isExporting}
              />
            </div>
            <div className="form-group">
              <label>Height (mm)</label>
              <input
                type="number"
                min="20"
                step="1"
                value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)}
                disabled={isExporting}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={isExporting}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>
          <div className="form-group">
            <label>Colour mode</label>
            <select value={colorMode} onChange={(e) => setColorMode(e.target.value)} disabled={isExporting}>
              <option value="color">Colour</option>
              <option value="bw">B&amp;W</option>
            </select>
          </div>
          <p className="bulk-create-note">
            The total label size includes passport category on top, the QR code in the middle, and the passport GUID at the bottom.
          </p>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isExporting}>
              Cancel
            </button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={isExporting}>
              {isExporting ? "Preparing..." : "Download QR Codes"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function ArchiveConfirmModal({ title, message, confirmLabel = "Archive", onClose, onConfirm, isSubmitting }) {
  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}>
      <div className="dashboard-modal-card dashboard-modal-card-compact">
        <h3 className="dashboard-modal-title">Archive Passport</h3>
        <p className="dashboard-modal-subtitle">{title}</p>
        <div className="dashboard-warning-panel">
          <div className="dashboard-warning-item">
            <strong className="dashboard-warning-label">What happens next</strong>
            <div className="dashboard-warning-copy">{message}</div>
          </div>
        </div>
        <div className="dashboard-modal-actions dashboard-modal-actions-end">
          <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Archiving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Device Integration Modal ──────────────────────────────────────────────────
function DeviceIntegrationModal({ passport, passportType, companyId, onClose }) {
  const [deviceKey,    setDeviceKey]    = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [dynFields,    setDynFields]    = useState([]);
  const [manualVals,   setManualVals]   = useState({});
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState("");
  const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";

  useEffect(() => {
    // Fetch device key
    fetch(`${API}/api/companies/${companyId}/passports/${passport.guid}/device-key`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.deviceKey) setDeviceKey(d.deviceKey); })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch type definition to find dynamic fields
    fetch(`${API}/api/passport-types/${passportType}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const sections = d.fields_json?.sections || [];
        const dyn = sections.flatMap(s => s.fields || []).filter(f => f.dynamic);
        setDynFields(dyn);
      })
      .catch(() => {});

    // Fetch current dynamic values for manual override display
    fetch(`${API}/api/passports/${passport.guid}/dynamic-values`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.values) {
          const vals = {};
          Object.entries(d.values).forEach(([k, v]) => { vals[k] = v.value ?? ""; });
          setManualVals(vals);
        }
      })
      .catch(() => {});
  }, [passport.guid, passportType, companyId]);

  const handleRegenerate = async () => {
    if (!window.confirm("Regenerate the device key? The old key will stop working immediately.")) return;
    setRegenerating(true);
    try {
      const r = await fetch(
        `${API}/api/companies/${companyId}/passports/${passport.guid}/device-key/regenerate`,
        { method: "POST", headers: authHeaders() }
      );
      const d = await r.json();
      if (r.ok) setDeviceKey(d.deviceKey);
    } catch {}
    finally { setRegenerating(false); }
  };

  const handleSaveManual = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(
        `${API}/api/companies/${companyId}/passports/${passport.guid}/dynamic-values`,
        {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(manualVals),
        }
      );
      setSaveMsg(r.ok ? "Saved!" : "Save failed");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch { setSaveMsg("Save failed"); }
    finally { setSaving(false); }
  };

  const copyKey = () => {
    if (!deviceKey) return;
    navigator.clipboard.writeText(deviceKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const endpoint = `${apiBase}/api/passports/${passport.guid}/dynamic-values`;
  const exampleBody = dynFields.length
    ? `{\n${dynFields.map(f => `  "${f.key}": "value"`).join(",\n")}\n}`
    : `{\n  "field_key": "value"\n}`;

  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box device-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Device Integration — {passport.model_name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="device-modal-body">
          {/* Device API Key */}
          <section className="device-section">
            <h4 className="device-section-title">Device API Key</h4>
            <p className="device-section-desc">
              Your IoT device uses this key to push live values. Send it in the <code>x-device-key</code> header.
            </p>
            {loading ? (
              <div className="device-key-row"><span className="device-loading-copy">Loading…</span></div>
            ) : (
              <div className="device-key-row">
                <code className="device-key-code">{deviceKey || "—"}</code>
                <button className="device-copy-btn" onClick={copyKey} disabled={!deviceKey}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <button className="device-regen-btn" onClick={handleRegenerate} disabled={regenerating}>
                  {regenerating ? "…" : "Regenerate"}
                </button>
              </div>
            )}
          </section>

          {/* Push endpoint docs */}
          <section className="device-section">
            <h4 className="device-section-title">Push Endpoint</h4>
            <div className="device-code-block">
              <div className="device-code-line"><span className="device-code-method">POST</span> <span className="device-code-url">{endpoint}</span></div>
              <div className="device-code-line device-code-line-spaced">
                <span className="device-code-comment">Headers:</span>
              </div>
              <div className="device-code-line device-code-indent">
                x-device-key: <em>&lt;your device key&gt;</em>
              </div>
              <div className="device-code-line device-code-indent">
                Content-Type: application/json
              </div>
              <div className="device-code-line device-code-line-spaced">
                <span className="device-code-comment">Body:</span>
              </div>
              <pre className="device-code-pre">{exampleBody}</pre>
            </div>
          </section>

          {/* Manual override */}
          {dynFields.length > 0 && (
            <section className="device-section">
              <h4 className="device-section-title">Manual Override</h4>
              <p className="device-section-desc">Set values directly without a device (useful for testing).</p>
              <div className="device-manual-grid">
                {dynFields.map(f => (
                  <div key={f.key} className="device-manual-row">
                    <label className="device-manual-label">{f.label}</label>
                    <input
                      type="text"
                      className="device-manual-input"
                      value={manualVals[f.key] ?? ""}
                      placeholder="Enter value…"
                      onChange={e => setManualVals(p => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="device-manual-actions">
                <button className="submit-btn" onClick={handleSaveManual} disabled={saving}>
                  {saving ? "Saving…" : "Save Values"}
                </button>
                {saveMsg && <span className="device-save-msg">{saveMsg}</span>}
              </div>
            </section>
          )}

          {dynFields.length === 0 && (
            <div className="device-no-dynamic">
              This passport type has no dynamic fields defined. Mark fields as "Dynamic" in the passport type editor to enable live data.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function BulkWorkflowModal({ companyId, user, selectedList, onClose, onDone }) {
  const [teamUsers,  setTeamUsers]  = useState([]);
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  useEffect(() => {
    fetch(`${API}/api/companies/${companyId}/users`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        setTeamUsers(data.filter(u => (u.role === "editor" || u.role === "company_admin") && u.id !== user?.id));
      }).catch(() => {});
    fetch(`${API}/api/users/me`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.default_reviewer_id) setReviewerId(String(d.default_reviewer_id));
        if (d.default_approver_id) setApproverId(String(d.default_approver_id));
      }).catch(() => {});
  }, [companyId, user?.id]);

  const handleSubmit = async () => {
    if (!reviewerId && !approverId) { setError("Select at least one reviewer or approver."); return; }
    setSubmitting(true); setError("");
    try {
      const items = selectedList.map(p => ({ guid: p.guid, passportType: p.passport_type || p.passportType }));
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk-workflow`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ items, reviewerId: reviewerId ? parseInt(reviewerId) : null, approverId: approverId ? parseInt(approverId) : null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      onDone(`Workflow: ${d.summary?.submitted || 0} submitted, ${d.summary?.skipped || 0} skipped`);
    } catch (e) { setError(e.message); setSubmitting(false); }
  };

  const editableCount = selectedList.filter(p => {
    const s = normalizePassportStatus(p.release_status);
    return s === "draft" || s === "in_revision";
  }).length;

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>Send {editableCount} Passport{editableCount !== 1 ? "s" : ""} to Workflow</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">
            Only draft and in-revision passports will be submitted. Released passports will be skipped.
          </p>
          {error && <div className="alert alert-error dashboard-alert-inline">{error}</div>}
          <div className="wf-select-group">
            <label>Reviewer <span className="wf-opt">(optional if approver selected)</span></label>
            <select value={reviewerId} onChange={e => setReviewerId(e.target.value)} disabled={submitting}>
              <option value="">— Skip review —</option>
              {teamUsers.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.role}</option>)}
            </select>
          </div>
          <div className="wf-select-group">
            <label>Approver <span className="wf-opt">(optional if reviewer selected)</span></label>
            <select value={approverId} onChange={e => setApproverId(e.target.value)} disabled={submitting}>
              <option value="">— Skip approval —</option>
              {teamUsers.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.role}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="submit-btn" disabled={submitting || (!reviewerId && !approverId)} onClick={handleSubmit}>
            {submitting ? "Submitting…" : `Submit ${editableCount} to Workflow`}
          </button>
          <button className="cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PassportList({ user, companyId, filterByUser, filterByUmbrella }) {
  const navigate = useNavigate();
  const { passportType, productKey, umbrellaKey } = useParams();
  const [passports,    setPassports]    = useState([]);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState("");
  const [successMsg,   setSuccessMsg]   = useState("");
  const [searchText,   setSearchText]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [openMenuId,   setOpenMenuId]   = useState(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [printQrModalOpen, setPrintQrModalOpen] = useState(false);
  const [qrExporting, setQrExporting] = useState(false);
  const [releaseModal,  setReleaseModal]  = useState(null);
  const [csvModal,      setCsvModal]      = useState(null); // { passport, pType }
  const [deviceModal,   setDeviceModal]   = useState(null); // { passport, pType }
  const [historyModal,  setHistoryModal]  = useState(null); // { guid, passportType }
  const [bulkCreateOpen,  setBulkCreateOpen]  = useState(false);
  const [bulkReviseOpen,  setBulkReviseOpen]  = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [bulkWorkflowOpen, setBulkWorkflowOpen] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(null); // { mode, guid?, pType?, count? }
  const [selectedPassports, setSelectedPassports] = useState(new Set());
  const [expandedPassportGroups, setExpandedPassportGroups] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "created_at", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [allPassportTypes, setAllPassportTypes] = useState([]); // used for product category + access_granted check
  const createMenuRef = useRef(null);
  const activeType = passportType || null;
  const activeProductCategory = productKey
    ? decodeURIComponent(productKey)
    : umbrellaKey
      ? decodeURIComponent(umbrellaKey)
      : null;

  // Current type's access_granted flag (false = revoked)
  const activeTypeData = allPassportTypes.find(t => t.type_name === activeType);
  const accessGranted = activeTypeData ? activeTypeData.access_granted : true;
  const getViewerPath = (passport, { forcePreview = false } = {}) => {
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
  };

  const openPassportViewer = (passport, options = {}) => {
    const path = getViewerPath(passport, options);
    if (!path) return;
    window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
  };

  // ── Per-user pinned passports (localStorage) ──────────────
  const [pinnedGuids, setPinnedGuids] = useState(new Set());

  // Reload pinned set whenever the identity (companyId + userId) is known / changes
  useEffect(() => {
    if (!companyId || !user?.id) return;
    try {
      const raw = localStorage.getItem(`passport_pins_${companyId}_${user.id}`);
      setPinnedGuids(new Set(raw ? JSON.parse(raw) : []));
    } catch { setPinnedGuids(new Set()); }
  }, [companyId, user?.id]);

  const togglePin = (guid) => {
    if (!companyId || !user?.id) return;
    const key = `passport_pins_${companyId}_${user.id}`;
    setPinnedGuids(prev => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid); else next.add(guid);
      try { localStorage.setItem(key, JSON.stringify([...next])); } catch {}
      return next;
    });
    setOpenMenuId(null);
  };

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
  }, [passportType, productKey, umbrellaKey, filterByUser]);

  // Fetch all passport types once for access_granted lookup and product-category filtering
  useEffect(() => {
    if (!companyId) return;
    fetch(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAllPassportTypes(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [companyId]);

  useEffect(() => {
    const handler = (e) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target)) {
        setCreateMenuOpen(false);
      }
    };
    if (createMenuOpen) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [createMenuOpen]);


  const fetchPassports = useCallback(async () => {
    if (!activeType && !filterByUser && !activeProductCategory) return;
    try {
      setIsLoading(true); setError("");

      // Helper to fetch all passports for a list of type names
      const fetchForTypes = async (types) => {
        let all = [];
        for (const t of types) {
          const params = new URLSearchParams({ passportType: t.type_name });
          if (searchText) params.append("search", searchText);
          if (filterStatus) params.append("status", filterStatus);
          const r = await fetch(`${API}/api/companies/${companyId}/passports?${params}`,
            { headers: authHeaders() });
          if (r.ok) { const data = await r.json(); all = [...all, ...data]; }
        }
        return all;
      };

      if (filterByUser) {
        const typesRes = await fetch(`${API}/api/companies/${companyId}/passport-types`,
          { headers: authHeaders() });
        const types = typesRes.ok ? await typesRes.json() : [];
        let all = await fetchForTypes(Array.isArray(types) ? types : []);
        all = all.filter(p => p.created_by === user?.id);
        all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setPassports(all);
      } else if (activeProductCategory) {
        const typesRes = await fetch(`${API}/api/companies/${companyId}/passport-types`,
          { headers: authHeaders() });
        const allTypes = typesRes.ok ? await typesRes.json() : [];
        const productCategoryTypes = (Array.isArray(allTypes) ? allTypes : [])
          .filter(t => t.umbrella_category === activeProductCategory);
        const all = await fetchForTypes(productCategoryTypes);
        all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setPassports(all);
      } else {
        const params = new URLSearchParams({ passportType: activeType });
        if (searchText) params.append("search", searchText);
        if (filterStatus) params.append("status", filterStatus);
        const r = await fetch(`${API}/api/companies/${companyId}/passports?${params}`,
          { headers: authHeaders() });
        if (!r.ok) throw new Error();
        const data = await r.json();
        data.sort((a, b) => {
          if (a.guid !== b.guid) return a.guid.localeCompare(b.guid);
          return b.version_number - a.version_number;
        });
        setPassports(data);
      }
    } catch { setError("Failed to load passports"); }
    finally { setIsLoading(false); }
  }, [companyId, activeType, activeProductCategory, filterByUser, user, searchText, filterStatus]);

  // Fetch passports whenever dependencies change
  useEffect(() => {
    fetchPassports();
  }, [companyId, activeType, activeProductCategory, filterByUser, user, searchText, filterStatus, fetchPassports]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handleClickOutside = (e) => {
      // Don't close if click is on the kebab button or menu container
      if (e.target.closest('.kebab-menu-btn') || e.target.closest('.kebab-menu-container')) {
        return;
      }
      // Don't close if click is on a row - let row onclick handler manage it
      if (e.target.closest('tr.passport-row-clickable')) {
        return;
      }
      setOpenMenuId(null);
      setMenuAnchorRect(null);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openMenuId]);

  const showSuccess = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 4000); };
  const showError   = (msg) => { setError(msg);       setTimeout(() => setError(""),       5000); };

  const handleRevise = async (guid, v, pType) => {
    const r = await fetch(`${API}/api/companies/${companyId}/passports/${guid}/revise`, {
      method:"POST", headers:authHeaders({"Content-Type":"application/json"}),
      body: JSON.stringify({ passportType: pType }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) { showSuccess(`v${v} → v${data.newVersion} moved into In Revision.`); fetchPassports(); }
    else showError(data.error || "Revise failed");
  };

  const handleClone = async (p, pType) => {
    setOpenMenuId(null);
    setMenuAnchorRect(null);
    try {
      const r = await fetch(
        `${API}/api/companies/${companyId}/passports/${p.guid}?passportType=${pType}`,
        { headers: authHeaders() }
      );
      if (!r.ok) throw new Error("Failed to fetch passport data");
      const data = await r.json();
      navigate(`/create/${pType}`, { state: { cloneData: data } });
    } catch {
      showError("Failed to clone passport — could not fetch data");
    }
  };

  const handleDelete = async (guid, pType) => {
    if (!window.confirm("Delete this passport?")) return;
    const r = await fetch(`${API}/api/companies/${companyId}/passports/${guid}`, {
      method:"DELETE", headers:authHeaders({"Content-Type":"application/json"}),
      body: JSON.stringify({ passportType: pType }),
    });
    if (r.ok) { showSuccess("Deleted"); fetchPassports(); }
    else { const d = await r.json().catch(() => ({})); showError(d.error || "Delete failed"); }
  };

  const handleArchive = async (guid, pType) => {
    setArchiveConfirm({ mode: "single", guid, pType });
  };

  const openMenu = (e, menuId) => {
    e.stopPropagation();
    e.preventDefault();

    // If menu is already open for this item, close it
    if (openMenuId === menuId) {
      setOpenMenuId(null);
      setMenuAnchorRect(null);
    } else {
      // Open menu for this item
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuAnchorRect({
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      });
      setOpenMenuId(menuId);
    }
  };

  const pageTitle = filterByUser ? "My Passports"
    : activeProductCategory ? `${activeProductCategory}`
    : activeType ? `${activeTypeData?.display_name || formatPassportTypeLabel(activeType)} Passports`
    : "Passports";

  // Pinned passports float to the top; order within each group is preserved
  const displayedPassports = [...passports].sort((a, b) => {
    const ap = pinnedGuids.has(a.guid) ? 0 : 1;
    const bp = pinnedGuids.has(b.guid) ? 0 : 1;
    return ap - bp;
  });

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
    const base = [
      { key: "version_number", type: "number", getValue: (group) => group.latest?.version_number },
      { key: "product_id", type: "string", getValue: (group) => group.latest?.product_id || "" },
      { key: "model_name", type: "string", getValue: (group) => group.latest?.model_name || "" },
      { key: "created_at", type: "date", getValue: (group) => group.latest?.created_at },
      { key: "release_status", type: "string", getValue: (group) => group.latest?.release_status || "" },
      { key: "completeness", type: "number", getValue: (group) => calcCompleteness(group.latest, allPassportTypes) ?? -1 },
    ];

    if (filterByUser) {
      base.splice(3, 0, { key: "passport_type", type: "string", getValue: (group) => group.latest?.passport_type || activeType || "" });
    } else {
      base.push({
        key: "created_by",
        type: "string",
        getValue: (group) => (
          group.latest?.first_name && group.latest?.last_name
            ? `${group.latest.first_name} ${group.latest.last_name}`
            : group.latest?.created_by_email || ""
        ),
      });
    }

    return base;
  }, [filterByUser, activeType, allPassportTypes]);

  const filteredAndSortedPassports = useMemo(
    () => applyTableControls(groupedPassports, tableColumns, sortConfig, columnFilters),
    [groupedPassports, tableColumns, sortConfig, columnFilters]
  );
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedPassports.length / rowsPerPage));
  const paginatedPassports = useMemo(() => {
    if (searchText || filterStatus || Object.values(columnFilters).some(Boolean)) {
      return filteredAndSortedPassports;
    }
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredAndSortedPassports.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredAndSortedPassports, currentPage, rowsPerPage, searchText, filterStatus, columnFilters]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterStatus, columnFilters, sortConfig, activeType, activeProductCategory, filterByUser, selectionMode]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const updateColumnFilter = (key, value) => {
    setColumnFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  // CSV Functions
  // CSV Format:
  // Column A: Field names (e.g., "model_name", "Category", "Capacity", etc.)
  // Columns B, C, D, etc.: Passport data (each column represents one passport)
  // First row: Headers like "Field Name", "Passport 1", "Passport 2", etc.
  // System fields: product_id (required), model_name (optional)
  // Form fields: Dynamically fetched from backend based on passport type
  // File fields are skipped (can't embed files in CSV)
  // Boolean fields: "true"/"false" or "1"/"0"
  const downloadCSVTemplate = async () => {
    if (!activeType) return;

    try {
      // Fetch the dynamic passport type definition from backend
      const response = await fetch(`${API}/api/passport-types/${activeType}`);
      if (!response.ok) {
        showError('Failed to fetch passport type definition');
        return;
      }

      const passportTypeData = await response.json();
      const sections = passportTypeData.fields_json?.sections || [];

      const csvRows = [];

      // Header row: Field labels
      csvRows.push(['Field Name', 'Passport 1', 'Passport 2', 'Passport 3']);

      // Add system fields
      csvRows.push(['product_id', '', '', '']);
      csvRows.push(['model_name', '', '', '']);

      // Add all form fields from dynamic sections
      sections.forEach(section => {
        if (section.fields && Array.isArray(section.fields)) {
          section.fields.forEach(field => {
            if (field.type !== 'table') { // Skip table fields for CSV; file/symbol fields accept repository links
              csvRows.push([field.label, '', '', '']);
            }
          });
        }
      });

      const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${activeType}_template.csv`;
      link.click();
    } catch (error) {
      showError('Failed to download CSV template');
    }
  };



  const isFiltering = !!(searchText || filterStatus || Object.values(columnFilters).some(Boolean));

  const selectedPassportList = passports.filter((p) => selectedPassports.has(`${p.guid}-${p.version_number}`));

  const togglePassportGroup = (groupKey) => {
    setExpandedPassportGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

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

  const downloadQrCodes = async ({ widthMm, heightMm, format, colorMode }) => {
    if (!selectedPassportList.length) {
      showError("Select at least one passport first.");
      return;
    }

    const dpi = 300;
    const mmToPx = (mm) => Math.max(1, Math.round((mm / 25.4) * dpi));
    const widthPx = mmToPx(widthMm);
    const heightPx = mmToPx(heightMm);
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const isBw = colorMode === "bw";
    const background = isBw || format === "jpeg" ? "#ffffff" : "#0f2134";

    setQrExporting(true);
    try {
      for (const passport of selectedPassportList) {
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not create export canvas");

        ctx.fillStyle = background;
        ctx.fillRect(0, 0, widthPx, heightPx);

        const topPadding = Math.round(heightPx * 0.09);
        const bottomPadding = Math.round(heightPx * 0.08);
        const sidePadding = Math.round(widthPx * 0.08);
        const categoryFontSize = Math.max(22, Math.round(heightPx * 0.065));
        const guidFontSize = Math.max(18, Math.round(heightPx * 0.045));
        const qrTop = topPadding + categoryFontSize + Math.round(heightPx * 0.06);
        const qrBottomLimit = heightPx - bottomPadding - guidFontSize - Math.round(heightPx * 0.05);
        const qrSize = Math.max(120, Math.min(widthPx - sidePadding * 2, qrBottomLimit - qrTop));
        const qrX = Math.round((widthPx - qrSize) / 2);
        const qrY = qrTop;

        const qrCanvas = document.createElement("canvas");
        const passportPath = buildPublicPassportPath({
          companyName: user?.company_name,
          modelName: passport.model_name,
          productId: passport.product_id,
        });
        if (!passportPath) throw new Error("Passport link is unavailable for this QR code");
        await QRCode.toCanvas(qrCanvas, `${window.location.origin}${passportPath}`, {
          errorCorrectionLevel: "H",
          margin: 1,
          width: qrSize,
          color: {
            dark: isBw ? "#000000" : (format === "jpeg" ? "#0b1826" : "#f0f6fa"),
            light: background,
          },
        });

        ctx.textAlign = "center";
        ctx.fillStyle = isBw ? "#000000" : (format === "jpeg" ? "#0b1826" : "#f0f6fa");

        ctx.font = `700 ${categoryFontSize}px ${getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "sans-serif"}`;
        ctx.fillText((passport.passport_type || activeType || "Passport").replace(/_/g, " "), widthPx / 2, topPadding + categoryFontSize);

        ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

        ctx.font = `600 ${guidFontSize}px monospace`;
        ctx.fillStyle = isBw ? "#000000" : (format === "jpeg" ? "#35586a" : "#b8ccd9");
        ctx.fillText(passport.product_id || passport.guid, widthPx / 2, heightPx - bottomPadding);

        const dataUrl = canvas.toDataURL(mimeType, format === "jpeg" ? 0.95 : undefined);
        const link = document.createElement("a");
        const safeType = (passport.passport_type || activeType || "passport").replace(/[^a-z0-9-_]+/gi, "_").toLowerCase();
        link.href = dataUrl;
        link.download = `${safeType}_${passport.product_id || passport.guid}.${format}`;
        link.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      setPrintQrModalOpen(false);
      showSuccess(`Downloaded ${selectedPassportList.length} QR code file${selectedPassportList.length !== 1 ? "s" : ""}.`);
    } catch (error) {
      showError(error.message || "Failed to generate QR codes");
    } finally {
      setQrExporting(false);
    }
  };


  const toggleSelectAll = () => {
    const visibleKeys = getVisiblePassportKeys(paginatedPassports);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every(key => selectedPassports.has(key));
    if (allVisibleSelected) {
      const nextSelected = new Set(selectedPassports);
      visibleKeys.forEach((key) => nextSelected.delete(key));
      setSelectedPassports(nextSelected);
    } else {
      const nextSelected = new Set(selectedPassports);
      visibleKeys.forEach((key) => nextSelected.add(key));
      setSelectedPassports(nextSelected);
    }
  };

  const toggleSelectPassport = (guid, version) => {
    const key = `${guid}-${version}`;
    const newSelected = new Set(selectedPassports);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedPassports(newSelected);
  };

  const renderPassportRow = (passport, {
    parentGuid = passport.guid,
    isHistorical = false,
    hasOlderVersions = false,
    latestVersionNumber = passport.version_number,
  } = {}) => {
    const pType = passport.passport_type || activeType;
    const menuId = `${passport.guid}-${passport.version_number}`;
    const isOpen = openMenuId === menuId;
    const pct = calcCompleteness(passport, allPassportTypes);
    const isPinned = pinnedGuids.has(passport.guid);
    const isExpanded = expandedPassportGroups.has(parentGuid);
    const normalizedStatus = normalizePassportStatus(passport.release_status);
    const showOlderVersionsToggle = hasOlderVersions && !isHistorical;

    return (
      <tr
        key={`${menuId}${isHistorical ? "-history" : ""}`}
        className={[
          isPinned ? "passport-row-pinned" : "",
          "passport-row-clickable",
          isHistorical ? "passport-row-history" : "",
        ].filter(Boolean).join(" ")}
        onClick={() => {
          if (openMenuId) {
            setOpenMenuId(null);
            return;
          }
          if (selectionMode) {
            toggleSelectPassport(passport.guid, passport.version_number);
          } else {
            openPassportViewer(passport);
          }
        }}
      >
        {user?.role !== "viewer" && selectionMode && (
          <td>
            <input
              type="checkbox"
              checked={selectedPassports.has(menuId)}
              onChange={() => toggleSelectPassport(passport.guid, passport.version_number)}
              onClick={e => e.stopPropagation()}
            />
          </td>
        )}
        <td className="passport-pin-cell" title={isPinned ? "Pinned" : ""}>
          {!isHistorical && isPinned ? "📌" : ""}
        </td>
        <td className="passport-version-col">
          <div className={`passport-version-cell${isHistorical ? " historical" : ""}`}>
            <span className="passport-version-toggle-slot" aria-hidden={!showOlderVersionsToggle}>
              {showOlderVersionsToggle && (
                <button
                  type="button"
                  className="passport-version-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePassportGroup(parentGuid);
                  }}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Hide older versions" : "Show older versions"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              )}
            </span>
            <span className="version-badge">v{passport.version_number}</span>
          </div>
        </td>
        <td>{passport.product_id
          ? <span className="product-id-badge">{passport.product_id}</span>
          : <span className="no-product-id">—</span>}</td>
        <td>
          <button
            className="model-link-btn"
            onClick={e => {
              e.stopPropagation();
              openPassportViewer(passport);
            }}
          >
            {passport.model_name}
          </button>
        </td>
        {filterByUser && (
          <td><span className="type-badge passport-type-badge">{pType}</span></td>
        )}
        <td>{new Date(passport.created_at).toLocaleDateString()}</td>
        <td>
          <div className="passport-status-cell">
            <span className={`status-badge ${normalizedStatus}`}>
              {formatPassportStatus(passport.release_status)}
            </span>
          </div>
        </td>
        <td><CompletenessBar pct={pct} /></td>
        {!filterByUser && (
          <td className="small-text">
            {passport.first_name && passport.last_name
              ? `${passport.first_name} ${passport.last_name}`
              : passport.created_by_email || "—"}
          </td>
        )}
        <td className="options-cell" onClick={e => e.stopPropagation()}>
          {user?.role !== "viewer" && (
            <div className="kebab-menu-container">
              <button className="kebab-menu-btn" onClick={e => openMenu(e, menuId)}>⋮</button>
            </div>
          )}
          {isOpen && (
            <KebabMenu anchorRect={menuAnchorRect} onClose={() => { setOpenMenuId(null); setMenuAnchorRect(null); }}>
              <button className="menu-item" onClick={() => togglePin(passport.guid)}>
                {isPinned ? "📌 Unpin" : "📌 Pin to top"}
              </button>
              <button
                className={`menu-item edit-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`}
                disabled={!isEditablePassportStatus(passport.release_status)}
                onClick={() => { navigate(`/edit/${passport.guid}?passportType=${pType}`); setOpenMenuId(null); }}
              >
                ✏️ Edit
              </button>
              <button
                className={`menu-item release-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`}
                disabled={!isEditablePassportStatus(passport.release_status)}
                onClick={() => { setReleaseModal({ ...passport, passport_type: pType }); setOpenMenuId(null); }}
              >
                🎯 Release
              </button>
              <button className="menu-item" onClick={() => { openPassportViewer(passport, { forcePreview: true }); setOpenMenuId(null); }}>
                👁 Preview public view
              </button>
              <button
                className={`menu-item revise-item${passport.release_status !== "released" ? " disabled" : ""}`}
                disabled={passport.release_status !== "released"}
                onClick={() => { handleRevise(passport.guid, passport.version_number, pType); setOpenMenuId(null); }}
              >
                🔄 Revise
              </button>
              <button className="menu-item" onClick={() => handleClone(passport, pType)}>
                🔁 Clone
              </button>
              <button
                className={`menu-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`}
                disabled={!isEditablePassportStatus(passport.release_status)}
                onClick={() => { setCsvModal({ passport, pType }); setOpenMenuId(null); }}
              >
                📤 Update data via CSV
              </button>
              <button className="menu-item" onClick={() => { setHistoryModal({ guid: passport.guid, passportType: pType }); setOpenMenuId(null); }}>
                🕘 Update history
              </button>
              <button className="menu-item" onClick={() => { navigate(`/passport/${passport.guid}/diff?passportType=${pType}`); setOpenMenuId(null); }}>
                🔀 Compare versions
              </button>
              <button className="menu-item" onClick={() => { setDeviceModal({ passport, pType }); setOpenMenuId(null); }}>
                📡 Device Integration
              </button>
              <button
                className="menu-item"
                onClick={async () => {
                  setOpenMenuId(null);
                  try {
                    const r = await fetch(
                      `${API}/api/companies/${companyId}/passports/${passport.guid}/export/aas`,
                      { headers: authHeaders() }
                    );
                    if (!r.ok) throw new Error();
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `passport-${passport.guid}.aas.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    showError("Failed to export AAS");
                  }
                }}
              >
                📦 Export AAS (JSON)
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  const path = getViewerPath(passport);
                  if (!path) {
                    showError("No viewer link is available for this passport");
                    setOpenMenuId(null);
                    return;
                  }
                  const url = `${window.location.origin}${path}`;
                  navigator.clipboard.writeText(url).then(() => {
                    showSuccess(`${normalizePassportStatus(passport.release_status) === "released" ? "Passport" : "Preview"} link copied to clipboard`);
                  }).catch(() => {
                    showError("Could not copy link");
                  });
                  setOpenMenuId(null);
                }}
              >
                🔗 {normalizePassportStatus(passport.release_status) === "released" ? "Copy passport link" : "Copy preview link"}
              </button>
              <button className="menu-item" onClick={() => { handleArchive(passport.guid, pType); setOpenMenuId(null); }}>
                📦 Archive
              </button>
              <button
                className={`menu-item delete-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`}
                disabled={!isEditablePassportStatus(passport.release_status)}
                onClick={() => { handleDelete(passport.guid, pType); setOpenMenuId(null); }}
              >
                🗑️ Delete
              </button>
            </KebabMenu>
          )}
        </td>
      </tr>
    );
  };

  const bulkRelease = async () => {
    if (!selectedPassportList.length) return;
    const editable = selectedPassportList.filter(p => isEditablePassportStatus(p.release_status));
    if (!editable.length) { showError("No draft or in-revision passports selected."); return; }
    if (!window.confirm(`Release ${editable.length} passport${editable.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkActionLoading(true);
    try {
      const items = editable.map(p => ({ guid: p.guid, passportType: p.passport_type || activeType }));
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk-release`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ items }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Bulk release failed");
      showSuccess(`Released ${d.summary?.released || 0}, skipped ${d.summary?.skipped || 0}, failed ${d.summary?.failed || 0}`);
      setSelectedPassports(new Set());
      fetchPassports();
    } catch (e) { showError(e.message); }
    finally { setBulkActionLoading(false); }
  };

  const bulkDelete = async () => {
    if (!selectedPassportList.length) return;
    const editable = selectedPassportList.filter(p => isEditablePassportStatus(p.release_status));
    if (!editable.length) { showError("No deletable passports selected. Released passports cannot be deleted."); return; }
    if (!window.confirm(`Permanently delete ${editable.length} passport${editable.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkActionLoading(true);
    let deleted = 0, failed = 0;
    try {
      for (const p of editable) {
        const pType = p.passport_type || activeType;
        const r = await fetch(`${API}/api/companies/${companyId}/passports/${p.guid}`, {
          method: "DELETE",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ passportType: pType }),
        });
        if (r.ok) deleted++; else failed++;
      }
      showSuccess(`Deleted ${deleted}${failed ? `, ${failed} failed` : ""}`);
      setSelectedPassports(new Set());
      fetchPassports();
    } catch (e) { showError(e.message); }
    finally { setBulkActionLoading(false); }
  };

  const bulkExportJson = async () => {
    if (!selectedPassportList.length) { showError("Select at least one passport."); return; }
    setBulkActionLoading(true);
    try {
      const exported = [];
      for (const p of selectedPassportList) {
        const pType = p.passport_type || activeType;
        const r = await fetch(`${API}/api/companies/${companyId}/passports/${p.guid}?passportType=${pType}`, { headers: authHeaders() });
        if (r.ok) { const data = await r.json(); exported.push(data); }
      }
      if (!exported.length) { showError("Could not fetch any passport data."); return; }
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `passports-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSuccess(`Exported ${exported.length} passport${exported.length !== 1 ? "s" : ""} as JSON`);
    } catch (e) { showError(e.message); }
    finally { setBulkActionLoading(false); }
  };

  const bulkArchive = async () => {
    if (!selectedPassportList.length) return;
    setArchiveConfirm({ mode: "bulk", count: selectedPassportList.length });
  };

  const confirmArchive = async () => {
    if (!archiveConfirm) return;

    if (archiveConfirm.mode === "single") {
      try {
        setBulkActionLoading(true);
        const r = await fetch(`${API}/api/companies/${companyId}/passports/${archiveConfirm.guid}/archive`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ passportType: archiveConfirm.pType }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Archive failed");
        showSuccess("Passport archived");
        setArchiveConfirm(null);
        fetchPassports();
      } catch (e) {
        showError(e.message);
      } finally {
        setBulkActionLoading(false);
      }
      return;
    }

    try {
      setBulkActionLoading(true);
      const items = selectedPassportList.map(p => ({ guid: p.guid, passportType: p.passport_type || activeType }));
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk-archive`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ items }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Bulk archive failed");
      showSuccess(`Archived ${d.summary?.archived || 0}, skipped ${d.summary?.skipped || 0}`);
      setSelectedPassports(new Set());
      setArchiveConfirm(null);
      fetchPassports();
    } catch (e) {
      showError(e.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  return (
    <div className="passport-list-page">
      <div className="passport-list-header">
        <div>
          <h2 className="passport-list-title">📋 {pageTitle}</h2>
          <p className="passport-list-description">Manage and track all your digital product passports</p>
        </div>
        {user?.role !== "viewer" && (
          <div className="passport-list-actions">
            <button
              className={`csv-btn template-btn passport-select-toggle${selectionMode ? " active" : ""}`}
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelectedPassports(new Set());
                  setPrintQrModalOpen(false);
                } else {
                  setSelectionMode(true);
                }
              }}
              title={selectionMode ? "Hide passport selection" : "Select passports"}
            >
              {selectionMode ? "Done Selecting" : "Select Passports"}
            </button>
            <button className="csv-btn export-btn" onClick={() => setExportModalOpen(true)} title="Export passports">
              📊 Export
            </button>
          </div>
        )}
      </div>

      {selectionMode && selectedPassportList.length > 0 && (
        <div className="bulk-actions-bar">
          <span className="bulk-actions-count">{selectedPassportList.length} selected</span>
          <div className="bulk-actions-buttons">
            <button className="bulk-action-btn bulk-action-release" onClick={bulkRelease} disabled={bulkActionLoading}
              title="Release selected draft/in-revision passports">
              🎯 Release
            </button>
            <button className="bulk-action-btn bulk-action-workflow" onClick={() => setBulkWorkflowOpen(true)} disabled={bulkActionLoading}
              title="Submit selected passports to review/approval workflow">
              📋 Send to Workflow
            </button>
            <button
              className="bulk-action-btn bulk-action-revise"
              onClick={() => setBulkReviseOpen(true)}
              disabled={bulkActionLoading}
              title="Open the bulk revise flow for the selected passports"
            >
              🔄 Bulk Revise
            </button>
            <button className="bulk-action-btn bulk-action-export" onClick={bulkExportJson} disabled={bulkActionLoading}
              title="Download selected passports as JSON">
              📦 Export JSON
            </button>
            <button className="bulk-action-btn bulk-action-qr" onClick={() => setPrintQrModalOpen(true)} disabled={bulkActionLoading}
              title="Print QR codes for selected passports">
              🖨 Print QR
            </button>
            <button className="bulk-action-btn bulk-action-archive" onClick={bulkArchive} disabled={bulkActionLoading}
              title="Archive selected passports">
              📦 Archive
            </button>
            <button className="bulk-action-btn bulk-action-delete" onClick={bulkDelete} disabled={bulkActionLoading}
              title="Delete selected draft/in-revision passports">
              🗑️ Delete
            </button>
          </div>
          {bulkActionLoading && <span className="bulk-actions-loading">Processing…</span>}
        </div>
      )}

      <div className="search-bar">
        <input type="text" placeholder="🔍 Search by serial number or model name…"
          value={searchText} onChange={e => setSearchText(e.target.value)} className="search-input" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="released">Released</option>
          <option value="in_revision">In Revision</option>
          <option value="obsolete">Obsolete</option>
        </select>
        {(searchText || filterStatus) && (
          <button className="clear-filter-btn" onClick={() => { setSearchText(""); setFilterStatus(""); }}>
            ✕ Clear
          </button>
        )}
        <button
          type="button"
          className={`table-filter-toggle-btn search-filter-toggle-btn${showFilters ? " active" : ""}`}
          onClick={() => setShowFilters(prev => !prev)}
          title={showFilters ? "Hide column filters" : "Show column filters"}
        >
          Filter
        </button>
        {!isFiltering && (
          <div className="passport-pagination-size">
            <label htmlFor="passportRowsPerPage" className="passport-pagination-label">Rows per page</label>
            <select
              id="passportRowsPerPage"
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="filter-select passport-page-size-select"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        )}
      </div>

      {error      && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {isLoading  && <div className="loading">Loading passports…</div>}

      {!isLoading && (
        <div className="table-container">
          {filteredAndSortedPassports.length === 0 ? (
            <div className="empty-state"><p>
              {searchText || filterStatus || Object.values(columnFilters).some(Boolean) ? "No passports match your search/filter."
                : filterByUser ? "You haven't created any passports yet."
                : `No ${activeType} passports yet. Create one to get started!`}
            </p></div>
          ) : (
            <div className="table-scroll-wrapper">
              <table className="passports-table">
                <thead>
                  <tr>
                    {user?.role !== "viewer" && selectionMode && (
                      <th className="passport-table-select-col">
                        <input
                          type="checkbox"
                          checked={(() => {
                            const visibleKeys = getVisiblePassportKeys(paginatedPassports);
                            return visibleKeys.length > 0 && visibleKeys.every(key => selectedPassports.has(key));
                          })()}
                          onChange={toggleSelectAll}
                          title="Select All"
                        />
                      </th>
                    )}
                    <th className="passport-table-pin-col"></th>
                    <th className="passport-version-col"><button type="button" className="table-sort-btn" onClick={() => toggleSort("version_number")}>Ver.{sortIndicator(sortConfig, "version_number") && ` ${sortIndicator(sortConfig, "version_number")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("product_id")}>Serial Number{sortIndicator(sortConfig, "product_id") && ` ${sortIndicator(sortConfig, "product_id")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("model_name")}>Model{sortIndicator(sortConfig, "model_name") && ` ${sortIndicator(sortConfig, "model_name")}`}</button></th>
                    {filterByUser && <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("passport_type")}>Type{sortIndicator(sortConfig, "passport_type") && ` ${sortIndicator(sortConfig, "passport_type")}`}</button></th>}
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("created_at")}>Date{sortIndicator(sortConfig, "created_at") && ` ${sortIndicator(sortConfig, "created_at")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("release_status")}>Status{sortIndicator(sortConfig, "release_status") && ` ${sortIndicator(sortConfig, "release_status")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("completeness")}>Complete{sortIndicator(sortConfig, "completeness") && ` ${sortIndicator(sortConfig, "completeness")}`}</button></th>
                    {!filterByUser && <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("created_by")}>Created By{sortIndicator(sortConfig, "created_by") && ` ${sortIndicator(sortConfig, "created_by")}`}</button></th>}
                    <th>Options</th>
                  </tr>
                  {showFilters && <tr className="table-filter-row">
                    {user?.role !== "viewer" && selectionMode && <th></th>}
                    <th></th>
                    <th><input className="table-filter-input" value={columnFilters.version_number || ""} onChange={e => updateColumnFilter("version_number", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.product_id || ""} onChange={e => updateColumnFilter("product_id", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.model_name || ""} onChange={e => updateColumnFilter("model_name", e.target.value)} placeholder="Filter" /></th>
                    {filterByUser && <th><input className="table-filter-input" value={columnFilters.passport_type || ""} onChange={e => updateColumnFilter("passport_type", e.target.value)} placeholder="Filter" /></th>}
                    <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={e => updateColumnFilter("created_at", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.release_status || ""} onChange={e => updateColumnFilter("release_status", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.completeness || ""} onChange={e => updateColumnFilter("completeness", e.target.value)} placeholder="Filter" /></th>
                    {!filterByUser && <th><input className="table-filter-input" value={columnFilters.created_by || ""} onChange={e => updateColumnFilter("created_by", e.target.value)} placeholder="Filter" /></th>}
                    <th></th>
                  </tr>}
                </thead>
                <tbody>
                  {paginatedPassports.map((group) => (
                    <React.Fragment key={group.key}>
                      {renderPassportRow(group.latest, {
                        parentGuid: group.key,
                        hasOlderVersions: group.olderVersions.length > 0,
                        latestVersionNumber: group.latest.version_number,
                      })}
                      {expandedPassportGroups.has(group.key) && group.olderVersions.map((version) =>
                        renderPassportRow(version, {
                          parentGuid: group.key,
                          isHistorical: true,
                          latestVersionNumber: group.latest.version_number,
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

      {!isLoading && !isFiltering && filteredAndSortedPassports.length > 0 && (
        <div className="passport-pagination">
          <div className="passport-pagination-summary">
            Showing {(currentPage - 1) * rowsPerPage + 1}-
            {Math.min(currentPage * rowsPerPage, filteredAndSortedPassports.length)} of {filteredAndSortedPassports.length}
          </div>
          <div className="passport-pagination-controls">
            <button
              type="button"
              className="passport-page-btn"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span className="passport-page-indicator">Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              className="passport-page-btn"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {releaseModal && (
        <ReleaseModal
          passport={releaseModal} companyId={companyId} user={user}
          onClose={() => setReleaseModal(null)}
          onDone={(msg) => { setReleaseModal(null); showSuccess(`${msg}`); fetchPassports(); }}
        />
      )}

      {printQrModalOpen && (
        <PrintQrModal
          selectedCount={selectedPassportList.length}
          isExporting={qrExporting}
          onClose={() => { if (!qrExporting) setPrintQrModalOpen(false); }}
          onConfirm={downloadQrCodes}
        />
      )}

      {archiveConfirm && (
        <ArchiveConfirmModal
          title={archiveConfirm.mode === "bulk"
            ? `Archive ${archiveConfirm.count} passport${archiveConfirm.count !== 1 ? "s" : ""}?`
            : "Archive this passport?"}
          message={archiveConfirm.mode === "bulk"
            ? "The selected passports will be moved to the archive and removed from the active list."
            : "This passport will be moved to the archive and removed from the active list."}
          confirmLabel={archiveConfirm.mode === "bulk" ? "Archive Selected" : "Archive Passport"}
          isSubmitting={bulkActionLoading}
          onClose={() => { if (!bulkActionLoading) setArchiveConfirm(null); }}
          onConfirm={confirmArchive}
        />
      )}

      {csvModal && (
        <CsvUpdateModal
          passport={csvModal.passport}
          passportType={csvModal.pType}
          companyId={companyId}
          onClose={() => setCsvModal(null)}
          onDone={(msg) => { setCsvModal(null); showSuccess(`${msg}`); fetchPassports(); }}
        />
      )}

      {exportModalOpen && (
        <ExportModal
          passports={passports}
          filteredPassports={filteredAndSortedPassports.map(group => group.latest)}
          pagePassports={paginatedPassports.map(group => group.latest)}
          selectedPassports={selectedPassports}
          activeType={activeType}
          allPassportTypes={allPassportTypes}
          onClose={() => setExportModalOpen(false)}
          onDone={(msg) => { setExportModalOpen(false); showSuccess(msg); }}
        />
      )}

      {bulkReviseOpen && (
        <BulkReviseModal
          companyId={companyId}
          user={user}
          allPassportTypes={allPassportTypes}
          passports={passports}
          filteredPassports={filteredAndSortedPassports.map(group => group.latest)}
          pagePassports={paginatedPassports.map(group => group.latest)}
          selectedPassports={selectedPassports}
          activeType={activeType}
          onClose={() => setBulkReviseOpen(false)}
          onApplied={async (data) => {
            await fetchPassports();
            showSuccess(
              `Bulk revise batch #${data.batch?.id} complete: ${data.summary?.revised || 0} revised, ${data.summary?.skipped || 0} skipped, ${data.summary?.failed || 0} failed.`
            );
          }}
        />
      )}

      {historyModal && (
        <PassportHistoryModal
          guid={historyModal.guid}
          passportType={historyModal.passportType}
          companyId={companyId}
          mode="company"
          onClose={() => setHistoryModal(null)}
        />
      )}

      {bulkCreateOpen && activeType && (
        <BulkCreateModal
          passportType={activeType}
          companyId={companyId}
          onClose={() => setBulkCreateOpen(false)}
          onDone={(createdCount) => {
            setBulkCreateOpen(false);
            showSuccess(`Created ${createdCount} draft passport${createdCount !== 1 ? "s" : ""}`);
            fetchPassports();
          }}
        />
      )}

      {deviceModal && (
        <DeviceIntegrationModal
          passport={deviceModal.passport}
          passportType={deviceModal.pType}
          companyId={companyId}
          onClose={() => setDeviceModal(null)}
        />
      )}

      {bulkWorkflowOpen && (
        <BulkWorkflowModal
          companyId={companyId}
          user={user}
          selectedList={selectedPassportList}
          onClose={() => setBulkWorkflowOpen(false)}
          onDone={(msg) => { setBulkWorkflowOpen(false); showSuccess(msg); setSelectedPassports(new Set()); fetchPassports(); }}
        />
      )}
    </div>
  );
}

export default PassportList;
