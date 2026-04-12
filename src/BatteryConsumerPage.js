import React from "react";
import { getConsumerTheme } from "./ThemeContext";
import { buildPreviewTechnicalPassportPath, buildTechnicalPassportPath } from "./passportRoutes";
import "./PassportViewer.css";

function BatteryConsumerPage({ passport, company, typeDef, dynamicValues = {} }) {
  const pType = passport.passport_type || "battery";
  const theme = getConsumerTheme(pType, company?.branding_json);
  const technicalPassportPath = passport?.preview_mode
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
  // Helper: search typeDef sections for a field by key or label pattern
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
          {passport.release_status === "released" && (
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

export default BatteryConsumerPage;
