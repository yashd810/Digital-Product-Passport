import React, { useState } from "react";
import { getConsumerTheme } from "./ThemeContext";
import { translateFieldValue, translateSchemaLabel } from "./i18n";
import { formatPassportStatus } from "./passportStatus";
import "./PassportViewer.css";

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

function GenericConsumerPage({ passport, company, typeDef, dynamicValues }) {
  const [expanded, setExpanded] = useState(null);

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
          {passport.release_status === "released" && (
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
          <div className={`cp-strip-val cp-strip-status ${passport.release_status === "released" ? "released" : "pending"}`}>
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
          <a href={`/passport/${passport.guid}`} className="cp-cta-btn">
            View Full Technical Passport →
          </a>
        </div>

        <div className="cp-footer">
          <div className="cp-footer-brand">🌍 Digital Product Passport System</div>
          <div className="cp-footer-guid">GUID: {passport.guid.substring(0, 8)}…</div>
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

export default GenericConsumerPage;
