"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSystemPassportHeader } = require("../services/passport-header-fields");

const DEFAULT_MODULES_DIR = __dirname;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeComplianceProfile(profileDefinition = null, moduleDefinition = {}) {
  if (!profileDefinition || typeof profileDefinition !== "object" || Array.isArray(profileDefinition)) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" must define an explicit complianceProfile.`);
  }
  const baseProfile = clone(profileDefinition);
  const semanticModelKey = moduleDefinition.semanticModelKey || null;
  const contentSpecificationIds = Array.isArray(baseProfile.contentSpecificationIds)
    && baseProfile.contentSpecificationIds.length
      ? baseProfile.contentSpecificationIds
      : (semanticModelKey ? [semanticModelKey] : []);
  if (!baseProfile.key) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" complianceProfile.key is required.`);
  }
  if (!contentSpecificationIds.length) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" complianceProfile.contentSpecificationIds is required.`);
  }

  return {
    ...baseProfile,
    key: baseProfile.key,
    displayName: baseProfile.displayName || baseProfile.key,
    contentSpecificationIds,
    requiredPassportFields: Array.isArray(baseProfile.requiredPassportFields)
      ? baseProfile.requiredPassportFields
      : [],
    requireFacilityAtGranularities: Array.isArray(baseProfile.requireFacilityAtGranularities)
      ? baseProfile.requireFacilityAtGranularities
      : [],
    managedSemanticFields: Array.isArray(baseProfile.managedSemanticFields)
      ? baseProfile.managedSemanticFields
      : [],
  };
}

function normalizeCanonicalModuleSections(sections = [], sourceModuleKey = null) {
  return sections.map((section) => ({
    ...section,
    sourceModuleKey,
    fields: (section.fields || []).map((field) => {
      const nextField = {
        ...field,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
      };
      if (field.type === "table" && Array.isArray(field.table_columns)) {
        nextField.table_columns = field.table_columns.map((column) => ({
          ...column,
          canonicalLocked: true,
          sourceModuleKey,
          sourceModuleColumnKey: column.key,
        }));
        nextField.table_cols = nextField.table_columns.length;
      }
      return nextField;
    }),
  }));
}

function normalizeModuleDefinition(moduleDefinition = {}) {
  const definition = clone(moduleDefinition);
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const complianceProfile = normalizeComplianceProfile(definition.complianceProfile, definition);
  const sourceModuleKey = definition.moduleKey || null;

  return {
    moduleKey: definition.moduleKey,
    typeName: definition.typeName,
    displayName: definition.displayName,
    productCategory: definition.productCategory,
    productIcon: definition.productIcon || "📋",
    semanticModelKey: definition.semanticModelKey || null,
    complianceProfile,
    lifecycle: definition.lifecycle || null,
    fieldsJson: {
      schemaVersion: Number.parseInt(definition.schemaVersion, 10) || 1,
      systemHeader: normalizeSystemPassportHeader(definition.systemHeader),
      sections: normalizeCanonicalModuleSections(sections, sourceModuleKey),
      sourceModule: sourceModuleKey,
      identity: definition.identity,
      complianceProfileKey: complianceProfile.key,
      complianceProfile,
    },
  };
}

function normalizeModuleExport(moduleExport) {
  if (typeof moduleExport === "function") return moduleExport();
  return moduleExport;
}

function flattenModuleExports(moduleExport) {
  const normalizedExport = normalizeModuleExport(moduleExport);
  return Array.isArray(normalizedExport) ? normalizedExport : [normalizedExport];
}

function loadPassportTypeModuleDefinitions(options = {}) {
  const modulesDir = options.modulesDir || DEFAULT_MODULES_DIR;
  if (!fs.existsSync(modulesDir)) return [];

  return fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith(".js"))
    .filter((entry) => entry.name !== "index.js")
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const moduleExport = require(path.join(modulesDir, entry.name));
      return flattenModuleExports(moduleExport);
    })
    .filter((moduleDefinition) => moduleDefinition && typeof moduleDefinition === "object");
}

function getPassportTypeModules(options = {}) {
  return loadPassportTypeModuleDefinitions(options).map(normalizeModuleDefinition);
}

function getPassportTypeModule(moduleKeyOrTypeName, options = {}) {
  const key = String(moduleKeyOrTypeName || "").trim();
  if (!key) return null;
  return getPassportTypeModules(options).find((definition) =>
    definition.moduleKey === key || definition.typeName === key
  ) || null;
}

function getComplianceProfileForPassportType(moduleKeyOrTypeName, typeDef = null, options = {}) {
  const sourceModule = typeDef?.fieldsJson?.sourceModule || typeDef?.fields_json?.sourceModule || null;
  const resolvedModule = getPassportTypeModule(sourceModule, options)
    || getPassportTypeModule(moduleKeyOrTypeName, options)
    || getPassportTypeModule(typeDef?.typeName || typeDef?.type_name, options);
  if (resolvedModule?.complianceProfile) return clone(resolvedModule.complianceProfile);
  return null;
}

function getComplianceProfileCatalog(options = {}) {
  const profilesByKey = new Map();
  for (const definition of getPassportTypeModules(options)) {
    if (!definition.complianceProfile?.key) continue;
    profilesByKey.set(definition.complianceProfile.key, clone(definition.complianceProfile));
  }
  return [...profilesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

module.exports = {
  getComplianceProfileCatalog,
  getComplianceProfileForPassportType,
  getPassportTypeModule,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
  normalizeComplianceProfile,
  normalizeModuleDefinition,
};
