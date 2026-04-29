import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders } from "../../../../shared/api/authHeaders";
import { dedupeLatestReleasedPassports } from "../utils/passportListHelpers";

const API = import.meta.env.VITE_API_URL || "";

export function BulkReviseModal({
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
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        const eligible = (Array.isArray(data) ? data : []).filter((member) =>
          (member.role === "editor" || member.role === "company_admin") && member.id !== user?.id
        );
        setTeamUsers(eligible);
      })
      .catch(() => {});

    fetch(`${API}/api/users/me`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.default_reviewer_id) setReviewerId(String(data.default_reviewer_id));
        if (data?.default_approver_id) setApproverId(String(data.default_approver_id));
      })
      .catch(() => {});
  }, [companyId, user?.id]);

  const selectedSourcePassports = useMemo(
    () => passports.filter((passport) => selectedPassports.has(`${passport.dppId}-${passport.version_number}`)),
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
  }, [scopePassports.filtered.length, scopePassports.selected.length]);

  const scopedPassports = scopePassports[scope] || [];
  const availableTypes = useMemo(
    () => [...new Set(scopedPassports.map((passport) => passport.passport_type || activeType).filter(Boolean))],
    [activeType, scopedPassports]
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
  }, [activeType, availableTypes, selectedType]);

  const targetedPassports = useMemo(
    () => scopedPassports.filter((passport) => !selectedType || (passport.passport_type || activeType) === selectedType),
    [activeType, scopedPassports, selectedType]
  );

  const typeDef = allPassportTypes.find((type) => type.type_name === selectedType);
  const availableFields = useMemo(() => {
    const baseFields = [
      { key: "model_name", label: "Model Name", type: "text" },
      { key: "product_id", label: "Serial Number", type: "text" },
    ];
    const schemaFields = (typeDef?.fields_json?.sections || [])
      .flatMap((section) => section.fields || [])
      .filter((field) => field?.key && field.type !== "table");

    const seen = new Set();
    return [...baseFields, ...schemaFields].filter((field) => {
      if (seen.has(field.key)) return false;
      seen.add(field.key);
      return true;
    });
  }, [typeDef]);

  const addChangeRow = () => {
    setChangeRows((rows) => [...rows, { id: Date.now() + Math.random(), key: "", value: "" }]);
  };

  const updateChangeRow = (id, patch) => {
    setChangeRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const removeChangeRow = (id) => {
    setChangeRows((rows) => rows.length === 1 ? rows : rows.filter((row) => row.id !== id));
  };

  const downloadResultsCsv = () => {
    if (!result?.details?.length) return;
    const rows = [
      ["DPP ID", "Passport Type", "Status", "Source Version", "New Version", "Message"],
      ...result.details.map((item) => [
        item.dppId || "",
        item.passport_type || "",
        item.status || "",
        item.source_version_number ?? "",
        item.new_version_number ?? "",
        item.message || "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
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
      const field = availableFields.find((item) => item.key === row.key);
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
          items: targetedPassports.map((passport) => ({
            dppId: passport.dppId,
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
    const field = availableFields.find((item) => item.key === row.key);
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
          <div key={`${item.dppId}-${index}`} className={`bulk-revise-result-item ${item.status || "default"}`}>
            <div className="bulk-revise-result-topline">
              <strong>{item.dppId?.slice(0, 8)}…</strong>
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
        Create new <strong>In Revision</strong> versions for many released passports at once. The latest released version for each DPP ID is used automatically.
      </p>

      <form onSubmit={handleSubmit} className="bulk-create-form">
        <div className="bulk-revise-scope-grid">
          {scopeOptions.map((option) => (
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
              {availableTypes.map((typeName) => {
                const typeMeta = allPassportTypes.find((type) => type.type_name === typeName);
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
            const usedKeys = new Set(changeRows.filter((item) => item.id !== row.id).map((item) => item.key).filter(Boolean));
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
                    {availableFields.map((field) => (
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
                {teamUsers.map((member) => (
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
                  .filter((member) => !reviewerId || String(member.id) !== reviewerId)
                  .map((member) => (
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
