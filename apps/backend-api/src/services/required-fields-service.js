"use strict";

const {
  getPassportPolicyForPassportType,
} = require("../passport-modules");
const { getPassportFieldValue } = require("../shared/passports/passport-helpers");

function normalizeText(value) {
  return String(value || "").trim();
}

function flattenSchemaFields(typeDef) {
  const sections = typeDef?.fieldsJson?.sections || [];
  return sections.flatMap((section) =>
    (section.fields || []).map((field) => ({
      ...field,
      sectionKey: section.key || null,
      sectionLabel: section.label || null,
    }))
  );
}

function normalizePassportTypeDefinition(typeDef) {
  if (!typeDef) return null;
  const fieldsJson = typeDef.fieldsJson || typeDef.fields_json || {};
  return {
    ...typeDef,
    typeName: typeDef.typeName || typeDef.type_name || null,
    displayName: typeDef.displayName || typeDef.display_name || null,
    productCategory: typeDef.productCategory || typeDef.product_category || null,
    semanticModelKey: typeDef.semanticModelKey || typeDef.semantic_model_key || null,
    passportPolicy: typeDef.passportPolicy || typeDef.passport_policy || fieldsJson.passportPolicy || null,
    fieldsJson,
  };
}

function normalizePassportPolicy(policy = null) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  const basePolicy = { ...policy };
  return {
    ...basePolicy,
    contentSpecificationIds: Array.isArray(basePolicy.contentSpecificationIds)
      ? basePolicy.contentSpecificationIds
      : [],
  };
}

function parseTableValue(value) {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  const text = normalizeText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row));
    return [];
  } catch {
    return [];
  }
}

function hasMeaningfulValue(field, value) {
  if (value === null || value === undefined) return false;

  if (field?.type === "boolean") {
    // Boolean fields default to false in storage, so only true counts as filled.
    return value === true;
  }

  if (field?.type === "table") {
    const rows = parseTableValue(value);
    return rows.some((row) =>
      Object.values(row).some((cell) => normalizeText(cell) !== "")
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => normalizeText(item) !== "");
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((item) => normalizeText(item) !== "");
  }

  return normalizeText(value) !== "";
}

function createIssue({ severity = "error", code, message, key = null, label = null, section = null }) {
  return {
    severity,
    code,
    message,
    ...(key ? { key } : {}),
    ...(label ? { label } : {}),
    ...(section ? { section } : {}),
  };
}

module.exports = function createRequiredFieldsService({
  pool,
} = {}) {
  async function loadPassportTypeDefinition(passportType) {
    const result = await pool.query(
      `SELECT id, "typeName" AS "typeName", "displayName" AS "displayName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson"
       FROM passport_types
       WHERE "typeName" = $1
       LIMIT 1`,
      [passportType]
    );
    return normalizePassportTypeDefinition(result.rows[0] || null);
  }

  function resolvePassportPolicyMetadata({ passportType = null, typeDef = null, granularity = null } = {}) {
    const normalizedTypeDef = normalizePassportTypeDefinition(typeDef);
    const policyLookupKey = passportType || normalizedTypeDef?.typeName || "";
    const policy = normalizePassportPolicy(
      normalizedTypeDef?.passportPolicy
      || getPassportPolicyForPassportType(policyLookupKey, normalizedTypeDef)
    );
    if (!policy) {
      throw new Error(`Passport policy is required for passport type "${policyLookupKey || "unknown"}".`);
    }
    const contentSpecificationIds = Array.isArray(policy.contentSpecificationIds) && policy.contentSpecificationIds.length
      ? policy.contentSpecificationIds
      : [];
    if (!contentSpecificationIds.length) {
      throw new Error(`Passport policy "${policy.key || "unknown"}" must define contentSpecificationIds.`);
    }
    return {
      ...policy,
      granularity: String(granularity || "item").trim().toLowerCase() || "item",
      contentSpecificationIds,
    };
  }

  function buildCompleteness(fields, passport) {
    const requiredFields = (fields || []).filter((field) => field?.required === true);
    const missingFields = [];
    let filledFields = 0;
    const applicableFieldDetails = [];

    for (const field of requiredFields) {
      const value = getPassportFieldValue(passport, field.key);
      if (hasMeaningfulValue(field, value)) {
        filledFields += 1;
        applicableFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel: null,
          mandatory: true,
          filled: true,
          section: field.sectionLabel || field.sectionKey || null,
        });
        continue;
      }

      const missingField = {
        key: field.key,
        label: field.label || field.key,
        type: field.type || "text",
        access: Array.isArray(field.access) ? field.access : ["public"],
        requirementLevel: null,
        mandatory: true,
        section: field.sectionLabel || field.sectionKey || null,
      };
      missingFields.push(missingField);
      applicableFieldDetails.push({
        key: field.key,
        label: field.label || field.key,
        requirementLevel: null,
        mandatory: true,
        filled: false,
        section: field.sectionLabel || field.sectionKey || null,
      });
    }

    const totalFields = requiredFields.length;
    const percentage = totalFields > 0
      ? Math.round((filledFields / totalFields) * 100)
      : 100;

    return {
      totalFields,
      filledFields,
      missingFields,
      missingMandatoryFields: missingFields,
      missingVoluntaryFields: [],
      applicableFields: applicableFieldDetails,
      ignoredFields: [],
      percentage,
    };
  }

  function buildRequiredFieldIssues(completeness) {
    return (completeness?.missingMandatoryFields || []).map((field) => createIssue({
      code: "REQUIRED_FIELD_MISSING",
      message: `Field "${field.label || field.key}" is required before release.`,
      key: field.key,
      label: field.label || field.key,
      section: field.section || null,
    }));
  }

  async function evaluatePassport(passport, passportType = null, providedTypeDef = null) {
    const basePassport = passport || {};
    const requestedPassportType = passportType || basePassport.passportType || basePassport.passport_type || "";
    const resolvedTypeDef = normalizePassportTypeDefinition(providedTypeDef)
      || await loadPassportTypeDefinition(requestedPassportType);

    if (!resolvedTypeDef) {
      return {
        passportType: requestedPassportType || null,
        semanticModelKey: null,
        completeness: { totalFields: 0, filledFields: 0, missingFields: [], percentage: 0 },
        accessIssues: [],
        governanceIssues: [],
        audienceLayerIssues: [],
        profileIssues: [],
        semanticIssues: [],
        requiredFieldIssues: [],
        managedSemanticFields: [],
        managedSemanticIssues: [],
        category: { raw: null, normalized: null, supported: [], focusFields: [], missingFocusFields: [], issues: [] },
        blockingIssues: [],
        directReleaseAllowed: true,
        workflowReleaseAllowed: true,
        workflowRequired: false,
      };
    }

    const resolvedPassportType = requestedPassportType || resolvedTypeDef.typeName;
    const policy = resolvePassportPolicyMetadata({
      passportType: resolvedPassportType,
      typeDef: resolvedTypeDef,
      granularity: basePassport.granularity,
    });
    const fields = flattenSchemaFields(resolvedTypeDef).map((field) => ({
      ...field,
      __semanticModelKey: normalizeText(resolvedTypeDef.semanticModelKey || policy.contentSpecificationIds?.[0] || ""),
      __passportPolicyKey: policy.key,
    }));
    const completeness = buildCompleteness(fields, basePassport);
    const requiredFieldIssues = buildRequiredFieldIssues(completeness);
    const blockingIssues = requiredFieldIssues.filter((issue) => issue.severity === "error");
    const releaseAllowed = blockingIssues.length === 0;

    return {
      policy,
      companyIdentity: null,
      passportType: resolvedTypeDef.typeName || null,
      semanticModelKey: normalizeText(resolvedTypeDef.semanticModelKey || policy.contentSpecificationIds?.[0] || "") || null,
      completeness,
      accessIssues: [],
      governanceIssues: [],
      audienceLayerIssues: [],
      profileIssues: [],
      semanticIssues: [],
      requiredFieldIssues,
      managedSemanticFields: [],
      managedSemanticIssues: [],
      category: {
        raw: null,
        normalized: null,
        supported: [],
        policyKind: null,
        productKind: null,
        fieldKey: null,
        semanticId: null,
        sourceWorkbook: null,
        sheetName: null,
        mandatoryFieldCount: completeness.totalFields,
        voluntaryFieldCount: 0,
        missingMandatoryFields: completeness.missingMandatoryFields,
        missingVoluntaryFields: [],
        ignoredFields: [],
        ruleCoverage: [],
        issues: [],
      },
      blockingIssues,
      directReleaseAllowed: releaseAllowed,
      workflowReleaseAllowed: releaseAllowed,
      workflowRequired: false,
    };
  }

  return {
    loadPassportTypeDefinition,
    evaluatePassport,
    resolvePassportPolicyMetadata,
  };
};
