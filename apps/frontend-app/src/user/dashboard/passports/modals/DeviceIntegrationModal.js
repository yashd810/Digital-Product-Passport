import React, { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { flattenSchemaFieldsFromSections } from "../../../../shared/passports/passportSchemaUtils";

const api = import.meta.env.VITE_API_URL || "";

function slugifyCompanyName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function DeviceIntegrationModal({ passport, passportType, companyId, companyName = "", onClose }) {
  const [dynFields, setDynFields] = useState([]);
  const [manualVals, setManualVals] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const apiBase = import.meta.env.VITE_API_URL || "";
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  useEffect(() => {
    fetchWithAuth(`${api}/api/internal/passport-types/${passportType}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const sections = d.fieldsJson?.sections || [];
        setDynFields(flattenSchemaFieldsFromSections(sections).filter((field) => field.dynamic));
      })
      .catch((error) => console.warn("Ignored async error", error));

    fetchWithAuth(`${api}/api/companies/${encodeURIComponent(companyId)}/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.values) {
          const vals = {};
          Object.entries(d.values).forEach(([key, value]) => { vals[key] = value.value ?? ""; });
          setManualVals(vals);
        }
      })
      .catch((error) => console.warn("Ignored async error", error));
  }, [companyId, passport.dppId, passportType]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSaveManual = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/${passport.dppId}/dynamic-values`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(manualVals),
      });
      setSaveMsg(r.ok ? "Saved!" : "Save failed");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch {
      setSaveMsg("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const companySlug = slugifyCompanyName(companyName || passport.companyName);
  const endpoint = `${apiBase}/api/companies/${companySlug}/integrations/v1/passports/${passport.dppId}/dynamic-values`;
  const exampleBody = dynFields.length
    ? `{\n${dynFields.map((field) => `  "${field.key}": "value"`).join(",\n")}\n}`
    : `{\n  "fieldKey": "value"\n}`;

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-box device-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
      >
        <div className="modal-header">
          <span id={dialogTitleId} className="modal-title">Device Integration — {passport.modelName}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close device integration modal">✕</button>
        </div>

        <div className="device-modal-body">
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
            Review the Bearer-token push endpoint and override dynamic field values for this passport.
          </p>
          <section className="device-section">
            <h4 className="device-section-title">Push Endpoint</h4>
            <p className="device-section-desc">
              Use a company service Bearer token with permission to update this company passport.
            </p>
            <div className="device-code-block">
              <div className="device-code-line"><span className="device-code-method">POST</span> <span className="device-code-url">{endpoint}</span></div>
              <div className="device-code-line device-code-line-spaced">
                <span className="device-code-comment">Headers:</span>
              </div>
              <div className="device-code-line device-code-indent">Authorization: Bearer <em>&lt;company service token&gt;</em></div>
              <div className="device-code-line device-code-indent">Content-Type: application/json</div>
              <div className="device-code-line device-code-line-spaced">
                <span className="device-code-comment">Body:</span>
              </div>
              <pre className="device-code-pre">{exampleBody}</pre>
            </div>
          </section>

          {dynFields.length > 0 && (
            <section className="device-section">
              <h4 className="device-section-title">Manual Override</h4>
              <p className="device-section-desc">Set values directly without a device (useful for testing).</p>
              <div className="device-manual-grid">
                {dynFields.map((field) => (
                  <div key={field.key} className="device-manual-row">
                    <label className="device-manual-label" htmlFor={`device-manual-${field.key}`}>{field.label}</label>
                    <input
                      id={`device-manual-${field.key}`}
                      type="text"
                      className="device-manual-input"
                      value={manualVals[field.key] ?? ""}
                      placeholder="Enter value…"
                      onChange={(e) => setManualVals((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="device-manual-actions">
                <button type="button" className="submit-btn" onClick={handleSaveManual} disabled={saving}>
                  {saving ? "Saving…" : "Save Values"}
                </button>
                {saveMsg && <span className="device-save-msg" role="status" aria-live="polite">{saveMsg}</span>}
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
