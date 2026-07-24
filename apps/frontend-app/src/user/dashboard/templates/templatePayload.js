import { flattenSchemaFieldsFromSections } from "../../../shared/passports/passportSchemaUtils";

export function hasUserPopulatedTemplateValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasUserPopulatedTemplateValue);
  if (typeof value === "object") {
    return Object.values(value).some(hasUserPopulatedTemplateValue);
  }
  return String(value).trim().length > 0;
}

export function buildUserTemplateFields(sections, fieldValues, modelDataKeys) {
  const values = fieldValues && typeof fieldValues === "object" ? fieldValues : {};
  const modelKeys = modelDataKeys instanceof Set ? modelDataKeys : new Set(modelDataKeys || []);

  return flattenSchemaFieldsFromSections(sections || [])
    .filter((field) => Object.prototype.hasOwnProperty.call(values, field.key))
    .filter((field) => hasUserPopulatedTemplateValue(values[field.key]))
    .map((field) => ({
      fieldKey: field.key,
      fieldValue: values[field.key],
      isModelData: modelKeys.has(field.key),
    }));
}
