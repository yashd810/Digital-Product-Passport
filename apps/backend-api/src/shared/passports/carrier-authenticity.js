"use strict";

const fieldMappings = [
  { canonical: "carrierSecurityStatus" },
  { canonical: "carrierAuthenticationMethod" },
  { canonical: "carrierVerificationInstructions" },
  { canonical: "signedCarrierPayload" },
  { canonical: "issuerCertificateId" },
  { canonical: "carrierCompatibilityProfiles" },
  { canonical: "physicalCarrierSecurityFeatures" },
  { canonical: "trustedViewerOrigin" },
  { canonical: "trustedViewerHost" },
  { canonical: "counterfeitRiskLevel" },
  { canonical: "antiCounterfeitInstructions" },
  { canonical: "safetyWarnings" },
  { canonical: "qrPrintSpecification" },
  { canonical: "dataCarrierPlacementRules" },
  { canonical: "dataCarrierVerificationEvidence" },
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseJsonLikeString(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!["{", "["].includes(normalized[0])) return normalized;
  try {
    return JSON.parse(normalized);
  } catch (_error) {
    return normalized;
  }
}

function normalizeCompatibilityProfile(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (upper === "VDS" || upper === "VISIBLEDIGITALSEAL") return "VDS";
  if (upper === "DIGSIG" || upper === "ISOIEC20248DIGSIG") return "DigSig";
  return normalized;
}

function normalizeStringArray(value, { compatibilityProfiles = false } = {}) {
  if (value === null || value === undefined) return null;

  let items = value;
  if (typeof items === "string") {
    const parsed = parseJsonLikeString(items);
    items = Array.isArray(parsed) ? parsed : String(parsed || "").split(",");
  }
  if (!Array.isArray(items)) items = [items];

  const normalized = items
    .map((item) => compatibilityProfiles ? normalizeCompatibilityProfile(item) : normalizeOptionalText(item))
    .filter(Boolean);

  return normalized.length ? [...new Set(normalized)] : null;
}

function normalizeSignedCarrierPayload(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return parseJsonLikeString(value);
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return value;
  return value;
}

function normalizeObjectArray(value) {
  if (value === null || value === undefined) return null;
  let items = value;
  if (typeof items === "string") {
    const parsed = parseJsonLikeString(items);
    items = Array.isArray(parsed) ? parsed : [parsed];
  }
  if (!Array.isArray(items)) items = [items];
  const normalized = items.filter(isPlainObject);
  return normalized.length ? normalized : null;
}

function normalizePlacementRules(value) {
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) return value;
  const parsed = parseJsonLikeString(value);
  return isPlainObject(parsed) ? parsed : null;
}

function validateQrPrintSpecification(value) {
  if (!isPlainObject(value)) return { valid: true, errors: [] };

  const errors = [];
  const quietZone = Number(value.quietZoneModules);
  if (Number.isFinite(quietZone) && quietZone < 4) {
    errors.push("qrPrintSpecification.quietZoneModules must be at least 4");
  }

  const modulePixels = Number(value.modulePixelSize);
  if (Number.isFinite(modulePixels) && modulePixels < 4) {
    errors.push("qrPrintSpecification.modulePixelSize must be at least 4 for print-source exports");
  }

  const qualityChecks = Array.isArray(value.qualityChecks) ? value.qualityChecks : [];
  const failedChecks = qualityChecks
    .filter((check) => isPlainObject(check) && check.passed === false)
    .map((check) => normalizeOptionalText(check.key) || "qualityCheck");
  if (failedChecks.length) {
    errors.push(`qrPrintSpecification has failed quality checks: ${failedChecks.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

function parseStoredCarrierAuthenticity(value) {
  if (!value) return null;
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function normalizeCarrierAuthenticityMetadata(value) {
  const source = parseStoredCarrierAuthenticity(value) || (isPlainObject(value) ? value : null);
  if (!source) return null;

  const normalized = {};
  for (const field of fieldMappings) {
    const rawValue = source[field.canonical];
    if (rawValue === undefined) continue;

    if (field.canonical === "carrierCompatibilityProfiles") {
      const normalizedValue = normalizeStringArray(rawValue, { compatibilityProfiles: true });
      if (normalizedValue) normalized[field.canonical] = normalizedValue;
      continue;
    }

    if (field.canonical === "physicalCarrierSecurityFeatures") {
      const normalizedValue = normalizeStringArray(rawValue);
      if (normalizedValue) normalized[field.canonical] = normalizedValue;
      continue;
    }

    if (field.canonical === "safetyWarnings" || field.canonical === "antiCounterfeitInstructions") {
      const normalizedValue = normalizeStringArray(rawValue);
      if (normalizedValue) normalized[field.canonical] = normalizedValue;
      continue;
    }

    if (field.canonical === "signedCarrierPayload") {
      const normalizedValue = normalizeSignedCarrierPayload(rawValue);
      if (normalizedValue !== null) normalized[field.canonical] = normalizedValue;
      continue;
    }

    if (field.canonical === "qrPrintSpecification") {
      if (isPlainObject(rawValue)) normalized[field.canonical] = rawValue;
      else {
        const parsed = parseJsonLikeString(rawValue);
        if (isPlainObject(parsed)) normalized[field.canonical] = parsed;
      }
      continue;
    }

    if (field.canonical === "dataCarrierPlacementRules") {
      const normalizedValue = normalizePlacementRules(rawValue);
      if (normalizedValue) normalized[field.canonical] = normalizedValue;
      continue;
    }

    if (field.canonical === "dataCarrierVerificationEvidence") {
      const normalizedValue = normalizeObjectArray(rawValue);
      if (normalizedValue) normalized[field.canonical] = normalizedValue;
      continue;
    }

    const normalizedValue = normalizeOptionalText(rawValue);
    if (normalizedValue) normalized[field.canonical] = normalizedValue;
  }

  return Object.keys(normalized).length ? normalized : null;
}

function extractCarrierAuthenticityMutation(source = {}) {
  if (!isPlainObject(source)) {
    return { provided: false, clear: false, updates: {}, signCarrierPayload: false };
  }

  const nestedProvided = Object.prototype.hasOwnProperty.call(source, "carrierAuthenticity");
  const nestedValue = source.carrierAuthenticity;
  const clear = nestedProvided && nestedValue === null;

  const updates = {};
  let provided = clear;

  const nestedSource = isPlainObject(nestedValue) ? nestedValue : {};

  for (const field of fieldMappings) {
    const hasDirectCanonical = Object.prototype.hasOwnProperty.call(source, field.canonical);
    const hasNestedCanonical = Object.prototype.hasOwnProperty.call(nestedSource, field.canonical);
    const hasField = hasDirectCanonical || hasNestedCanonical;
    if (!hasField) continue;

    provided = true;
    const rawValue = hasDirectCanonical ? source[field.canonical] : nestedSource[field.canonical];

    if (field.canonical === "carrierCompatibilityProfiles") {
      updates[field.canonical] = normalizeStringArray(rawValue, { compatibilityProfiles: true });
      continue;
    }
    if (field.canonical === "physicalCarrierSecurityFeatures") {
      updates[field.canonical] = normalizeStringArray(rawValue);
      continue;
    }
    if (field.canonical === "safetyWarnings" || field.canonical === "antiCounterfeitInstructions") {
      updates[field.canonical] = normalizeStringArray(rawValue);
      continue;
    }
    if (field.canonical === "signedCarrierPayload") {
      updates[field.canonical] = normalizeSignedCarrierPayload(rawValue);
      continue;
    }
    if (field.canonical === "qrPrintSpecification") {
      updates[field.canonical] = isPlainObject(rawValue) ? rawValue : parseJsonLikeString(rawValue);
      if (!isPlainObject(updates[field.canonical])) updates[field.canonical] = null;
      continue;
    }
    if (field.canonical === "dataCarrierPlacementRules") {
      updates[field.canonical] = normalizePlacementRules(rawValue);
      continue;
    }
    if (field.canonical === "dataCarrierVerificationEvidence") {
      updates[field.canonical] = normalizeObjectArray(rawValue);
      continue;
    }

    updates[field.canonical] = normalizeOptionalText(rawValue);
  }

  const signCarrierPayloadRaw = source.signCarrierPayload;
  const signCarrierPayload =
    signCarrierPayloadRaw === true
    || String(signCarrierPayloadRaw || "").trim().toLowerCase() === "true";

  return { provided, clear, updates, signCarrierPayload };
}

function applyCarrierAuthenticityMutation(existingValue, mutation) {
  if (!mutation?.provided) return normalizeCarrierAuthenticityMetadata(existingValue);
  if (mutation.clear) return null;

  const next = {
    ...(normalizeCarrierAuthenticityMetadata(existingValue) || {}),
  };

  for (const [key, value] of Object.entries(mutation.updates || {})) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }

  return Object.keys(next).length ? next : null;
}

function buildCarrierAuthenticityResponseFields(value) {
  const metadata = normalizeCarrierAuthenticityMetadata(value);
  if (!metadata) return {};
  return { ...metadata };
}

module.exports = {
  fieldMappings,
  parseStoredCarrierAuthenticity,
  normalizeCarrierAuthenticityMetadata,
  validateQrPrintSpecification,
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
  buildCarrierAuthenticityResponseFields,
};
