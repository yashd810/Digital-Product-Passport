import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CONSUMER_PAGE_THEMES } from "./ThemeContext";
import { translateFieldValue, translateSchemaLabel, useI18n } from "./i18n";
import "./PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function ConsumerPage() {
  const { guid }       = useParams();
  const { lang }       = useI18n();
  const [passport,  setPassport]  = useState(null);
  const [company,   setCompany]   = useState(null);
  const [typeDef,   setTypeDef]   = useState(null);
  const [dynamicValues, setDynamicValues] = useState({});
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [expanded,  setExpanded]  = useState(null);

  useEffect(() => {
    // Track scan
    fetch(`${API}/api/passports/${guid}/scan`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ referrer: document.referrer, userAgent: navigator.userAgent }),
    }).catch(() => {});

    // Load passport
    fetch(`${API}/api/passports/${guid}`)
      .then(r => r.ok ? r.json() : Promise.reject("not found"))
      .then(async data => {
        setPassport(data);
        const [companyRes, typeRes, dynamicRes] = await Promise.all([
          data.company_id ? fetch(`${API}/api/companies/${data.company_id}/profile`) : Promise.resolve(null),
          data.passport_type ? fetch(`${API}/api/passport-types/${data.passport_type}`) : Promise.resolve(null),
          fetch(`${API}/api/passports/${guid}/dynamic-values`),
        ]);

        if (companyRes?.ok) setCompany(await companyRes.json());
        if (typeRes?.ok) setTypeDef(await typeRes.json());
        if (dynamicRes.ok) {
          const dynamicData = await dynamicRes.json();
          if (dynamicData?.values) setDynamicValues(dynamicData.values);
        }
      })
      .catch(() => setError("Passport not found"))
      .finally(() => setLoading(false));
  }, [guid]);

  if (loading) return (
    <div className="cp-state-screen cp-state-screen-loading">
      Loading passport…
    </div>
  );

  if (error || !passport) return (
    <div className="cp-state-screen cp-state-screen-error">
      <div className="cp-state-icon">🔍</div>
      <h2>Passport not found</h2>
      <p className="cp-state-copy">This QR code may be invalid or the passport has been removed.</p>
    </div>
  );

  const pType   = passport.passport_type || "battery";
  const theme   = CONSUMER_PAGE_THEMES[pType] || CONSUMER_PAGE_THEMES.battery;
  const statusLabel = ["in_revision", "revised"].includes(passport.release_status)
    ? "In Revision"
    : String(passport.release_status || "").split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

  // Build highlight sections based on type
  const highlights = buildHighlights(passport, pType, lang);
  const schemaSections = buildSchemaSections(passport, typeDef, dynamicValues, lang);
  const sections = schemaSections.length > 0 ? schemaSections : buildSections(passport, pType, lang);

  return (
    <div className="consumer-page" style={{ "--c-primary":theme.accentColor, "--c-grad":theme.gradient, "--c-card":theme.cardBg }}>
      {/* Hero header */}
      <div className="cp-hero">
        <div className="cp-hero-inner">
          {company?.company_logo && (
            <img src={company.company_logo} alt="Company logo" className="cp-company-logo" />
          )}
          <div className="cp-hero-icon">{theme.icon}</div>
          <div className="cp-hero-type">{theme.headline}</div>
          <h1 className="cp-product-name">{passport.model_name}</h1>
          {passport.product_id && (
            <div className="cp-pid">Product ID: {passport.product_id}</div>
          )}
          {/* Verified badge */}
          {passport.release_status === "released" && (
            <div className="cp-verified">
              <span>✅</span> Verified Product Passport
            </div>
          )}
          <p className="cp-tagline">{theme.tagline}</p>
        </div>
        {/* SVG pattern decoration */}
        <div className="cp-hero-pattern" aria-hidden="true">
          {renderPattern(pType)}
        </div>
      </div>

      {/* Quick info strip */}
      <div className="cp-strip">
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
        {company && (
          <div className="cp-strip-item">
            <div className="cp-strip-label">Manufacturer</div>
            <div className="cp-strip-val">{company.company_name}</div>
          </div>
        )}
        {passport.manufacturer && (
          <div className="cp-strip-item">
            <div className="cp-strip-label">Brand</div>
            <div className="cp-strip-val">{passport.manufacturer}</div>
          </div>
        )}
      </div>

      {/* Highlights grid */}
      <div className="cp-body">
        {company?.introduction_text && (
          <div className="cp-intro-text">
            <p>{company.introduction_text}</p>
          </div>
        )}

        <div className="cp-highlights">
          {highlights.map((h, i) => (
            <div key={i} className="cp-highlight-card">
              <div className="cp-h-icon">{h.icon}</div>
              <div className="cp-h-label">{h.label}</div>
              <div className="cp-h-val">{h.value || "—"}</div>
            </div>
          ))}
        </div>

        {/* Expandable sections */}
        {sections.map((sec, i) => (
          <div key={i} className="cp-section">
            <button className="cp-section-header" onClick={() => setExpanded(expanded === i ? null : i)}>
              <span>{sec.icon} {sec.title}</span>
              <span className="cp-toggle">{expanded === i ? "▲" : "▼"}</span>
            </button>
            {expanded === i && (
              <div className="cp-section-body">
                {sec.fields.map((f, fi) => f.value && (
                  <div key={fi} className="cp-field-row">
                    <span className="cp-field-label">{f.label}</span>
                    <span className="cp-field-val">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* CTA */}
        <div className="cp-cta">
          <a href={`/passport/${guid}/introduction`} className="cp-cta-btn">
            View Full Technical Passport →
          </a>
        </div>

        <div className="cp-footer">
          <div className="cp-footer-brand">
            🌍 Digital Product Passport System
          </div>
          <div className="cp-footer-guid">
            GUID: {passport.guid.substring(0,8)}…
          </div>
        </div>
      </div>
    </div>
  );
}

function translateLooseLabel(lang, label) {
  return translateSchemaLabel(lang, { label });
}

function buildHighlights(p, type, lang) {
  const map = {
    battery: [
      { icon:"⚡", label:translateLooseLabel(lang, "Chemistry"),  value: p.chemistry },
      { icon:"🔋", label:translateLooseLabel(lang, "Capacity"),   value: p.capacity  },
      { icon:"🌡️", label:translateLooseLabel(lang, "Voltage"),    value: p.voltage   },
      { icon:"♻️", label:translateLooseLabel(lang, "Recycled Li"), value: p.lithium  },
      { icon:"🌱", label:translateLooseLabel(lang, "Carbon class"),value: p.cf_class  },
      { icon:"🏭", label:translateLooseLabel(lang, "Facility"),   value: p.facility   },
    ],
    textile: [
      { icon:"🧵", label:translateLooseLabel(lang, "Fibres"),       value: p.fiber_composition },
      { icon:"♻️", label:translateLooseLabel(lang, "Recycled"),     value: p.recycled_content_pct ? `${p.recycled_content_pct}%` : null },
      { icon:"✅", label:translateLooseLabel(lang, "Organic"),      value: p.organic_certified ? translateFieldValue(lang, true, "boolean") : null },
      { icon:"🌍", label:translateLooseLabel(lang, "Origin"),       value: p.country_of_origin },
      { icon:"🌊", label:translateLooseLabel(lang, "Water usage"),  value: p.water_usage },
      { icon:"🏷️", label:translateLooseLabel(lang, "Brand"),        value: p.brand },
    ],
    steel: [
      { icon:"⚙️", label:translateLooseLabel(lang, "Grade"),        value: p.steel_grade },
      { icon:"📐", label:translateLooseLabel(lang, "Standard"),     value: p.standard },
      { icon:"💪", label:translateLooseLabel(lang, "Tensile str."), value: p.tensile_strength },
      { icon:"♻️", label:translateLooseLabel(lang, "Recycled"),     value: p.recycled_content_pct ? `${p.recycled_content_pct}%` : null },
      { icon:"🌍", label:translateLooseLabel(lang, "Origin"),       value: p.country_of_origin },
      { icon:"🌱", label:translateLooseLabel(lang, "CO₂/tonne"),   value: p.co2_per_tonne },
    ],
    toys: [
      { icon:"🧸", label:translateLooseLabel(lang, "Category"),     value: p.toy_category },
      { icon:"👶", label:translateLooseLabel(lang, "Age range"),    value: p.age_range },
      { icon:"✅", label:translateLooseLabel(lang, "CE Marked"),    value: p.ce_marking ? translateFieldValue(lang, true, "boolean") : null },
      { icon:"🧪", label:translateLooseLabel(lang, "Phthalate-free"),value: p.phthalates_free ? translateFieldValue(lang, true, "boolean") : null },
      { icon:"🌍", label:translateLooseLabel(lang, "Origin"),       value: p.country_of_origin },
      { icon:"🛡️", label:translateLooseLabel(lang, "EN71"),         value: p.en71_compliant ? translateLooseLabel(lang, "Compliant") : null },
    ],
    construction: [
      { icon:"🏗️", label:translateLooseLabel(lang, "Product type"),  value: p.product_category },
      { icon:"🔥", label:translateLooseLabel(lang, "Fire resist."),  value: p.fire_resistance },
      { icon:"💪", label:translateLooseLabel(lang, "Mech. strength"),value: p.mechanical_strength },
      { icon:"♻️", label:translateLooseLabel(lang, "Recycled"),      value: p.recycled_content_pct ? `${p.recycled_content_pct}%` : null },
      { icon:"🌱", label:translateLooseLabel(lang, "Carbon"),        value: p.carbon_footprint },
      { icon:"📅", label:translateLooseLabel(lang, "Design life"),   value: p.design_working_life },
    ],
  };
  return (map[type] || []).filter(h => h.value);
}

function buildSections(p, type, lang) {
  const all = {
    battery: [
      { icon:"🧪", title:"Materials",   fields:[
        { label:translateLooseLabel(lang, "Cathode"),     value: p.cathode },
        { label:translateLooseLabel(lang, "Anode"),       value: p.anode },
        { label:translateLooseLabel(lang, "Electrolyte"), value: p.electrolyte },
      ]},
      { icon:"🌱", title:"Sustainability", fields:[
        { label:translateLooseLabel(lang, "Sustainability"), value: p.sustainability },
        { label:translateLooseLabel(lang, "Due diligence"),  value: p.due_diligence  },
      ]},
    ],
    textile: [
      { icon:"🎨", title:"Care & Repair", fields:[
        { label:translateLooseLabel(lang, "Washing"),  value: p.washing_instructions },
        { label:translateLooseLabel(lang, "Drying"),   value: p.drying_instructions  },
        { label:translateLooseLabel(lang, "Repair"),   value: p.repair_info          },
      ]},
      { icon:"🌱", title:"Sustainability", fields:[
        { label:translateLooseLabel(lang, "Certifications"),  value: p.certifications     },
        { label:translateLooseLabel(lang, "Recyclability"),   value: p.recyclability_info },
        { label:translateLooseLabel(lang, "End of life"),     value: p.end_of_life_options },
      ]},
    ],
    steel: [
      { icon:"🔬", title:"Composition", fields:[
        { label:translateLooseLabel(lang, "Chemical"),   value: p.chemical_composition },
        { label:translateLooseLabel(lang, "Carbon"),     value: p.carbon_content       },
        { label:translateLooseLabel(lang, "Alloying"),   value: p.alloying_elements    },
      ]},
    ],
    toys: [
      { icon:"🛡️", title:"Safety Info", fields:[
        { label:translateLooseLabel(lang, "Choking hazard"), value: p.choking_hazard_info },
        { label:translateLooseLabel(lang, "Safety warnings"),value: p.safety_warnings    },
      ]},
    ],
    construction: [
      { icon:"🏗️", title:"Performance", fields:[
        { label:translateLooseLabel(lang, "Thermal"),   value: p.thermal_performance  },
        { label:translateLooseLabel(lang, "Acoustic"),  value: p.acoustic_performance },
        { label:translateLooseLabel(lang, "Durability"),value: p.durability_class     },
      ]},
      { icon:"🌱", title:"Sustainability", fields:[
        { label:translateLooseLabel(lang, "Recyclability"), value: p.recyclability },
        { label:translateLooseLabel(lang, "End of life"),   value: p.end_of_life   },
      ]},
    ],
  };
  return (all[type] || []).map(section => ({
    ...section,
    title: translateLooseLabel(lang, section.title),
  })).filter(s => s.fields.some(f => f.value));
}

function inferSectionIcon(section, index) {
  const source = `${section?.key || ""} ${section?.label || ""}`.toLowerCase();
  if (source.includes("material")) return "🧪";
  if (source.includes("sustain")) return "🌱";
  if (source.includes("safety")) return "🛡️";
  if (source.includes("composit")) return "🔬";
  if (source.includes("perform")) return "🏗️";
  if (source.includes("repair") || source.includes("care")) return "🎨";
  return ["📋", "🧩", "📦", "📘"][index % 4];
}

function formatConsumerFieldValue(field, raw, lang) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.type === "boolean") return translateFieldValue(lang, !!raw, "boolean");
  if (field.type === "table") {
    try {
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows
        .map((row) => Array.isArray(row) ? row.filter(Boolean).join(" | ") : "")
        .filter(Boolean)
        .join(" ; ");
    } catch {
      return null;
    }
  }
  if (field.type === "file" && typeof raw === "string") {
    return raw.split("/").pop() || raw;
  }
  return raw;
}

function buildSchemaSections(passport, typeDef, dynamicValues, lang) {
  const sections = typeDef?.fields_json?.sections || typeDef?.sections || [];

  return sections.map((section, index) => {
    const fields = (section.fields || [])
      .filter((field) => (field.access || ["public"]).includes("public"))
      .map((field) => {
        const raw = field.dynamic ? dynamicValues?.[field.key]?.value : passport?.[field.key];
        const value = formatConsumerFieldValue(field, raw, lang);
        if (!value) return null;
        return {
          label: translateSchemaLabel(lang, field),
          value,
        };
      })
      .filter(Boolean);

    return {
      icon: inferSectionIcon(section, index),
      title: translateSchemaLabel(lang, section),
      fields,
    };
  }).filter(section => section.fields.length > 0);
}

function renderPattern(type) {
  const patterns = {
    battery: (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
        {[0,1,2,3].map(i=><rect key={i} x={20+i*45} y={60} width={30} height={80} rx="5" fill="rgba(255,255,255,0.07)"/>)}
        <path d="M 90 40 L 110 40 L 110 60 L 90 60 Z" fill="rgba(255,255,255,0.1)"/>
        <path d="M 100 70 L 80 110 L 95 110 L 75 150 L 125 100 L 108 100 Z" fill="rgba(255,255,255,0.15)"/>
      </svg>
    ),
    textile: (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
        {Array.from({length:5}).map((_,i)=>
          Array.from({length:5}).map((_,j)=>
            <circle key={`${i}-${j}`} cx={20+i*40} cy={20+j*40} r="3" fill="rgba(255,255,255,0.08)"/>
          )
        )}
        <path d="M 0 100 Q 50 80 100 100 Q 150 120 200 100" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
        <path d="M 0 120 Q 50 100 100 120 Q 150 140 200 120" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2"/>
      </svg>
    ),
    steel: (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
        {[0,1,2,3].map(i=><line key={i} x1="0" y1={50*i} x2="200" y2={50*i} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>)}
        {[0,1,2,3].map(i=><line key={i+4} x1={50*i} y1="0" x2={50*i} y2="200" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>)}
        <polygon points="100,40 140,120 60,120" fill="rgba(255,255,255,0.08)"/>
      </svg>
    ),
    toys: (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
        <circle cx="50"  cy="50"  r="25" fill="rgba(255,255,255,0.06)"/>
        <circle cx="150" cy="50"  r="15" fill="rgba(255,255,255,0.08)"/>
        <circle cx="100" cy="150" r="30" fill="rgba(255,255,255,0.05)"/>
        <rect x="30" y="120" width="40" height="40" rx="6" fill="rgba(255,255,255,0.07)"/>
        <rect x="130" y="110" width="50" height="50" rx="6" fill="rgba(255,255,255,0.06)"/>
      </svg>
    ),
    construction: (
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="cp-svg-pattern">
        <rect x="20" y="100" width="50" height="80" fill="rgba(255,255,255,0.06)"/>
        <rect x="80" y="70"  width="50" height="110" fill="rgba(255,255,255,0.08)"/>
        <rect x="140" y="120" width="40" height="60" fill="rgba(255,255,255,0.05)"/>
        <rect x="10" y="175" width="180" height="8" rx="2" fill="rgba(255,255,255,0.1)"/>
      </svg>
    ),
  };
  return patterns[type] || patterns.battery;
}

export default ConsumerPage;
