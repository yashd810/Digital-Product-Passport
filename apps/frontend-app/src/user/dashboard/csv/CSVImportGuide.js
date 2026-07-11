import React, { useRef, useState } from "react";
import { useNavigate, useParams, NavLink } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { flattenSchemaFieldsFromSections } from "../../../shared/passports/passportSchemaUtils";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import "../../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

// Proper CSV parser — handles quoted values, embedded commas, and escaped quotes
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

function ResultSummary({ summary, details, onDone }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="upsert-result">
      <div className="upsert-summary-row">
        {summary.created > 0 && <div className="upsert-stat upsert-created"><span className="upsert-num">{summary.created}</span><span>created</span></div>}
        {summary.updated > 0 && <div className="upsert-stat upsert-updated"><span className="upsert-num">{summary.updated}</span><span>updated</span></div>}
        {summary.skipped > 0 && <div className="upsert-stat upsert-skipped"><span className="upsert-num">{summary.skipped}</span><span>skipped</span></div>}
        {summary.failed  > 0 && <div className="upsert-stat upsert-failed"><span className="upsert-num">{summary.failed}</span><span>failed</span></div>}
      </div>
      {details?.length > 0 && (
        <button className="upsert-detail-toggle" onClick={() => setShowDetails(s => !s)}>
          {showDetails ? "Hide details ▲" : "Show details ▼"}
        </button>
      )}
      {showDetails && (
        <div className="upsert-detail-list">
          {details.map((d, i) => (
            <div key={i} className={`upsert-detail-row upsert-detail-${d.status}`}>
              <span className="upsert-detail-status">{d.status}</span>
              <span className="upsert-detail-id">{d.internalAliasId || d.dppId || d.modelName || `#${i+1}`}</span>
              {d.reason && <span className="upsert-detail-reason">— {d.reason}</span>}
              {d.error  && <span className="upsert-detail-reason">— {d.error}</span>}
            </div>
          ))}
        </div>
      )}
      <button className="action-btn download-btn" style={{ marginTop: 16 }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function CSVImportGuide({ user, companyId, activeTab }) {
  const navigate = useNavigate();
  const { companySlug, passportType } = useParams();
  const passportListPath = buildDashboardPath({
    companySlug,
    companyName: user?.companyName,
    companyId,
    subpath: `passports/${passportType}`,
  });

  const tab = activeTab || "create-csv";

  // ── Create tab state ──
  const createFileRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  // ── JSON import state ──
  const createJsonRef = useRef(null);
  const [isUpdating,   setIsUpdating]   = useState(false);
  const [updateResult, setUpdateResult] = useState(null); // { summary, details }
  const [updateError,  setUpdateError]  = useState("");

  // ─────────────────────────────────────────────
  // CREATE: existing CSV import logic (unchanged)
  // ─────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    try {
      const response = await fetchWithAuth(`${api}/api/internal/passport-types/${passportType}`);
      if (!response.ok) { setCreateError("Failed to fetch passport type definition"); return; }
      const passportTypeData = await response.json();
      const sections = passportTypeData.fieldsJson?.sections || [];
      const csvRows = [];
      csvRows.push(["Field Key", "Passport 1", "Passport 2", "Passport 3"]);
      csvRows.push(["internalAliasId", "", "", ""]);
      csvRows.push(["modelName", "", "", ""]);
      flattenSchemaFieldsFromSections(sections).forEach(field => {
        if (field.type !== "file" && field.type !== "table") {
          csvRows.push([field.key, "", "", ""]);
        }
      });
      const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${passportType}_template.csv`;
      link.click();
    } catch { setCreateError("Failed to download template"); }
  };

  const handleCSVImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsImporting(true);
    setCreateError("");
    try {
      const typeResponse = await fetchWithAuth(`${api}/api/internal/passport-types/${passportType}`);
      if (!typeResponse.ok) throw new Error("Failed to fetch passport type definition");
      const passportTypeData = await typeResponse.json();
      const sections = passportTypeData.fieldsJson?.sections || [];
      const allFields = flattenSchemaFieldsFromSections(sections);
      const fieldsByKey = new Map([
        ["modelName", { key: "modelName", type: "text" }],
        ["internalAliasId", { key: "internalAliasId", type: "text" }],
        ...allFields.map((field) => [field.key, field]),
      ]);
      const text = await file.text();
      const rows = parseCsvText(text);
      if (rows.length < 2) throw new Error("CSV must have at least a header row and one data row");
      const numPassports = rows[0].length - 1;
      const fieldRows = rows.slice(1);
      const unknownKeys = fieldRows
        .map((row) => String(row[0] || "").trim())
        .filter(Boolean)
        .filter((key) => !fieldsByKey.has(key));
      if (unknownKeys.length) {
        throw new Error(`Unknown field key(s): ${[...new Set(unknownKeys)].join(", ")}. Use the downloaded template field keys exactly.`);
      }
      const createdPassports = [];
      for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
        const passportData = {};
        let hasData = false;
        fieldRows.forEach(row => {
          const rawKey = String(row[0] || "").trim();
          if (!rawKey) return;
          const value = (row[colIdx] || "").trim();
          if (!value) return;
          hasData = true;
          const field = fieldsByKey.get(rawKey);
          if (field) {
            passportData[field.key] = field.type === "boolean"
              ? (value.toLowerCase() === "true" || value === "1")
              : value;
          }
        });
        if (hasData && passportData.internalAliasId) createdPassports.push(passportData);
      }
      if (createdPassports.length > 0) {
        let successCount = 0;
        for (const passportData of createdPassports) {
          try {
            const response = await fetchWithAuth(`${api}/api/companies/${companyId}/passports`, {
              method: "POST",
              headers: authHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ passportType, ...passportData }),
            });
            if (response.ok) successCount++;
          } catch (error) {
            console.warn("Failed to create passport from CSV row", error);
          }
        }
        setCreateSuccess(`Successfully created ${successCount} passport(s)!`);
        setTimeout(() => navigate(passportListPath), 2000);
      } else {
        setCreateError("No valid passports found in CSV. Please check your CSV format.");
      }
    } catch (error) {
      setCreateError(`CSV import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
      if (createFileRef.current) createFileRef.current.value = "";
    }
  };

  const handleCreateJSON = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsUpdating(true);
    setUpdateError("");
    setUpdateResult(null);
    try {
      const text = await file.text();
      let passports;
      try { passports = JSON.parse(text); } catch { throw new Error("Invalid JSON file"); }
      if (!Array.isArray(passports)) throw new Error("JSON must be an array of passport objects");
      if (passports.some((passport) => passport?.dppId)) {
        throw new Error("Create-only JSON import does not accept dppId. Remove update identifiers and use new internalAliasId values.");
      }
      const typeResponse = await fetchWithAuth(`${api}/api/internal/passport-types/${passportType}`);
      if (!typeResponse.ok) throw new Error("Failed to fetch passport type definition");
      const passportTypeData = await typeResponse.json();
      const allowedJsonKeys = new Set([
        "internalAliasId",
        "modelName",
        ...flattenSchemaFieldsFromSections(passportTypeData.fieldsJson?.sections || [])
          .map((field) => field.key),
      ]);
      const unknownJsonKeys = passports.flatMap((passport) =>
        Object.keys(passport || {}).filter((key) => !allowedJsonKeys.has(key))
      );
      if (unknownJsonKeys.length) {
        throw new Error(`Unknown JSON field key(s): ${[...new Set(unknownJsonKeys)].join(", ")}. Use exact passport type field keys.`);
      }

      let created = 0;
      let failed = 0;
      const details = [];

      for (const passportData of passports) {
        try {
          const response = await fetchWithAuth(`${api}/api/companies/${companyId}/passports`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ passportType, ...passportData }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "Create failed");
          created += 1;
          details.push({
            status: "created",
            internalAliasId: passportData.internalAliasId || payload?.passport?.internalAliasId || undefined,
            modelName: passportData.modelName || payload?.passport?.modelName || undefined,
          });
        } catch (error) {
          failed += 1;
          details.push({
            status: "failed",
            internalAliasId: passportData.internalAliasId || undefined,
            modelName: passportData.modelName || undefined,
            error: error.message || "Create failed",
          });
        }
      }

      setUpdateResult({
        summary: { created, updated: 0, skipped: 0, failed },
        details,
      });
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setIsUpdating(false);
      if (createJsonRef.current) createJsonRef.current.value = "";
    }
  };

  return (
    <div className="csv-import-guide">
      <button className="csv-back-btn" onClick={() => navigate(passportListPath)}>
        ← Back
      </button>

      <div className="guide-container">
        <h1>📊 Import Passports — {passportType}</h1>

        <div className="upsert-info-box">
          <strong>Governance note:</strong> field confidentiality belongs to the passport type schema,
          not to individual passport rows. Set public or restricted in the admin passport-type builder. CSV and JSON imports here are only for field values.
        </div>

        {/* Tab switcher */}
        <div className="upsert-tabs">
          <NavLink to={`/csv-import/${passportType}/create-csv`}
            className={({ isActive }) => `upsert-tab${isActive ? " active" : ""}`}>
            📊 Import from CSV
          </NavLink>
          <NavLink to={`/csv-import/${passportType}/create-json`}
            className={({ isActive }) => `upsert-tab${isActive ? " active" : ""}`}>
            🧾 Import from JSON
          </NavLink>
        </div>

        {tab === "create-csv" && (
          <>
            <section className="guide-section">
              <h2>Step 1: Download the Template</h2>
              <p>Start by downloading a blank CSV template specific to your <strong>{passportType}</strong> passport type.</p>
              <button className="action-btn download-btn" onClick={handleDownloadTemplate}>
                📥 Download Template CSV
              </button>
            </section>

            <section className="guide-section">
              <h2>Step 2: Fill in Your Passport Data</h2>
              <div className="subsection">
                <h3>Required Fields</h3>
                <ul>
                  <li><strong>internalAliasId</strong> — The unique local passport ID used internally by the platform (required)</li>
                  <li><strong>modelName</strong> — Display name or model label for the product (optional)</li>
                </ul>
              </div>
              <div className="subsection">
                <h3>Example Format</h3>
                <table className="example-table">
                  <thead><tr><th>Field Key</th><th>Passport 1</th><th>Passport 2</th></tr></thead>
                  <tbody>
                    <tr><td className="field-name">internalAliasId</td><td>SKU-001</td><td>SKU-002</td></tr>
                    <tr><td className="field-name">modelName</td><td>Model A</td><td>Model B</td></tr>
                    <tr><td className="field-name">productCategoryDetail</td><td>Equipment</td><td>Service Asset</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="guide-section">
              <h2>Step 3: Upload Your CSV</h2>
              <div className="upload-section">
                <label className={`upload-label ${isImporting ? "disabled" : ""}`}>
                  {isImporting ? "⏳ Importing…" : "🗂️ Choose CSV File"}
                  <input ref={createFileRef} type="file" accept=".csv"
                    onChange={handleCSVImport} style={{ display: "none" }} disabled={isImporting} />
                </label>
              </div>
              {createError   && <div className="alert alert-error">{createError}</div>}
              {createSuccess && <div className="alert alert-success">{createSuccess}</div>}
            </section>

            <section className="guide-section tips-section">
              <h2>💡 Tips</h2>
              <ul>
                <li><strong>Internal Alias ID drives uniqueness</strong> — use a stable internal identifier; model names can repeat</li>
                <li><strong>Boolean fields:</strong> use "true"/"false" or "1"/"0"</li>
                <li><strong>Save as CSV</strong>, not .xlsx or .xls</li>
                  <li><strong>Exact field keys only</strong> — use the downloaded template keys, not UI labels</li>
                  <li><strong>Partial fields supported</strong> — missing cells stay empty</li>
                <li><strong>File/PDF fields</strong> cannot be set via CSV — upload manually after</li>
              </ul>
            </section>
          </>
        )}

        {tab === "create-json" && (
          <>
            <section className="guide-section">
              <h2>Create passports via JSON</h2>
              <p>
                Upload a JSON array where each object represents one new passport draft for <strong>{passportType}</strong>.
              </p>
              <div className="upsert-info-box">
                <strong>JSON format — array of objects:</strong>
                <pre className="upsert-code">{`[
  {
    "internalAliasId": "SKU-1001",
    "modelName": "Unit A",
    "productModelIdentifier": "SN-1001"
  },
  {
    "internalAliasId": "SKU-1002",
    "modelName": "Unit B",
    "productModelIdentifier": "SN-1002"
  }
]`}</pre>
                <ul>
                  <li>Each object creates one new passport draft</li>
                  <li>Use a unique <code>internalAliasId</code> for every passport</li>
                  <li>Do not include <code>dppId</code> here — this screen is for creation only</li>
                  <li>Only include exact passport type field keys you want prefilled at creation time</li>
                </ul>
              </div>
            </section>

            {updateResult ? (
              <ResultSummary
                summary={updateResult.summary}
                details={updateResult.details}
                onDone={() => { setUpdateResult(null); navigate(passportListPath); }}
              />
            ) : (
              <section className="guide-section">
                <h2>Upload JSON file</h2>
                <div className="upload-section">
                  <label className={`upload-label ${isUpdating ? "disabled" : ""}`}>
                    {isUpdating ? "⏳ Importing…" : "🗂️ Choose JSON File"}
                    <input ref={createJsonRef} type="file" accept=".json"
                      onChange={handleCreateJSON} style={{ display: "none" }} disabled={isUpdating} />
                  </label>
                </div>
                {updateError && <div className="alert alert-error">{updateError}</div>}
              </section>
            )}
          </>
        )}

        <div className="action-buttons">
          <button className="cancel-btn" onClick={() => navigate(passportListPath)}>
            ✕ Cancel
          </button>
          {tab === "create-csv" && (
            <button className="action-btn download-btn" onClick={handleDownloadTemplate}>
              📥 Download Template Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CSVImportGuide;
