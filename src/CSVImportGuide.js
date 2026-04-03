import React, { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

function CSVImportGuide({ token, user, companyId }) {
  const navigate = useNavigate();
  const { passportType } = useParams();
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch(`${API}/api/passport-types/${passportType}`);
      if (!response.ok) {
        setError("Failed to fetch passport type definition");
        return;
      }

      const passportTypeData = await response.json();
      const sections = passportTypeData.fields_json?.sections || [];

      const csvRows = [];
      csvRows.push(["Field Name", "Passport 1", "Passport 2", "Passport 3"]);
      csvRows.push(["model_name", "", "", ""]);
      csvRows.push(["product_id", "", "", ""]);

      sections.forEach(section => {
        if (section.fields && Array.isArray(section.fields)) {
          section.fields.forEach(field => {
            if (field.type !== "file" && field.type !== "table") {
              csvRows.push([field.label, "", "", ""]);
            }
          });
        }
      });

      const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${passportType}_template.csv`;
      link.click();
    } catch (error) {
      setError("Failed to download template");
    }
  };

  const handleCSVImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);
    setError("");
    try {
      const typeResponse = await fetch(`${API}/api/passport-types/${passportType}`);
      if (!typeResponse.ok) {
        throw new Error("Failed to fetch passport type definition");
      }
      const passportTypeData = await typeResponse.json();
      const sections = passportTypeData.fields_json?.sections || [];
      const allFields = sections.flatMap(section => section.fields || []);

      const text = await file.text();
      const rows = parseCsvText(text);

      if (rows.length < 2) throw new Error("CSV must have at least a header row and one data row");

      const createdPassports = [];

      // CSV is column-oriented: rows[0] = headers (Field Name, Passport 1, Passport 2…)
      // rows[1..] = one row per field; columns[1..] = one column per passport
      // Only fields present in the CSV are set — missing fields are left empty (partial import supported)
      const numPassports = rows[0].length - 1; // subtract the "Field Name" label column
      const fieldRows = rows.slice(1);

      for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
        const passportData = {};
        let hasData = false;

        fieldRows.forEach(row => {
          const rawLabel = row[0];
          if (!rawLabel || !rawLabel.trim()) return;
          const normalized = rawLabel.trim().toLowerCase();
          const value = (row[colIdx] || "").trim(); // this passport's value for this field

          if (!value) return;
          hasData = true;

          // Match by label (case-insensitive) first, then by field key, then system fields
          const field =
            allFields.find(f => f.label?.trim().toLowerCase() === normalized) ||
            allFields.find(f => f.key?.toLowerCase() === normalized) ||
            (normalized === "model_name" ? { key: "model_name", type: "text" } : null) ||
            (normalized === "product_id" ? { key: "product_id", type: "text" } : null);

          if (field) {
            if (field.type === "boolean") {
              passportData[field.key] = value.toLowerCase() === "true" || value === "1";
            } else {
              passportData[field.key] = value;
            }
          }
        });

        if (hasData && passportData.model_name) {
          createdPassports.push(passportData);
        }
      }

      if (createdPassports.length > 0) {
        let successCount = 0;
        for (const passportData of createdPassports) {
          try {
            const response = await fetch(`${API}/api/companies/${companyId}/passports`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                passport_type: passportType,
                ...passportData,
              }),
            });

            if (response.ok) {
              successCount++;
            }
          } catch (error) {
          }
        }

        setSuccess(`Successfully created ${successCount} passport(s)!`);
        setTimeout(() => {
          navigate(`/dashboard/passports/${passportType}`);
        }, 2000);
      } else {
        setError("No valid passports found in CSV. Please check your CSV format.");
      }
    } catch (error) {
      setError(`CSV import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="csv-import-guide">
      <div className="guide-container">
        <button className="back-btn" onClick={() => navigate(`/dashboard/passports/${passportType}`)}>
          ← Back
        </button>

        <h1>📊 Import Passports from CSV</h1>

        <section className="guide-section">
          <h2>Step 1: Download the Template</h2>
          <p>
            Start by downloading a blank CSV template specific to your <strong>{passportType}</strong> passport type. This
            template includes all the available fields you can fill in.
          </p>
          <button className="action-btn download-btn" onClick={handleDownloadTemplate}>
            📥 Download Template CSV
          </button>
        </section>

        <section className="guide-section">
          <h2>Step 2: Fill in Your Passport Data</h2>
          <p>
            Open the downloaded CSV file in a spreadsheet application (Excel, Google Sheets, etc.) and fill in your passport
            information. Here's what you need to know:
          </p>

          <div className="subsection">
            <h3>Required Fields</h3>
            <ul>
              <li>
                <strong>model_name</strong> - The name/identifier of your passport (required for each row)
              </li>
              <li>
                <strong>product_id</strong> - The product ID associated with this passport (optional)
              </li>
            </ul>
          </div>

          <div className="subsection">
            <h3>Additional Fields</h3>
            <p>
              Fill in any of the additional fields provided in your template based on your passport type. Leave fields blank if
              they don't apply — or remove those rows from the CSV entirely. Only fields you include with a value will be set;
              all other fields remain empty on the created passport.
            </p>
          </div>

          <div className="subsection">
            <h3>Example Format</h3>
            <table className="example-table">
              <thead>
                <tr>
                  <th>Field Name</th>
                  <th>Passport 1</th>
                  <th>Passport 2</th>
                  <th>Passport 3</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="field-name">model_name</td>
                  <td>Model A</td>
                  <td>Model B</td>
                  <td>Model C</td>
                </tr>
                <tr>
                  <td className="field-name">product_id</td>
                  <td>SKU-001</td>
                  <td>SKU-002</td>
                  <td>SKU-003</td>
                </tr>
                <tr>
                  <td className="field-name">Category</td>
                  <td>Electronics</td>
                  <td>Electronics</td>
                  <td>Textiles</td>
                </tr>
                <tr>
                  <td className="field-name">Description</td>
                  <td>High quality product</td>
                  <td>Premium variant</td>
                  <td>Natural fibers</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="guide-section">
          <h2>Step 3: Add Multiple Passports</h2>
          <p>
            To import multiple passports at once, simply add more columns to your CSV file. Each column (after "Field Name")
            represents one passport:
          </p>
          <ul>
            <li>Column A: Field names (stays the same)</li>
            <li>Column B: First passport data</li>
            <li>Column C: Second passport data</li>
            <li>Column D: Third passport data</li>
            <li>And so on...</li>
          </ul>
          <p>
            <strong>Tip:</strong> You can add as many columns as needed. Each column with valid data will create a new passport.
          </p>
        </section>

        <section className="guide-section">
          <h2>Step 4: Upload Your CSV File</h2>
          <p>Once you've filled in all your passport data, upload the CSV file below to create all passports at once.</p>

          <div className="upload-section">
            <label className={`upload-label ${isImporting ? "disabled" : ""}`}>
              {isImporting ? "⏳ Importing passport data..." : "🗂️ Choose CSV File"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCSVImport}
                style={{ display: "none" }}
                disabled={isImporting}
              />
            </label>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
        </section>

        <section className="guide-section tips-section">
          <h2>💡 Tips for Success</h2>
          <ul>
            <li>
              <strong>Use consistent formatting:</strong> Ensure all cells are properly filled and formatted consistently
            </li>
            <li>
              <strong>Boolean fields:</strong> Use "true" or "false" (or "1" or "0") for yes/no fields
            </li>
            <li>
              <strong>Save as CSV:</strong> Make sure your file is saved as .csv format, not .xlsx or .xls
            </li>
            <li>
              <strong>Partial fields supported:</strong> You don't need to include all fields — only rows you provide (with a value) will be filled. The rest remain empty until you edit the passport.
            </li>
            <li>
              <strong>Model Name required:</strong> Every passport must have a model_name - it cannot be empty
            </li>
            <li>
              <strong>File uploads not supported:</strong> PDF fields cannot be uploaded via CSV. Upload those manually after
              creating the passports
            </li>
            <li>
              <strong>Special characters:</strong> If using special characters, make sure your file is UTF-8 encoded
            </li>
          </ul>
        </section>

        <div className="action-buttons">
          <button className="cancel-btn" onClick={() => navigate(`/dashboard/passports/${passportType}`)}>
            ✕ Cancel
          </button>
          <button className="action-btn download-btn" onClick={handleDownloadTemplate}>
            📥 Download Template Again
          </button>
        </div>
      </div>
    </div>
  );
}

export default CSVImportGuide;
