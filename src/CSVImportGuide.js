import React, { useRef, useState } from "react";
import { useNavigate, useParams, NavLink } from "react-router-dom";
import { authHeaders } from "./authHeaders";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

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
              <span className="upsert-detail-id">{d.product_id || d.guid || d.model_name || `#${i+1}`}</span>
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
  const { passportType } = useParams();

  const tab = activeTab || "create";

  // ── Create tab state ──
  const createFileRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  // ── Update tab state ──
  const updateCsvRef  = useRef(null);
  const updateJsonRef = useRef(null);
  const [isUpdating,   setIsUpdating]   = useState(false);
  const [updateResult, setUpdateResult] = useState(null); // { summary, details }
  const [updateError,  setUpdateError]  = useState("");

  // ─────────────────────────────────────────────
  // CREATE: existing CSV import logic (unchanged)
  // ─────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch(`${API}/api/passport-types/${passportType}`);
      if (!response.ok) { setCreateError("Failed to fetch passport type definition"); return; }
      const passportTypeData = await response.json();
      const sections = passportTypeData.fields_json?.sections || [];
      const csvRows = [];
      csvRows.push(["Field Name", "Passport 1", "Passport 2", "Passport 3"]);
      csvRows.push(["product_id", "", "", ""]);
      csvRows.push(["model_name", "", "", ""]);
      sections.forEach(section => {
        (section.fields || []).forEach(field => {
          if (field.type !== "file" && field.type !== "table") {
            csvRows.push([field.label, "", "", ""]);
          }
        });
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
      const typeResponse = await fetch(`${API}/api/passport-types/${passportType}`);
      if (!typeResponse.ok) throw new Error("Failed to fetch passport type definition");
      const passportTypeData = await typeResponse.json();
      const sections = passportTypeData.fields_json?.sections || [];
      const allFields = sections.flatMap(section => section.fields || []);
      const text = await file.text();
      const rows = parseCsvText(text);
      if (rows.length < 2) throw new Error("CSV must have at least a header row and one data row");
      const numPassports = rows[0].length - 1;
      const fieldRows = rows.slice(1);
      const createdPassports = [];
      for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
        const passportData = {};
        let hasData = false;
        fieldRows.forEach(row => {
          const rawLabel = row[0];
          if (!rawLabel || !rawLabel.trim()) return;
          const normalized = rawLabel.trim().toLowerCase();
          const value = (row[colIdx] || "").trim();
          if (!value) return;
          hasData = true;
          const field =
            allFields.find(f => f.label?.trim().toLowerCase() === normalized) ||
            allFields.find(f => f.key?.toLowerCase() === normalized) ||
            (normalized === "model_name" ? { key: "model_name", type: "text" } : null) ||
            (normalized === "product_id" ? { key: "product_id", type: "text" } : null);
          if (field) {
            passportData[field.key] = field.type === "boolean"
              ? (value.toLowerCase() === "true" || value === "1")
              : value;
          }
        });
        if (hasData && passportData.product_id) createdPassports.push(passportData);
      }
      if (createdPassports.length > 0) {
        let successCount = 0;
        for (const passportData of createdPassports) {
          try {
            const response = await fetch(`${API}/api/companies/${companyId}/passports`, {
              method: "POST",
              headers: authHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ passport_type: passportType, ...passportData }),
            });
            if (response.ok) successCount++;
          } catch {}
        }
        setCreateSuccess(`Successfully created ${successCount} passport(s)!`);
        setTimeout(() => navigate(`/dashboard/passports/${passportType}`), 2000);
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

  // ─────────────────────────────────────────────
  // UPDATE: upsert CSV
  // ─────────────────────────────────────────────
  const handleUpdateCSV = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsUpdating(true);
    setUpdateError("");
    setUpdateResult(null);
    try {
      const csv = await file.text();
      const r = await fetch(`${API}/api/companies/${companyId}/passports/upsert-csv`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ passport_type: passportType, csv }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Import failed");
      setUpdateResult(data);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setIsUpdating(false);
      if (updateCsvRef.current) updateCsvRef.current.value = "";
    }
  };

  // ─────────────────────────────────────────────
  // UPDATE: upsert JSON
  // ─────────────────────────────────────────────
  const handleUpdateJSON = async (event) => {
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
      const r = await fetch(`${API}/api/companies/${companyId}/passports/upsert-json`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ passport_type: passportType, passports }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Import failed");
      setUpdateResult(data);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setIsUpdating(false);
      if (updateJsonRef.current) updateJsonRef.current.value = "";
    }
  };

  return (
    <div className="csv-import-guide">
      <button className="csv-back-btn" onClick={() => navigate(`/dashboard/passports/${passportType}`)}>
        ← Back
      </button>

      <div className="guide-container">
        <h1>📊 Import / Update Passports — {passportType}</h1>

        {/* Tab switcher */}
        <div className="upsert-tabs">
          <NavLink to={`/csv-import/${passportType}/create`}
            className={({ isActive }) => `upsert-tab${isActive ? " active" : ""}`}>
            ✨ Create new passports
          </NavLink>
          <NavLink to={`/csv-import/${passportType}/update-csv`}
            className={({ isActive }) => `upsert-tab${isActive ? " active" : ""}`}>
            📝 Update existing (CSV)
          </NavLink>
          <NavLink to={`/csv-import/${passportType}/update-json`}
            className={({ isActive }) => `upsert-tab${isActive ? " active" : ""}`}>
            🔧 Update existing (JSON)
          </NavLink>
        </div>

        {/* ── CREATE TAB ── */}
        {tab === "create" && (
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
                  <li><strong>product_id</strong> — The unique serial number for the passport (required)</li>
                  <li><strong>model_name</strong> — Display name or model label for the product (optional)</li>
                </ul>
              </div>
              <div className="subsection">
                <h3>Example Format</h3>
                <table className="example-table">
                  <thead><tr><th>Field Name</th><th>Passport 1</th><th>Passport 2</th></tr></thead>
                  <tbody>
                    <tr><td className="field-name">product_id</td><td>SKU-001</td><td>SKU-002</td></tr>
                    <tr><td className="field-name">model_name</td><td>Model A</td><td>Model B</td></tr>
                    <tr><td className="field-name">Category</td><td>Electronics</td><td>Textiles</td></tr>
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
                <li><strong>Serial Number drives uniqueness</strong> — use a stable unit identifier; model names can repeat</li>
                <li><strong>Boolean fields:</strong> use "true"/"false" or "1"/"0"</li>
                <li><strong>Save as CSV</strong>, not .xlsx or .xls</li>
                <li><strong>Partial fields supported</strong> — missing cells stay empty</li>
                <li><strong>File/PDF fields</strong> cannot be set via CSV — upload manually after</li>
              </ul>
            </section>
          </>
        )}

        {/* ── UPDATE CSV TAB ── */}
        {tab === "update-csv" && (
          <>
            <section className="guide-section">
              <h2>Update existing drafts via CSV</h2>
              <p>
                Export your drafts from the <strong>Templates</strong> page using <em>"Export drafts CSV"</em>.
                The file includes a <code>guid</code> row — <strong>keep it</strong>. Fill in the non-model fields
                in Excel or Google Sheets, then upload below.
              </p>
              <div className="upsert-info-box">
                <strong>How it works:</strong>
                <ul>
                  <li>Row has a <code>guid</code> → the matching draft passport is <strong>updated</strong></li>
                  <li>No <code>guid</code> but matching <code>product_id</code> on an editable passport → that passport is <strong>updated</strong></li>
                  <li>New <code>product_id</code> with no <code>guid</code> → a <strong>new passport is created</strong></li>
                  <li>If the matching passport is released or in review, the row is skipped so you can revise it first</li>
                </ul>
              </div>
            </section>

            {updateResult ? (
              <ResultSummary
                summary={updateResult.summary}
                details={updateResult.details}
                onDone={() => { setUpdateResult(null); navigate(`/dashboard/passports/${passportType}`); }}
              />
            ) : (
              <section className="guide-section">
                <h2>Upload filled CSV</h2>
                <div className="upload-section">
                  <label className={`upload-label ${isUpdating ? "disabled" : ""}`}>
                    {isUpdating ? "⏳ Importing…" : "🗂️ Choose CSV File"}
                    <input ref={updateCsvRef} type="file" accept=".csv"
                      onChange={handleUpdateCSV} style={{ display: "none" }} disabled={isUpdating} />
                  </label>
                </div>
                {updateError && <div className="alert alert-error">{updateError}</div>}
              </section>
            )}
          </>
        )}

        {/* ── UPDATE JSON TAB ── */}
        {tab === "update-json" && (
          <>
            <section className="guide-section">
              <h2>Update existing drafts via JSON</h2>
              <p>
                Export your drafts from the <strong>Templates</strong> page using <em>"Export drafts JSON"</em>.
                Edit the file — change any field values you need. Upload below.
              </p>
              <div className="upsert-info-box">
                <strong>JSON format — array of objects:</strong>
                <pre className="upsert-code">{`[
  {
    "guid": "existing-passport-guid",
    "product_id": "SKU-1001",
    "model_name": "Unit A",
    "serial_number": "SN-1001",
    "manufacture_date": "2024-01-15"
  },
  {
    "product_id": "SKU-1002",
    "serial_number": "SN-1002"
  }
]`}</pre>
                <ul>
                  <li>Object has a <code>guid</code> → the matching draft is <strong>updated</strong></li>
                  <li>No <code>guid</code> but matching <code>product_id</code> on an editable passport → that passport is <strong>updated</strong></li>
                  <li>New <code>product_id</code> with no <code>guid</code> → a <strong>new passport is created</strong></li>
                  <li>If the matching passport is released or in review, the object is skipped so you can revise it first</li>
                  <li>Only include fields you want to change — unspecified fields are left as-is</li>
                </ul>
              </div>
            </section>

            {updateResult ? (
              <ResultSummary
                summary={updateResult.summary}
                details={updateResult.details}
                onDone={() => { setUpdateResult(null); navigate(`/dashboard/passports/${passportType}`); }}
              />
            ) : (
              <section className="guide-section">
                <h2>Upload JSON file</h2>
                <div className="upload-section">
                  <label className={`upload-label ${isUpdating ? "disabled" : ""}`}>
                    {isUpdating ? "⏳ Importing…" : "🗂️ Choose JSON File"}
                    <input ref={updateJsonRef} type="file" accept=".json"
                      onChange={handleUpdateJSON} style={{ display: "none" }} disabled={isUpdating} />
                  </label>
                </div>
                {updateError && <div className="alert alert-error">{updateError}</div>}
              </section>
            )}
          </>
        )}

        <div className="action-buttons">
          <button className="cancel-btn" onClick={() => navigate(`/dashboard/passports/${passportType}`)}>
            ✕ Cancel
          </button>
          {tab === "create" && (
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
