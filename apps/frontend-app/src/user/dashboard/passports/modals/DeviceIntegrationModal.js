import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders } from "../../../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";

export function DeviceIntegrationModal({ passport, passportType, companyId, onClose }) {
  const [deviceKey, setDeviceKey] = useState(null);
  const [deviceKeyMeta, setDeviceKeyMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dynFields, setDynFields] = useState([]);
  const [manualVals, setManualVals] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const apiBase = import.meta.env.VITE_API_URL || "";

  useEffect(() => {
    fetch(`${API}/api/companies/${companyId}/passports/${passport.dppId}/device-key`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setDeviceKeyMeta(d); })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch(`${API}/api/passport-types/${passportType}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const sections = d.fields_json?.sections || [];
        setDynFields(sections.flatMap((section) => section.fields || []).filter((field) => field.dynamic));
      })
      .catch(() => {});

    fetch(`${API}/api/passports/${passport.dppId}/dynamic-values`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.values) {
          const vals = {};
          Object.entries(d.values).forEach(([key, value]) => { vals[key] = value.value ?? ""; });
          setManualVals(vals);
        }
      })
      .catch(() => {});
  }, [companyId, passport.dppId, passportType]);

  const handleRegenerate = async () => {
    if (!window.confirm("Regenerate the device key? The old key will stop working immediately.")) return;
    setRegenerating(true);
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${passport.dppId}/device-key/regenerate`, {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (r.ok) {
        setDeviceKey(d.deviceKey);
        setDeviceKeyMeta({
          hasDeviceKey: true,
          keyPrefix: d.keyPrefix || null,
          lastRotatedAt: d.lastRotatedAt || new Date().toISOString(),
        });
      }
    } catch {}
    finally { setRegenerating(false); }
  };

  const handleSaveManual = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(`${API}/api/companies/${companyId}/passports/${passport.dppId}/dynamic-values`, {
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

  const copyKey = () => {
    if (!deviceKey) return;
    navigator.clipboard.writeText(deviceKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const endpoint = `${apiBase}/api/passports/${passport.dppId}/dynamic-values`;
  const exampleBody = dynFields.length
    ? `{\n${dynFields.map((field) => `  "${field.key}": "value"`).join(",\n")}\n}`
    : `{\n  "field_key": "value"\n}`;

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box device-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Device Integration — {passport.model_name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="device-modal-body">
          <section className="device-section">
            <h4 className="device-section-title">Device API Key</h4>
            <p className="device-section-desc">
              Your IoT device uses this key to push live values. Send it in the <code>x-device-key</code> header.
            </p>
            {loading ? (
              <div className="device-key-row"><span className="device-loading-copy">Loading…</span></div>
            ) : (
              <div className="device-key-row">
                <code className="device-key-code">{deviceKey || deviceKeyMeta?.keyPrefix || "Not issued yet"}</code>
                <button className="device-copy-btn" onClick={copyKey} disabled={!deviceKey}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <button className="device-regen-btn" onClick={handleRegenerate} disabled={regenerating}>
                  {regenerating ? "…" : deviceKeyMeta?.hasDeviceKey ? "Regenerate" : "Issue Key"}
                </button>
              </div>
            )}
          </section>

          <section className="device-section">
            <h4 className="device-section-title">Push Endpoint</h4>
            <div className="device-code-block">
              <div className="device-code-line"><span className="device-code-method">POST</span> <span className="device-code-url">{endpoint}</span></div>
              <div className="device-code-line device-code-line-spaced">
                <span className="device-code-comment">Headers:</span>
              </div>
              <div className="device-code-line device-code-indent">x-device-key: <em>&lt;your device key&gt;</em></div>
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
                    <label className="device-manual-label">{field.label}</label>
                    <input
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
