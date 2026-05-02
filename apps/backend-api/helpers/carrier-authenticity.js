"use strict";

const FIELD_MAPPINGS = [
  { canonical: "carrierSecurityStatus", snake: "carrier_security_status", camel: "carrierSecurityStatus" },
  { canonical: "carrierAuthenticationMethod", snake: "carrier_authentication_method", camel: "carrierAuthenticationMethod" },
  { canonical: "carrierVerificationInstructions", snake: "carrier_verification_instructions", camel: "carrierVerificationInstructions" },
  { canonical: "signedCarrierPayload", snake: "signed_carrier_payload", camel: "signedCarrierPayload" },
  { canonical: "issuerCertificateId", snake: "issuer_certificate_id", camel: "issuerCertificateId" },
  { canonical: "carrierCompatibilityProfiles", snake: "carrier_compatibility_profiles", camel: "carrierCompatibilityProfiles" },
  { canonical: "physicalCarrierSecurityFeatures", snake: "physical_carrier_security_features", camel: "physicalCarrierSecurityFeatures" },
  { canonical: "trustedViewerOrigin", snake: "trusted_viewer_origin", camel: "trustedViewerOrigin" },
  { canonical: "trustedViewerHost", snake: "trusted_viewer_host", camel: "trustedViewerHost" },
  { canonical: "counterfeitRiskLevel", snake: "counterfeit_risk_level", camel: "counterfeitRiskLevel" },
  { canonical: "antiCounterfeitInstructions", snake: "anti_counterfeit_instructions", camel: "antiCounterfeitInstructions" },
  { canonical: "safetyWarnings", snake: "safety_warnings", camel: "safetyWarnings" },
  { canonical: "qrPrintSpecification", snake: "qr_print_specification", camel: "qrPrintSpecification" },
  { canonical: "dataCarrierPlacementRules", snake: "data_carrier_placement_rules", camel: "dataCarrierPlacementRules" },
  { canonical: "dataCarrierVerificationEvidence", snake: "data_carrier_verification_evidence", camel: "dataCarrierVerificationEvidence" },
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
  } catch {
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
  const quietZone = Number(value.quietZoneModules ?? value.quiet_zone_modules);
  if (Number.isFinite(quietZone) && quietZone < 4) {
    errors.push("qrPrintSpecification.quietZoneModules must be at least 4");
  }

  const modulePixels = Number(value.modulePixelSize ?? value.module_pixel_size);
  if (Number.isFinite(modulePixels) && modulePixels < 4) {
    errors.push("qrPrintSpecification.modulePixelSize must be at least 4 for print-source exports");
  }

  const qualityChecks = Array.isArray(value.qualityChecks) ? value.qualityChecks : [];
  const failedChecks = qualityChecks
    .filter((check) => isPlainObject(check) && check.passed === false)
    .map((check) => normalizeOptionalText(check.key) || "quality_check");
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
  } catch {
    return null;
  }
}

function normalizeCarrierAuthenticityMetadata(value) {
  const source = parseStoredCarrierAuthenticity(value) || (isPlainObject(value) ? value : null);
  if (!source) return null;

  const normalized = {};
  for (const field of FIELD_MAPPINGS) {
    const rawValue = source[field.canonical] ?? source[field.snake] ?? source[field.camel];
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

  const nestedProvided =
    Object.prototype.hasOwnProperty.call(source, "carrier_authenticity")
    || Object.prototype.hasOwnProperty.call(source, "carrierAuthenticity");
  const nestedValue = source.carrier_authenticity ?? source.carrierAuthenticity;
  const clear = nestedProvided && nestedValue === null;

  const updates = {};
  let provided = clear;

  const nestedSource = isPlainObject(nestedValue) ? nestedValue : {};

  for (const field of FIELD_MAPPINGS) {
    const hasDirectSnake = Object.prototype.hasOwnProperty.call(source, field.snake);
    const hasDirectCamel = Object.prototype.hasOwnProperty.call(source, field.camel);
    const hasNestedSnake = Object.prototype.hasOwnProperty.call(nestedSource, field.snake);
    const hasNestedCamel = Object.prototype.hasOwnProperty.call(nestedSource, field.camel);
    const hasNestedCanonical = Object.prototype.hasOwnProperty.call(nestedSource, field.canonical);
    const hasField = hasDirectSnake || hasDirectCamel || hasNestedSnake || hasNestedCamel || hasNestedCanonical;
    if (!hasField) continue;

    provided = true;
    let rawValue;
    if (hasDirectSnake) rawValue = source[field.snake];
    else if (hasDirectCamel) rawValue = source[field.camel];
    else if (hasNestedSnake) rawValue = nestedSource[field.snake];
    else if (hasNestedCamel) rawValue = nestedSource[field.camel];
    else rawValue = nestedSource[field.canonical];

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

  const signCarrierPayloadRaw = source.sign_carrier_payload ?? source.signCarrierPayload;
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
  FIELD_MAPPINGS,
  parseStoredCarrierAuthenticity,
  normalizeCarrierAuthenticityMetadata,
  validateQrPrintSpecification,
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
  buildCarrierAuthenticityResponseFields,
};
