import React, { useEffect, useState } from "react";
import { LANGUAGES, translateFieldValue, translateSchemaLabel } from "../../app/providers/i18n";
import { DynamicChart } from "./DynamicChart";
import { PieChart, parseCompositionFromTable, parseCompositionFromText } from "./PieChart";
import { formatPassportStatus, getPassportActivityState } from "../../passports/utils/passportStatus";
import { ACCESS_LABEL_MAP, renderTextBlock, isHeroSummaryField, getFieldPresentation, getSummaryHint, getSummaryValue, shouldFeatureInSummary, toInlineText, formatLinkLabel } from "../utils/viewerHelpers";

const API = import.meta.env.VITE_API_URL || "";
const PUBLIC_VIEWER_URL = import.meta.env.VITE_PUBLIC_VIEWER_URL || "";

function getDomainIndicatorState() {
  if (typeof window === "undefined") {
    return { currentHost: "", expectedHost: "", trusted: true, label: "" };
  }

  const currentHost = window.location.host || "";
  let expectedHost = "";
  try {
    expectedHost = PUBLIC_VIEWER_URL ? new URL(PUBLIC_VIEWER_URL).host : "";
  } catch {
    expectedHost = "";
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const isLocal = localHosts.has(window.location.hostname);
  const trusted = !expectedHost || currentHost === expectedHost || isLocal;
  return {
    currentHost,
    expectedHost,
    trusted,
    label: trusted
      ? (isLocal ? `Local preview · ${currentHost}` : `Verified domain · ${currentHost}`)
      : `Check domain · expected ${expectedHost || "trusted viewer host"}`,
  };
}

export function ViewerDomainIndicator({ compact = false }) {
  const indicator = getDomainIndicatorState();
  if (!indicator.label) return null;

  return (
    <div className={`viewer-domain-indicator viewer-domain-indicator-${indicator.trusted ? "trusted" : "warning"}${compact ? " compact" : ""}`}>
      <span className="viewer-domain-indicator-label">{indicator.label}</span>
      <strong className="viewer-domain-indicator-host">{indicator.currentHost || indicator.expectedHost || "unknown-host"}</strong>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer UI Blocks
// ─────────────────────────────────────────────────────────────────────────────
export function PassportIntro({ passport, companyData, displayName, qrCode, qrLoading, onPrint, onOpenHistory }) {
  if (!passport) return null;
  const activityState = getPassportActivityState(passport);
  const manufacturingDate =
    passport.manufactured_date ||
    passport.manufacture_date ||
    passport.manufacturing_date ||
    passport.date_of_manufacture ||
    "—";
  const uniqueBatteryIdentifier =
    passport.unique_battery_identifier ||
    passport.battery_identifier ||
    passport.product_id ||
    "—";
  const batteryMass =
    passport.battery_mass ||
    passport.battery_weight ||
    passport.weight ||
    "—";
  const serialNumber =
    passport.product_id ||
    passport.serial_number ||
    passport.serial ||
    passport.battery_serial_number ||
    "—";
  const manufacturerInfo =
    companyData?.company_name ||
    passport.manufacturer ||
    passport.manufactured_by ||
    "—";
  const carbonFootprintRaw = passport.carbon_footprint_label_and_performance_class || "";
  const carbonFootprintIsUrl = /^(https?:)?\/\//i.test(String(carbonFootprintRaw)) || String(carbonFootprintRaw).startsWith("/");
  const carbonFootprintLabelAndClass = carbonFootprintRaw
    ? (carbonFootprintIsUrl
        ? <img src={carbonFootprintRaw} alt="Carbon Footprint Label" className="pv-hero-stat-symbol" />
        : carbonFootprintRaw)
    : "—";
  const batteryChemistry =
    passport.battery_chemistry ||
    passport.chemistry ||
    "—";
  const summaryStats = [
    { label: "Unique Passport Identifier", value: passport.dppId || "—" },
    { label: "Manufacturing Date", value: manufacturingDate },
    { label: "Unique Battery Identifier", value: uniqueBatteryIdentifier },
    { label: "Serial Number", value: serialNumber },
    { label: "Carbon Footprint Label and Performance Class", value: carbonFootprintLabelAndClass },
    { label: "Battery Chemistry", value: batteryChemistry },
    { label: "Battery Mass", value: batteryMass },
    { label: "Manufacturer Information", value: manufacturerInfo },
  ];

  return (
    <section className="pv-hero">
      <div className="pv-hero-main">
        <div className="pv-hero-brandline">
          <div>
            <p className="pv-hero-kicker">{displayName || passport.passport_type}</p>
            <h1>{passport.model_name}</h1>
          </div>
        </div>

        <div className="pv-hero-stat-grid">
          {summaryStats.map(item => (
            <article key={item.label} className="pv-hero-stat">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      </div>

      <aside className="pv-hero-side">
        <div className="pv-hero-actions">
          <button type="button" className="pv-secondary-btn" onClick={onOpenHistory}>
            Version History
          </button>
          <button type="button" className="pv-primary-btn" onClick={onPrint}>
            Print PDF
          </button>
        </div>

        {companyData?.company_logo && (
          <div className="pv-company-card">
            <img src={companyData.company_logo} alt="Company Logo" className="pv-company-logo" />
          </div>
        )}

        <div className="pv-qr-card">
          <span className="pv-qr-label">Passport QR</span>
          {qrLoading ? (
            <div className="pv-qr-placeholder">Generating QR…</div>
          ) : qrCode ? (
            <img src={qrCode} alt="Passport QR" className="pv-qr-image" />
          ) : (
            <div className="pv-qr-placeholder">QR unavailable</div>
          )}
          <div className={`pv-dpp-status pv-dpp-status-${activityState}`}>
            <span className="pv-dpp-status-dot" />
            {activityState === "archived" ? "Archived" : activityState === "obsolete" ? "Obsolete" : "Active"}
          </div>
        </div>
      </aside>
    </section>
  );
}

export function Header({ displayName, lang, setLang, dppId, companyData, brandTheme }) {
  return (
    <header className="viewer-header">
      <div className="viewer-header-inner viewer-header-shell">
        <div>
          <h1>{brandTheme?.title || "Digital Product Passport"}</h1>
          <p>{companyData?.company_name ? `${companyData.company_name} · ${displayName}` : displayName}</p>
          <ViewerDomainIndicator compact />
          {brandTheme?.companyWebsite && (
            <a href={brandTheme.companyWebsite} target="_blank" rel="noopener noreferrer" className="viewer-header-website">
              {brandTheme.companyWebsite.replace(/^https?:\/\//i, "")}
            </a>
          )}
        </div>
        <div className="viewer-header-actions">
          {companyData?.company_logo && (
            <img src={companyData.company_logo} alt={`${companyData.company_name || "Company"} logo`} className="viewer-header-brand-logo" />
          )}
          <ScanBadge dppId={dppId} />
          <ViewerLangSelector lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  );
}

export function Footer({ brandTheme }) {
  const supportHref = brandTheme?.supportLink || "mailto:digitalproductpass@gmail.com";
  const supportLabel = supportHref.startsWith("mailto:") ? "Contact information" : "Support";
  return (
    <footer className="viewer-footer">
      <p className="viewer-footer-provider">{brandTheme?.footerText || "Powered by ClarosDPP, digital passport provider via software as a service."}</p>
      <ViewerDomainIndicator />
      <p className="viewer-footer-subtle">
        <a href={supportHref} className="viewer-footer-link">{supportLabel}</a>
      </p>
    </footer>
  );
}

export function LockedFieldCell({ field, onUnlock }) {
  const who = (field.access || [])
    .filter(a => a !== "public")
    .map(a => ACCESS_LABEL_MAP[a] || a)
    .join(", ");
  return (
    <button type="button" className="locked-field-btn" onClick={onUnlock}>
      Unlock field
      {who && <span className="locked-field-who"> ({who})</span>}
    </button>
  );
}

export function LiveBadge({ updatedAt }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const calc = () => {
      if (!updatedAt) return "";
      const secs = Math.floor((Date.now() - new Date(updatedAt)) / 1000);
      if (secs < 60) return "just now";
      if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
      if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
      return `${Math.floor(secs / 86400)}d ago`;
    };
    setLabel(calc());
    const t = setInterval(() => setLabel(calc()), 30000);
    return () => clearInterval(t);
  }, [updatedAt]);
  return (
    <span className="live-badge">
      <span className="live-dot" />
      LIVE{label ? ` · ${label}` : ""}
    </span>
  );
}

export function SectionView({ sectionDef, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang, sectionId = "" }) {
  const [expandedKey, setExpandedKey] = useState(null);   // which dynamic field is open
  const [chartTypes,  setChartTypes]  = useState({});     // { [fieldKey]: "line"|"histogram" }
  const [history,     setHistory]     = useState({});     // { [fieldKey]: { data, loading } }

  const toggleChart = async (fieldKey) => {
    if (expandedKey === fieldKey) { setExpandedKey(null); return; }
    setExpandedKey(fieldKey);
    if (!history[fieldKey]) {
      setHistory(p => ({ ...p, [fieldKey]: { data: [], loading: true } }));
      try {
        const r = await fetch(`${API}/api/passports/${passport.dppId}/dynamic-values/${fieldKey}/history?limit=500`);
        const d = r.ok ? await r.json() : null;
        setHistory(p => ({ ...p, [fieldKey]: { data: d?.history || [], loading: false } }));
      } catch {
        setHistory(p => ({ ...p, [fieldKey]: { data: [], loading: false } }));
      }
    }
  };

  const setChartType = (fieldKey, type) =>
    setChartTypes(p => ({ ...p, [fieldKey]: type }));

  if (!sectionDef || !passport) return null;
  const isFileUrl = v => typeof v === "string" && v.startsWith("http");
  const sectionTitle = translateSchemaLabel(lang, sectionDef);
  const visibleFields = (sectionDef.fields || []).filter(field => !isHeroSummaryField(field, translateSchemaLabel(lang, field)));
  const fieldEntries = visibleFields.map(f => {
    const access = f.access || ["public"];
    const isPublic = access.includes("public");
    const fieldLabel = translateSchemaLabel(lang, f);
    const isDynamic = !!f.dynamic;
    const dynEntry = isDynamic ? dynamicValues?.[f.key] : null;
    const src = unlockedPassport || passport;
    const raw = isPublic || unlockedPassport
      ? (isDynamic ? (dynEntry?.value ?? null) : src[f.key])
      : null;
    const isLocked = !isPublic && !unlockedPassport;

    let display = "—";
    if (isLocked) {
      display = (
        <div className="pv-locked-state">
          <p className="pv-locked-copy">This value is available to authorised parties only.</p>
          <LockedFieldCell field={f} onUnlock={onRequestUnlock} />
        </div>
      );
    } else if (f.type === "boolean") {
      display = <div className="pv-field-value-strong">{translateFieldValue(lang, !!raw, "boolean")}</div>;
    } else if (f.type === "file" && isFileUrl(raw)) {
      display = <FileCell url={raw} label={`${passport.model_name}_${f.key}`} />;
    } else if (f.type === "table") {
      let tableData = null;
      if (Array.isArray(raw)) tableData = raw;
      else {
        try { tableData = raw ? JSON.parse(raw) : null; } catch {}
      }
      if (Array.isArray(tableData) && tableData.length > 0) {
        const cols = f.table_columns || [];
        display = (
          <div className="pv-field-table-wrap">
            <table className="field-table-display">
              {cols.length > 0 && (
                <thead>
                  <tr>{cols.map((col, index) => <th key={index}>{translateSchemaLabel(lang, { label: col })}</th>)}</tr>
                </thead>
              )}
              <tbody>
                {tableData.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    } else if (f.type === "symbol" && raw) {
      display = (
        <div className="pv-field-symbol-wrap">
          <img src={raw} alt={f.label} className="field-symbol-img pv-field-symbol" />
        </div>
      );
    } else if (f.type === "url" && raw) {
      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      display = (
        <a href={href} target="_blank" rel="noopener noreferrer" className="field-url-link">
          {raw}
        </a>
      );
    } else if (typeof raw === "string" && raw.includes("\n")) {
      display = renderTextBlock(raw, "pv-field-text-block");
    } else if (raw || raw === 0) {
      display = <div className="pv-field-value">{String(raw)}</div>;
    }

    let pieItems = null;
    if (f.composition && raw) {
      pieItems = f.type === "table" ? parseCompositionFromTable(raw) : parseCompositionFromText(raw);
    }

    const isExpanded = isDynamic && expandedKey === f.key;
    const chartType = chartTypes[f.key] || "line";
    const presentation = getFieldPresentation(f, raw, isLocked, pieItems);
    const fullWidth = false;
    const twoColumn = false;
    const tags = [];
    if (!isPublic) tags.push("Restricted");
    if (unlockedPassport && !isPublic) tags.push("Authorised view");
    if (f.composition) tags.push("Breakdown");
    if (f.type === "table") tags.push("Dataset");
    if (f.type === "url") tags.push("External link");

    return {
      field: f,
      fieldLabel,
      isPublic,
      isDynamic,
      dynEntry,
      isLocked,
      display,
      pieItems,
      isExpanded,
      chartType,
      fullWidth,
      twoColumn,
      tags,
      summaryValue: getSummaryValue(f, raw, isLocked, lang),
      summaryCandidate: shouldFeatureInSummary(f, raw, isLocked, pieItems),
      summaryHint: getSummaryHint(f, isLocked, isDynamic, presentation.tone),
      presentation,
    };
  });
  return (
    <section className="pv-section-card" id={sectionId || undefined}>
      <div className="pv-section-head">
        <div>
          <h3>{sectionTitle}</h3>
        </div>
        <div className="pv-section-count">{fieldEntries.length} items</div>
      </div>

      <div className="pv-field-grid">
        {fieldEntries.map(entry => {
          return (
            <article
              key={entry.field.key}
              className={`pv-field-card pv-field-card-tone-${entry.presentation.tone}${entry.fullWidth ? " pv-field-card-wide" : ""}${entry.twoColumn ? " pv-field-card-two-col" : ""}`}
            >
              <div className="pv-field-head">
                <div>
                  <p className="pv-field-kicker">{entry.fieldLabel}</p>
                  {entry.tags.length > 0 && (
                    <div className="pv-field-tags">
                      {entry.tags.map(tag => (
                        <span key={tag} className="pv-field-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                {entry.isDynamic && <LiveBadge updatedAt={entry.dynEntry?.updatedAt} />}
              </div>

              <div className="pv-field-body">
                <div className="pv-field-body-surface">
                  {entry.display}
                </div>
              </div>

              {entry.isDynamic && (entry.isPublic || unlockedPassport) && (
                <div className="pv-field-actions">
                  <button
                    type="button"
                    className={`dyn-expand-btn${entry.isExpanded ? " open" : ""}`}
                    onClick={() => toggleChart(entry.field.key)}
                    title={entry.isExpanded ? "Hide chart" : "Show history chart"}
                  >
                    {entry.isExpanded ? "Hide history" : "View history"}
                  </button>
                </div>
              )}

              {entry.isExpanded && (
                <div className="pv-chart-wrap">
                  <div className="dyn-chart-panel">
                    <div className="dyn-chart-toggle">
                      <span className="dyn-chart-toggle-label">Chart</span>
                      <button
                        type="button"
                        className={`dyn-toggle-btn${entry.chartType === "line" ? " active" : ""}`}
                        onClick={() => setChartType(entry.field.key, "line")}
                      >
                        Line
                      </button>
                      <button
                        type="button"
                        className={`dyn-toggle-btn${entry.chartType === "histogram" ? " active" : ""}`}
                        onClick={() => setChartType(entry.field.key, "histogram")}
                      >
                        Histogram
                      </button>
                    </div>

                    {history[entry.field.key]?.loading ? (
                      <div className="dyn-chart-loading">Loading history…</div>
                    ) : (
                      <DynamicChart data={history[entry.field.key]?.data || []} chartType={entry.chartType} />
                    )}
                  </div>
                </div>
              )}

              {entry.pieItems && (
                <div className="pv-chart-wrap">
                  <PieChart items={entry.pieItems} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── File cell with inline PDF preview ───────────────────────
// Fetches the PDF as a blob to create a same-origin URL,
// which bypasses X-Frame-Options restrictions on the backend.
export function FileCell({ url, label }) {
  const [open,    setOpen]    = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const handleToggle = async () => {
    if (open) { setOpen(false); return; }
    if (blobUrl) { setOpen(true); return; }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load PDF (${res.status})`);
      const blob = await res.blob();
      setBlobUrl(URL.createObjectURL(blob));
      setOpen(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pdf-cell">
      <div className="pdf-cell-actions">
        <a href={url} target="_blank" rel="noopener noreferrer" className="pdf-open-link">
          Open document
        </a>
        <button type="button" className="pdf-preview-btn" onClick={handleToggle} disabled={loading}>
          {loading ? "Loading…" : open ? "▲ Hide preview" : "▼ Show preview"}
        </button>
      </div>
      {err && <div className="pdf-err">{err}</div>}
      {open && blobUrl && (
        <iframe src={blobUrl} title={label} className="pdf-iframe" />
      )}
    </div>
  );
}

// ─── Passport section tabs ────────────────────────────────────
export function PassportTabRail({ tabs, activeSectionKey, onSelect }) {
  return (
    <nav className="pv-tab-rail" aria-label="Passport sections">
      {tabs.map(tab => (
        <button
          key={tab.sectionKey}
          type="button"
          className={`pv-tab-btn${activeSectionKey === tab.sectionKey ? " active" : ""}`}
          onClick={() => onSelect(tab.sectionKey)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// ─── Language selector ────────────────────────────────────────
export function ViewerLangSelector({ lang, setLang }) {
  return (
    <div className="viewer-lang-selector">
      {LANGUAGES.map(l => (
        <button key={l.code} onClick={() => { setLang(l.code); localStorage.setItem("dpp_lang", l.code); }}
          className={`viewer-lang-btn${lang === l.code ? " active" : ""}`}>
          {l.flag} {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ─── Scan badge ───────────────────────────────────────────────
export function SignatureBadge({ verification }) {
  if (!verification) return null;
  const { status, signedAt, keyId } = verification;

  const cfg = {
    valid:       { icon: "✅", label: "Signature Valid", tone: "valid" },
    tampered:    { icon: "⚠️", label: "Data Tampered", tone: "danger" },
    invalid:     { icon: "❌", label: "Invalid Signature", tone: "danger" },
    unsigned:    { icon: "🔓", label: "Not Signed", tone: "warning" },
    key_missing: { icon: "🔑", label: "Key Not Found", tone: "warning" },
  }[status] || { icon: "❓", label: status, tone: "neutral" };

  const ts = signedAt ? new Date(signedAt).toLocaleDateString() : null;

  return (
    <div className={`sig-badge sig-badge-${cfg.tone}`}>
      <span className="sig-badge-icon">{cfg.icon}</span>
      <span className="sig-badge-label">{cfg.label}</span>
      {ts && <span className="sig-badge-ts">{ts}</span>}
      {keyId && <span className="sig-badge-key" title={`Key ID: ${keyId}`}>#{keyId.slice(0, 8)}</span>}
    </div>
  );
}

export function ScanBadge({ dppId }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    fetch(`${API}/api/passports/${dppId}/scan-stats`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.total > 0) setCount(d.total); })
      .catch(() => {});
  }, [dppId]);
  if (!count) return null;
  return (
    <div className="viewer-scan-badge">
      📊 {count} unique scan{count !== 1 ? "s" : ""}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────
export function EmptySectionsState() {
  return (
    <section className="pv-section-card pv-section-card-intro">
      <div className="pv-section-head">
        <div>
          <h3>No passport sections available</h3>
        </div>
      </div>
    </section>
  );
}

// ─── Print view ───────────────────────────────────────────────
export function PrintView({ passport, companyData, sections }) {
  const isFileUrl = v => typeof v === "string" && v.startsWith("http");
  const statusLabel = formatPassportStatus(passport.release_status);
  return (
    <div className="print-view">
      <div className="print-header">
        <div className="print-header-left">
        </div>
        <div className="print-header-right">
          <h1 className="print-model-name">{passport.model_name}</h1>
          <div className="print-meta">
            <span><strong>Type:</strong> {passport.passport_type}</span>
            <span><strong>Version:</strong> v{passport.version_number}</span>
            <span><strong>Status:</strong> {statusLabel}</span>
            {passport.product_id && <span><strong>Serial Number:</strong> {passport.product_id}</span>}
            <span><strong>DPP ID:</strong> {passport.dppId}</span>
          </div>
        </div>
      </div>
      {companyData?.introduction_text && (
        <div className="print-section">
          <h2 className="print-section-title">Introduction</h2>
          <p className="print-intro-text">{companyData.introduction_text}</p>
        </div>
      )}
      {sections.map(section => (
        <div key={section.key} className="print-section">
          <h2 className="print-section-title">{section.label}</h2>
          <table className="print-table">
            <tbody>
              {section.fields.map(f => {
                const access   = f.access || ["public"];
                const isPublic = access.includes("public");
                const raw = passport[f.key];
                let display;

                if (!isPublic) {
                  // Non-public fields appear redacted in print unless already unlocked
                  const who = access
                    .filter(a => a !== "public")
                    .map(a => ACCESS_LABEL_MAP[a] || a)
                    .join(", ");
                  display = (
                    <span className="print-restricted-note">
                      🔒 Restricted — accessible by: {who || "authorised parties"}
                    </span>
                  );
                } else if (f.type === "boolean") {
                  display = raw ? "Yes" : "No";
                } else if (f.type === "file" && isFileUrl(raw)) {
                  display = <a href={raw} target="_blank" rel="noopener noreferrer">{raw}</a>;
                } else if (f.type === "table") {
                  let tableData = null;
                  try { tableData = raw ? JSON.parse(raw) : null; } catch {}
                  if (Array.isArray(tableData) && tableData.length > 0) {
                    const cols = f.table_columns || [];
                    display = (
                      <table className="field-table-display">
                        {cols.length > 0 && (
                          <thead>
                            <tr>{cols.map((col, i) => <th key={i}>{col}</th>)}</tr>
                          </thead>
                        )}
                        <tbody>
                          {tableData.map((row, ri) => (
                            <tr key={ri}>
                              {(Array.isArray(row) ? row : []).map((cell, ci) => <td key={ci}>{cell || "—"}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  } else display = "—";
                } else {
                  display = raw || "—";
                }
                return (<tr key={f.key}><th>{f.label}</th><td>{display}</td></tr>);
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="print-footer">Digital Product Passport · Generated {new Date().toLocaleDateString()}</div>
    </div>
  );
}

// ─── Main viewer ──────────────────────────────────────────────
