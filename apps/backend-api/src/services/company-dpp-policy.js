"use strict";

const companyPolicyDefaults = Object.freeze({
  defaultGranularity: "item",
  allowGranularityOverride: false,
  mintModelDids: true,
  mintItemDids: true,
  mintFacilityDids: false,
  vcIssuanceEnabled: true,
  jsonldExportEnabled: true,
  semanticDictionaryEnabled: true,
});

const companyPolicyBoolFields = Object.freeze([
  "allowGranularityOverride",
  "mintModelDids",
  "mintItemDids",
  "mintFacilityDids",
  "vcIssuanceEnabled",
  "jsonldExportEnabled",
  "semanticDictionaryEnabled",
]);

const companyPolicyColumnNames = new Set(Object.keys(companyPolicyDefaults));

function validateCompanyDppPolicyInput(body = {}) {
  const nextPolicy = {};
  if (body.defaultGranularity !== undefined) {
    if (!["model", "batch", "item"].includes(body.defaultGranularity)) {
      throw new Error("defaultGranularity must be one of: model, batch, item");
    }
    nextPolicy.defaultGranularity = body.defaultGranularity;
  }

  companyPolicyBoolFields.forEach((field) => {
    if (body[field] === undefined) return;
    if (typeof body[field] !== "boolean") {
      throw new Error(`${field} must be a boolean`);
    }
    nextPolicy[field] = body[field];
  });

  return nextPolicy;
}

function buildCompanyDppPolicyUpdateQuery(companyId, updates = {}) {
  const setClauses = [];
  const params = [];
  let index = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (!companyPolicyColumnNames.has(key)) {
      throw new Error(`Unsupported company DPP policy field: ${key}`);
    }
    setClauses.push(`"${key}" = $${index++}`);
    params.push(value);
  }

  if (!setClauses.length) {
    throw new Error("At least one company DPP policy field is required");
  }

  setClauses.push('"updatedAt" = NOW()');
  params.push(companyId);
  return {
    sql: `UPDATE "companyDppPolicies"
          SET ${setClauses.join(", ")}
          WHERE "companyId" = $${index}
          RETURNING *`,
    params,
  };
}

module.exports = {
  buildCompanyDppPolicyUpdateQuery,
  companyPolicyBoolFields,
  companyPolicyDefaults,
  validateCompanyDppPolicyInput,
};
