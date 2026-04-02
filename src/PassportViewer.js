import React, { useState, useEffect, useRef } from "react";
import { Routes, Route, useParams, useNavigate, useLocation } from "react-router-dom";
import { PASSPORT_VIEWER_THEME } from "./ThemeContext";
import { LANGUAGES, translateFieldValue, translateSchemaLabel, translateText } from "./i18n";
import { generateQRCode, fetchQRCodeFromDatabase, saveQRCodeToDatabase } from "./QRcode";
import PassportIntro from "./PassportIntro";
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

function Header({ displayName, lang, setLang, guid }) {
  return (
    <header className="viewer-header">
      <div className="viewer-header-inner viewer-header-shell">
        <div>
          <h1>🌍 Digital Product Passport</h1>
          <p>{displayName}</p>
        </div>
        <div className="viewer-header-actions">
          <ScanBadge guid={guid} />
          <ViewerLangSelector lang={lang} setLang={setLang} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="viewer-footer">
      <p>© 2026 Digital Product Passport. All rights reserved.</p>
      <p>Passport data is presented in sector views via sidebar navigation.</p>
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
    <button className="locked-field-btn" onClick={onUnlock}>
      🔒 Provide Access Key
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
  const isFileUrl = v => typeof v === "string" && v.startsWith("http") && v.includes("/passport-files/");

  return (
    <div className="section-view">
      <table className="battery-table">
        <tbody>
          {sectionDef.fields.map(f => {
            const access   = f.access || ["public"];
            const isPublic = access.includes("public");
            const fieldLabel = translateSchemaLabel(lang, f);

            // Restricted field and user hasn't unlocked yet → show lock button
            if (!isPublic && !unlockedPassport) {
              return (
                <tr key={f.key}>
                  <th>{fieldLabel}</th>
                  <td><LockedFieldCell field={f} onUnlock={onRequestUnlock} /></td>
                </tr>
              );
            }

            // Use unlocked passport data if available (it has restricted fields), otherwise public data
            const src = unlockedPassport || passport;
            // Dynamic fields: value comes from live data, not the passport record
            const isDynamic = !!f.dynamic;
            const dynEntry  = isDynamic ? dynamicValues?.[f.key] : null;
            const raw = isDynamic ? (dynEntry?.value ?? null) : src[f.key];
            let display;

            if (f.type === "boolean") {
              display = translateFieldValue(lang, !!raw, "boolean");
            } else if (f.type === "file" && isFileUrl(raw)) {
              display = <FileCell url={raw} label={`${passport.model_name}_${f.key}`} />;
            } else if (f.type === "table") {
              let tableData = null;
              try { tableData = raw ? JSON.parse(raw) : null; } catch {}
              if (Array.isArray(tableData) && tableData.length > 0) {
                const cols = f.table_columns || [];
                display = (
                  <table className="field-table-display">
                    {cols.length > 0 && (
                      <thead>
                        <tr>{cols.map((col, i) => <th key={i}>{translateSchemaLabel(lang, { label: col })}</th>)}</tr>
                      </thead>
                    )}
                    <tbody>
                      {tableData.map((row, ri) => (
                        <tr key={ri}>
                          {(Array.isArray(row) ? row : []).map((cell, ci) => (
                            <td key={ci}>{cell || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              } else {
                display = "—";
              }
            } else {
              display = raw || "—";
            }
            // ── Composition pie chart ──────────────────────────────
            let pieItems = null;
            if (f.composition && raw) {
              if (f.type === "table") {
                pieItems = parseCompositionFromTable(raw);
              } else {
                pieItems = parseCompositionFromText(raw);
              }
            }

            const isExpanded = isDynamic && expandedKey === f.key;
            const cType = chartTypes[f.key] || "line";

            return (
              <React.Fragment key={f.key}>
                <tr className={isDynamic ? "dynamic-field-row" : ""}>
                  <th>
                    {fieldLabel}
                    {isDynamic && <LiveBadge updatedAt={dynEntry?.updatedAt} />}
                    {isDynamic && (
                      <button
                        className={`dyn-expand-btn${isExpanded ? " open" : ""}`}
                        onClick={() => toggleChart(f.key)}
                        title={isExpanded ? "Hide chart" : "Show history chart"}
                      >
                        {isExpanded ? "▲ Hide" : "📈 Chart"}
                      </button>
                    )}
                  </th>
                  <td>{display ?? "—"}</td>
                </tr>

                {/* Inline chart panel */}
                {isExpanded && (
                  <tr className="dyn-chart-row">
                    <td colSpan={2} className="dyn-chart-cell">
                      <div className="dyn-chart-panel">
                        <div className="dyn-chart-toggle">
                          <span className="dyn-chart-toggle-label">Chart</span>
                          <button
                            className={`dyn-toggle-btn${cType === "line" ? " active" : ""}`}
                            onClick={() => setChartType(f.key, "line")}
                          >
                            Line
                          </button>
                          <button
                            className={`dyn-toggle-btn${cType === "histogram" ? " active" : ""}`}
                            onClick={() => setChartType(f.key, "histogram")}
                          >
                            Histogram
                          </button>
                        </div>

                        {history[f.key]?.loading ? (
                          <div className="dyn-chart-loading">Loading history…</div>
                        ) : (
                          <DynamicChart
                            data={history[f.key]?.data || []}
                            chartType={cType}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Composition pie chart — always visible when field has composition flag */}
                {pieItems && (
                  <tr className="composition-chart-row">
                    <td colSpan={2}>
                      <div className="composition-chart-cell">
                        <PieChart items={pieItems} title={fieldLabel} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── File cell with inline PDF preview ───────────────────────
function FileCell({ url, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pdf-viewer-container">
      <div className="pdf-viewer-actions">
        <a href={url} target="_blank" rel="noopener noreferrer" className="pdf-open-link">📄 {label}</a>
        <button className="pdf-toggle-btn" onClick={() => setOpen(o => !o)}>
          {open ? "▲ Hide preview" : "▼ Preview PDF"}
        </button>
      </div>
      {open && <iframe src={url} title={label} className="pdf-iframe" />}
    </div>
  );
}

// ─── Passport sidebar tabs ────────────────────────────────────
function PassportNavBar({ tabs, guid, isLoggedIn, onBack, onPrint, qrCode, qrLoading }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = p => location.pathname.endsWith(p);
  return (
    <aside className="viewer-sidebar">
      <div className="viewer-sidebar-nav-top">
        {isLoggedIn && (
          <button className="sidebar-action-btn" onClick={onBack}>← Back to Dashboard</button>
        )}
        <button className="sidebar-action-btn" onClick={onPrint}>🖨 Print PDF</button>
        <div className="sidebar-qr-box">
          {qrLoading ? (
            <div>Generating QR…</div>
          ) : qrCode ? (
            <img src={qrCode} alt="Passport QR" className="sidebar-qr-img" />
          ) : (
            <div>QR unavailable</div>
          )}
        </div>
      </div>
      <div className="viewer-sidebar-inner">
        {tabs.map(t => (
          <button key={t.path} className={`sidebar-tab${isActive(t.path) ? " active" : ""}`}
            onClick={() => navigate(`/passport/${guid}${t.path}`)}>
            {t.label}
          </button>
        ))}
      </div>
    </aside>
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

// ─── Introduction section (company branding) ──────────────────
function IntroductionSection({ passport }) {
  const [companyData, setCompanyData] = useState(null);
  useEffect(() => {
    if (!passport?.company_id) return;
    fetch(`${API}/api/companies/${passport.company_id}/profile`)
      .then(r => r.ok ? r.json() : null).then(setCompanyData).catch(() => {});
  }, [passport?.company_id]);
  return (
    <div className="introduction-layout">
      <div className="intro-text-col">
        <h2>About This Product</h2>
        <div className="intro-text-body">{companyData?.introduction_text || "No introduction provided."}</div>
      </div>
    </div>
  );
}

// ─── Print view ───────────────────────────────────────────────
function PrintView({ passport, companyData, sections }) {
  const isFileUrl = v => typeof v === "string" && v.startsWith("http") && v.includes("/passport-files/");
  const statusLabel = ["in_revision", "revised"].includes(passport.release_status)
    ? "In Revision"
    : String(passport.release_status || "").split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
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
            {passport.product_id && <span><strong>Product ID:</strong> {passport.product_id}</span>}
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
      headers: { Authorization: "Bearer cookie-session" },
    })
      .then(r => setIsLoggedIn(r.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  useEffect(() => {
    if (!passport?.guid) return;
    (async () => {
      setQrLoading(true);
      try {
        const existing = await fetchQRCodeFromDatabase(passport.guid);
        if (existing) {
          setQrCode(existing);
          return;
        }
        const generated = await generateQRCode(passport.guid);
        if (generated) {
          await saveQRCodeToDatabase(passport.guid, generated, passport.passport_type);
          setQrCode(generated);
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
      headers: { Authorization: "Bearer cookie-session" },
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

  // Build tabs: Introduction + one per section
  const tabs = [
    { path: "/introduction", label: translateText(lang, "introduction") },
    ...sections.map(s => ({ path: `/${s.key}`, label: translateSchemaLabel(lang, s) })),
  ];

  const passportType = passport.passport_type;
  const displayName  = typeDef?.display_name || passportType;
  const theme = PASSPORT_VIEWER_THEME;
  const dashboardBackPath = `/dashboard/passports/${passportType}`;

  return (
    <>
      <div className="no-print">
        <Header displayName={displayName} lang={lang} setLang={setLang} guid={guid} />

        <div className="viewer-layout">
          <PassportNavBar
            tabs={tabs}
            guid={guid}
            isLoggedIn={isLoggedIn}
            onBack={() => navigate(dashboardBackPath)}
            onPrint={() => { setTimeout(() => window.print(), 300); }}
            qrCode={qrCode}
            qrLoading={qrLoading}
          />

          <div className="viewer-content">
            <div className="viewer-topbar">
              <div className="viewer-title">
                <h2>{typeDef?.umbrella_icon || ""} {displayName}</h2>
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
              isLoggedIn={isLoggedIn}
              onBack={() => navigate(dashboardBackPath)}
              onPrint={() => { setTimeout(() => window.print(), 300); }}
              theme={theme}
            />

            <Routes>
              <Route path="/introduction" element={<IntroductionSection passport={passport} />} />
              {sections.map(section => (
                <Route key={section.key} path={`/${section.key}`}
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

        <Footer />
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
    </>
  );
}

export default PassportViewer;
