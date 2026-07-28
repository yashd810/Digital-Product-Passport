"use strict";

(function exposeDerivedFieldMetadata(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleDerivedFieldMetadata = api;
})(typeof globalThis === "object" ? globalThis : null, () => {
  const fixedDataTypeByFieldType = Object.freeze({
    boolean: "boolean",
    date: "date",
    datetime: "datetime",
    file: "uri",
    symbol: "uri",
    table: "array",
    url: "uri",
  });
  // These names are owned by the passport registry/header and cannot be used as
  // module storage columns. A matching visible label is still allowed; its
  // generated key is qualified by the containing section instead.
  const reservedFieldKeys = new Set([
    "id", "dppId", "lineageId", "companyId", "createdBy", "createdAt",
    "passportType", "versionNumber", "releaseStatus", "deletedAt", "qrCode",
    "carrierAuthenticity", "carrierSecurityStatus", "carrierAuthenticationMethod",
    "carrierVerificationInstructions", "signedCarrierPayload", "issuerCertificateId",
    "carrierCompatibilityProfiles", "physicalCarrierSecurityFeatures", "trustedViewerOrigin",
    "trustedViewerHost", "counterfeitRiskLevel", "antiCounterfeitInstructions",
    "safetyWarnings", "qrPrintSpecification", "signCarrierPayload", "createdByEmail",
    "firstName", "lastName", "updatedBy", "updatedAt", "internalAliasId",
    "uniqueProductIdentifier", "passportPolicyKey", "contentSpecificationIds",
    "carrierPolicyKey", "economicOperatorId", "facilityId", "granularity",
    "digitalProductPassportId", "dppSchemaVersion", "dppStatus", "lastUpdate",
    "subjectDid", "dppDid", "companyDid",
  ]);

  function clean(value) {
    return String(value ?? "").trim();
  }

  function splitWords(value) {
    return clean(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  function camelCaseFromWords(value) {
    return splitWords(value)
      .map((word, index) => {
        const lower = word.toLowerCase();
        return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      })
      .join("");
  }

  function slugFromValue(value) {
    return splitWords(value).map((word) => word.toLowerCase()).join("-");
  }

  function stableHash(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value ?? "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, "0").slice(-7);
  }

  function fitCamelKey(value, maxLength, seed = value) {
    const key = camelCaseFromWords(value);
    if (!key || key.length <= maxLength) return key;
    const suffix = stableHash(seed);
    return `${key.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
  }

  function makeUniqueKey(candidate, used, { maxLength, seed }) {
    let key = fitCamelKey(candidate, maxLength, seed);
    if (!key) return "";
    if (!used.has(key)) {
      used.add(key);
      return key;
    }
    let index = 2;
    while (used.has(key)) {
      key = fitCamelKey(`${candidate} ${index}`, maxLength, `${seed}:${index}`);
      index += 1;
    }
    used.add(key);
    return key;
  }

  function deriveIdentityDescriptors(descriptors = [], { maxLength = 200, reservedKeys = new Set() } = {}) {
    const normalized = descriptors.map((descriptor, index) => ({
      ...descriptor,
      index,
      label: clean(descriptor?.label),
      contextLabels: (descriptor?.contextLabels || []).map(clean).filter(Boolean),
    }));
    const counts = normalized.reduce((result, descriptor) => {
      const base = camelCaseFromWords(descriptor.label);
      if (base) result.set(base, (result.get(base) || 0) + 1);
      return result;
    }, new Map());
    const used = new Set();
    return normalized.map((descriptor) => {
      const base = camelCaseFromWords(descriptor.label);
      if (!base) return { key: "", semanticSlug: "" };
      const contextual = counts.get(base) > 1 || reservedKeys.has(base)
        ? camelCaseFromWords([...descriptor.contextLabels, descriptor.label].join(" "))
        : base;
      const seed = clean(descriptor.discriminator)
        || `${descriptor.contextLabels.join("/")}/${descriptor.label}/${descriptor.index + 1}`;
      const key = makeUniqueKey(contextual || base, used, { maxLength, seed });
      return { key, semanticSlug: slugFromValue(key) };
    });
  }

  function unitKeyFromLabel(value) {
    return slugFromValue(value) || "none";
  }

  function defaultDataTypeForFieldType(fieldType) {
    return fixedDataTypeByFieldType[clean(fieldType)] || "string";
  }

  function valueDataTypeFromDataType(dataType) {
    return {
      array: "Array",
      integer: "Integer",
      decimal: "Decimal",
      boolean: "Boolean",
      date: "Date",
      datetime: "DateTime",
      uri: "URI",
    }[clean(dataType)] || "String";
  }

  function defaultObjectTypeForFieldType(fieldType) {
    const type = clean(fieldType);
    if (type === "table") return "DataElementCollection";
    if (["file", "url", "symbol"].includes(type)) return "RelatedResource";
    return "SingleValuedDataElement";
  }

  function defaultValueDataTypeForField(fieldType, dataType) {
    const type = clean(fieldType);
    if (type === "table") return "Array";
    if (["file", "url", "symbol"].includes(type)) return "URI";
    return valueDataTypeFromDataType(dataType);
  }

  function deriveTableColumns(columns = [], fieldDiscriminator = "field") {
    const source = Array.isArray(columns) ? columns : [];
    const identities = deriveIdentityDescriptors(
      source.map((column, index) => ({
        label: column?.columnLabel,
        discriminator: `${fieldDiscriminator}:column:${index + 1}`,
      })),
      { maxLength: 200 }
    );
    return source.map((column, index) => {
      const dataType = clean(column?.dataType) || "string";
      return {
        ...column,
        columnKey: identities[index].key,
        semanticSlug: identities[index].semanticSlug,
        dataType,
        unitKey: unitKeyFromLabel(column?.unitLabel),
        objectType: "SingleValuedDataElement",
        valueDataType: valueDataTypeFromDataType(dataType),
      };
    });
  }

  function deriveSections(sections = []) {
    const source = Array.isArray(sections) ? sections : [];
    const sectionEntries = [];
    const fieldEntries = [];
    const visit = (section, parentLabels, orderPath) => {
      const label = clean(section?.label);
      const labels = [...parentLabels, label];
      sectionEntries.push({ section, label, contextLabels: parentLabels, labels, orderPath });
      (Array.isArray(section?.fields) ? section.fields : []).forEach((field, fieldIndex) => {
        fieldEntries.push({
          field,
          label: clean(field?.fieldLabel),
          contextLabels: labels,
          orderPath: [...orderPath, fieldIndex + 1],
        });
      });
      (Array.isArray(section?.sections) ? section.sections : []).forEach((child, childIndex) => {
        visit(child, labels, [...orderPath, childIndex + 1]);
      });
    };
    source.forEach((section, index) => visit(section, [], [index + 1]));

    const sectionIdentities = deriveIdentityDescriptors(
      sectionEntries.map((entry) => ({
        label: entry.label,
        contextLabels: entry.contextLabels,
        discriminator: `section:${entry.orderPath.join(".")}`,
      })),
      { maxLength: 200 }
    );
    const fieldIdentities = deriveIdentityDescriptors(
      fieldEntries.map((entry) => ({
        label: entry.label,
        contextLabels: entry.contextLabels,
        discriminator: `field:${entry.orderPath.join(".")}`,
      })),
      { maxLength: 200, reservedKeys: reservedFieldKeys }
    );
    const sectionIdentityByObject = new Map(
      sectionEntries.map((entry, index) => [entry.section, sectionIdentities[index]])
    );
    const fieldIdentityByObject = new Map(
      fieldEntries.map((entry, index) => [entry.field, {
        ...fieldIdentities[index],
        discriminator: `field:${entry.orderPath.join(".")}`,
      }])
    );

    const cloneSection = (section) => {
      const sectionIdentity = sectionIdentityByObject.get(section) || { key: "" };
      const fields = (Array.isArray(section?.fields) ? section.fields : []).map((field) => {
        const generatedIdentity = fieldIdentityByObject.get(field) || { key: "", semanticSlug: "", discriminator: "field" };
        const canonicalOverride = camelCaseFromWords(field?.canonicalKeyOverride);
        const baseField = { ...(field || {}) };
        delete baseField.canonicalKeyOverride;
        const identity = canonicalOverride
          ? { ...generatedIdentity, key: canonicalOverride, semanticSlug: slugFromValue(canonicalOverride) }
          : generatedIdentity;
        const fieldType = clean(field?.fieldType) || "text";
        const fixedDataType = fixedDataTypeByFieldType[fieldType];
        const dataType = fixedDataType || clean(field?.dataType) || defaultDataTypeForFieldType(fieldType);
        return {
          ...baseField,
          ...(canonicalOverride ? { canonicalKeyOverride: canonicalOverride } : {}),
          fieldKey: identity.key,
          semanticSlug: identity.semanticSlug,
          dataType,
          unitKey: unitKeyFromLabel(field?.unitLabel),
          objectType: defaultObjectTypeForFieldType(fieldType),
          valueDataType: defaultValueDataTypeForField(fieldType, dataType),
          tableColumns: fieldType === "table"
            ? deriveTableColumns(field?.tableColumns, identity.discriminator)
            : [],
        };
      });
      const children = (Array.isArray(section?.sections) ? section.sections : []).map(cloneSection);
      const result = {
        ...section,
        key: sectionIdentity.key,
        fields,
      };
      if (children.length) result.sections = children;
      else delete result.sections;
      return result;
    };

    return source.map(cloneSection);
  }

  return {
    camelCaseFromWords,
    defaultDataTypeForFieldType,
    defaultObjectTypeForFieldType,
    defaultValueDataTypeForField,
    deriveIdentityDescriptors,
    deriveSections,
    deriveTableColumns,
    fixedDataTypeByFieldType,
    fitCamelKey,
    slugFromValue,
    reservedFieldKeys,
    unitKeyFromLabel,
    valueDataTypeFromDataType,
  };
});
