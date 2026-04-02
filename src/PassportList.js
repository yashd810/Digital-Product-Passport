import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { PASSPORT_SECTIONS_MAP } from "./PassportFields";
import { ReleaseModal } from "./WorkflowDashboard";
import { applyTableControls, getNextSortDirection, sortIndicator } from "./tableControls";
import { authHeaders } from "./authHeaders";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

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
        setAllFields(sections.flatMap(s => s.fields || []).filter(f => f.type !== "file" && f.type !== "table"));
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
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [selectedPassports, setSelectedPassports] = useState(new Set());
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
    if (r.ok) { showSuccess(`✅ v${v} → v${data.newVersion} draft created!`); fetchPassports(); }
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
    if (r.ok) { showSuccess("✅ Deleted"); fetchPassports(); }
    else { const d = await r.json().catch(() => ({})); showError(d.error || "Delete failed"); }
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
    : activeType ? `${activeType.charAt(0).toUpperCase() + activeType.slice(1)} Passports`
    : "Passports";

  // Pinned passports float to the top; order within each group is preserved
  const displayedPassports = [...passports].sort((a, b) => {
    const ap = pinnedGuids.has(a.guid) ? 0 : 1;
    const bp = pinnedGuids.has(b.guid) ? 0 : 1;
    return ap - bp;
  });

  const tableColumns = useMemo(() => {
    const base = [
      { key: "version_number", type: "number", getValue: (p) => p.version_number },
      { key: "product_id", type: "string", getValue: (p) => p.product_id || "" },
      { key: "model_name", type: "string", getValue: (p) => p.model_name || "" },
      { key: "guid", type: "string", getValue: (p) => p.guid || "" },
      { key: "created_at", type: "date", getValue: (p) => p.created_at },
      { key: "release_status", type: "string", getValue: (p) => p.release_status || "" },
      { key: "completeness", type: "number", getValue: (p) => calcCompleteness(p, allPassportTypes) ?? -1 },
    ];

    if (filterByUser) {
      base.splice(3, 0, { key: "passport_type", type: "string", getValue: (p) => p.passport_type || activeType || "" });
    } else {
      base.push({
        key: "created_by",
        type: "string",
        getValue: (p) => (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.created_by_email || ""),
      });
    }

    return base;
  }, [filterByUser, activeType, allPassportTypes]);

  const filteredAndSortedPassports = useMemo(
    () => applyTableControls(displayedPassports, tableColumns, sortConfig, columnFilters),
    [displayedPassports, tableColumns, sortConfig, columnFilters]
  );
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedPassports.length / rowsPerPage));
  const paginatedPassports = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredAndSortedPassports.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredAndSortedPassports, currentPage, rowsPerPage]);

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
  // System fields: model_name, product_id (required)
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
      csvRows.push(['model_name', '', '', '']);
      csvRows.push(['product_id', '', '', '']);

      // Add all form fields from dynamic sections
      sections.forEach(section => {
        if (section.fields && Array.isArray(section.fields)) {
          section.fields.forEach(field => {
            if (field.type !== 'file' && field.type !== 'table') { // Skip file and table fields for CSV
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


  const handleCSVExport = async () => {
    // Use selected passports if available, otherwise export all
    const exportList = selectedPassports.size > 0 
      ? passports.filter(p => selectedPassports.has(`${p.guid}-${p.version_number}`))
      : passports;

    if (exportList.length === 0) {
      showError('No passports to export');
      return;
    }

    try {
      // Group by passport type for multi-type export
      const groupedByType = exportList.reduce((acc, passport) => {
        const type = passport.passport_type || activeType;
        if (!acc[type]) acc[type] = [];
        acc[type].push(passport);
        return acc;
      }, {});

      // If multiple types, create separate CSV files
      if (Object.keys(groupedByType).length > 1) {
        for (const [type, typePassports] of Object.entries(groupedByType)) {
          await exportTypeToCSV(type, typePassports);
        }
        showSuccess(`✅ Exported ${exportList.length} passport(s) across ${Object.keys(groupedByType).length} types`);
      } else {
        const type = Object.keys(groupedByType)[0];
        await exportTypeToCSV(type, groupedByType[type]);
        showSuccess(`✅ Exported ${exportList.length} passport(s) to CSV`);
      }
    } catch (error) {
      showError('Failed to export CSV');
    }
  };

  const selectedPassportList = passports.filter((p) => selectedPassports.has(`${p.guid}-${p.version_number}`));

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
        await QRCode.toCanvas(qrCanvas, `${window.location.origin}/passport/${passport.guid}`, {
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
        ctx.fillText(passport.guid, widthPx / 2, heightPx - bottomPadding);

        const dataUrl = canvas.toDataURL(mimeType, format === "jpeg" ? 0.95 : undefined);
        const link = document.createElement("a");
        const safeType = (passport.passport_type || activeType || "passport").replace(/[^a-z0-9-_]+/gi, "_").toLowerCase();
        link.href = dataUrl;
        link.download = `${safeType}_${passport.guid}.${format}`;
        link.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      setPrintQrModalOpen(false);
      showSuccess(`✅ Downloaded ${selectedPassportList.length} QR code file${selectedPassportList.length !== 1 ? "s" : ""}.`);
    } catch (error) {
      showError(error.message || "Failed to generate QR codes");
    } finally {
      setQrExporting(false);
    }
  };

  const exportTypeToCSV = async (type, typePassports) => {
    // Fetch dynamic field definitions from backend
    const response = await fetch(`${API}/api/passport-types/${type}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch field definitions for ${type}`);
    }
    const passportTypeData = await response.json();
    const sections = passportTypeData.fields_json?.sections || [];
    const allFields = sections.flatMap(section => section.fields || []);
    
    const csvRows = [];
    
    // Header row
    csvRows.push(['Field Name', ...typePassports.map(p => p.model_name)]);
    
    // System fields
    csvRows.push(['model_name', ...typePassports.map(p => p.model_name)]);
    csvRows.push(['product_id', ...typePassports.map(p => p.product_id || '')]);
    
    // All form fields
    allFields.forEach(field => {
      if (field.type !== 'file' && field.type !== 'table') {
        csvRows.push([
          field.label,
          ...typePassports.map(p => {
            const value = p[field.key];
            if (field.type === 'boolean') {
              return value ? 'true' : 'false';
            }
            return value || '';
          })
        ]);
      }
    });
    
    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_passports_export.csv`;
    link.click();
  };

  const toggleSelectAll = () => {
    const visibleKeys = paginatedPassports.map(p => `${p.guid}-${p.version_number}`);
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
            {selectionMode && (
              <button
                className="csv-btn template-btn"
                onClick={() => setPrintQrModalOpen(true)}
                disabled={selectedPassportList.length === 0}
                title={selectedPassportList.length > 0 ? "Print Passport QR Code" : "Select at least one passport"}
              >
                🖨 Print Passport QR Code
              </button>
            )}
            <button className="csv-btn export-btn" onClick={handleCSVExport} title={selectedPassports.size > 0 ? "Export Selected to CSV" : "Export All to CSV"}>
              📊 {selectedPassports.size > 0 ? "Export Selected" : "Export All"}
            </button>
            {!filterByUser && activeType && accessGranted && (
              <div className="passport-create-menu-wrap" ref={createMenuRef}>
                <button className="create-passport-btn" onClick={() => setCreateMenuOpen(!createMenuOpen)}>
                  + Create Passport
                </button>
                {createMenuOpen && (
                  <div className="passport-create-menu">
                    <button onClick={() => {
                      setCreateMenuOpen(false);
                      navigate(`/create/${activeType}`);
                    }} className="passport-create-menu-item">
                      ✏️ Create via App
                    </button>
                    <div className="passport-create-menu-divider"></div>
                    <button onClick={() => {
                      setCreateMenuOpen(false);
                      navigate(`/csv-import/${activeType}`);
                    }} className="passport-create-menu-item">
                      📤 Import from CSV
                    </button>
                    <div className="passport-create-menu-divider"></div>
                    <button onClick={() => {
                      setCreateMenuOpen(false);
                      setBulkCreateOpen(true);
                    }} className="passport-create-menu-item">
                      📦 Bulk Create
                    </button>
                    <div className="passport-create-menu-divider"></div>
                    <button onClick={() => {
                      setCreateMenuOpen(false);
                      downloadCSVTemplate();
                    }} className="passport-create-menu-item">
                      📥 Template CSV
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="search-bar">
        <input type="text" placeholder="🔍 Search by model name or Product ID…"
          value={searchText} onChange={e => setSearchText(e.target.value)} className="search-input" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="released">Released</option>
          <option value="revised">In Revision</option>
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
                          checked={paginatedPassports.length > 0 && paginatedPassports.every(p => selectedPassports.has(`${p.guid}-${p.version_number}`))}
                          onChange={toggleSelectAll}
                          title="Select All"
                        />
                      </th>
                    )}
                    <th className="passport-table-pin-col"></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("version_number")}>Ver.{sortIndicator(sortConfig, "version_number") && ` ${sortIndicator(sortConfig, "version_number")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("product_id")}>Product ID{sortIndicator(sortConfig, "product_id") && ` ${sortIndicator(sortConfig, "product_id")}`}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("model_name")}>Model{sortIndicator(sortConfig, "model_name") && ` ${sortIndicator(sortConfig, "model_name")}`}</button></th>
                    {filterByUser && <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("passport_type")}>Type{sortIndicator(sortConfig, "passport_type") && ` ${sortIndicator(sortConfig, "passport_type")}`}</button></th>}
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("guid")}>GUID{sortIndicator(sortConfig, "guid") && ` ${sortIndicator(sortConfig, "guid")}`}</button></th>
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
                    <th><input className="table-filter-input" value={columnFilters.guid || ""} onChange={e => updateColumnFilter("guid", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={e => updateColumnFilter("created_at", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.release_status || ""} onChange={e => updateColumnFilter("release_status", e.target.value)} placeholder="Filter" /></th>
                    <th><input className="table-filter-input" value={columnFilters.completeness || ""} onChange={e => updateColumnFilter("completeness", e.target.value)} placeholder="Filter" /></th>
                    {!filterByUser && <th><input className="table-filter-input" value={columnFilters.created_by || ""} onChange={e => updateColumnFilter("created_by", e.target.value)} placeholder="Filter" /></th>}
                    <th></th>
                  </tr>}
                </thead>
                <tbody>
                  {paginatedPassports.map(p => {
                    const pType   = p.passport_type || activeType;
                    const menuId  = `${p.guid}-${p.version_number}`;
                    const isOpen  = openMenuId === menuId;
                    const pct     = calcCompleteness(p, allPassportTypes);
                    const isPinned = pinnedGuids.has(p.guid);
                    return (
                      <tr
                        key={menuId}
                        className={`${isPinned ? "passport-row-pinned " : ""}passport-row-clickable`}
                        onClick={() => {
                          if (openMenuId) {
                            setOpenMenuId(null); // Close the menu without navigating
                            return;
                          }
                          if (selectionMode) {
                            toggleSelectPassport(p.guid, p.version_number);
                          } else {
                            navigate(`/passport/${p.guid}/introduction`);
                          }
                        }}
                      >
                        {user?.role !== "viewer" && selectionMode && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPassports.has(menuId)}
                              onChange={() => toggleSelectPassport(p.guid, p.version_number)}
                              onClick={e => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td className="passport-pin-cell"
                          title={isPinned ? "Pinned" : ""}>
                          {isPinned ? "📌" : ""}
                        </td>
                        <td><span className="version-badge">v{p.version_number}</span></td>
                        <td>{p.product_id
                          ? <span className="product-id-badge">{p.product_id}</span>
                          : <span className="no-product-id">—</span>}</td>
                        <td>
                          <button className="model-link-btn"
                            onClick={e => {
                              e.stopPropagation();
                              navigate(`/passport/${p.guid}/introduction`);
                            }}>
                            {p.model_name}
                          </button>
                        </td>
                        {filterByUser && (
                          <td><span className="type-badge passport-type-badge">{pType}</span></td>
                        )}
                        <td className="guid-cell"><code>{p.guid.substring(0,8)}…</code></td>
                        <td>{new Date(p.created_at).toLocaleDateString()}</td>
                        <td><span className={`status-badge ${p.release_status}`}>
                          {["in_revision", "revised"].includes(p.release_status)
                            ? "In Revision"
                            : p.release_status.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}
                        </span></td>
                        <td><CompletenessBar pct={pct} /></td>
                        {!filterByUser && (
                          <td className="small-text">
                            {p.first_name && p.last_name
                              ? `${p.first_name} ${p.last_name}`
                              : p.created_by_email || "—"}
                          </td>
                        )}
                        <td className="options-cell" onClick={e => e.stopPropagation()}>
                          {user?.role !== "viewer" && (
                          <div className="kebab-menu-container">
                            <button className="kebab-menu-btn" onClick={e => openMenu(e, menuId)}>⋮</button>
                          </div>)}
                          {isOpen && (
                            <KebabMenu anchorRect={menuAnchorRect} onClose={() => { setOpenMenuId(null); setMenuAnchorRect(null); }}>
                              <button className="menu-item"
                                onClick={() => togglePin(p.guid)}>
                                {isPinned ? "📌 Unpin" : "📌 Pin to top"}
                              </button>
                              <button className={`menu-item edit-item${p.release_status==="released"?" disabled":""}`}
                                disabled={p.release_status==="released"}
                                onClick={() => { navigate(`/edit/${p.guid}?passportType=${pType}`); setOpenMenuId(null); }}>
                                ✏️ Edit
                              </button>
                              <button className={`menu-item release-item${!["draft","revised"].includes(p.release_status)?" disabled":""}`}
                                disabled={!["draft","revised"].includes(p.release_status)}
                                onClick={() => { setReleaseModal({...p,passport_type:pType}); setOpenMenuId(null); }}>
                                🎯 Release
                              </button>
                              <button className={`menu-item revise-item${p.release_status!=="released"?" disabled":""}`}
                                disabled={p.release_status!=="released"}
                                onClick={() => { handleRevise(p.guid,p.version_number,pType); setOpenMenuId(null); }}>
                                🔄 Revise
                              </button>
                              <button className="menu-item"
                                onClick={() => handleClone(p, pType)}>
                                🔁 Clone
                              </button>
                              <button className={`menu-item${!["draft","revised"].includes(p.release_status) ? " disabled" : ""}`}
                                disabled={!["draft","revised"].includes(p.release_status)}
                                onClick={() => { setCsvModal({ passport: p, pType }); setOpenMenuId(null); }}>
                                📤 Update data via CSV
                              </button>
                              <button className="menu-item"
                                onClick={() => { navigate(`/passport/${p.guid}/diff?passportType=${pType}`); setOpenMenuId(null); }}>
                                🔀 Compare versions
                              </button>
                              <button className="menu-item"
                                onClick={() => { setDeviceModal({ passport: p, pType }); setOpenMenuId(null); }}>
                                📡 Device Integration
                              </button>
                              <button className="menu-item"
                                onClick={async () => {
                                  setOpenMenuId(null);
                                  try {
                                    const r = await fetch(
                                      `${API}/api/companies/${companyId}/passports/${p.guid}/export/aas`,
                                      { headers: authHeaders() }
                                    );
                                    if (!r.ok) throw new Error();
                                    const blob = await r.blob();
                                    const url  = URL.createObjectURL(blob);
                                    const a    = document.createElement("a");
                                    a.href     = url;
                                    a.download = `passport-${p.guid}.aas.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  } catch { showError("Failed to export AAS"); }
                                }}>
                                📦 Export AAS (JSON)
                              </button>
                              <button className={`menu-item delete-item${!["draft","revised"].includes(p.release_status)?" disabled":""}`}
                                disabled={!["draft","revised"].includes(p.release_status)}
                                onClick={() => { handleDelete(p.guid,pType); setOpenMenuId(null); }}>
                                🗑️ Delete
                              </button>
                            </KebabMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isLoading && filteredAndSortedPassports.length > 0 && (
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
          onDone={(msg) => { setReleaseModal(null); showSuccess(`✅ ${msg}`); fetchPassports(); }}
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

      {csvModal && (
        <CsvUpdateModal
          passport={csvModal.passport}
          passportType={csvModal.pType}
          companyId={companyId}
          onClose={() => setCsvModal(null)}
          onDone={(msg) => { setCsvModal(null); showSuccess(`✅ ${msg}`); fetchPassports(); }}
        />
      )}

      {bulkCreateOpen && activeType && (
        <BulkCreateModal
          passportType={activeType}
          companyId={companyId}
          onClose={() => setBulkCreateOpen(false)}
          onDone={(createdCount) => {
            setBulkCreateOpen(false);
            showSuccess(`✅ Created ${createdCount} draft passport${createdCount !== 1 ? "s" : ""}`);
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
    </div>
  );
}

export default PassportList;
