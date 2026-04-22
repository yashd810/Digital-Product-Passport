import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buildPassportJsonLdExport } from "../../../../shared/utils/batterySemanticExport";

const API = import.meta.env.VITE_API_URL || "";

export function ExportModal({ passports, filteredPassports, pagePassports, selectedPassports, activeType, allPassportTypes, onClose, onDone }) {
  const [scope, setScope] = useState("all");
  const [format, setFormat] = useState("csv");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const formatLabel = format === "jsonld" ? "JSON-LD" : format.toUpperCase();

  const selectedList = passports.filter((passport) => selectedPassports.has(`${passport.guid}-${passport.version_number}`));

  const scopePassports = {
    selected: selectedList,
    filtered: filteredPassports,
    page: pagePassports,
    all: filteredPassports,
  };

  const scopeOptions = [
    { id: "selected", label: "Selected", description: "Only the passports you have checked.", count: selectedList.length },
    { id: "filtered", label: "All Pages", description: "Every passport in the current filtered view.", count: filteredPassports.length },
    { id: "page", label: "This Page", description: "Only the passports visible on the current page.", count: pagePassports.length },
  ];

  useEffect(() => {
    if (selectedList.length > 0) setScope("selected");
    else setScope("filtered");
  }, [selectedList.length]);

  const exportList = scopePassports[scope] || [];

  const exportTypeToCSV = async (type, list) => {
    const r = await fetch(`${API}/api/passport-types/${type}`);
    if (!r.ok) throw new Error(`Failed to fetch field definitions for ${type}`);
    const data = await r.json();
    const allFields = (data.fields_json?.sections || []).flatMap((section) => section.fields || []);
    const rows = [
      ["Field Name", ...list.map((passport) => passport.model_name)],
      ["guid", ...list.map((passport) => passport.guid)],
      ["model_name", ...list.map((passport) => passport.model_name || "")],
      ["product_id", ...list.map((passport) => passport.product_id || "")],
      ...allFields
        .filter((field) => field.type !== "table")
        .map((field) => [field.label, ...list.map((passport) => field.type === "boolean" ? (passport[field.key] ? "true" : "false") : (passport[field.key] || ""))]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_export.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportTypeToJsonLd = async (type, list) => {
    const r = await fetch(`${API}/api/passport-types/${type}`);
    if (!r.ok) throw new Error(`Failed to fetch field definitions for ${type}`);
    const data = await r.json();
    const semanticModelKey = data.semantic_model_key || allPassportTypes.find((item) => item.type_name === type)?.semantic_model_key || "";
    const allFields = (data.fields_json?.sections || []).flatMap((section) => section.fields || []);
    const output = list.map((passport) => {
      const obj = {
        guid: passport.guid,
        model_name: passport.model_name,
        product_id: passport.product_id,
        release_status: passport.release_status,
        version_number: passport.version_number,
      };
      allFields.forEach((field) => { obj[field.key] = passport[field.key] ?? null; });
      return obj;
    });
    const exportPayload = buildPassportJsonLdExport(output, type, { semanticModelKey });
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/ld+json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_export.jsonld`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleExport = async () => {
    if (!exportList.length) {
      setError("No passports in the selected scope.");
      return;
    }

    setExporting(true);
    setError("");
    try {
      const grouped = exportList.reduce((acc, passport) => {
        const type = passport.passport_type || activeType;
        if (!acc[type]) acc[type] = [];
        acc[type].push(passport);
        return acc;
      }, {});

      for (const [type, list] of Object.entries(grouped)) {
        if (format === "csv") await exportTypeToCSV(type, list);
        if (format === "jsonld") await exportTypeToJsonLd(type, list);
      }

      onDone(`Exported ${exportList.length} passport${exportList.length !== 1 ? "s" : ""} as ${formatLabel}`);
    } catch (e) {
      setError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return createPortal(
    <div className="dashboard-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !exporting) onClose(); }}>
      <div className="dashboard-modal-card bulk-revise-modal-card">
        <h3 className="dashboard-modal-title">Export Passports</h3>
        <p className="dashboard-modal-subtitle">Choose which passports to export and the file format.</p>

        <div className="bulk-revise-scope-grid">
          {scopeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`bulk-revise-scope-card${scope === option.id ? " active" : ""}`}
              onClick={() => setScope(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.count} passport{option.count !== 1 ? "s" : ""}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        <div className="wf-select-group" style={{ marginTop: 16 }}>
          <label>Format</label>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {["csv", "jsonld"].map((value) => (
              <button
                key={value}
                type="button"
                className={`bulk-revise-scope-card${format === value ? " active" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setFormat(value)}
              >
                <strong>{value === "jsonld" ? "JSON-LD" : value.toUpperCase()}</strong>
                <small>{value === "csv" ? "Spreadsheet — edit in Excel / Sheets" : "Linked data export with semantic contexts and IDs"}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-note-panel" style={{ marginTop: 16 }}>
          Exporting <strong>{exportList.length}</strong> passport{exportList.length !== 1 ? "s" : ""} as <strong>{formatLabel}</strong>.
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
