import { translateFieldValue } from "../../app/providers/i18n";

const API = import.meta.env.VITE_API_URL || "";

// ─────────────────────────────────────────────────────────────────────────────
// Access-Control Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const ACCESS_LABEL_MAP = {
  consumers:            "Consumers",
  economicOperator:    "Economic Operators",
  manufacturer:         "Manufacturers",
  authorizedRepresentative: "Authorized Representatives",
  importer:             "Importers",
  distributor:          "Distributors",
  dealer:               "Dealers",
  fulfilmentServiceProvider: "Fulfilment Service Providers",
  delegatedOperator:   "Delegated Operators",
  professionalRepairer: "Professional Repairers",
  independentOperator: "Independent Operators",
  recycler:             "Recyclers",
  notifiedBodies:     "Notified Bodies",
  marketSurveillance: "Market Surveillance Authorities",
  customsAuthority:   "Customs Authorities",
  euCommission:       "The EU Commission",
  mainDppServiceProvider: "Main DPP Service Providers",
  backupDppServiceProvider: "Back-up DPP Service Providers",
  legitimateInterest: "Person with Legitimate Interest",
};

// ─────────────────────────────────────────────────────────────────────────────
// Viewer Content Helpers
// ─────────────────────────────────────────────────────────────────────────────
export function renderTextBlock(raw, className = "") {
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

export function isHeroSummaryField(field) {
  return field?.displayRole === "hero";
}

export function toInlineText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatLinkLabel(value) {
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(href).hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

export function getFieldUnitLabel(field) {
  const unitDisplay = String(field?.unitDisplay || "").trim();
  const unit = String(field?.unit || "").trim();
  if (unitDisplay && unitDisplay.toLowerCase() !== "n.a.") return unitDisplay;
  if (unit && unit.toLowerCase() !== "none") return unit;
  return "";
}

export function formatFieldLabelWithUnit(label, field) {
  const baseLabel = String(label || field?.label || field?.key || "").trim();
  const unitLabel = getFieldUnitLabel(field);
  if (!baseLabel) return unitLabel;
  return unitLabel ? `${baseLabel} (${unitLabel})` : baseLabel;
}

export function appendUnitToDisplayValue(value, field) {
  const baseValue = String(value ?? "").trim();
  const unitLabel = getFieldUnitLabel(field);
  if (!baseValue || !unitLabel) return baseValue;

  const normalizedValue = baseValue.toLowerCase();
  const normalizedUnit = unitLabel.toLowerCase();
  if (
    normalizedValue.endsWith(normalizedUnit)
    || normalizedValue.endsWith(`(${normalizedUnit})`)
  ) {
    return baseValue;
  }

  return `${baseValue} ${unitLabel}`;
}

export function formatIsoDate(value, { dateOnly = false } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  if (dateOnly) {
    return parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRESENTATION_TONES = {
  data: { tone: "data", eyebrow: "" },
  specCard: { tone: "data", eyebrow: "" },
  document: { tone: "document", eyebrow: "Evidence file" },
  evidenceFile: { tone: "document", eyebrow: "Evidence file" },
  table: { tone: "table", eyebrow: "Structured data" },
  dataset: { tone: "table", eyebrow: "Structured data" },
  compositionChart: { tone: "composition", eyebrow: "Composition" },
  liveMetric: { tone: "live", eyebrow: "Live metric" },
  link: { tone: "link", eyebrow: "Reference link" },
  symbol: { tone: "symbol", eyebrow: "Visual marker" },
  badge: { tone: "status", eyebrow: "Status" },
  status: { tone: "status", eyebrow: "Status" },
  narrative: { tone: "narrative", eyebrow: "Detailed information" },
  narrativeBlock: { tone: "narrative", eyebrow: "Detailed information" },
};

export function getFieldPresentation(field, raw, isLocked, pieItems) {
  if (isLocked) return { tone: "restricted", eyebrow: "Protected data" };
  if (pieItems) return PRESENTATION_TONES.compositionChart;
  const presentation = String(field?.presentation).trim();
  return PRESENTATION_TONES[presentation];
}
