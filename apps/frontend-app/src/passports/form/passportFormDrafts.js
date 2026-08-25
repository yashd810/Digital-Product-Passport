// Pure Passport Form draft transforms shared by create, edit, clone, and browser-draft flows.
import { getFieldUnitLabel } from "../../passport-viewer/utils/viewerHelpers";
import {
  alignRecordToSchemaKeys,
  buildSchemaFieldKeyMap,
  extractFieldValuesFromElements,
} from "../../shared/passports/schemaKeyUtils";
import { selectPassportDataEntryValues } from "../../shared/passports/passportSchemaVisibility";
import { passportFormDraftStoragePrefix } from "../../shared/security/passportFormDraftStorage";

/**
 * Pure draft and record helpers for Passport Form.
 *
 * These functions deliberately avoid React state and network access so create,
 * edit, clone, and browser-draft flows use the same deterministic values.
 */
export function getFieldInputPrompt(field) {
  const baseLabel = String(field?.label || field?.key || "value").toLowerCase();
  const unitLabel = getFieldUnitLabel(field);
  return unitLabel ? `Enter ${baseLabel} in ${unitLabel}` : `Enter ${baseLabel}`;
}

export function buildDraftStorageKey({ userId, mode, companyId, passportType, dppId }) {
  const parts = [
    userId || "no-user",
    mode || "create",
    companyId || "no-company",
    passportType || "no-type",
    dppId || "new",
  ];
  return `${passportFormDraftStoragePrefix}${parts.map((part) => encodeURIComponent(String(part))).join(":")}`;
}

export function normalizePersistedComparisonValue(value) {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") return value.trim();
  return value ?? null;
}

export function mergePassportRepresentations(rawRecord = {}, fullRecord = {}) {
  const rawFields = rawRecord?.fields && typeof rawRecord.fields === "object" ? rawRecord.fields : {};
  const fullFields = fullRecord?.fields && typeof fullRecord.fields === "object" ? fullRecord.fields : {};
  return {
    ...fullRecord,
    ...rawRecord,
    fields: {
      ...fullFields,
      ...rawFields,
    },
    elements: fullRecord?.elements || rawRecord?.elements,
  };
}

export function buildClonePrefill(record, sections) {
  if (!record || typeof record !== "object") {
    return { internalAliasId: "", formData: {} };
  }

  const keyMap = buildSchemaFieldKeyMap(sections);
  const mergedRecord = {
    ...record,
    ...(record.fields && typeof record.fields === "object" ? record.fields : {}),
    ...extractFieldValuesFromElements(record.elements, keyMap),
  };
  const aligned = alignRecordToSchemaKeys(mergedRecord, sections);
  const excludedKeys = new Set([
    "id", "dppId", "companyId", "lineageId", "createdAt", "updatedAt",
    "releaseStatus", "versionNumber", "archivedAt", "releasedAt", "deletedAt",
    "elements", "fields", "linkedData", "companyProfile", "subjectDid", "dppDid", "companyDid",
  ]);
  const formData = Object.fromEntries(
    Object.entries(selectPassportDataEntryValues(aligned, sections))
      .filter(([key, value]) => !excludedKeys.has(key) && value !== undefined)
  );

  return { internalAliasId: "", formData };
}

export function generateDraftLocalPassportId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return `dppId${globalThis.crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timestampPart = Date.now().toString(36);
  return `dppId${timestampPart}${randomPart}`;
}
