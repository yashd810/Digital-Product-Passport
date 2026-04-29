import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders } from "../../../../shared/api/authHeaders";
import { parseCsvText } from "../utils/passportListHelpers";

const API = import.meta.env.VITE_API_URL || "";

export function CsvUpdateModal({ passport, passportType, companyId, onClose, onDone }) {
  const [phase, setPhase] = useState("loading");
  const [allFields, setAllFields] = useState([]);
  const [parsed, setParsed] = useState({});
  const [conflicts, setConflicts] = useState([]);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  useEffect(() => {
    fetch(`${API}/api/passport-types/${passportType}`)
      .then((r) => r.json())
      .then((d) => {
        const sections = d.fields_json?.sections || [];
        setAllFields(sections.flatMap((section) => section.fields || []).filter((field) => field.type !== "table"));
        setPhase("upload");
      })
      .catch(() => { setErr("Failed to load passport type definition"); setPhase("upload"); });
  }, [passportType]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && phase !== "applying") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase]);

  const getLabel = (key) => allFields.find((field) => field.key === key)?.label || key;

  const downloadCurrent = () => {
    const rows = [["Field Name", "Value"]];
    rows.push(["model_name", passport.model_name || ""]);
    rows.push(["product_id", passport.product_id || ""]);
    allFields.forEach((field) => {
      const value = passport[field.key];
      rows.push([field.label, value === null || value === undefined ? "" : String(value)]);
    });
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(passport.model_name || passport.dppId).replace(/\s+/g, "_")}_update.csv`;
    link.click();
  };

  const doApply = async (data) => {
    setPhase("applying");
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${passport.dppId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ passportType, ...data }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Update failed");
      const count = Object.keys(data).length;
      onDone(`"${passport.model_name}" updated — ${count} field${count !== 1 ? "s" : ""} set from CSV`);
    } catch (ex) {
      setErr(ex.message);
      setPhase(conflicts.length ? "confirming" : "upload");
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    setErr("");

    let text;
    try {
      text = await file.text();
    } catch {
      setErr("Could not read file");
      return;
    }

    const rows = parseCsvText(text);
    if (rows.length < 2) {
      setErr("CSV must have at least a header row and one data row");
      return;
    }

    const isColumnOriented = rows[0]?.[0]?.trim().toLowerCase() === "field name";
    const dataRows = isColumnOriented ? rows.slice(1) : rows;

    const parsedData = {};
    dataRows.forEach((row) => {
      const rawLabel = (row[0] || "").trim();
      if (!rawLabel) return;
      const normalized = rawLabel.toLowerCase();
      const value = (row[1] || "").trim();
      if (!value) return;

      const field =
        allFields.find((item) => item.label?.trim().toLowerCase() === normalized) ||
        allFields.find((item) => item.key?.toLowerCase() === normalized) ||
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

    const conflictKeys = Object.keys(parsedData).filter((key) => {
      const value = passport[key];
      return value !== null && value !== undefined && value !== "" && value !== false;
    });

    setParsed(parsedData);
    if (conflictKeys.length) {
      setConflicts(conflictKeys);
      setPhase("confirming");
      return;
    }
    doApply(parsedData);
  };

  const handleSkipExisting = () => {
    const filtered = { ...parsed };
    conflicts.forEach((key) => delete filtered[key]);
    if (!Object.keys(filtered).length) {
      setErr("All CSV fields already have data in this passport. Choose 'Overwrite all' to replace them, or cancel.");
      return;
    }
    doApply(filtered);
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="dashboard-modal-card dashboard-modal-card-compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
      >
        <h2
          id={dialogTitleId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          Update passport data from CSV
        </h2>
        <p
          id={dialogDescriptionId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          Upload a CSV file, compare conflicting values, and apply the update to this passport.
        </p>
        {phase === "loading" && (
          <p className="dashboard-modal-status" role="status" aria-live="polite">Loading…</p>
        )}

        {(phase === "upload" || (phase === "loading" && err)) && phase !== "loading" && (
          <>
            <h3 className="dashboard-modal-title">Update data via CSV</h3>
            <p className="dashboard-modal-subtitle">Passport: <strong>{passport.model_name}</strong></p>

            {err && <div className="dashboard-inline-error" role="alert">{err}</div>}

            <div className="dashboard-info-panel">
              <strong className="dashboard-info-title">How it works:</strong> Only fields you include in the CSV (with a value)
              will be updated. Fields not in the CSV remain unchanged. You can start from the current data below.
            </div>

            <div className="dashboard-info-panel">
              <strong className="dashboard-info-title">Governance:</strong> `access`, `confidentiality`, and `updateAuthority`
              are passport-type controls managed by admins. They are not valid passport-row CSV columns in this update flow.
            </div>

            <button type="button" className="dashboard-btn dashboard-btn-secondary dashboard-btn-block-spaced" onClick={downloadCurrent}>
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
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {phase === "confirming" && (
          <>
            <h3 className="dashboard-modal-title dashboard-modal-title-warning">⚠️ Some fields have existing data</h3>
            <p className="dashboard-modal-subtitle dashboard-modal-subtitle-spaced">
              The following <strong>{conflicts.length}</strong> field{conflicts.length !== 1 ? "s" : ""} already
              have data in this passport. Choose how to handle them:
            </p>

            <div className="dashboard-warning-panel">
              {conflicts.map((key) => {
                const currentValue = String(passport[key] ?? "");
                const nextValue = String(parsed[key] ?? "");
                return (
                  <div key={key} className="dashboard-warning-item">
                    <strong className="dashboard-warning-label">{getLabel(key)}</strong>
                    <div className="dashboard-warning-copy">
                      Current: <em>"{currentValue.length > 60 ? `${currentValue.substring(0, 60)}…` : currentValue}"</em>
                      <span className="dashboard-warning-separator">→</span>
                      New: <em>"{nextValue.length > 60 ? `${nextValue.substring(0, 60)}…` : nextValue}"</em>
                    </div>
                  </div>
                );
              })}
            </div>

            {err && <div className="dashboard-inline-error" role="alert">{err}</div>}

            <div className="dashboard-note-panel">
              <strong>Overwrite all</strong> — replaces the existing values shown above with the new CSV data.<br />
              <strong>Skip existing</strong> — only fills in fields that are currently empty; the values shown above are kept as-is.
            </div>

            <div className="dashboard-modal-actions">
              <button type="button" className="dashboard-btn dashboard-btn-danger" onClick={() => doApply(parsed)}>Overwrite all</button>
              <button type="button" className="dashboard-btn dashboard-btn-secondary" onClick={handleSkipExisting}>Skip existing</button>
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {phase === "applying" && (
          <p className="dashboard-modal-status" role="status" aria-live="polite">Updating passport data…</p>
        )}
      </div>
    </div>,
    document.body
  );
}
