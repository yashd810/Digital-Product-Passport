"use strict";

function createCanonicalPassportSerializer({ didService, productIdentifierService = null }) {
  const HEADER_FIELD_ALIASES = {
    granularity: new Set(["granularity", "dpp_granularity", "dppgranularity"]),
    dppSchemaVersion: new Set(["dpp_schema_version", "dppschemaversion"]),
    dppStatus: new Set(["dpp_status", "dppstatus"]),
    economicOperatorId: new Set([
      "economic_operator_id",
      "economic_operator_identifier",
      "economicoperatorid",
      "economicoperatoridentifier",
    ]),
    facilityId: new Set([
      "facility_id",
      "facility_identifier",
      "facilityid",
      "facilityidentifier",
    ]),
    contentSpecificationIds: new Set([
      "content_specification_ids",
      "content_specification_id",
      "contentspecificationids",
      "contentspecificationid",
    ]),
  };

  function toIsoTimestamp(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function toTitleCaseGranularity(value) {
    const normalized = String(value || "model").trim().toLowerCase();
    if (!normalized) return "Model";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function toDppStatus(releaseStatus) {
    const normalized = String(releaseStatus || "").trim().toLowerCase();
    if (normalized === "released") return "Active";
    if (normalized === "obsolete") return "Inactive";
    if (normalized === "draft") return "Draft";
    if (normalized === "in_review") return "InReview";
    if (normalized === "in_revision") return "InRevision";
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Unknown";
  }

  function looksLikeJson(value) {
    const text = String(value || "").trim();
    return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = String(value || "").trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return value;
  }

  function parseNumeric(value, integerOnly = false) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return integerOnly ? Math.trunc(value) : value;
    }
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return value;
    const parsed = integerOnly ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  function parseArrayValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (looksLikeJson(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : value;
      } catch {
        return value;
      }
    }
    return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function coerceTypedFieldValue(fieldDef, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;
    if (typeof rawValue === "number" || typeof rawValue === "boolean") return rawValue;
    if (Array.isArray(rawValue)) return rawValue;
    if (typeof rawValue === "object") return rawValue;

    if (fieldDef?.type === "boolean" || fieldDef?.dataType === "boolean") {
      return parseBoolean(rawValue);
    }

    if (fieldDef?.type === "table") {
      if (looksLikeJson(rawValue)) {
        try {
          return JSON.parse(rawValue);
        } catch {
          return rawValue;
        }
      }
      return rawValue;
    }

    if (fieldDef?.dataType === "number") return parseNumeric(rawValue, false);
    if (fieldDef?.dataType === "integer") return parseNumeric(rawValue, true);

    if (looksLikeJson(rawValue)) {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    }

    return rawValue;
  }

  function findHeaderAliasValue(fieldValues, aliasSet) {
    for (const [fieldKey, value] of Object.entries(fieldValues)) {
      const compactKey = String(fieldKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (aliasSet.has(fieldKey) || aliasSet.has(compactKey)) {
        return value;
      }
    }
    return null;
  }

  function buildCanonicalPassportPayload(passport, typeDef, options = {}) {
    const publicOrigin = didService?.getPublicOrigin?.() || "http://localhost:3000";
    const company = options.company || null;
    const passportType = String(passport?.passport_type || typeDef?.type_name || options.passportType || "battery").trim().toLowerCase() || "battery";
    const didPassportType = "battery";
    const stableId = didService?.normalizeStableId?.(passport?.lineage_id || passport?.guid);
    const resolvedGranularity = String(
      options.granularity
      || findHeaderAliasValue(passport || {}, HEADER_FIELD_ALIASES.granularity)
      || passport?.granularity
      || company?.dpp_granularity
      || "model"
    ).trim().toLowerCase() || "model";
    const companySlug = company?.did_slug
      ? didService.normalizeCompanySlug(company.did_slug)
      : didService.normalizeCompanySlug(company?.company_name || `company-${passport.company_id}`);
    const companyDid = didService.generateCompanyDid(companySlug);
    const subjectDid = resolvedGranularity === "item"
      ? didService.generateItemDid(didPassportType, stableId)
      : didService.generateModelDid(didPassportType, stableId);
    const dppDid = didService.generateDppDid(resolvedGranularity, stableId);
    const derivedProductIdentifierDid = passport?.product_id
      ? productIdentifierService?.buildCanonicalProductDid?.({
          companyId: passport.company_id,
          passportType,
          rawProductId: passport.product_id,
          granularity: resolvedGranularity,
        }) || null
      : null;

    const schemaFields = (typeDef?.fields_json?.sections || [])
      .flatMap((section) => section.fields || [])
      .filter((field) => field?.key);

    const fields = {};
    for (const fieldDef of schemaFields) {
      const typedValue = coerceTypedFieldValue(fieldDef, passport?.[fieldDef.key]);
      if (typedValue === null) continue;
      fields[fieldDef.key] = typedValue;
    }

    const dppSchemaVersion = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.dppSchemaVersion) || passport?.dpp_schema_version || "prEN 18223:2025";
    const rawDppStatus = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.dppStatus) || passport?.dpp_status || null;
    const dppStatus = toDppStatus(passport?.release_status || rawDppStatus);
    const economicOperatorId = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.economicOperatorId) || passport?.economic_operator_id || companyDid;
    const facilityId = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.facilityId) || passport?.facility_id || null;
    const contentSpecificationIdsRaw =
      findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.contentSpecificationIds)
      || passport?.content_specification_ids
      || typeDef?.semantic_model_key
      || [];
    const contentSpecificationIds = Array.isArray(contentSpecificationIdsRaw)
      ? contentSpecificationIdsRaw
      : parseArrayValue(contentSpecificationIdsRaw);

    Object.values(HEADER_FIELD_ALIASES).forEach((aliases) => {
      Object.keys(fields).forEach((fieldKey) => {
        const compactKey = String(fieldKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (aliases.has(fieldKey) || aliases.has(compactKey)) {
          delete fields[fieldKey];
        }
      });
    });

    return {
      digitalProductPassportId: dppDid,
      uniqueProductIdentifier: passport.product_identifier_did || derivedProductIdentifierDid || null,
      granularity: toTitleCaseGranularity(resolvedGranularity),
      dppSchemaVersion,
      dppStatus,
      lastUpdate: toIsoTimestamp(passport.updated_at || passport.created_at),
      economicOperatorId,
      facilityId,
      contentSpecificationIds: Array.isArray(contentSpecificationIds) ? contentSpecificationIds : [],
      complianceProfileKey: passport.compliance_profile_key || null,
      carrierPolicyKey: passport.carrier_policy_key || null,
      subjectDid,
      dppDid,
      companyDid,
      passportType,
      versionNumber: Number(passport.version_number) || 1,
      fields,
    };
  }

  return {
    toDppStatus,
    coerceTypedFieldValue,
    buildCanonicalPassportPayload,
  };
}

module.exports = createCanonicalPassportSerializer;
