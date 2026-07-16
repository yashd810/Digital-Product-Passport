import { translateFieldValue } from "../../app/providers/i18n";

const api = import.meta.env.VITE_API_URL || "";

// ─────────────────────────────────────────────────────────────────────────────
// Access-Control Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const accessLabelMap = {
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
