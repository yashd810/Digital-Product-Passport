import { translateFieldValue } from "../../app/providers/i18n";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ─────────────────────────────────────────────────────────────────────────────
// Access-Control Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const ACCESS_LABEL_MAP = {
  notified_bodies:     "Notified Bodies",
  market_surveillance: "Market Surveillance Authorities",
  eu_commission:       "The EU Commission",
  legitimate_interest: "Person with Legitimate Interest",
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

export function isHeroSummaryField(field, fieldLabel = "") {
  const key = String(field?.key || "").toLowerCase();
  const label = String(fieldLabel || field?.label || "").toLowerCase();

  if ([
    "guid",
    "product_id",
    "passport_identifier",
    "unique_passport_identifier",
    "manufactured_date",
    "manufacture_date",
    "manufacturing_date",
    "date_of_manufacture",
    "battery_identifier",
    "unique_battery_identifier",
    "battery_mass",
    "battery_weight",
    "weight",
    "serial_number",
    "battery_serial_number",
    "carbon_footprint_label_and_performance_class",
    "battery_chemistry",
    "manufacturer",
    "manufactured_by",
  ].includes(key)) {
    return true;
  }

  return (
    label === "guid" ||
    label.includes("passport identifier") ||
    label.includes("manufactured date") ||
    label.includes("manufacturing date") ||
    label.includes("manufacture date") ||
    label.includes("date of manufacture") ||
    label.includes("battery identifier") ||
    label.includes("battery mass") ||
    label.includes("battery weight") ||
    label === "weight" ||
    label.includes("product id") ||
    label.includes("battery serial") ||
    label.includes("serial number") ||
    label.includes("carbon footprint label and performance class") ||
    label.includes("battery chemistry") ||
    label.includes("manufacturer") ||
    label.includes("manufactured by")
  );
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

export function getFieldPresentation(field, raw, isLocked, pieItems) {
  if (isLocked) return { tone: "restricted", eyebrow: "Protected data" };
  if (field.type === "file") return { tone: "document", eyebrow: "Evidence file" };
  if (field.type === "table") return { tone: "table", eyebrow: "Structured data" };
  if (pieItems) return { tone: "composition", eyebrow: "Composition" };
  if (field.dynamic) return { tone: "live", eyebrow: "Live metric" };
  if (field.type === "url") return { tone: "link", eyebrow: "Reference link" };
  if (field.type === "symbol") return { tone: "symbol", eyebrow: "Visual marker" };
  if (field.type === "boolean") return { tone: "status", eyebrow: "Status" };
  if (typeof raw === "string" && (raw.includes("\n") || raw.length > 120)) {
    return { tone: "narrative", eyebrow: "Detailed information" };
  }
  return { tone: "data", eyebrow: "" };
}

export function getSummaryValue(field, raw, isLocked, lang) {
  if (isLocked) return "Restricted";
  if (field.type === "boolean") return translateFieldValue(lang, !!raw, "boolean");
  if (field.type === "file") return raw ? "Document available" : "No file";
  if (field.type === "table") {
    const rowCount = Array.isArray(raw) ? raw.length : null;
    return rowCount ? `${rowCount} rows` : "Table data";
  }
  if (field.type === "url" && raw) return formatLinkLabel(raw);
  if (raw === 0) return "0";
  if (!raw) return "Not provided";
  const text = toInlineText(raw);
  return text.length > 58 ? `${text.slice(0, 58).trim()}…` : text;
}

export function shouldFeatureInSummary(field, raw, isLocked, pieItems) {
  if (field.type === "file" || field.type === "table" || field.type === "symbol" || pieItems) {
    return false;
  }
  if (isLocked) return true;
  if (raw === 0) return true;
  if (!raw) return false;
  if (field.type === "boolean" || field.type === "url" || field.dynamic) return true;
  const text = toInlineText(raw);
  return !!text && text.length <= 72;
}

export function getSummaryHint(field, isLocked, isDynamic, tone) {
  if (isLocked) return "Unlock with an access key to view this value.";
  if (isDynamic) return "This value refreshes from live field updates.";
  if (field.type === "url") return "Reference link available for this field.";
  if (field.type === "boolean") return "Quick compliance-style status indicator.";
  if (tone === "narrative") return "Expanded context is available in the detail card below.";
  return "Highlighted here for faster scanning.";
}
