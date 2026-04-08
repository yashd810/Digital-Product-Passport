import React, { useState, useEffect, useRef } from "react";
import { Routes, Route, useParams, useNavigate, useLocation, Navigate } from "react-router-dom";
import { LANGUAGES, translateFieldValue, translateSchemaLabel } from "./i18n";
import { generateQRCode, saveQRCodeToDatabase } from "./QRcode";
import { getViewerBrandTheme } from "./ThemeContext";
import { formatPassportStatus } from "./passportStatus";
import { authHeaders } from "./authHeaders";
import PassportHistoryModal from "./PassportHistoryModal";
// PassportIntro merged inline — no separate file needed
import { DynamicChart } from "./DynamicChart";
import { PieChart, parseCompositionFromTable, parseCompositionFromText } from "./PieChart";
import "./PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Human-readable labels for each restricted access group
const ACCESS_LABEL_MAP = {
  notified_bodies:     "Notified Bodies",
  market_surveillance: "Market Surveillance Authorities",
  eu_commission:       "The EU Commission",
  legitimate_interest: "Person with Legitimate Interest",
};

function formatReleaseStatus(status) {
  return formatPassportStatus(status);
}

function renderTextBlock(raw, className = "") {
  return (
    <div className={className}>
      {String(raw)
        .split(/\n+/)
        .filter(Boolean)
        .map((line, index) => (
          <p key={index}>{line}</p>
        ))}
    </div>
  );
}

function isHeroSummaryField(field, fieldLabel = "") {
  const key = String(field?.key || "").toLowerCase();
  const label = String(fieldLabel || field?.label || "").toLowerCase();

  if ([
    "guid",
    "product_id",
    "passport_identifier",
    "unique_passport_identifier",
    "manufactured_date",
    "manufacture_date",
    "manufacturing_date",
    "date_of_manufacture",
    "battery_identifier",
    "unique_battery_identifier",
    "battery_mass",
    "battery_weight",
    "weight",
    "serial_number",
    "battery_serial_number",
    "carbon_footprint_label_and_performance_class",
    "battery_chemistry",
    "manufacturer",
    "manufactured_by",
  ].includes(key)) {
    return true;
  }

  return (
    label === "guid" ||
    label.includes("passport identifier") ||
    label.includes("manufactured date") ||
    label.includes("manufacturing date") ||
    label.includes("manufacture date") ||
    label.includes("date of manufacture") ||
    label.includes("battery identifier") ||
    label.includes("battery mass") ||
    label.includes("battery weight") ||
    label === "weight" ||
    label.includes("product id") ||
    label.includes("battery serial") ||
    label.includes("serial number") ||
    label.includes("carbon footprint label and performance class") ||
    label.includes("battery chemistry") ||
    label.includes("manufacturer") ||
    label.includes("manufactured by")
  );
}

function toInlineText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLinkLabel(value) {
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(href).hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

function getFieldPresentation(field, raw, isLocked, pieItems) {
  if (isLocked) return { tone: "restricted", eyebrow: "Protected data" };
  if (field.type === "file") return { tone: "document", eyebrow: "Evidence file" };
  if (field.type === "table") return { tone: "table", eyebrow: "Structured data" };
  if (pieItems) return { tone: "composition", eyebrow: "Composition" };
  if (field.dynamic) return { tone: "live", eyebrow: "Live metric" };
  if (field.type === "url") return { tone: "link", eyebrow: "Reference link" };
  if (field.type === "symbol") return { tone: "symbol", eyebrow: "Visual marker" };
  if (field.type === "boolean") return { tone: "status", eyebrow: "Status" };
  if (typeof raw === "string" && (raw.includes("\n") || raw.length > 120)) {
    return { tone: "narrative", eyebrow: "Detailed information" };
  }
  return { tone: "data", eyebrow: "" };
}

function getSummaryValue(field, raw, isLocked, lang) {
  if (isLocked) return "Restricted";
  if (field.type === "boolean") return translateFieldValue(lang, !!raw, "boolean");
  if (field.type === "file") return raw ? "Document available" : "No file";
  if (field.type === "table") {
    const rowCount = Array.isArray(raw) ? raw.length : null;
    return rowCount ? `${rowCount} rows` : "Table data";
  }
  if (field.type === "url" && raw) return formatLinkLabel(raw);
  if (raw === 0) return "0";
  if (!raw) return "Not provided";
  const text = toInlineText(raw);
  return text.length > 58 ? `${text.slice(0, 58).trim()}…` : text;
}

function shouldFeatureInSummary(field, raw, isLocked, pieItems) {
  if (field.type === "file" || field.type === "table" || field.type === "symbol" || pieItems) {
    return false;
  }
  if (isLocked) return true;
  if (raw === 0) return true;
  if (!raw) return false;
  if (field.type === "boolean" || field.type === "url" || field.dynamic) return true;
  const text = toInlineText(raw);
  return !!text && text.length <= 72;
}

function getSummaryHint(field, isLocked, isDynamic, tone) {
  if (isLocked) return "Unlock with an access key to view this value.";
  if (isDynamic) return "This value refreshes from live field updates.";
  if (field.type === "url") return "Reference link available for this field.";
  if (field.type === "boolean") return "Quick compliance-style status indicator.";
  if (tone === "narrative") return "Expanded context is available in the detail card below.";
  return "Highlighted here for faster scanning.";
}

// ─── Passport intro card (merged from PassportIntro.js) ──────
function PassportIntro({ passport, companyData, displayName, qrCode, qrLoading, onPrint, onOpenHistory }) {
  if (!passport) return null;
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
    { label: "Unique Passport Identifier", value: passport.guid || "—" },
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
        </div>
      </aside>
    </section>
  );
}

function Header({ displayName, lang, setLang, guid, companyData, brandTheme }) {
  return (
    <header className="viewer-header">
      <div className="viewer-header-inner viewer-header-shell">
        <div>
          <h1>{brandTheme?.title || "Digital Product Passport"}</h1>
          <p>{companyData?.company_name ? `${companyData.company_name} · ${displayName}` : displayName}</p>
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
          <ScanBadge guid={guid} />
          <ViewerLangSelector lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  );
}

function Footer({ brandTheme }) {
  const supportHref = brandTheme?.supportLink || "mailto:digitalproductpass@gmail.com";
  const supportLabel = supportHref.startsWith("mailto:") ? "Contact information" : "Support";
  return (
    <footer className="viewer-footer">
      <p className="viewer-footer-provider">{brandTheme?.footerText || "Powered by ClarosDPP, digital passport provider via software as a service."}</p>
      <p className="viewer-footer-subtle">
        <a href={supportHref} className="viewer-footer-link">{supportLabel}</a>
      </p>
    </footer>
  );
}

// ─── Locked field cell ───────────────────────────────────────
// Shown for restricted fields when no valid access key has been entered yet
function LockedFieldCell({ field, onUnlock }) {
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

// ─── Live badge + relative timestamp ─────────────────────────
function LiveBadge({ updatedAt }) {
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

// ─── Section view ────────────────────────────────────────────
// unlockedPassport: full passport data returned after a valid access key (null = not unlocked)
// onRequestUnlock: callback to open the unlock form
// dynamicValues: { fieldKey: { value, updatedAt } }
function SectionView({ sectionDef, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang }) {
  const [expandedKey, setExpandedKey] = useState(null);   // which dynamic field is open
  const [chartTypes,  setChartTypes]  = useState({});     // { [fieldKey]: "line"|"histogram" }
  const [history,     setHistory]     = useState({});     // { [fieldKey]: { data, loading } }

  const toggleChart = async (fieldKey) => {
    if (expandedKey === fieldKey) { setExpandedKey(null); return; }
    setExpandedKey(fieldKey);
    if (!history[fieldKey]) {
      setHistory(p => ({ ...p, [fieldKey]: { data: [], loading: true } }));
      try {
        const r = await fetch(`${API}/api/passports/${passport.guid}/dynamic-values/${fieldKey}/history?limit=500`);
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
    const longText =
      typeof raw === "string" &&
      (raw.includes("\n") || raw.length > 120) &&
      f.type !== "table" &&
      f.type !== "file" &&
      !pieItems;
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
    <section className="pv-section-card">
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
function FileCell({ url, label }) {
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
function PassportTabRail({ tabs, guid }) {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = `/passport/${guid}`;
  const pathName = location.pathname.replace(/\/+$/, "");

  const isActive = (path) => {
    if (path === "/introduction") {
      return pathName === basePath || pathName === `${basePath}/introduction`;
    }
    return pathName.endsWith(path);
  };

  return (
    <nav className="pv-tab-rail" aria-label="Passport sections">
      {tabs.map(tab => (
        <button
          key={tab.path}
          type="button"
          className={`pv-tab-btn${isActive(tab.path) ? " active" : ""}`}
          onClick={() => navigate(`/passport/${guid}${tab.path}`)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// ─── Language selector ────────────────────────────────────────
function ViewerLangSelector({ lang, setLang }) {
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
function SignatureBadge({ verification }) {
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

function ScanBadge({ guid }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    fetch(`${API}/api/passports/${guid}/scan-stats`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.total > 0) setCount(d.total); })
      .catch(() => {});
  }, [guid]);
  if (!count) return null;
  return (
    <div className="viewer-scan-badge">
      📊 {count} scan{count !== 1 ? "s" : ""}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────
function EmptySectionsState() {
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
function PrintView({ passport, companyData, sections }) {
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
            <span><strong>GUID:</strong> {passport.guid}</span>
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
function PassportViewer() {
  const { guid }   = useParams();
  const navigate   = useNavigate();
  const printRef   = useRef(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [lang,             setLang]             = useState(() => localStorage.getItem("dpp_lang") || "en");
  const [passport,         setPassport]         = useState(null);
  const [companyData,      setCompanyData]      = useState(null);
  const [typeDef,          setTypeDef]          = useState(null);
  const [qrCode,           setQrCode]           = useState(null);
  const [qrLoading,        setQrLoading]        = useState(true);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState("");

  // Dynamic field values — live data polled independently
  const [dynamicValues, setDynamicValues] = useState({});

  // Signature verification
  const [sigVerification, setSigVerification] = useState(null);

  // Access-control state
  const [unlockedPassport,  setUnlockedPassport]  = useState(null);   // full data after valid key
  const [showAccessForm,    setShowAccessForm]    = useState(false);  // unlock modal visible?
  const [accessKeyInput,    setAccessKeyInput]    = useState("");
  const [accessError,       setAccessError]       = useState("");
  const [unlocking,         setUnlocking]         = useState(false);
  const [passportAccessKey, setPassportAccessKey] = useState(null);   // key shown to logged-in users
  const [keyCopied,         setKeyCopied]         = useState(false);
  const [showHistoryModal,  setShowHistoryModal]  = useState(false);

  useEffect(() => {
    if (!guid) return;
    (async () => {
      try {
        // 1. Fetch the passport record
        const r = await fetch(`${API}/api/passports/${guid}`);
        if (!r.ok) throw new Error("Passport not found");
        const data = await r.json();
        setPassport(data);

        // 2. Fetch company branding in parallel with type definition
        const [profileRes, typeRes] = await Promise.all([
          data.company_id
            ? fetch(`${API}/api/companies/${data.company_id}/profile`)
            : Promise.resolve(null),
          fetch(`${API}/api/passport-types/${data.passport_type}`),
        ]);

        if (profileRes?.ok) setCompanyData(await profileRes.json());
        if (typeRes.ok) {
          setTypeDef(await typeRes.json());
        } else {
          // Graceful fallback: empty sections
          setTypeDef({ sections: [] });
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [guid]);

  useEffect(() => {
    fetch(`${API}/api/users/me`, {
      headers: authHeaders(),
    })
      .then(r => setIsLoggedIn(r.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  useEffect(() => {
    if (!passport?.guid) return;
    (async () => {
      setQrLoading(true);
      try {
        const generated = await generateQRCode(passport.guid);
        if (generated) {
          setQrCode(generated);
          try {
            await saveQRCodeToDatabase(passport.guid, generated, passport.passport_type);
          } catch {}
        }
      } catch (e) {
        setQrCode(null);
      } finally {
        setQrLoading(false);
      }
    })();
  }, [passport?.guid, passport?.passport_type]);

  // Fetch + poll dynamic field values every 30 s
  useEffect(() => {
    if (!passport?.guid) return;
    const fetchDynamic = () =>
      fetch(`${API}/api/passports/${passport.guid}/dynamic-values`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.values) setDynamicValues(d.values); })
        .catch(() => {});
    fetchDynamic();
    const timer = setInterval(fetchDynamic, 30000);
    return () => clearInterval(timer);
  }, [passport?.guid]);

  // Fetch signature verification for released passports
  useEffect(() => {
    if (!passport?.guid || passport?.release_status !== "released") return;
    fetch(`${API}/api/passports/${passport.guid}/signature`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSigVerification(d); })
      .catch(() => {});
  }, [passport?.guid, passport?.release_status]);

  // Fetch the access key so logged-in company users can share it with authorised parties
  useEffect(() => {
    if (!isLoggedIn || !passport?.guid || !passport?.company_id) return;
    fetch(`${API}/api/companies/${passport.company_id}/passports/${passport.guid}/access-key`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.accessKey) setPassportAccessKey(d.accessKey); })
      .catch(() => {});
  }, [passport?.guid, passport?.company_id, isLoggedIn]);

  const handleUnlock = async () => {
    if (!accessKeyInput.trim()) return;
    setUnlocking(true);
    setAccessError("");
    try {
      const r = await fetch(`${API}/api/passports/${guid}/unlock`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accessKey: accessKeyInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Invalid access key");
      setUnlockedPassport(d.passport);
      setShowAccessForm(false);
      setAccessKeyInput("");
    } catch (e) {
      setAccessError(e.message);
    } finally {
      setUnlocking(false);
    }
  };

  if (loading) return <div className="loading">Loading passport…</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!passport) return null;

  const sections = typeDef?.fields_json?.sections || typeDef?.sections || [];
  const firstSectionKey = sections[0]?.key || null;

  const tabs = sections.map(s => ({ path: `/${s.key}`, label: translateSchemaLabel(lang, s) }));

  const passportType = passport.passport_type;
  const displayName  = typeDef?.display_name || passportType;
  const brandTheme = getViewerBrandTheme(companyData?.branding_json);

  return (
    <div
      data-theme="light"
      className={`viewer-brand-shell viewer-variant-${brandTheme.variant || "classic"}`}
      style={brandTheme.style}
    >
      <div className="no-print">
        <Header displayName={displayName} lang={lang} setLang={setLang} guid={guid} companyData={companyData} brandTheme={brandTheme} />

        <div className="viewer-content">
          <div className="viewer-shell">
            <div className="viewer-topbar">
              <div className="viewer-title">
                <h2>{typeDef?.umbrella_icon || ""} {displayName}</h2>
                <p className="viewer-subtitle">Public passport viewer</p>
              </div>
              <SignatureBadge verification={sigVerification} />
            </div>

            {/* Access key info bar — only visible to logged-in company users */}
            {isLoggedIn && passportAccessKey && (
              <div className="access-key-bar">
                <span className="access-key-bar-icon">🔑</span>
                <div className="access-key-bar-text">
                  <strong>Passport Access Key</strong>
                  <span className="access-key-bar-hint">
                    Share this key with authorised parties (Notified Bodies, EU Commission, etc.) so they can view restricted fields on the public passport page.
                  </span>
                </div>
                <code className="access-key-bar-code">{passportAccessKey}</code>
                <button
                  className="access-key-bar-copy"
                  onClick={() => {
                    navigator.clipboard.writeText(passportAccessKey);
                    setKeyCopied(true);
                    setTimeout(() => setKeyCopied(false), 2000);
                  }}
                >
                  {keyCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            )}

            {/* Unlocked banner — shown after successful key entry */}
            {unlockedPassport && (
              <div className="access-unlocked-bar">
                ✅ Restricted fields are now visible. Access granted to authorised view.
                <button className="access-relock-btn" onClick={() => setUnlockedPassport(null)}>
                  🔒 Re-lock
                </button>
              </div>
            )}

            <PassportIntro
              passport={passport}
              companyData={companyData}
              displayName={displayName}
              qrCode={qrCode}
              qrLoading={qrLoading}
              onOpenHistory={() => setShowHistoryModal(true)}
              onPrint={() => { setTimeout(() => window.print(), 300); }}
            />

            <PassportTabRail tabs={tabs} guid={guid} />

            <div className="viewer-route-panel">
              <Routes>
                {firstSectionKey ? (
                  <>
                    <Route index element={<Navigate to={`/passport/${guid}/${firstSectionKey}`} replace />} />
                    <Route path="introduction" element={<Navigate to={`/passport/${guid}/${firstSectionKey}`} replace />} />
                  </>
                ) : (
                  <Route index element={<EmptySectionsState />} />
                )}
                {sections.map(section => (
                  <Route key={section.key} path={section.key}
                    element={
                      <SectionView
                        sectionDef={section}
                        passport={passport}
                        unlockedPassport={unlockedPassport}
                        onRequestUnlock={() => setShowAccessForm(true)}
                        dynamicValues={dynamicValues}
                        lang={lang}
                      />
                    }
                  />
                ))}
              </Routes>
            </div>
          </div>
        </div>

        <Footer brandTheme={brandTheme} />
      </div>

      <div className="print-only" ref={printRef}>
        <PrintView passport={passport} companyData={companyData} sections={sections} />
      </div>

      {/* ── Access Key Unlock Modal ── */}
      {showAccessForm && (
        <div className="access-unlock-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAccessForm(false); }}>
          <div className="access-unlock-modal">
            <button className="access-unlock-close" onClick={() => { setShowAccessForm(false); setAccessError(""); setAccessKeyInput(""); }}>✕</button>
            <div className="access-unlock-icon">🔒</div>
            <h3 className="access-unlock-title">Restricted Data</h3>
            <p className="access-unlock-desc">
              This field is restricted to authorised parties only. Enter the access key provided by the manufacturer to view it.
            </p>
            <input
              type="text"
              value={accessKeyInput}
              onChange={e => { setAccessKeyInput(e.target.value); setAccessError(""); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="Enter access key"
              className="access-unlock-input"
              autoFocus
            />
            {accessError && <div className="access-unlock-error">{accessError}</div>}
            <div className="access-unlock-actions">
              <button className="access-unlock-btn cancel" onClick={() => { setShowAccessForm(false); setAccessError(""); setAccessKeyInput(""); }}>
                Cancel
              </button>
              <button className="access-unlock-btn submit" onClick={handleUnlock} disabled={unlocking || !accessKeyInput.trim()}>
                {unlocking ? "Verifying…" : "Unlock"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <PassportHistoryModal
          guid={guid}
          passportType={passport.passport_type}
          mode="public"
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
}

export default PassportViewer;
