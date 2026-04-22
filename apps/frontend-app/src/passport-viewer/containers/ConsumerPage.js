import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { getConsumerTheme } from "../../app/providers/ThemeContext";
import { translateFieldValue, translateSchemaLabel } from "../../app/providers/i18n";
import { formatPassportStatus, isReleasedPassportStatus } from "../../passports/utils/passportStatus";
import { authHeaders } from "../../shared/api/authHeaders";
import { buildPreviewTechnicalPassportPath, buildTechnicalPassportPath } from "../../passports/utils/passportRoutes";
import "../styles/PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "";

// ─────────────────────────────────────────────────────────────────────────────
// Viewer Session Helpers
// ─────────────────────────────────────────────────────────────────────────────
const getViewerUserId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    const parsedUserId = Number.parseInt(user?.id, 10);
    return Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Field Formatting Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatFieldValue(field, raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.type === "boolean") return translateFieldValue("en", !!raw, "boolean");
  if (field.type === "table") {
    try {
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows.map(row => Array.isArray(row) ? row.filter(Boolean).join(" | ") : "").filter(Boolean).join(" ; ");
    } catch { return null; }
  }
  if (field.type === "file") return null; // don't show file URLs on consumer page
  return raw;
}

function inferIcon(section, index) {
  const src = `${section?.key || ""} ${section?.label || ""}`.toLowerCase();
  if (src.includes("material") || src.includes("composit")) return "🧪";
  if (src.includes("sustain")) return "🌱";
  if (src.includes("safety")) return "🛡️";
  if (src.includes("perform")) return "📊";
  if (src.includes("repair") || src.includes("care")) return "🎨";
  if (src.includes("supply")) return "🔗";
  if (src.includes("compliance")) return "✅";
  return ["📋", "🧩", "📦", "📘"][index % 4];
}

// ─────────────────────────────────────────────────────────────────────────────
// Battery Consumer View
// ─────────────────────────────────────────────────────────────────────────────
function BatteryConsumerView({ passport, company, typeDef, dynamicValues = {} }) {
  const pType = passport.passport_type || "battery";
  const theme = getConsumerTheme(pType, company?.branding_json);
  const isPreviewView = !!passport?.preview_mode || (!!passport?.guid && !!passport?.previewId);
  const technicalPassportPath = isPreviewView
    ? buildPreviewTechnicalPassportPath({
        companyName: company?.company_name,
        manufacturerName: passport?.manufacturer,
        manufacturedBy: passport?.manufactured_by,
        modelName: passport?.model_name,
        productId: passport?.product_id,
        previewId: passport?.guid,
      })
    : buildTechnicalPassportPath({
        companyName: company?.company_name,
        manufacturerName: passport?.manufacturer,
        manufacturedBy: passport?.manufactured_by,
        modelName: passport?.model_name,
        productId: passport?.product_id,
      });

  const getFieldVal = (keyPatterns) => {
    const sections = typeDef?.fields_json?.sections || typeDef?.sections || [];
    for (const section of sections) {
      for (const f of (section.fields || [])) {
        const match = keyPatterns.some(p =>
          typeof p === "string"
            ? f.key === p || f.label?.toLowerCase().includes(p.toLowerCase())
            : p.test(f.key) || p.test(f.label || "")
        );
        if (match) {
          const raw = f.dynamic ? dynamicValues?.[f.key]?.value : passport?.[f.key];
          return raw || null;
        }
      }
    }
    return null;
  };

  const manufacturer     = company?.company_name || passport.manufacturer || "—";
  const ratedCapacity    = getFieldVal(["capacity", /rated.capacity/i])    || passport.capacity  || "—";
  const batteryChemistry = getFieldVal(["chemistry", /battery.chemistry/i]) || passport.chemistry || "—";
  const stateOfHealth    = getFieldVal([/state.of.health/i,          "state_of_health"]);
  const chargeCycles     = getFieldVal([/charge.*discharge.*cycle/i, /number.*cycle/i, "cycles"]) || passport.cycles;
  const batteryCategory  = getFieldVal([/category/i,                 "category"])                 || passport.category;
  const stateOfCharge    = getFieldVal([/state.of.charge/i,          "state_of_charge"]);
  const symbolLead       = getFieldVal([/symbol.*lead|lead.*symbol/i, "symbols_for_lead"])        || passport.symbols_for_lead;
  const symbolCadmium    = getFieldVal([/symbol.*cadmium|cadmium.*symbol/i, "symbols_for_cadmium"]) || passport.symbols_for_cadmium;

  return (
    <div
      data-theme="light"
      className={`consumer-page consumer-page-${theme.variant || "classic"}`}
      style={{
        "--c-primary": theme.accentColor,
        "--c-grad": theme.gradient,
        "--c-card": theme.cardBg,
        "--c-secondary": theme.secondaryColor || "#132840",
        "--c-surface": theme.accentSurface || "#dce8f0",
      }}
    >

      {/* ── Hero ── */}
      <div className="cp-hero">
        <div className="cp-hero-inner">
          {company?.company_logo && (
            <img src={company.company_logo} alt="Company logo" className="cp-company-logo" />
          )}
          <div className="cp-hero-icon">{theme.icon}</div>
          <div className="cp-hero-type">{theme.headline}</div>
          <h1 className="cp-product-name">{passport.model_name}</h1>
          {passport.product_id && <div className="cp-pid">Serial Number: {passport.product_id}</div>}
          {isReleasedPassportStatus(passport.release_status) && (
            <div className="cp-verified"><span>✅</span> Verified Product Passport</div>
          )}
          <p className="cp-tagline">{theme.tagline}</p>
        </div>
        <div className="cp-hero-pattern" aria-hidden="true">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
            {[0,1,2,3].map(i => <rect key={i} x={20+i*45} y={60} width={30} height={80} rx="5" fill="rgba(255,255,255,0.07)" />)}
            <path d="M 90 40 L 110 40 L 110 60 L 90 60 Z" fill="rgba(255,255,255,0.1)" />
            <path d="M 100 70 L 80 110 L 95 110 L 75 150 L 125 100 L 108 100 Z" fill="rgba(255,255,255,0.15)" />
          </svg>
        </div>
      </div>

      {/* ── Strip ── */}
      <div className="cp-strip">
        <div className="cp-strip-item">
          <div className="cp-strip-label">Manufacturer</div>
          <div className="cp-strip-val">{manufacturer}</div>
        </div>
        <div className="cp-strip-item">
          <div className="cp-strip-label">Rated Capacity</div>
          <div className="cp-strip-val">{ratedCapacity}</div>
        </div>
        <div className="cp-strip-item">
          <div className="cp-strip-label">Battery Chemistry</div>
          <div className="cp-strip-val">{batteryChemistry}</div>
        </div>
      </div>

      {/* ── Body: 3 cards ── */}
      <div className="cp-body">
        {company?.introduction_text && (
          <div className="cp-intro-text"><p>{company.introduction_text}</p></div>
        )}

        <div className="cp-cards-row">

          {/* Card 1 — Battery Information */}
          <div className="cp-info-card">
            <div className="cp-info-card-title">🔋 Battery Information</div>
            <div className="cp-info-card-row">
              <span className="cp-info-label">State of Health</span>
              <span className="cp-info-val">{stateOfHealth || "—"}</span>
            </div>
            <div className="cp-info-card-row">
              <span className="cp-info-label">Charge / Discharge Cycles</span>
              <span className="cp-info-val">{chargeCycles || "—"}</span>
            </div>
          </div>

          {/* Card 2 — Battery State */}
          <div className="cp-info-card">
            <div className="cp-info-card-title">📊 Battery State</div>
            <div className="cp-info-card-row">
              <span className="cp-info-label">Battery Category</span>
              <span className="cp-info-val">{batteryCategory || "—"}</span>
            </div>
            <div className="cp-info-card-row">
              <span className="cp-info-label">State of Charge</span>
              <span className="cp-info-val">{stateOfCharge || "—"}</span>
            </div>
          </div>

          {/* Card 3 — Symbols */}
          <div className="cp-info-card cp-symbols-card">
            <div className="cp-info-card-title">⚠️ Hazardous Material Symbols</div>
            <div className="cp-symbols-row">
              {symbolLead ? (
                <div className="cp-symbol-item">
                  <img src={symbolLead} alt="Symbol for Lead" className="cp-symbol-img" />
                  <span className="cp-symbol-name">Lead (Pb)</span>
                </div>
              ) : (
                <div className="cp-symbol-item cp-symbol-empty">
                  <span className="cp-symbol-placeholder">—</span>
                  <span className="cp-symbol-name">Lead (Pb)</span>
                </div>
              )}
              {symbolCadmium ? (
                <div className="cp-symbol-item">
                  <img src={symbolCadmium} alt="Symbol for Cadmium" className="cp-symbol-img" />
                  <span className="cp-symbol-name">Cadmium (Cd)</span>
                </div>
              ) : (
                <div className="cp-symbol-item cp-symbol-empty">
                  <span className="cp-symbol-placeholder">—</span>
                  <span className="cp-symbol-name">Cadmium (Cd)</span>
                </div>
              )}
            </div>
          </div>

        </div>

        <div className="cp-cta">
          <a href={technicalPassportPath || "#"} className="cp-cta-btn">
            View Full Technical Passport →
          </a>
        </div>

        <div className="cp-footer">
          <div className="cp-footer-brand">🌍 Digital Product Passport System</div>
          <div className="cp-footer-guid">Product ID: {passport.product_id || "—"}</div>
          {theme.companyWebsite && (
            <a className="cp-footer-company-link" href={theme.companyWebsite} target="_blank" rel="noopener noreferrer">
              Visit company website
            </a>
          )}
          <div className="cp-footer-note">Powered by ClarosDPP, digital passport provider via software as a service.</div>
          <a className="cp-footer-support" href="mailto:digitalproductpass@gmail.com">Contact information</a>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic Consumer View
// ─────────────────────────────────────────────────────────────────────────────
function GenericConsumerView({ passport, company, typeDef, dynamicValues }) {
  const [expanded, setExpanded] = useState(null);
  const isPreviewView = !!passport?.preview_mode || (!!passport?.guid && !!passport?.previewId);
  const technicalPassportPath = isPreviewView
    ? buildPreviewTechnicalPassportPath({
        companyName: company?.company_name,
        manufacturerName: passport?.manufacturer,
        manufacturedBy: passport?.manufactured_by,
        modelName: passport?.model_name,
        productId: passport?.product_id,
        previewId: passport?.guid,
      })
    : buildTechnicalPassportPath({
        companyName: company?.company_name,
        manufacturerName: passport?.manufacturer,
        manufacturedBy: passport?.manufactured_by,
        modelName: passport?.model_name,
        productId: passport?.product_id,
      });

  const pType = passport.passport_type || "generic";
  const theme = getConsumerTheme(pType, company?.branding_json);

  const statusLabel = formatPassportStatus(passport.release_status);

  const sections = (typeDef?.fields_json?.sections || typeDef?.sections || [])
    .map((section, index) => {
      const fields = (section.fields || [])
        .filter(f => (f.access || ["public"]).includes("public"))
        .map(f => {
          const raw = f.dynamic ? dynamicValues?.[f.key]?.value : passport?.[f.key];
          const value = formatFieldValue(f, raw);
          return value ? { label: translateSchemaLabel("en", f), value } : null;
        })
        .filter(Boolean);
      return { title: translateSchemaLabel("en", section), fields, icon: inferIcon(section, index) };
    })
    .filter(s => s.fields.length > 0);

  return (
    <div
      data-theme="light"
      className={`consumer-page consumer-page-${theme.variant || "classic"}`}
      style={{
        "--c-primary": theme.accentColor,
        "--c-grad": theme.gradient,
        "--c-card": theme.cardBg,
        "--c-secondary": theme.secondaryColor || "#132840",
        "--c-surface": theme.accentSurface || "#dce8f0",
      }}
    >

      {/* Hero */}
      <div className="cp-hero">
        <div className="cp-hero-inner">
          {company?.company_logo && (
            <img src={company.company_logo} alt="Company logo" className="cp-company-logo" />
          )}
          <div className="cp-hero-icon">{theme.icon}</div>
          <div className="cp-hero-type">{theme.headline}</div>
          <h1 className="cp-product-name">{passport.model_name}</h1>
          {passport.product_id && <div className="cp-pid">Serial Number: {passport.product_id}</div>}
          {isReleasedPassportStatus(passport.release_status) && (
            <div className="cp-verified"><span>✅</span> Verified Product Passport</div>
          )}
          <p className="cp-tagline">{theme.tagline}</p>
        </div>
        <div className="cp-hero-pattern" aria-hidden="true">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
            <circle cx="50" cy="50" r="40" fill="rgba(255,255,255,0.05)" />
            <circle cx="150" cy="150" r="50" fill="rgba(255,255,255,0.04)" />
            <circle cx="160" cy="50" r="25" fill="rgba(255,255,255,0.06)" />
          </svg>
        </div>
      </div>

      {/* Strip */}
      <div className="cp-strip">
        <div className="cp-strip-item">
          <div className="cp-strip-label">Manufacturer</div>
          <div className="cp-strip-val">{company?.company_name || passport.manufacturer || "—"}</div>
        </div>
        <div className="cp-strip-item">
          <div className="cp-strip-label">Version</div>
          <div className="cp-strip-val">v{passport.version_number}</div>
        </div>
        <div className="cp-strip-item">
          <div className="cp-strip-label">Status</div>
          <div className={`cp-strip-val cp-strip-status ${isReleasedPassportStatus(passport.release_status) ? "released" : "pending"}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="cp-body">
        {company?.introduction_text && (
          <div className="cp-intro-text"><p>{company.introduction_text}</p></div>
        )}

        {sections.map((sec, i) => (
          <div key={i} className="cp-section">
            <button className="cp-section-header" onClick={() => setExpanded(expanded === i ? null : i)}>
              <span>{sec.icon} {sec.title}</span>
              <span className="cp-toggle">{expanded === i ? "▲" : "▼"}</span>
            </button>
            {expanded === i && (
              <div className="cp-section-body">
                {sec.fields.map((f, fi) => (
                  <div key={fi} className="cp-field-row">
                    <span className="cp-field-label">{f.label}</span>
                    <span className="cp-field-val">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="cp-cta">
          <a href={technicalPassportPath || "#"} className="cp-cta-btn">
            View Full Technical Passport →
          </a>
        </div>

        <div className="cp-footer">
          <div className="cp-footer-brand">🌍 Digital Product Passport System</div>
          <div className="cp-footer-guid">Product ID: {passport.product_id || "—"}</div>
          {theme.companyWebsite && (
            <a className="cp-footer-company-link" href={theme.companyWebsite} target="_blank" rel="noopener noreferrer">
              Visit company website
            </a>
          )}
          <div className="cp-footer-note">Powered by ClarosDPP, digital passport provider via software as a service.</div>
          <a className="cp-footer-support" href="mailto:digitalproductpass@gmail.com">Contact information</a>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Controller
// ─────────────────────────────────────────────────────────────────────────────
function BatteryConsumerPage({ previewMode = false, previewCompanyId = null }) {
  const { productId, versionNumber, previewId } = useParams();
  const [passport,      setPassport]      = useState(null);
  const [company,       setCompany]       = useState(null);
  const [typeDef,       setTypeDef]       = useState(null);
  const [dynamicValues, setDynamicValues] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");

  useEffect(() => {
    const encodedProductId = encodeURIComponent(productId || "");
    const encodedPreviewId = encodeURIComponent(previewId || "");
    const endpoint = previewMode
      ? `${API}/api/companies/${previewCompanyId}/passports/${encodedPreviewId}/preview`
      : versionNumber
        ? `${API}/api/passports/by-product/${encodedProductId}?version=${encodeURIComponent(versionNumber)}`
        : `${API}/api/passports/by-product/${encodedProductId}`;
    const requestInit = previewMode ? { headers: authHeaders() } : undefined;

    setLoading(true);
    setError("");
    fetch(endpoint, requestInit)
      .then(r => r.ok ? r.json() : Promise.reject("not found"))
      .then(async data => {
        const resolvedPassport = previewMode && data
          ? { ...data, preview_mode: true, previewId: previewId || data.guid }
          : data;
        setPassport(resolvedPassport);
        if (resolvedPassport?.guid && !previewMode) {
          const viewerUserId = getViewerUserId();
          fetch(`${API}/api/passports/${resolvedPassport.guid}/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: viewerUserId,
              referrer: document.referrer,
              userAgent: navigator.userAgent,
            }),
          }).catch(() => {});
        }
        const [companyRes, typeRes, dynamicRes] = await Promise.all([
          resolvedPassport.company_id   ? fetch(`${API}/api/companies/${resolvedPassport.company_id}/profile`)     : Promise.resolve(null),
          resolvedPassport.passport_type ? fetch(`${API}/api/passport-types/${resolvedPassport.passport_type}`)    : Promise.resolve(null),
          resolvedPassport.inactive_public_version || !resolvedPassport.guid
            ? Promise.resolve(null)
            : fetch(`${API}/api/passports/${resolvedPassport.guid}/dynamic-values`),
        ]);
        if (companyRes?.ok)  setCompany(await companyRes.json());
        if (typeRes?.ok)     setTypeDef(await typeRes.json());
        if (dynamicRes?.ok) {
          const d = await dynamicRes.json();
          if (d?.values) setDynamicValues(d.values);
        }
      })
      .catch(() => setError("Passport not found"))
      .finally(() => setLoading(false));
  }, [previewCompanyId, previewId, previewMode, productId, versionNumber]);

  if (loading) return (
    <div className="cp-state-screen cp-state-screen-loading">Loading passport…</div>
  );

  if (error || !passport) return (
    <div className="cp-state-screen cp-state-screen-error">
      <div className="cp-state-icon">🔍</div>
      <h2>Passport not found</h2>
      <p className="cp-state-copy">This QR code may be invalid or the passport has been removed.</p>
    </div>
  );

  const umbrellaCategory = typeDef?.umbrella_category || "";
  const isBattery = /battery/i.test(umbrellaCategory);

  if (isBattery) {
    return (
      <BatteryConsumerView
        passport={passport}
        company={company}
        typeDef={typeDef}
        dynamicValues={dynamicValues}
      />
    );
  }

  return (
    <GenericConsumerView
      passport={passport}
      company={company}
      typeDef={typeDef}
      dynamicValues={dynamicValues}
    />
  );
}

export default BatteryConsumerPage;
