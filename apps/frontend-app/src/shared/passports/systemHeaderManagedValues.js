import { formatPassportStatus } from "../../passports/utils/passportStatus";
import { formatIsoDate } from "../../passport-viewer/utils/viewerHelpers";

function parseHeaderArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value ? [value] : [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [trimmed];
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

export function resolveManagedSystemHeaderValue(managedKey, {
  passport = {},
  typeDef = {},
  lastUpdateAt = null,
} = {}) {
  const policyContentSpecificationIds =
    typeDef?.fieldsJson?.passportPolicy?.contentSpecificationIds
    || typeDef?.passportPolicy?.contentSpecificationIds
    || null;
  const canonicalSubjects = passport?.linked_data?.canonical_subjects || {};
  const resolvedCompanyDid = passport?.companyDid || canonicalSubjects.companyDid || null;
  const resolvedFacilityDid = passport?.facilityDid || canonicalSubjects.facilityDid || null;
  const resolvedSubjectDid = passport?.subjectDid || canonicalSubjects.subjectDid || null;
  const resolvedDppDid = passport?.dppDid || canonicalSubjects.dppDid || null;

  switch (String(managedKey || "").trim()) {
    case "internalManagedDigitalProductPassportId":
      return passport?.digitalProductPassportId || passport?.dppId || null;
    case "internalManagedUniqueProductIdentifier":
      return passport?.uniqueProductIdentifier || null;
    case "internalManagedInternalAliasId":
      return passport?.internalAliasId || null;
    case "internalManagedGranularity":
      return passport?.granularity || "item";
    case "internalManagedDppSchemaVersion":
      return passport?.dppSchemaVersion || typeDef?.fieldsJson?.dppSchemaVersion || "prEN 18223:2025";
    case "internalManagedDppStatus":
      return formatPassportStatus(passport?.releaseStatus || passport?.dppStatus || "");
    case "internalManagedLastUpdate":
      return formatIsoDate(lastUpdateAt || passport?.updatedAt || passport?.createdAt) || null;
    case "internalManagedEconomicOperatorId":
      return resolvedCompanyDid || passport?.economicOperatorId || null;
    case "internalManagedFacilityId":
      return resolvedFacilityDid || null;
    case "internalManagedContentSpecificationIds":
      return parseHeaderArray(
        passport?.contentSpecificationIds
        || policyContentSpecificationIds
        || passport?.passportPolicyKey
        || typeDef?.semanticModelKey
      );
    case "internalManagedSubjectDid":
      return resolvedSubjectDid || null;
    case "internalManagedDppDid":
      return resolvedDppDid || null;
    case "internalManagedCompanyDid":
      return resolvedCompanyDid || null;
    default:
      return null;
  }
}
