import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { isEditablePassportStatus } from "../../../../passports/utils/passportStatus";
import { parseCsvText } from "../utils/passportListHelpers";

const API = import.meta.env.VITE_API_URL || "";

function buildSelectableFields(typeDef) {
  const baseFields = [
    { key: "modelName", label: "Model Name", type: "text" },
    { key: "internalAliasId", label: "Internal Alias ID", type: "text" },
  ];
  const schemaFields = (typeDef?.fieldsJson?.sections || [])
    .flatMap((section) => section.fields || [])
    .filter((field) => field?.key);
  const seen = new Set();
  return [...baseFields, ...schemaFields].filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
}

function normalizeCellValue(value, field) {
  if (field?.type === "boolean") {
    return String(value).toLowerCase() === "true" || String(value) === "1";
  }
  if (field?.type === "table") {
    return JSON.parse(value);
  }
  return value;
}

export function BulkEditModal({
  companyId,
  allPassportTypes,
  passports,
  selectedPassports,
  activeType,
  onClose,
  onApplied,
}) {
  const [tab, setTab] = useState("form");
  const [selectedType, setSelectedType] = useState(activeType || "");
  const [changeRows, setChangeRows] = useState([{ id: 1, key: "", value: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const selectedSourcePassports = useMemo(
    () => passports.filter((passport) => selectedPassports.has(`${passport.dppId}-${passport.versionNumber}`)),
    [passports, selectedPassports]
  );

  const editableSelectedPassports = useMemo(
    () => selectedSourcePassports.filter((passport) => isEditablePassportStatus(passport.releaseStatus)),
    [selectedSourcePassports]
  );

  const availableTypes = useMemo(
    () => [...new Set(editableSelectedPassports.map((passport) => passport.passportType || activeType).filter(Boolean))],
    [activeType, editableSelectedPassports]
  );

  const targetedPassports = useMemo(
    () => editableSelectedPassports.filter((passport) => (passport.passportType || activeType) === selectedType),
    [activeType, editableSelectedPassports, selectedType]
  );

  const targetByDppId = useMemo(
    () => new Map(targetedPassports.map((passport) => [String(passport.dppId), passport])),
    [targetedPassports]
  );
  const targetByAlias = useMemo(
    () => new Map(targetedPassports.map((passport) => [String(passport.internalAliasId || ""), passport]).filter(([key]) => key)),
    [targetedPassports]
  );

  const typeDef = allPassportTypes.find((type) => type.typeName === selectedType);
  const availableFields = useMemo(() => buildSelectableFields(typeDef), [typeDef]);

  React.useEffect(() => {
    if (!availableTypes.length) {
      setSelectedType("");
      return;
    }
    if (selectedType && availableTypes.includes(selectedType)) return;
    if (activeType && availableTypes.includes(activeType)) {
      setSelectedType(activeType);
      return;
    }
    setSelectedType(availableTypes[0]);
  }, [activeType, availableTypes, selectedType]);

  const addChangeRow = () => setChangeRows((rows) => [...rows, { id: Date.now() + Math.random(), key: "", value: "" }]);
  const updateChangeRow = (id, patch) => setChangeRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeChangeRow = (id) => setChangeRows((rows) => (rows.length === 1 ? rows : rows.filter((row) => row.id !== id)));

  const submitBulkPatch = async (items) => {
    if (!selectedType) {
      setError("Choose a passport type first.");
      return;
    }
    if (!items.length) {
      setError("No editable selected passports matched this update.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          passportType: selectedType,
          passports: items,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bulk edit failed");
      setResult(data);
      if (onApplied) await onApplied(data);
    } catch (err) {
      setError(err.message || "Bulk edit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    const changes = {};

    for (const row of changeRows) {
      if (!row.key) continue;
      const field = availableFields.find((item) => item.key === row.key);
      if (!field) continue;
      const rawValue = String(row.value ?? "").trim();
      if (!rawValue) {
        setError(`Enter a value for ${field.label}.`);
        return;
      }
      try {
        changes[row.key] = normalizeCellValue(rawValue, field);
      } catch {
        setError(`${field.label} must contain valid JSON.`);
        return;
      }
    }

    if (!Object.keys(changes).length) {
      setError("Add at least one field to update.");
      return;
    }

    await submitBulkPatch(
      targetedPassports.map((passport) => ({
        dppId: passport.dppId,
        ...changes,
      }))
    );
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsvText(text);
      if (rows.length < 2) throw new Error("CSV must include a header row and at least one data row.");
      const headers = rows[0].map((cell) => String(cell || "").trim());
      const identifierIndex = headers.findIndex((cell) => ["dppid", "internalaliasid", "internalAliasId", "dppId"].includes(cell));
      if (identifierIndex < 0) throw new Error("CSV must include a dppId or internalAliasId column.");

      const updates = rows.slice(1).flatMap((row) => {
        const identifierHeader = headers[identifierIndex];
        const identifierValue = String(row[identifierIndex] || "").trim();
        if (!identifierValue) return [];
        const target = identifierHeader.toLowerCase() === "dppid" ? targetByDppId.get(identifierValue) : targetByAlias.get(identifierValue);
        if (!target) return [];

        const payload = { dppId: target.dppId };
        headers.forEach((header, index) => {
          if (index === identifierIndex) return;
          const rawValue = String(row[index] || "").trim();
          if (!rawValue) return;
          const field = availableFields.find((item) => item.key === header || item.label === header);
          if (!field) return;
          payload[field.key] = normalizeCellValue(rawValue, field);
        });
        return Object.keys(payload).length > 1 ? [payload] : [];
      });

      if (!updates.length) throw new Error("No rows matched the selected editable passports.");
      await submitBulkPatch(updates);
    } catch (err) {
      setError(err.message || "CSV update failed");
    }
  };

  const handleJsonUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array of update objects.");

      const updates = parsed.flatMap((item) => {
        const match = item?.dppId
          ? targetByDppId.get(String(item.dppId))
          : targetByAlias.get(String(item?.internalAliasId || ""));
        if (!match) return [];
        const payload = { dppId: match.dppId };
        availableFields.forEach((field) => {
          if (item?.[field.key] === undefined) return;
          payload[field.key] = item[field.key];
        });
        return Object.keys(payload).length > 1 ? [payload] : [];
      });

      if (!updates.length) throw new Error("No JSON rows matched the selected editable passports.");
      await submitBulkPatch(updates);
    } catch (err) {
      setError(err.message || "JSON update failed");
    }
  };

  const renderValueField = (row) => {
    const field = availableFields.find((item) => item.key === row.key);
    if (!field) {
      return <input type="text" className="device-manual-input" value={row.value} placeholder="Choose a field first" disabled readOnly />;
    }
    if (field.type === "boolean") {
      return (
        <select className="device-manual-input" value={row.value} onChange={(event) => updateChangeRow(row.id, { value: event.target.value })}>
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
          onChange={(event) => updateChangeRow(row.id, { value: event.target.value })}
          placeholder='Enter JSON, e.g. [["Cell 1","Cell 2"]]'
        />
      );
    }
    return (
      <input
        type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
        className="device-manual-input"
        value={row.value}
        onChange={(event) => updateChangeRow(row.id, { value: event.target.value })}
        placeholder={`Enter ${field.label}`}
      />
    );
  };

  const modalBody = result ? (
    <>
      <h3 className="dashboard-modal-title">Bulk Edit Complete</h3>
      <p className="dashboard-modal-subtitle">
        Updated <strong>{result.summary?.updated || 0}</strong> passport{result.summary?.updated === 1 ? "" : "s"} for <strong>{selectedType}</strong>.
      </p>
      <div className="tmpl-bulk-summary">
        <div className="tmpl-bulk-stat tmpl-bulk-created">
          <span className="tmpl-bulk-num">{result.summary?.updated || 0}</span>
          <span>updated</span>
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
      <div className="dashboard-modal-actions dashboard-modal-actions-end">
        <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  ) : (
    <>
      <h3 className="dashboard-modal-title">Bulk Edit</h3>
      <p className="dashboard-modal-subtitle">
        Update the selected editable passports by direct form entry, CSV, or JSON.
      </p>

      <div className="bulk-edit-summary">
        <div><strong>{selectedSourcePassports.length}</strong> selected</div>
        <div><strong>{editableSelectedPassports.length}</strong> editable</div>
      </div>

      <label className="device-manual-label">Passport Type</label>
      <select className="device-manual-input" value={selectedType} onChange={(event) => setSelectedType(event.target.value)} disabled={submitting || availableTypes.length <= 1}>
        {availableTypes.map((type) => (
          <option key={type} value={type}>{type}</option>
        ))}
      </select>

      <div className="bulk-edit-tabs">
        <button type="button" className={tab === "form" ? "active" : ""} onClick={() => setTab("form")}>Direct form</button>
        <button type="button" className={tab === "csv" ? "active" : ""} onClick={() => setTab("csv")}>CSV</button>
        <button type="button" className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>JSON</button>
      </div>

      {tab === "form" && (
        <form onSubmit={handleFormSubmit} className="bulk-edit-form">
          {changeRows.map((row) => (
            <div key={row.id} className="bulk-revise-row">
              <select className="device-manual-input" value={row.key} onChange={(event) => updateChangeRow(row.id, { key: event.target.value, value: "" })}>
                <option value="">Choose field…</option>
                {availableFields.map((field) => (
                  <option key={field.key} value={field.key}>{field.label}</option>
                ))}
              </select>
              {renderValueField(row)}
              <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={() => removeChangeRow(row.id)}>Remove</button>
            </div>
          ))}
          <div className="dashboard-modal-actions">
            <button type="button" className="dashboard-btn dashboard-btn-secondary" onClick={addChangeRow}>Add Field</button>
          </div>
          {error && <div className="dashboard-inline-error">{error}</div>}
          <div className="dashboard-modal-actions dashboard-modal-actions-end">
            <button type="button" className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="dashboard-btn dashboard-btn-primary" disabled={submitting || !targetedPassports.length}>
              {submitting ? "Updating…" : `Update ${targetedPassports.length} Passport${targetedPassports.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      )}

      {tab === "csv" && (
        <div className="bulk-edit-upload-panel">
          <p>Upload a CSV with one row per passport. Include `dppId` or `internalAliasId` as the first identifier column, then any field keys or labels you want to update.</p>
          <label className="dashboard-btn dashboard-btn-primary dashboard-upload-button">
            Upload CSV
            <input type="file" accept=".csv" className="dashboard-hidden-input" onChange={handleCsvUpload} disabled={submitting} />
          </label>
          {error && <div className="dashboard-inline-error">{error}</div>}
        </div>
      )}

      {tab === "json" && (
        <div className="bulk-edit-upload-panel">
          <p>Upload a JSON array of update objects. Each object must include `dppId` or `internalAliasId` plus the fields to change.</p>
          <label className="dashboard-btn dashboard-btn-primary dashboard-upload-button">
            Upload JSON
            <input type="file" accept=".json,application/json" className="dashboard-hidden-input" onChange={handleJsonUpload} disabled={submitting} />
          </label>
          {error && <div className="dashboard-inline-error">{error}</div>}
        </div>
      )}
    </>
  );

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div className="dashboard-modal-card">
        {modalBody}
      </div>
    </div>,
    document.body
  );
}
