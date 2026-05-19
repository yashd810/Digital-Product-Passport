import React, { useEffect, useMemo, useState } from "react";
import { translateFieldValue, translateSchemaLabel } from "../../app/providers/i18n";
import { normalizeSystemPassportHeader } from "../../admin/passport-types/builderHelpers";
import { formatPassportStatus } from "../../passports/utils/passportStatus";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { DynamicChart } from "./DynamicChart";
import { PieChart, parseCompositionFromTable, parseCompositionFromText } from "./PieChart";
import { FileCell, LiveBadge, LockedFieldCell, ViewerDomainIndicator } from "./ViewerBlocks";
import { renderTextBlock } from "../utils/viewerHelpers";

const API = import.meta.env.VITE_API_URL || "";

const BATTERY_ICON = (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <rect x="12" y="20" width="40" height="24" rx="8" fill="currentColor" opacity="0.18" />
    <rect x="16" y="18" width="34" height="28" rx="8" fill="none" stroke="currentColor" strokeWidth="4" />
    <rect x="50" y="27" width="4" height="10" rx="2" fill="currentColor" />
    <path d="M32 23 24 35h7l-3 10 12-16h-8l4-6Z" fill="currentColor" />
  </svg>
);

function isFilled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrlLike(value) {
  return typeof value === "string" && /^(https?:)?\/\//i.test(value);
}

function toHref(value) {
  if (!value || typeof value !== "string") return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("/")) return value;
  return `https://${value}`;
}

function isImageLikeUrl(value) {
  return typeof value === "string" && /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
}

function isPdfLikeUrl(value) {
  return typeof value === "string" && /\.pdf(\?.*)?$/i.test(value);
}

function formatValue(value) {
  if (!isFilled(value)) return "";
  if (Array.isArray(value)) return value.filter(isFilled).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flattenSections(sections) {
  return sections.flatMap((section) =>
    (section.fields || []).map((field) => ({ ...field, _section: section }))
  );
}

function getSchemaFieldValue(source, key) {
  if (!source || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const foldedKey = typeof key === "string" ? key.toLowerCase() : key;
  if (foldedKey && Object.prototype.hasOwnProperty.call(source, foldedKey)) return source[foldedKey];
  return undefined;
}

function resolveFieldValue(field, passport, unlockedPassport, dynamicValues) {
  const access = field.access || ["public"];
  const isPublic = access.includes("public");
  const isDynamic = !!field.dynamic;
  const dynEntry = isDynamic ? dynamicValues?.[field.key] : null;
  const source = unlockedPassport || passport;
  const raw = isPublic || unlockedPassport
    ? (isDynamic ? (dynEntry?.value ?? null) : getSchemaFieldValue(source, field.key))
    : null;

  return {
    raw,
    isPublic,
    isDynamic,
    dynEntry,
    isLocked: !isPublic && !unlockedPassport,
  };
}

function findFieldEntry(fields, matchers, passport, unlockedPassport, dynamicValues, extraPredicate = null) {
  for (const field of fields) {
    const fieldText = `${normalizeText(field.key)} ${normalizeText(field.label)}`;
    const matched = matchers.some((matcher) =>
      typeof matcher === "string" ? fieldText.includes(normalizeText(matcher)) : matcher.test(fieldText)
    );
    if (!matched) continue;

    const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
    if (!isFilled(resolved.raw)) continue;
    if (extraPredicate && !extraPredicate(resolved.raw, field)) continue;
    return { field, ...resolved };
  }
  return null;
}

function getCompositionItems(field, raw) {
  if (!field.composition || !isFilled(raw)) return null;
  return field.type === "table" ? parseCompositionFromTable(raw) : parseCompositionFromText(raw);
}

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

function buildLifecycleEvents(fields, passport, unlockedPassport, dynamicValues) {
  const manufactured = findFieldEntry(
    fields,
    ["manufactured date", "manufacture date", "manufacturing date", "date of manufacture", "production date"],
    passport,
    unlockedPassport,
    dynamicValues
  );
  const manufactureContext = findFieldEntry(
    fields,
    ["manufacturing place", "manufacturing location", "manufacturing site", "facility", "country of origin"],
    passport,
    unlockedPassport,
    dynamicValues
  );
  const putIntoService = findFieldEntry(
    fields,
    ["putting the battery into service", "put into service", "date of putting", "date in service", "in service date"],
    passport,
    unlockedPassport,
    dynamicValues
  );
  const serviceContext = findFieldEntry(
    fields,
    ["warranty period", "warranty", "battery status", "service period", "service status"],
    passport,
    unlockedPassport,
    dynamicValues
  );
  const updatedAt = passport?.updated_at || passport?.created_at || "";

  return [
    {
      date: manufactured ? formatValue(manufactured.raw) : "",
      title: "Manufactured",
      text: manufactureContext ? formatValue(manufactureContext.raw) : "",
    },
    {
      date: putIntoService ? formatValue(putIntoService.raw) : "",
      title: "Put into service",
      text: serviceContext ? formatValue(serviceContext.raw) : "",
    },
    {
      date: updatedAt ? new Date(updatedAt).toISOString().slice(0, 10) : "",
      title: "DPP updated",
      text: updatedAt ? "Latest data, QR binding, and signature checked." : "",
    },
  ];
}

function buildHeaderRows(passport, typeDef) {
  const systemHeader = normalizeSystemPassportHeader(typeDef?.fields_json?.systemHeader || typeDef?.systemHeader);
  const canonicalSubjects = passport?.linked_data?.canonical_subjects || {};
  const resolvedCompanyDid = passport?.companyDid || passport?.company_did || canonicalSubjects.companyDid || null;
  const resolvedFacilityDid = passport?.facilityDid || passport?.facility_did || canonicalSubjects.facilityDid || null;
  const resolvedSubjectDid = passport?.subjectDid || passport?.subject_did || canonicalSubjects.subjectDid || passport?.product_identifier_did || null;
  const resolvedDppDid = passport?.dppDid || passport?.dpp_did || canonicalSubjects.dppDid || null;
  const values = {
    digitalProductPassportId: passport?.digitalProductPassportId || passport?.dppId || passport?.dpp_id,
    uniqueProductIdentifier: passport?.uniqueProductIdentifier || passport?.product_identifier_did || passport?.product_id,
    localProductId: passport?.product_id,
    granularity: passport?.granularity || "item",
    dppSchemaVersion: passport?.dpp_schema_version || typeDef?.fields_json?.dppSchemaVersion || "prEN 18223:2025",
    dppStatus: formatPassportStatus(passport?.release_status),
    lastUpdate: passport?.updated_at || passport?.created_at
      ? new Date(passport.updated_at || passport.created_at).toISOString()
      : null,
    economicOperatorId: resolvedCompanyDid || passport?.economicOperatorId || passport?.economic_operator_id,
    facilityId: resolvedFacilityDid || passport?.facilityId || passport?.facility_id,
    contentSpecificationIds: Array.isArray(passport?.content_specification_ids)
      ? passport.content_specification_ids.join(", ")
      : passport?.content_specification_ids || passport?.compliance_profile_key || typeDef?.semantic_model_key,
    subjectDid: resolvedSubjectDid,
    dppDid: resolvedDppDid,
    companyDid: resolvedCompanyDid,
  };

  return systemHeader.fields.map((field) => ({
    key: field.key,
    label: field.label || field.key,
    value: formatValue(values[field.key]),
  }));
}

function buildTrustRows(passport, carrierAuthenticity, sigVerification) {
  const verificationEvidence = Array.isArray(carrierAuthenticity?.dataCarrierVerificationEvidence)
    ? carrierAuthenticity.dataCarrierVerificationEvidence
    : [];
  const latestVerification = verificationEvidence[0] || null;

  return [
    ["Signature status", sigVerification?.status || ""],
    ["Signature timestamp", sigVerification?.signedAt ? new Date(sigVerification.signedAt).toISOString() : ""],
    ["Signing key", sigVerification?.keyId || ""],
    ["Trusted viewer host", carrierAuthenticity?.trustedViewerHost || ""],
    ["Trusted viewer origin", carrierAuthenticity?.trustedViewerOrigin || ""],
    ["Carrier security status", carrierAuthenticity?.carrierSecurityStatus || ""],
    ["Carrier authentication", carrierAuthenticity?.carrierAuthenticationMethod || ""],
    ["Counterfeit risk level", carrierAuthenticity?.counterfeitRiskLevel || ""],
    ["Issuer certificate", carrierAuthenticity?.issuerCertificateId || ""],
    ["Signed carrier payload", carrierAuthenticity?.signedCarrierPayload ? "Available" : "Not stored"],
    ["QR print specification", carrierAuthenticity?.qrPrintSpecification ? `${carrierAuthenticity.qrPrintSpecification.symbology} · ECC ${carrierAuthenticity.qrPrintSpecification.errorCorrectionLevel}` : ""],
    ["Latest verification", latestVerification?.verifiedAt ? `${latestVerification.printGrade || "recorded"} · ${new Date(latestVerification.verifiedAt).toISOString()}` : ""],
    ["Current viewer host", typeof window !== "undefined" ? window.location.host : ""],
    ["Public passport URL", passport?.linked_data?.public_url || ""],
  ].filter(([, value]) => isFilled(value));
}

function buildVerificationRows(verificationBundle) {
  if (!verificationBundle) return [];
  return [
    ["DPP integrity", verificationBundle.integrity || ""],
    ["Signer", verificationBundle.signedBy === "did:web:www.claros-dpp.online" ? "Claros" : (verificationBundle.signedBy || "")],
    ["Company trust level", verificationBundle.trustLevel || ""],
    ["DPP data unchanged", verificationBundle.dppDataUnchanged ? "Yes" : "No"],
    ["External company certificate", verificationBundle.externalCompanyCertificate || "Not provided"],
    ["Verification status", verificationBundle.verificationStatus || ""],
  ].filter(([, value]) => isFilled(value));
}

function buildDocumentItems(fields, passport, unlockedPassport, dynamicValues, lang) {
  return fields
    .map((field) => {
      const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
      const rawText = formatValue(resolved.raw);
      const looksLinkedArtifact = field.type === "file"
        || field.type === "symbol"
        || field.type === "url"
        || isImageLikeUrl(rawText)
        || isPdfLikeUrl(rawText)
        || isUrlLike(rawText);
      if (!resolved.isLocked && !looksLinkedArtifact) return null;
      if (!resolved.isLocked && !isFilled(resolved.raw)) return null;

      return {
        field,
        fieldLabel: translateSchemaLabel(lang, field),
        ...resolved,
      };
    })
    .filter(Boolean);
}

function DataArtifactPreview({ field, raw, label }) {
  const href = toHref(raw);
  if (!isFilled(raw)) return null;
  if (field.type === "file" || isPdfLikeUrl(raw)) {
    return <FileCell url={raw} label={label} />;
  }
  if (field.type === "symbol" || isImageLikeUrl(raw)) {
    return (
      <div className="artifact-image-wrap">
        <img src={raw} alt={label} className="artifact-image" />
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="artifact-link">
            Open original
          </a>
        )}
      </div>
    );
  }
  if (field.type === "url" && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="artifact-link">
        {raw}
      </a>
    );
  }
  return null;
}

function DataFieldValue({ field, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang }) {
  const [expandedHistory, setExpandedHistory] = useState(false);
  const [chartType, setChartType] = useState("line");
  const [historyState, setHistoryState] = useState({ loading: false, loaded: false, data: [] });

  const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
  const { raw, isLocked, isDynamic, dynEntry } = resolved;
  const pieItems = getCompositionItems(field, raw);

  useEffect(() => {
    if (!expandedHistory || !isDynamic || historyState.loaded || !passport?.dppId) return;
    let cancelled = false;
    setHistoryState({ loading: true, loaded: false, data: [] });
    fetchWithAuth(`${API}/api/passports/${passport.dppId}/dynamic-values/${field.key}/history?limit=500`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        setHistoryState({
          loading: false,
          loaded: true,
          data: payload?.history || [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryState({ loading: false, loaded: true, data: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [expandedHistory, field.key, historyState.loaded, isDynamic, passport?.dppId]);

  let content = <span className="field-value-empty">—</span>;

  if (isLocked) {
    content = (
      <div className="field-value-locked">
        <p>This value is available to authorised parties only.</p>
        <LockedFieldCell field={field} onUnlock={onRequestUnlock} />
      </div>
    );
  } else if (field.type === "boolean") {
    content = <strong className="field-value-strong">{translateFieldValue(lang, !!raw, "boolean")}</strong>;
  } else if (field.type === "table") {
    const { columns: storedColumns, rows: tableRows } = parseStoredTableValue(raw);
    const tableColumns = storedColumns.length ? storedColumns : (Array.isArray(field.table_columns) ? field.table_columns : []);
    content = Array.isArray(tableRows) && tableRows.length > 0 ? (
      <div className="inline-table-wrap">
        <table className="inline-table">
          {tableColumns.length > 0 && (
            <thead>
              <tr>
                {tableColumns.map((column) => (
                  <th key={column}>{translateSchemaLabel(lang, { label: column })}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {tableRows.map((row, index) => (
              <tr key={`${field.key}-row-${index}`}>
                {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                  <td key={`${field.key}-cell-${index}-${cellIndex}`}>{isFilled(cell) ? String(cell) : "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <span className="field-value-empty">—</span>
    );
  } else if (field.type === "symbol" || field.type === "file" || field.type === "url" || isImageLikeUrl(raw) || isPdfLikeUrl(raw) || isUrlLike(raw)) {
    content = <DataArtifactPreview field={field} raw={raw} label={translateSchemaLabel(lang, field)} />;
  } else if (typeof raw === "string" && raw.includes("\n")) {
    content = renderTextBlock(raw, "field-value-text");
  } else if (isFilled(raw)) {
    content = <strong className="field-value-strong">{formatValue(raw)}</strong>;
  }

  return (
    <div className="field-value-stack">
      {content}
      {isDynamic && !isLocked && (
        <div className="field-dynamic-block">
          <div className="field-dynamic-top">
            <LiveBadge updatedAt={dynEntry?.updatedAt} />
            <button
              type="button"
              className="field-history-toggle"
              onClick={() => setExpandedHistory((current) => !current)}
            >
              {expandedHistory ? "Hide history" : "View history"}
            </button>
          </div>
          {expandedHistory && (
            <div className="field-history-panel">
              <div className="field-history-tabs">
                <button
                  type="button"
                  className={chartType === "line" ? "active" : ""}
                  onClick={() => setChartType("line")}
                >
                  Line
                </button>
                <button
                  type="button"
                  className={chartType === "histogram" ? "active" : ""}
                  onClick={() => setChartType("histogram")}
                >
                  Histogram
                </button>
              </div>
              {historyState.loading ? (
                <div className="field-history-loading">Loading history…</div>
              ) : (
                <DynamicChart data={historyState.data || []} chartType={chartType} />
              )}
            </div>
          )}
        </div>
      )}
      {pieItems && (
        <div className="field-chart-panel">
          <PieChart items={pieItems} />
        </div>
      )}
    </div>
  );
}

function DocumentCard({ item, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang }) {
  const { field, fieldLabel, isLocked } = item;
  const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
  const href = toHref(resolved.raw);

  return (
    <article className="doc-card">
      <div className="doc-icon">{field.type === "symbol" ? "IMG" : field.type === "file" ? "PDF" : "LINK"}</div>
      <div>
        <h3>{fieldLabel}</h3>
        <p>{translateSchemaLabel(lang, field._section || { label: "Passport data" })}</p>
      </div>
      <span className="badge neutral">{field.type}</span>
      <div className="doc-preview-area">
        <DataFieldValue
          field={field}
          passport={passport}
          unlockedPassport={unlockedPassport}
          onRequestUnlock={onRequestUnlock}
          dynamicValues={dynamicValues}
          lang={lang}
        />
      </div>
      {!isLocked && href && (
        <a href={href} target="_blank" rel="noopener noreferrer">
          Open resource
        </a>
      )}
    </article>
  );
}

export default function PublicPassportPortal({
  passport,
  companyData,
  typeDef,
  qrCode,
  qrLoading,
  unlockedPassport,
  onRequestUnlock,
  dynamicValues,
  lang,
  sigVerification,
  verificationBundle,
  carrierAuthenticity,
  isPreviewMode = false,
  isInactiveView = false,
  isObsolete = false,
  canonicalPublicPath = "",
}) {
  const [activePage, setActivePage] = useState("overview");
  const sections = typeDef?.fields_json?.sections || typeDef?.sections || [];
  const fields = useMemo(() => flattenSections(sections), [sections]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activePage]);

  const modelEntry = findFieldEntry(fields, ["model name", "product name"], passport, unlockedPassport, dynamicValues);
  const capacityEntry = findFieldEntry(fields, ["rated capacity", "capacity", "usable battery energy", "certified usable battery energy"], passport, unlockedPassport, dynamicValues);
  const categoryEntry = findFieldEntry(fields, ["battery category", "product category", "category"], passport, unlockedPassport, dynamicValues);
  const productImageEntry = findFieldEntry(
    fields,
    ["product image", "product photo", "product picture", "item image"],
    passport,
    unlockedPassport,
    dynamicValues,
    (raw) => isImageLikeUrl(raw) || isUrlLike(raw)
  );
  const overviewSymbols = fields
    .map((field) => ({ field, ...resolveFieldValue(field, passport, unlockedPassport, dynamicValues) }))
    .filter((entry) => {
      if (entry.isLocked || !isFilled(entry.raw)) return false;
      const text = `${normalizeText(entry.field.key)} ${normalizeText(entry.field.label)}`;
      return entry.field.type === "symbol" || text.includes("symbol") || text.includes("label");
    })
    .slice(0, 3);

  const lifecycleEvents = buildLifecycleEvents(fields, passport, unlockedPassport, dynamicValues);
  const headerRows = buildHeaderRows(passport, typeDef);
  const trustRows = buildTrustRows(passport, carrierAuthenticity, sigVerification);
  const verificationRows = buildVerificationRows(verificationBundle);
  const documentItems = buildDocumentItems(fields, passport, unlockedPassport, dynamicValues, lang);

  const pages = [
    { key: "overview", label: "Overview" },
    { key: "header", label: "Header" },
    { key: "data", label: "Data" },
    { key: "trustPage", label: "Trust" },
    { key: "documents", label: "Documents" },
  ];

  const currentStatus = formatPassportStatus(passport?.release_status || "");
  const heroMetrics = [
    ["Manufacturer", companyData?.company_name || passport?.manufacturer || passport?.manufactured_by || ""],
    ["Serial number", passport?.product_id || passport?.serial_number || ""],
    ["Status", currentStatus || ""],
    ["Last update", passport?.updated_at ? new Date(passport.updated_at).toISOString().slice(0, 10) : ""],
  ];

  return (
    <div className="passport-portal">
      <nav className="nav" aria-label="Passport sections">
        <div className="nav-inner">
          <a className="brand" href="#portal-top" aria-label="Back to passport top">
            <div className="logo">{BATTERY_ICON}</div>
            <div>
              <strong>Battery Passport Portal</strong>
              <span>Public DPP · battery viewer</span>
            </div>
          </a>
          <div className="nav-links" role="tablist" aria-label="Viewer pages">
            {pages.map((page) => (
              <button
                key={page.key}
                type="button"
                className={activePage === page.key ? "active" : ""}
                onClick={() => setActivePage(page.key)}
                role="tab"
                aria-selected={activePage === page.key ? "true" : "false"}
                aria-controls={page.key}
              >
                {page.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <header className="hero" id="portal-top">
        <div className="hero-main">
          <div>
            <div className="kicker">{typeDef?.display_name || passport?.passport_type || "Battery product passport"}</div>
            <h1>{modelEntry ? formatValue(modelEntry.raw) : (passport?.model_name || "")}</h1>
            {(isPreviewMode || isInactiveView || isObsolete || unlockedPassport) && (
              <div className="hero-badge-row">
                {isPreviewMode && <span className="badge">Preview mode</span>}
                {isInactiveView && <span className="badge warn">Inactive snapshot</span>}
                {isObsolete && <span className="badge warn">Superseded version</span>}
                {unlockedPassport && <span className="badge ok">Authorised view</span>}
              </div>
            )}
            {isPreviewMode && canonicalPublicPath && (
              <p className="hero-note">Future public URL: {canonicalPublicPath}</p>
            )}
            <div className="hero-cards" aria-label="Key passport facts">
              {heroMetrics.map(([label, value]) => (
                <div key={label} className="hero-card">
                  <span>{label}</span>
                  <strong>{value || ""}</strong>
                </div>
              ))}
            </div>
          </div>

          <aside className="side-panel" aria-label="Product image and QR access">
            <div className={`product-photo${companyData?.company_logo ? " has-img" : ""}`}>
              {companyData?.company_logo && <img src={companyData.company_logo} alt={`${companyData.company_name || "Company"} logo`} />}
            </div>
            <div className="qr-row">
              <div className="qr" aria-label="Passport QR code">
                {qrLoading ? (
                  <div className="artifact-placeholder">Generating…</div>
                ) : qrCode ? (
                  <img src={qrCode} alt="Passport QR code" />
                ) : (
                  <div className="artifact-placeholder" />
                )}
              </div>
              <div className="scan-copy">
                <strong>Scan to open public URL</strong>
                <ViewerDomainIndicator compact />
              </div>
            </div>
          </aside>
        </div>
      </header>

      <main>
        <section className={`page${activePage === "overview" ? " active" : ""}`} id="overview" role="tabpanel" hidden={activePage !== "overview"}>
          <div className="grid2 overview-only-layout">
            <article className="card">
              <h2>Product overview</h2>
              <div className={`energy-art${productImageEntry ? " has-img" : ""}`}>
                {productImageEntry && <img src={productImageEntry.raw} alt={passport?.model_name || "Product"} className="overview-product-image" />}
              </div>
              <div className="overview-meta">
                {[
                  ["Model", modelEntry ? formatValue(modelEntry.raw) : passport?.model_name || ""],
                  ["Capacity", capacityEntry ? formatValue(capacityEntry.raw) : ""],
                  ["Category", categoryEntry ? formatValue(categoryEntry.raw) : ""],
                ].map(([label, value]) => (
                  <div key={label} className="mini">
                    <span>{label}</span>
                    <strong>{value || ""}</strong>
                  </div>
                ))}
              </div>

              {overviewSymbols.length > 0 && (
                <div className="overview-symbols" aria-label="Product labels and symbols">
                  <div className="overview-symbols-head">
                    <h3>Labels & symbols</h3>
                    <span>{overviewSymbols.length} fields</span>
                  </div>
                  <div className="symbol-list">
                    {overviewSymbols.map((entry) => (
                      <div key={entry.field.key} className="symbol-item">
                        <div className="symbol-icon">{entry.field.type === "symbol" ? "IMG" : "TAG"}</div>
                        <div>
                          <span>{translateSchemaLabel(lang, entry.field)}</span>
                          {entry.field.type === "symbol" || isImageLikeUrl(entry.raw) ? (
                            <img src={entry.raw} alt={translateSchemaLabel(lang, entry.field)} className="overview-symbol-image" />
                          ) : (
                            <strong>{formatValue(entry.raw)}</strong>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {verificationBundle && (
                <section className="verification-panel" aria-label="Verification">
                  <div className="verification-panel-head">
                    <span className="badge ok">Verification</span>
                    <h3>This passport is signed by Claros.</h3>
                    <p>You can independently verify the data using the links below.</p>
                  </div>
                  <div className="verification-grid">
                    {verificationRows.map(([label, value]) => (
                      <div key={label} className="verification-card">
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="verification-actions">
                    {verificationBundle.canonicalDppJsonUrl && (
                      <a className="pill-button" href={verificationBundle.canonicalDppJsonUrl} target="_blank" rel="noopener noreferrer">
                        Download DPP JSON
                      </a>
                    )}
                    {verificationBundle.signatureUrl && (
                      <a className="pill-button" href={verificationBundle.signatureUrl} target="_blank" rel="noopener noreferrer">
                        Download signature proof
                      </a>
                    )}
                    {verificationBundle.verificationBundleUrl && (
                      <a className="pill-button" href={verificationBundle.verificationBundleUrl} target="_blank" rel="noopener noreferrer">
                        Download verification bundle
                      </a>
                    )}
                    {verificationBundle.didDocumentUrl && (
                      <a className="pill-button" href={verificationBundle.didDocumentUrl} target="_blank" rel="noopener noreferrer">
                        View DID document / public key
                      </a>
                    )}
                  </div>
                </section>
              )}
            </article>

            <article className="card">
              <h2>Lifecycle snapshot</h2>
              <div className="timeline">
                {lifecycleEvents.map((event) => (
                  <div key={`${event.title}-${event.date}`} className="event">
                    <div className="date">{event.date || ""}</div>
                    <div>
                      <strong>{event.title}</strong>
                      <span>{event.text || ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={`page${activePage === "header" ? " active" : ""}`} id="header" role="tabpanel" hidden={activePage !== "header"}>
          <div className="page-head">
            <div>
              <span className="badge">Separate header tab</span>
              <h2>DPP header</h2>
              <p>This identity and schema context is platform-generated and always shown as the compliance header.</p>
            </div>
            <span className="badge ok">Active · public view</span>
          </div>
          <div className="header-panel">
            <div className="header-grid">
              {headerRows.map((row) => (
                <div key={row.key} className="header-field">
                  <span>{row.label}</span>
                  <strong>{row.value || ""}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`page${activePage === "data" ? " active" : ""}`} id="data" role="tabpanel" hidden={activePage !== "data"}>
          <h2 className="data-title">Battery data by category</h2>
          <p className="data-subtitle">All current passport sections and fields are rendered here using their configured data type, including documents, symbols, tables, and charts.</p>
          <div className="category-stack">
            {sections.map((section, sectionIndex) => (
              <details key={section.key || sectionIndex} className="category" open={sectionIndex === 0}>
                <summary>
                  <div className="cat-title">
                    <span className="cat-index">{String(sectionIndex + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{translateSchemaLabel(lang, section)}</h3>
                      <p>{(section.fields || []).length} configured fields</p>
                    </div>
                  </div>
                  <div className="cat-meta">
                    <span className="badge neutral">{(section.fields || []).length} fields</span>
                    <span className="chevron">⌄</span>
                  </div>
                </summary>
                <ul className="field-list">
                  {(section.fields || []).map((field) => (
                    <li key={field.key} className="field-row">
                      <span className="field-key">{translateSchemaLabel(lang, field)}</span>
                      <div className="field-value">
                        <DataFieldValue
                          field={field}
                          passport={passport}
                          unlockedPassport={unlockedPassport}
                          onRequestUnlock={onRequestUnlock}
                          dynamicValues={dynamicValues}
                          lang={lang}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>

        <section className={`page${activePage === "trustPage" ? " active" : ""}`} id="trustPage" role="tabpanel" hidden={activePage !== "trustPage"}>
          <div className="page-head">
            <div>
              <span className="badge ok">Verifier credentials</span>
              <h2>Trust identity</h2>
              <p>These fields come from platform-generated signature and carrier-authenticity data rather than static passport content.</p>
            </div>
          </div>
          <section className="trust-panel">
            {verificationBundle && (
              <div className="verification-inline-note">
                <strong>DPP integrity: {verificationBundle.integrity || "Unknown"}</strong>
                <span>Signer: {verificationBundle.signedBy === "did:web:www.claros-dpp.online" ? "Claros" : (verificationBundle.signedBy || "Unknown")}</span>
              </div>
            )}
            <div className="trust-grid">
              {[...verificationRows, ...trustRows].map(([label, value]) => (
                <div key={label} className="trust-card">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className={`page${activePage === "documents" ? " active" : ""}`} id="documents" role="tabpanel" hidden={activePage !== "documents"}>
          <div className="page-head">
            <div>
              <span className="badge">Linked resources</span>
              <h2>Documents</h2>
              <p>All linked files, uploaded artifacts, symbols, and web links are collected here for preview and download.</p>
            </div>
          </div>
          <div className="document-grid">
            {documentItems.map((item) => (
              <DocumentCard
                key={item.field.key}
                item={item}
                passport={passport}
                unlockedPassport={unlockedPassport}
                onRequestUnlock={onRequestUnlock}
                dynamicValues={dynamicValues}
                lang={lang}
              />
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{companyData?.company_name || "ClarosDPP"} · Category-specific battery passport</span>
          <span>Public passport viewer</span>
        </div>
      </footer>
    </div>
  );
}
