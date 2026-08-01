// Form ownership policy: separates platform-managed, local-only, and editable data values.
import { getPassportDataEntryFieldKeys } from "../../shared/passports/passportSchemaVisibility";

/**
 * Field ownership policy for Passport Form.
 *
 * Defines which values are platform-owned, preserved only as local context, or
 * safe to send as editable passport data. Keeping the policy centralized
 * prevents create, edit, draft, and clone flows from drifting apart.
 */
export const platformGeneratedHeaderSlots = new Set([
  "digitalProductPassportId",
  "uniqueProductIdentifier",
  "internalAliasId",
  "granularity",
  "dppSchemaVersion",
  "dppStatus",
  "lastUpdate",
  "contentSpecificationIds",
  "subjectDid",
  "dppDid",
  "companyDid",
]);

export const applicationPrefilledFieldKeys = new Set(["economicOperatorIdentifierScheme"]);

export const nonEditableFormKeys = new Set([
  "id", "dppId", "companyId", "lineageId", "createdBy", "createdByEmail",
  "createdAt", "updatedBy", "updatedAt", "releaseStatus", "versionNumber",
  "archived", "archivedAt", "releasedAt", "deletedAt", "passportType", "qrCode",
  "subjectDid", "dppDid", "companyDid", "internalAliasId", "elements", "fields",
  "linkedData", "companyProfile", "firstName", "lastName",
]);

export const reservedSystemFieldKeys = new Set([
  "carrierAuthenticity", "carrierSecurityStatus", "carrierAuthenticationMethod",
  "carrierVerificationInstructions", "signedCarrierPayload", "issuerCertificateId",
  "carrierCompatibilityProfiles", "physicalCarrierSecurityFeatures", "trustedViewerOrigin",
  "trustedViewerHost", "counterfeitRiskLevel", "antiCounterfeitInstructions",
  "safetyWarnings", "qrPrintSpecification", "signCarrierPayload",
]);

export const nonPersistedPayloadKeys = new Set([
  "internalAliasId", "subjectDid", "dppDid", "companyDid", "schemaVersion",
]);

export const managedEditableKeys = new Set(["productImage"]);

const passportFormContextKeys = new Set([
  ...nonEditableFormKeys,
  ...nonPersistedPayloadKeys,
  ...reservedSystemFieldKeys,
  ...managedEditableKeys,
  "semanticModelKey",
]);

export function sanitizePassportFormData(record, sections) {
  const dataEntryKeys = getPassportDataEntryFieldKeys(sections);
  return Object.fromEntries(
    Object.entries(record && typeof record === "object" ? record : {})
      .filter(([key]) => dataEntryKeys.has(key) || passportFormContextKeys.has(key))
  );
}
