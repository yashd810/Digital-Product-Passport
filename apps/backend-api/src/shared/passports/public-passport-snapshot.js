"use strict";

const {
  flattenSchemaFieldsFromSections,
} = require("./passport-helpers");

const publicMetadataKeys = new Set([
  "dppId",
  "lineageId",
  "passportType",
  "modelName",
  "uniqueProductIdentifier",
  "productIdentifierDid",
  "passportPolicyKey",
  "contentSpecificationIds",
  "carrierPolicyKey",
  "economicOperatorId",
  "economicOperatorIdentifierScheme",
  "facilityId",
  "granularity",
  "releaseStatus",
  "versionNumber",
  "qrCode",
  "createdAt",
  "updatedAt",
  "releasedAt",
  "archived",
  "backupPublicHandover",
  "carrierAuthenticity",
]);

function sanitizeCarrierAuthenticity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const sanitized = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (key === "dataCarrierVerificationEvidence") continue;
    if (key === "signedCarrierPayload" && childValue && typeof childValue === "object") {
      const { credential: _credential, ...verificationMetadata } = childValue;
      sanitized[key] = verificationMetadata;
      continue;
    }
    sanitized[key] = childValue;
  }
  return sanitized;
}

function buildPublicPassportSnapshot(passport, typeDef) {
  if (!passport || typeof passport !== "object") return passport;
  if (!typeDef?.fieldsJson) {
    const error = new Error("Passport type schema is required for a public snapshot");
    error.code = "passportTypeSchemaMissing";
    throw error;
  }

  const snapshot = {};
  for (const key of publicMetadataKeys) {
    if (!Object.prototype.hasOwnProperty.call(passport, key)) continue;
    snapshot[key] = key === "carrierAuthenticity"
      ? sanitizeCarrierAuthenticity(passport[key])
      : passport[key];
  }

  for (const field of flattenSchemaFieldsFromSections(typeDef.fieldsJson.sections || [])) {
    if (!field?.key || String(field.confidentiality || "").trim().toLowerCase() !== "public") continue;
    if (Object.prototype.hasOwnProperty.call(passport, field.key)) {
      snapshot[field.key] = passport[field.key];
    }
  }
  return snapshot;
}

module.exports = {
  buildPublicPassportSnapshot,
};
