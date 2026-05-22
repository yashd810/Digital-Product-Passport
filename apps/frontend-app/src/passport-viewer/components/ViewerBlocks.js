import React, { useEffect, useId, useState } from "react";
import { LANGUAGES, translateFieldValue, translateSchemaLabel } from "../../app/providers/i18n";
import { DynamicChart } from "./DynamicChart";
import { PieChart, parseCompositionFromTable, parseCompositionFromText } from "./PieChart";
import { formatPassportStatus, getPassportActivityState } from "../../passports/utils/passportStatus";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { normalizeSystemPassportHeader } from "../../admin/passport-types/builderHelpers";
import { ACCESS_LABEL_MAP, renderTextBlock, isHeroSummaryField, getFieldPresentation, getSummaryHint, getSummaryValue, shouldFeatureInSummary, toInlineText, formatLinkLabel, formatFieldLabelWithUnit, formatIsoDate } from "../utils/viewerHelpers";
import { getMarketingContactUrl } from "../utils/QRcode";

const API = import.meta.env.VITE_API_URL || "";
const PUBLIC_VIEWER_URL = import.meta.env.VITE_PUBLIC_VIEWER_URL || "";

function parseStoredTableValue(raw) {
  if (Array.isArray(raw)) return { columns: [], rows: raw };
  if (raw && typeof raw === "object") {
    return {
      columns: Array.isArray(raw.columns) ? raw.columns : [],
      rows: Array.isArray(raw.rows) ? raw.rows : [],
    };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { columns: [], rows: parsed };
      if (parsed && typeof parsed === "object") {
        return {
          columns: Array.isArray(parsed.columns) ? parsed.columns : [],
          rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        };
      }
    } catch {
      return { columns: [], rows: [] };
    }
  }
  return { columns: [], rows: [] };
}

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

function buildSuspiciousCarrierReportPayload(carrierAuthenticity) {
  if (typeof window === "undefined") return {};
  return {
    category: "suspicious_carrier",
    severity: "warning",
    observedHost: window.location.host || "",
    expectedHost: carrierAuthenticity?.trustedViewerHost || "",
    suspectedUrl: window.location.href,
    referrer: document.referrer || "",
    userAgent: navigator.userAgent || "",
  };
}

export function TrustedEntryPanel({
  passport,
  carrierAuthenticity = null,
  onReportSuspiciousCarrier = null,
  securityReportState = {},
}) {
  const trustedHost = carrierAuthenticity?.trustedViewerHost || "";
  const trustedOrigin = carrierAuthenticity?.trustedViewerOrigin || "";
  const printSpec = carrierAuthenticity?.qrPrintSpecification || null;
  const verificationEvidence = Array.isArray(carrierAuthenticity?.dataCarrierVerificationEvidence)
    ? carrierAuthenticity.dataCarrierVerificationEvidence
    : [];
  const latestVerification = verificationEvidence[0] || null;
  const safetyWarnings = carrierAuthenticity?.safetyWarnings || [];
  const antiCounterfeitInstructions = carrierAuthenticity?.antiCounterfeitInstructions || [];
  const canReport = typeof onReportSuspiciousCarrier === "function";

  return (
    <section className="trusted-entry-panel" aria-labelledby="trusted-entry-title">
      <div className="trusted-entry-panel-head">
        <div>
          <p className="trusted-entry-kicker">Trusted Entry Guidance</p>
          <h3 id="trusted-entry-title">Check the QR code before you trust the page</h3>
        </div>
        <ViewerDomainIndicator compact />
      </div>

      <div className="trusted-entry-grid">
        <div className="trusted-entry-card">
          <span className="trusted-entry-label">Trusted viewer host</span>
          <strong>{trustedHost || "Configured public viewer host"}</strong>
          {trustedOrigin && <p className="trusted-entry-copy">{trustedOrigin}</p>}
        </div>
        <div className="trusted-entry-card">
          <span className="trusted-entry-label">Carrier protection</span>
          <strong>{carrierAuthenticity?.carrierAuthenticationMethod || "Verified HTTPS viewer"}</strong>
          <p className="trusted-entry-copy">{carrierAuthenticity?.carrierSecurityStatus || "trusted_public_entry"}</p>
        </div>
        <div className="trusted-entry-card">
          <span className="trusted-entry-label">Counterfeit risk</span>
          <strong>{carrierAuthenticity?.counterfeitRiskLevel || "medium"}</strong>
          <p className="trusted-entry-copy">Digital Passport ID: {passport?.dppId || passport?.dpp_id || "—"}</p>
        </div>
        <div className="trusted-entry-card">
          <span className="trusted-entry-label">Protected verification</span>
          <strong>{carrierAuthenticity?.issuerCertificateId || "No certificate metadata"}</strong>
          <p className="trusted-entry-copy">
            {carrierAuthenticity?.signedCarrierPayload ? "Signed carrier payload available" : "No signed carrier binding stored"}
          </p>
        </div>
      </div>

      {printSpec && (
        <div className="trusted-entry-specs" aria-label="QR code print specification">
          <span>QR spec: {printSpec.symbology} · v{printSpec.version} · ECC {printSpec.errorCorrectionLevel}</span>
          <span>Quiet zone: {printSpec.quietZoneModules} modules</span>
          <span>Minimum print width: {printSpec.minimumRecommendedPrintWidthMm} mm</span>
          <span>HRI text: {printSpec.hriText || "Not set"}</span>
          <span>Marker: {printSpec.dppGraphicalMarking || "None"}</span>
          {latestVerification && (
            <span>
              Latest verification: {latestVerification.printGrade || "recorded"}
              {latestVerification.verifiedAt ? ` · ${new Date(latestVerification.verifiedAt).toLocaleDateString()}` : ""}
            </span>
          )}
        </div>
      )}

      {(antiCounterfeitInstructions.length > 0 || safetyWarnings.length > 0) && (
        <div className="trusted-entry-guidance-grid">
          {antiCounterfeitInstructions.length > 0 && (
            <div className="trusted-entry-guidance-card">
              <h4>Verification steps</h4>
              <ul>
                {antiCounterfeitInstructions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {safetyWarnings.length > 0 && (
            <div className="trusted-entry-guidance-card warning">
              <h4>Phishing and quishing warnings</h4>
              <ul>
                {safetyWarnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {carrierAuthenticity?.carrierVerificationInstructions && (
        <p className="trusted-entry-verification-note">
          {carrierAuthenticity.carrierVerificationInstructions}
        </p>
      )}

      {canReport && (
        <div className="trusted-entry-actions">
          <button
            type="button"
            className="pv-secondary-btn"
            onClick={() => onReportSuspiciousCarrier(buildSuspiciousCarrierReportPayload(carrierAuthenticity))}
            disabled={!!securityReportState?.submitting}
            aria-label="Report a suspicious or counterfeit QR code"
          >
            {securityReportState?.submitting ? "Reporting…" : "Report suspicious QR or label"}
          </button>
          {securityReportState?.success && (
            <span className="trusted-entry-feedback success" role="status" aria-live="polite">
              Report sent. The passport provider can now review this carrier.
            </span>
          )}
          {securityReportState?.error && (
            <span className="trusted-entry-feedback error" role="alert">
              {securityReportState.error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function formatHeaderValue(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not available";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function slugifyDidSegment(value, fallback = "company") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || fallback;
}

function stableDidSegment(value, fallback = "passport") {
  const segment = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment || fallback;
}

function isViewerHiddenField(field) {
  const normalizedKey = String(field?.key || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedLabel = String(field?.label || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizedKey === "internal alias id" || normalizedLabel === "internal alias id";
}

function buildViewerDidFallbacks(passport) {
  const didDomain = "www.claros-dpp.online";
  const companyName = passport?.company_profile?.company_name
    || passport?.companyName
    || passport?.company_name
    || passport?.company_id
    || passport?.companyId
    || "company";
  const companySlug = slugifyDidSegment(passport?.company_profile?.did_slug || companyName);
  const granularity = slugifyDidSegment(passport?.granularity || "item", "item");
  const stableId = stableDidSegment(passport?.lineage_id || passport?.dppId || passport?.dpp_id || passport?.internal_alias_id);
  return {
    companyDid: `did:web:${didDomain}:did:company:${companySlug}`,
    dppDid: `did:web:${didDomain}:did:dpp:${granularity}:${stableId}`,
  };
}

function parseHeaderArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value ? [value] : [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [trimmed];
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

export function PassportHeaderPanel({ passport, typeDef }) {
  if (!passport) return null;
  const systemHeader = normalizeSystemPassportHeader(typeDef?.fields_json?.systemHeader || typeDef?.systemHeader);
  const fields = Array.isArray(systemHeader?.fields)
    ? systemHeader.fields.filter((field) => field?.key !== "internalAliasId" && !isViewerHiddenField(field))
    : [];
  const canonicalSubjects = passport.linked_data?.canonical_subjects || {};
  const fallbackDids = buildViewerDidFallbacks(passport);
  const resolvedCompanyDid = passport.companyDid || passport.company_did || canonicalSubjects.companyDid || fallbackDids.companyDid;
  const resolvedFacilityDid = passport.facilityDid || passport.facility_did || canonicalSubjects.facilityDid || null;
  const resolvedSubjectDid = passport.subjectDid || passport.subject_did || canonicalSubjects.subjectDid || passport.product_identifier_did || null;
  const resolvedDppDid = passport.dppDid || passport.dpp_did || canonicalSubjects.dppDid || fallbackDids.dppDid;
  const headerValues = {
    digitalProductPassportId: passport.digitalProductPassportId || passport.dppId || passport.dpp_id,
    uniqueProductIdentifier: passport.uniqueProductIdentifier || passport.product_identifier_did || null,
    internalAliasId: passport.internal_alias_id,
    granularity: passport.granularity || "item",
    dppSchemaVersion: passport.dpp_schema_version || typeDef?.fields_json?.dppSchemaVersion || "prEN 18223:2025",
    dppStatus: formatPassportStatus(passport.release_status),
    lastUpdate: formatIsoDate(passport.updated_at || passport.created_at) || null,
    economicOperatorId: resolvedCompanyDid || passport.economicOperatorId || passport.economic_operator_id,
    facilityId: resolvedFacilityDid || passport.facilityId || passport.facility_id,
    contentSpecificationIds: parseHeaderArray(passport.content_specification_ids || passport.compliance_profile_key || typeDef?.semantic_model_key),
    subjectDid: resolvedSubjectDid,
    dppDid: resolvedDppDid,
    companyDid: resolvedCompanyDid,
  };

  return (
    <section className="pv-header-panel" aria-labelledby="pv-header-panel-title">
      <div className="pv-header-panel-head">
        <div>
          <p className="pv-header-panel-kicker">Standards Header</p>
          <h3 id="pv-header-panel-title">{systemHeader?.section?.label || "Passport Header"}</h3>
        </div>
        <span className="pv-header-panel-badge">JSON-LD required</span>
      </div>
      <p className="pv-header-panel-copy">
        These identifiers and status fields are generated or governed by the platform and form the mandatory public passport header.
      </p>
      <div className="pv-header-grid">
        {fields.map((field) => (
          <article key={field.key} className={`pv-header-card pv-header-card-${field.ownership || "system_generated"}`}>
            <div className="pv-header-card-top">
              <span className="pv-header-label">{field.label || field.key}</span>
            </div>
            <strong className="pv-header-value">{formatHeaderValue(headerValues[field.key])}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer UI Blocks
// ─────────────────────────────────────────────────────────────────────────────
export function PassportIntro({
  passport,
  companyData,
  displayName,
  qrCode,
  qrLoading,
  carrierAuthenticity = null,
  onReportSuspiciousCarrier = null,
  securityReportState = {},
  onPrint,
  onOpenHistory,
}) {
  if (!passport) return null;
  const activityState = getPassportActivityState(passport);
  const manufacturingDate =
    passport.manufactured_date ||
    passport.manufacture_date ||
    passport.manufacturing_date ||
    passport.date_of_manufacture ||
    "—";
  const uniqueBatteryIdentifier =
    passport.uniqueProductIdentifier ||
    passport.product_identifier_did ||
    passport.unique_battery_identifier ||
    passport.battery_identifier ||
    "—";
  const batteryMass =
    passport.battery_mass ||
    passport.battery_weight ||
    passport.weight ||
    "—";
  const serialNumber =
    passport.serial_number ||
    passport.product_serial_number ||
    passport.serial ||
    passport.batterySerialNumber ||
    passport.battery_serial_number ||
    passport.productSerialNumber ||
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
    { label: "Digital Passport ID", value: passport.dppId || passport.dpp_id || "—" },
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

        <TrustedEntryPanel
          passport={passport}
          carrierAuthenticity={carrierAuthenticity}
          onReportSuspiciousCarrier={onReportSuspiciousCarrier}
          securityReportState={securityReportState}
        />
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
  const supportHref = brandTheme?.supportLink || getMarketingContactUrl();
  return (
    <footer className="viewer-footer">
      <p className="viewer-footer-provider">{brandTheme?.footerText || "Powered by ClarosDPP, digital passport provider via software as a service."}</p>
      <ViewerDomainIndicator />
      <p className="viewer-footer-subtle">
        <a href={supportHref} target="_blank" rel="noopener noreferrer" className="viewer-footer-link">Contact information</a>
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

export function SectionView({ sectionDef, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang, sectionId = "", onRefreshFieldUrl = null }) {
  const [expandedKey, setExpandedKey] = useState(null);   // which dynamic field is open
  const [chartTypes,  setChartTypes]  = useState({});     // { [fieldKey]: "line"|"histogram" }
  const [history,     setHistory]     = useState({});     // { [fieldKey]: { data, loading } }

  const toggleChart = async (fieldKey) => {
    if (expandedKey === fieldKey) { setExpandedKey(null); return; }
    setExpandedKey(fieldKey);
    if (!history[fieldKey]) {
      setHistory(p => ({ ...p, [fieldKey]: { data: [], loading: true } }));
      try {
        const r = await fetchWithAuth(`${API}/api/passports/${passport.dppId}/dynamic-values/${fieldKey}/history?limit=500`);
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
    const fieldLabel = formatFieldLabelWithUnit(translateSchemaLabel(lang, f), f);
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
      display = <FileCell url={raw} label={`${passport.model_name}_${f.key}`} onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(f.key, raw) : null} />;
    } else if (f.type === "table") {
      const { columns: storedColumns, rows: tableData } = parseStoredTableValue(raw);
      if (Array.isArray(tableData) && tableData.length > 0) {
        const cols = storedColumns.length ? storedColumns : (f.table_columns || []);
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
          <RefreshableImage
            src={raw}
            alt={f.label}
            className="field-symbol-img pv-field-symbol"
            onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(f.key, raw) : null}
          />
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
export function FileCell({ url, label, onRefreshUrl = null }) {
  const [open,    setOpen]    = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);
  const previewId = useId();

  const tryResolveUrl = async () => {
    if (typeof onRefreshUrl !== "function") return url;
    const nextUrl = await onRefreshUrl(url);
    return nextUrl || url;
  };

  const handleToggle = async () => {
    if (open) { setOpen(false); return; }
    if (blobUrl) { setOpen(true); return; }
    setLoading(true);
    setErr(null);
    try {
      let activeUrl = url;
      let res = await fetchWithAuth(activeUrl);
      if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410)) {
        activeUrl = await tryResolveUrl();
        res = await fetchWithAuth(activeUrl);
      }
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

  const handleOpen = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const activeUrl = await tryResolveUrl();
      window.open(activeUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e.message || "Could not open file");
    }
  };

  return (
    <div className="pdf-cell">
      {err && <div className="pdf-err" role="alert">{err}</div>}
      {open && blobUrl && (
        <iframe id={previewId} src={blobUrl} title={label} className="pdf-iframe" />
      )}
      <div className="pdf-cell-actions">
        <a href={url} target="_blank" rel="noopener noreferrer" className="pdf-open-link" onClick={handleOpen}>
          Open
        </a>
        <button
          type="button"
          className="pdf-preview-btn"
          onClick={handleToggle}
          disabled={loading}
          aria-expanded={open}
          aria-controls={previewId}
        >
          {loading ? "Loading…" : open ? "Hide preview" : "Show preview"}
        </button>
      </div>
    </div>
  );
}

export function RefreshableImage({ src, alt, className = "", onRefreshUrl = null }) {
  const [activeSrc, setActiveSrc] = useState(src);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setActiveSrc(src);
    setRefreshing(false);
  }, [src]);

  const handleError = async () => {
    if (refreshing || typeof onRefreshUrl !== "function" || !src) return;
    setRefreshing(true);
    try {
      const nextSrc = await onRefreshUrl(src);
      if (nextSrc && nextSrc !== activeSrc) setActiveSrc(nextSrc);
    } catch {
      // Leave the current src in place if refresh fails.
    } finally {
      setRefreshing(false);
    }
  };

  return <img src={activeSrc} alt={alt} className={className} onError={handleError} />;
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
    <div className="viewer-lang-selector" role="group" aria-label="Passport language selector">
      {LANGUAGES.map(l => (
        <button
          key={l.code}
          type="button"
          onClick={() => { setLang(l.code); localStorage.setItem("dpp_lang", l.code); }}
          aria-pressed={lang === l.code}
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
    fetchWithAuth(`${API}/api/passports/${dppId}/scan-stats`)
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
            {(passport.dppId || passport.dpp_id) && <span><strong>Digital Passport ID:</strong> {passport.dppId || passport.dpp_id}</span>}
          </div>
        </div>
      </div>
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
                  const { columns: storedColumns, rows: tableData } = parseStoredTableValue(raw);
                  if (Array.isArray(tableData) && tableData.length > 0) {
                    const cols = storedColumns.length ? storedColumns : (f.table_columns || []);
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
                return (<tr key={f.key}><th>{formatFieldLabelWithUnit(f.label, f)}</th><td>{display}</td></tr>);
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
