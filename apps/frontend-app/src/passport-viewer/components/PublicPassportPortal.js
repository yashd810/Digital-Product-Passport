import React, { useEffect, useMemo, useState } from "react";
import { translateFieldValue, translateSchemaLabel } from "../../app/providers/i18n";
import { normalizeSystemPassportHeader, resolveSystemHeaderEntries } from "../../admin/passport-types/builderHelpers";
import { formatPassportStatus } from "../../passports/utils/passportStatus";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { normalizeTableColumns, parseTableRows } from "../../shared/passports/tableSchemaUtils";
import { resolveManagedSystemHeaderValue } from "../../shared/passports/systemHeaderManagedValues";
import { DynamicChart } from "./DynamicChart";
import { PieChart, parseCompositionFromTable } from "./PieChart";
import { FileCell, LiveBadge, LockedFieldCell, RefreshableImage, ViewerDomainIndicator } from "./ViewerBlocks";
import { appendUnitToDisplayValue, formatFieldLabelWithUnit, formatIsoDate, renderTextBlock } from "../utils/viewerHelpers";

const api = import.meta.env.VITE_API_URL || "";

const passportIcon = (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <rect x="14" y="8" width="36" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="4" />
    <path d="M24 22h16M24 32h16M24 42h10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <circle cx="43" cy="44" r="7" fill="currentColor" opacity="0.18" />
    <path d="m40 44 2 2 5-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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

function isViewerHiddenField(field) {
  const normalizedKey = normalizeText(field?.key);
  const normalizedLabel = normalizeText(field?.label);
  return normalizedKey === "internal alias id"
    || normalizedLabel === "internal alias id"
    || normalizedKey === "internalaliasid"
    || normalizedKey === "internal aliasid";
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

function formatDisplayValue(field, value) {
  return appendUnitToDisplayValue(formatValue(value), field);
}

function getBusinessIdentifierValue(passport, typeDef) {
  const fieldKey = typeDef?.fieldsJson?.identity?.businessIdentifierField || "";
  if (!fieldKey) return "";
  const value = passport?.[fieldKey];
  return isFilled(value) ? formatValue(value) : "";
}

function flattenSections(sections) {
  return sections.flatMap((section) =>
    (section.fields || [])
      .filter((field) => !isViewerHiddenField(field))
      .map((field) => ({ ...field, _section: section }))
  );
}

async function fetchJsonWithTimeout(url, timeoutMs = 4000, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithAuth(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    window.clearTimeout(timer);
  }
}

function getSchemaFieldValue(source, key) {
  if (!source || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
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

function findFieldEntryByRole(fields, roleKey, roleValue, passport, unlockedPassport, dynamicValues, extraPredicate = null) {
  for (const field of fields) {
    if (field?.[roleKey] !== roleValue) continue;

    const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
    if (!isFilled(resolved.raw)) continue;
    if (extraPredicate && !extraPredicate(resolved.raw, field)) continue;
    return { field, ...resolved };
  }
  return null;
}

function getProductOverviewCardIndex(summaryRole) {
  const role = String(summaryRole || "").trim();
  if (/^card[1-9]$/.test(role)) return Number(role.replace("card", ""));
  if (role === "model") return 1;
  if (role === "capacity") return 2;
  if (role === "category") return 3;
  return null;
}

function buildProductOverviewCards(fields, passport, unlockedPassport, dynamicValues, lang) {
  return fields
    .map((field, fieldIndex) => {
      const cardIndex = getProductOverviewCardIndex(field?.summaryRole);
      if (!cardIndex) return null;
      const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
      if (resolved.isLocked || !isFilled(resolved.raw)) return null;
      return {
        key: field.key,
        order: cardIndex,
        fieldIndex,
        label: formatFieldLabelWithUnit(translateSchemaLabel(lang, field), field),
        value: formatDisplayValue(field, resolved.raw),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.fieldIndex - b.fieldIndex)
    .slice(0, 9);
}

function getCompositionItems(field, raw) {
  if (!field.composition || !isFilled(raw)) return null;
  if (field.type !== "table") return null;
  return parseCompositionFromTable(raw, field);
}

function buildLifecycleEvents(fields, passport, unlockedPassport, dynamicValues, lastUpdateAt) {
  const manufactured = findFieldEntryByRole(
    fields,
    "lifecycleRole",
    "manufacturedDate",
    passport,
    unlockedPassport,
    dynamicValues
  );
  const manufactureContext = findFieldEntryByRole(
    fields,
    "lifecycleRole",
    "manufacturedContext",
    passport,
    unlockedPassport,
    dynamicValues
  );
  const putIntoService = findFieldEntryByRole(
    fields,
    "lifecycleRole",
    "putIntoServiceDate",
    passport,
    unlockedPassport,
    dynamicValues
  );
  const updatedAt = lastUpdateAt || passport?.updatedAt || passport?.createdAt || "";
  const manufacturingPlace = manufactureContext ? formatValue(manufactureContext.raw) : "";

  return [
    {
      date: manufactured ? formatValue(manufactured.raw) : "",
      title: "Manufactured",
      textLines: [
        manufactured ? "Product manufactured." : "",
        manufacturingPlace ? `Manufacturing place: ${manufacturingPlace}` : "",
      ].filter(Boolean),
    },
    {
      date: putIntoService ? formatValue(putIntoService.raw) : "",
      title: "Put into service",
      textLines: [putIntoService ? "Product put into service." : ""].filter(Boolean),
    },
    {
      date: formatIsoDate(updatedAt),
      title: "DPP updated",
      textLines: [updatedAt ? "Latest data, QR binding, and signature checked." : ""].filter(Boolean),
    },
  ];
}

function buildHeaderRows(passport, typeDef, companyData, lastUpdateAt) {
  const systemHeader = normalizeSystemPassportHeader(typeDef?.fieldsJson?.systemHeader || typeDef?.systemHeader);
  const sections = Array.isArray(typeDef?.fieldsJson?.sections) ? typeDef.fieldsJson.sections : [];
  return resolveSystemHeaderEntries(sections, systemHeader)
    .filter((entry) => entry.sourceType === "managed" || !isViewerHiddenField(entry.field))
    .map((entry) => ({
      key: entry.managedKey || entry.fieldKey || entry.slotKey,
      label: entry.label || entry.fieldKey || entry.slotKey,
      value: formatValue(
        entry.sourceType === "managed"
          ? resolveManagedSystemHeaderValue(entry.managedKey, { passport, typeDef, lastUpdateAt })
          : appendUnitToDisplayValue(passport?.[entry.fieldKey], entry.field)
      ),
    }));
}

function buildTrustRows(passport, carrierAuthenticity, sigVerification) {
  const verificationEvidence = Array.isArray(carrierAuthenticity?.dataCarrierVerificationEvidence)
    ? carrierAuthenticity.dataCarrierVerificationEvidence
    : [];
  const latestVerification = verificationEvidence[0] || null;

  return [
    ["Signature status", sigVerification?.status || ""],
    ["Signature timestamp", formatIsoDate(sigVerification?.signedAt)],
    ["Signing key", sigVerification?.keyId || ""],
    ["Trusted viewer host", carrierAuthenticity?.trustedViewerHost || ""],
    ["Trusted viewer origin", carrierAuthenticity?.trustedViewerOrigin || ""],
    ["Carrier security status", carrierAuthenticity?.carrierSecurityStatus || ""],
    ["Carrier authentication", carrierAuthenticity?.carrierAuthenticationMethod || ""],
    ["Counterfeit risk level", carrierAuthenticity?.counterfeitRiskLevel || ""],
    ["Issuer certificate", carrierAuthenticity?.issuerCertificateId || ""],
    ["Signed carrier payload", carrierAuthenticity?.signedCarrierPayload ? "Available" : "Not stored"],
    ["QR print specification", carrierAuthenticity?.qrPrintSpecification ? `${carrierAuthenticity.qrPrintSpecification.symbology} · ECC ${carrierAuthenticity.qrPrintSpecification.errorCorrectionLevel}` : ""],
    ["Latest verification", formatIsoDate(latestVerification?.verifiedAt) ? `${latestVerification.printGrade || "recorded"} · ${formatIsoDate(latestVerification?.verifiedAt)}` : ""],
    ["Current viewer host", typeof window !== "undefined" ? window.location.host : ""],
    ["Public passport URL", passport?.linkedData?.publicUrl || ""],
  ].filter(([, value]) => isFilled(value));
}

function buildVerificationRows(verificationBundle) {
  if (!verificationBundle) return [];
  return [
    ["DPP integrity", verificationBundle.integrity || ""],
    ["Signer", verificationBundle.signedBy === "did:web:www.claros-dpp.online" ? "Platform issuer" : (verificationBundle.signedBy || "")],
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
      const isDocumentArtifact = field.type === "file" || isPdfLikeUrl(rawText);
      if (!resolved.isLocked && !isDocumentArtifact) return null;
      if (!resolved.isLocked && !isFilled(resolved.raw)) return null;

      return {
        field,
        fieldLabel: formatFieldLabelWithUnit(translateSchemaLabel(lang, field), field),
        ...resolved,
      };
    })
    .filter(Boolean);
}

function DataArtifactPreview({ field, raw, label, onPreviewImage, onRefreshFieldUrl = null }) {
  if (!isFilled(raw)) return null;
  if (field.type === "file" || isPdfLikeUrl(raw)) {
    return <FileCell url={raw} label={label} onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(field.key, raw) : null} />;
  }
  if (field.type === "symbol" || isImageLikeUrl(raw)) {
    return (
      <div className="artifact-image-wrap">
        <button
          type="button"
          className="artifact-image-button"
          onClick={async () => {
            const nextRaw = onRefreshFieldUrl ? await onRefreshFieldUrl(field.key, raw) : raw;
            onPreviewImage?.(nextRaw || raw, label);
          }}
          aria-label={`Open larger preview for ${label}`}
        >
          <RefreshableImage
            src={raw}
            alt={label}
            className="artifact-image"
            onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(field.key, raw) : null}
          />
        </button>
      </div>
    );
  }
  const href = toHref(raw);
  if (field.type === "url" && href) {
    const handleOpen = async (e) => {
      if (typeof onRefreshFieldUrl !== "function") return;
      e.preventDefault();
      const nextUrl = await onRefreshFieldUrl(field.key, raw);
      window.open(toHref(nextUrl || raw), "_blank", "noopener,noreferrer");
    };
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="artifact-link" onClick={handleOpen}>
        {raw}
      </a>
    );
  }
  return null;
}

function DataFieldValue({ field, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang, onPreviewImage, onRefreshFieldUrl = null }) {
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
    fetchWithAuth(`${api}/api/passports/${passport.dppId}/dynamic-values/${field.key}/history?limit=500`)
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
    const tableColumns = normalizeTableColumns(field);
    const tableRows = parseTableRows(raw, field, { includeDefault: false });
    content = Array.isArray(tableRows) && tableRows.length > 0 ? (
      <div className="inline-table-wrap">
        <table className="inline-table">
          {tableColumns.length > 0 && (
            <thead>
              <tr>
                {tableColumns.map((column) => (
                  <th key={column.key}>{translateSchemaLabel(lang, { label: column.label || column.key })}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {tableRows.map((row, index) => (
              <tr key={`${field.key}-row-${index}`}>
                {tableColumns.map((column) => (
                  <td key={`${field.key}-cell-${index}-${column.key}`}>{isFilled(row?.[column.key]) ? String(row[column.key]) : "—"}</td>
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
    content = <DataArtifactPreview field={field} raw={raw} label={formatFieldLabelWithUnit(translateSchemaLabel(lang, field), field)} onPreviewImage={onPreviewImage} onRefreshFieldUrl={onRefreshFieldUrl} />;
  } else if (typeof raw === "string" && raw.includes("\n")) {
    content = renderTextBlock(raw, "field-value-text");
  } else if (isFilled(raw)) {
    content = <strong className="field-value-strong">{formatDisplayValue(field, raw)}</strong>;
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

function DocumentCard({ item, passport, unlockedPassport, onRequestUnlock, dynamicValues, lang, onRefreshFieldUrl = null }) {
  const { field, fieldLabel, isLocked } = item;
  const resolved = resolveFieldValue(field, passport, unlockedPassport, dynamicValues);
  const documentValue = !isLocked && isFilled(resolved.raw) ? resolved.raw : null;
  const handleOpenDocument = async (e) => {
    if (typeof onRefreshFieldUrl !== "function") return;
    e.preventDefault();
    const nextUrl = await onRefreshFieldUrl(field.key, documentValue);
    window.open(toHref(nextUrl || documentValue), "_blank", "noopener,noreferrer");
  };

  return (
    <article className="doc-card">
      <div className="doc-icon">{field.type === "symbol" ? "IMG" : field.type === "file" ? "PDF" : "LINK"}</div>
      <div>
        <h3>{fieldLabel}</h3>
      </div>
      <span className="badge neutral">{field.type}</span>
      <div className="doc-preview-area">
        {documentValue && (field.type === "symbol" || isImageLikeUrl(documentValue)) ? (
          <div className="doc-asset-shell">
            <div className="doc-asset-visual">
              <RefreshableImage
                src={documentValue}
                alt={fieldLabel}
                className="artifact-image"
                onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(field.key, documentValue) : null}
              />
            </div>
            <div className="doc-asset-actions">
              <a href={documentValue} target="_blank" rel="noopener noreferrer" className="pdf-open-link" onClick={handleOpenDocument}>
                Open
              </a>
            </div>
          </div>
        ) : (
          <DataFieldValue
            field={field}
            passport={passport}
            unlockedPassport={unlockedPassport}
            onRequestUnlock={onRequestUnlock}
            dynamicValues={dynamicValues}
            lang={lang}
            onRefreshFieldUrl={onRefreshFieldUrl}
          />
        )}
      </div>
    </article>
  );
}

export default function PublicPassportPortal({
  passport,
  companyData,
  typeDef,
  publicHistoryPayload = null,
  qrCode,
  qrLoading,
  unlockedPassport,
  onRequestUnlock,
  dynamicValues,
  lang,
  sigVerification,
  verificationBundle,
  carrierAuthenticity,
  onRefreshFieldUrl = null,
  isPreviewMode = false,
  isInactiveView = false,
  isObsolete = false,
  canonicalPublicPath = "",
  lastUpdateAt = null,
}) {
  const [activePage, setActivePage] = useState("overview");
  const [previewImage, setPreviewImage] = useState(null);
  const [publicHistoryState, setPublicHistoryState] = useState(() => (
    publicHistoryPayload
      ? { loading: false, loaded: true, data: publicHistoryPayload.history || [], failed: false }
      : { loading: false, loaded: false, data: [], failed: false }
  ));
  const passportDisplayName = typeDef?.displayName ||
    String(passport?.passportType || "Digital product passport").replace(/_/g, " ");
  const sections = (typeDef?.fieldsJson?.sections || typeDef?.sections || []).map((section) => ({
    ...section,
    fields: (section.fields || []).filter((field) => !isViewerHiddenField(field)),
  }));
  const fields = useMemo(() => flattenSections(sections), [sections]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activePage]);

  useEffect(() => {
    if (!publicHistoryPayload) return;
    setPublicHistoryState({
      loading: false,
      loaded: true,
      data: publicHistoryPayload.history || [],
      failed: false,
    });
  }, [publicHistoryPayload]);

  useEffect(() => {
    if (publicHistoryPayload || (!passport?.internalAliasId && !passport?.dppId) || publicHistoryState.loaded || publicHistoryState.loading) return;
    let cancelled = false;
    const loadHistory = async () => {
      setPublicHistoryState({ loading: true, loaded: false, data: [], failed: false });
      const endpoints = [
        passport?.dppId
          ? `${api}/api/passports/${encodeURIComponent(passport.dppId)}/history`
          : null,
        passport?.internalAliasId
          ? `${api}/api/passports/by-product/${encodeURIComponent(passport.internalAliasId)}/history`
          : null,
      ].filter(Boolean);

      try {
        for (const endpoint of endpoints) {
          const { response, payload } = await fetchJsonWithTimeout(endpoint);
          if (!response.ok) continue;
          if (cancelled) return;
          setPublicHistoryState({
            loading: false,
            loaded: true,
            data: payload?.history || [],
            failed: false,
          });
          return;
        }
      } catch {
      }

      if (cancelled) return;
      setPublicHistoryState({ loading: false, loaded: true, data: [], failed: true });
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [passport?.dppId, passport?.internalAliasId, publicHistoryPayload, publicHistoryState.loaded, publicHistoryState.loading]);

  const productOverviewCards = buildProductOverviewCards(fields, passport, unlockedPassport, dynamicValues, lang);
  const displayModelName = passport?.modelName || productOverviewCards[0]?.value || "";
  const productImageEntry = passport?.productImage
    ? {
        raw: passport.productImage,
        field: { key: "productImage", label: "Product image", type: "image" },
      }
    : null;
  const overviewSymbols = fields
    .map((field) => ({ field, ...resolveFieldValue(field, passport, unlockedPassport, dynamicValues) }))
    .filter((entry) => {
      if (entry.isLocked || !isFilled(entry.raw)) return false;
      const text = `${normalizeText(entry.field.key)} ${normalizeText(entry.field.label)}`;
      return entry.field.type === "symbol" || text.includes("symbol") || text.includes("label");
    })
    .slice(0, 3);

  const lifecycleEvents = buildLifecycleEvents(fields, passport, unlockedPassport, dynamicValues, lastUpdateAt);
  const publicHistory = publicHistoryState.data || [];
  const compactPublicHistory = publicHistory.filter((entry) => entry.isCurrent || entry.inactivePath);
  const headerRows = buildHeaderRows(passport, typeDef, companyData, lastUpdateAt);
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

  const currentStatus = formatPassportStatus(passport?.releaseStatus || "");
  const heroMetrics = [
    ["Manufacturer", companyData?.companyName || passport?.manufacturer || passport?.manufacturedBy || ""],
    ["Product identifier", getBusinessIdentifierValue(passport, typeDef)],
    ["Status", currentStatus || ""],
    ["Last update", formatIsoDate(lastUpdateAt || passport?.updatedAt || passport?.createdAt)],
  ];

  return (
    <div className="passport-portal">
      <nav className="nav" aria-label="Passport sections">
        <div className="nav-inner">
          <a className="brand" href="#portal-top" aria-label="Back to passport top">
            <div className="logo">{passportIcon}</div>
            <div>
              <strong>{passportDisplayName}</strong>
              <span>Public digital product passport</span>
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
            <div className="kicker">{passportDisplayName}</div>
            <h1>{displayModelName}</h1>
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
            <div className={`product-photo${companyData?.companyLogo ? " has-img" : ""}`}>
              {companyData?.companyLogo && <img src={companyData.companyLogo} alt={`${companyData.companyName || "Company"} logo`} />}
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
                {productImageEntry && (
                  <RefreshableImage
                    src={productImageEntry.raw}
                    alt={displayModelName || "Product"}
                    className="overview-product-image"
                    onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(productImageEntry.field.key, productImageEntry.raw) : null}
                  />
                )}
              </div>
              {productOverviewCards.length > 0 && (
                <div className="overview-meta">
                  {productOverviewCards.map((card) => (
                    <div key={`${card.order}-${card.key}`} className="mini">
                      <span>{card.label}</span>
                      <strong>{card.value || ""}</strong>
                    </div>
                  ))}
                </div>
              )}

              {overviewSymbols.length > 0 && (
                <div className="overview-symbols" aria-label="Product labels and symbols">
                  <div className="overview-symbols-head">
                    <h3>Labels & symbols</h3>
                    <span>{overviewSymbols.length} fields</span>
                  </div>
                  <div className="symbol-list">
                    {overviewSymbols.map((entry) => (
                      <div key={entry.field.key} className="symbol-item">
                        <div>
                      <span>{formatFieldLabelWithUnit(translateSchemaLabel(lang, entry.field), entry.field)}</span>
                          {entry.field.type === "symbol" || isImageLikeUrl(entry.raw) ? (
                            <button
                              type="button"
                              className="overview-symbol-button"
                              onClick={async () => {
                                const nextSrc = onRefreshFieldUrl ? await onRefreshFieldUrl(entry.field.key, entry.raw) : entry.raw;
                                setPreviewImage({ src: nextSrc || entry.raw, label: formatFieldLabelWithUnit(translateSchemaLabel(lang, entry.field), entry.field) });
                              }}
                              aria-label={`Open larger preview for ${formatFieldLabelWithUnit(translateSchemaLabel(lang, entry.field), entry.field)}`}
                            >
                              <RefreshableImage
                                src={entry.raw}
                                alt={formatFieldLabelWithUnit(translateSchemaLabel(lang, entry.field), entry.field)}
                                className="overview-symbol-image"
                                onRefreshUrl={onRefreshFieldUrl ? () => onRefreshFieldUrl(entry.field.key, entry.raw) : null}
                              />
                            </button>
                          ) : (
                            <strong>{formatDisplayValue(entry.field, entry.raw)}</strong>
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
                    <h3>This passport is signed by the platform issuer.</h3>
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
                      {(event.textLines || []).length > 0 && (
                        <div className="event-lines">
                          {event.textLines.map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="public-history-inline-block">
                <h3>Update history</h3>
                {publicHistoryState.loading ? (
                  <div className="pv-history-state">Loading history…</div>
                ) : publicHistoryState.failed ? (
                  <div className="pv-history-state">Update history is unavailable right now.</div>
                ) : compactPublicHistory.length === 0 ? (
                  <div className="pv-history-state">No public update history is available yet.</div>
                ) : (
                  <div className="pv-history-list public-history-inline-list">
                    {compactPublicHistory.map((entry) => (
                      <article key={`public-history-${entry.versionNumber}`} className="pv-history-card">
                        <div className="pv-history-card-top">
                          <div className="pv-history-version-group">
                            <span className="pv-history-version-pill">v{entry.versionNumber}</span>
                            <span className={`pv-history-status ${entry.releaseStatus}`}>{formatPassportStatus(entry.releaseStatus)}</span>
                            {entry.isCurrent && <span className="pv-history-current">Current</span>}
                          </div>
                        </div>
                        <div className="pv-history-meta pv-history-meta-compact">
                          <span>{formatIsoDate(entry.updatedAt || entry.createdAt) || ""}</span>
                          {(entry.publicPath || entry.inactivePath) && (
                            <a
                              href={entry.isCurrent ? entry.publicPath : entry.inactivePath}
                              className="pv-history-open-link"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {entry.isCurrent ? "Open current passport" : `Open v${entry.versionNumber} snapshot`}
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
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
          <h2 className="data-title">Passport data by section</h2>
          <div className="category-stack">
            {sections.map((section, sectionIndex) => (
              <details key={section.key || sectionIndex} className="category" open={sectionIndex === 0}>
                <summary>
                  <div className="cat-title">
                    <span className="cat-index">{String(sectionIndex + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{translateSchemaLabel(lang, section)}</h3>
                    </div>
                  </div>
                  <div className="cat-meta">
                    <span className="badge neutral">{(section.fields || []).length} fields</span>
                    <span className="chevron" aria-hidden="true" />
                  </div>
                </summary>
                <ul className="field-list">
                  {(section.fields || []).map((field) => (
                    <li key={field.key} className="field-row">
                      <span className="field-key">{formatFieldLabelWithUnit(translateSchemaLabel(lang, field), field)}</span>
                      <div className="field-value">
                        <DataFieldValue
                          field={field}
                          passport={passport}
                          unlockedPassport={unlockedPassport}
                          onRequestUnlock={onRequestUnlock}
                          dynamicValues={dynamicValues}
                          lang={lang}
                          onPreviewImage={(src, label) => setPreviewImage({ src, label })}
                          onRefreshFieldUrl={onRefreshFieldUrl}
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
                <span>Signer: {verificationBundle.signedBy === "did:web:www.claros-dpp.online" ? "Platform issuer" : (verificationBundle.signedBy || "Unknown")}</span>
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
                onRefreshFieldUrl={onRefreshFieldUrl}
              />
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{companyData?.companyName || "Digital Product Passport Platform"} · Category-specific product passport</span>
          <span>Public passport viewer</span>
        </div>
      </footer>

      {previewImage && (
        <div
          className="pv-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={previewImage.label || "Image preview"}
          onClick={() => setPreviewImage(null)}
        >
          <div className="pv-image-lightbox-card" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="pv-image-lightbox-close"
              onClick={() => setPreviewImage(null)}
              aria-label="Close image preview"
            >
              ×
            </button>
            <img src={previewImage.src} alt={previewImage.label || "Image preview"} className="pv-image-lightbox-img" />
            {previewImage.label && <div className="pv-image-lightbox-label">{previewImage.label}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
