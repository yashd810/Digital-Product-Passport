"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSystemPassportHeader } = require("../shared/identifiers/passport-header-fields");

const DEFAULT_MODULES_DIR = __dirname;

const DEFAULT_GENERIC_COMPLIANCE_PROFILE = {
  key: "genericDppV1",
  displayName: "Generic DPP Profile v1",
  contentSpecificationIds: ["genericDppV1"],
  requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
  requireCompanyOperatorIdentifier: true,
  requireCarrierPolicy: false,
  requireFacilityAtGranularities: [],
  defaultCarrierPolicyKey: "web_public_entry_v1",
  enforceSemanticMapping: false,
  requirePublicAccessLayer: false,
  categoryPolicy: null,
  managedSemanticFieldKeys: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeComplianceProfile(profileDefinition = null, moduleDefinition = {}) {
  const baseProfile = profileDefinition
    ? { ...DEFAULT_GENERIC_COMPLIANCE_PROFILE, ...clone(profileDefinition) }
    : clone(DEFAULT_GENERIC_COMPLIANCE_PROFILE);
  const semanticModelKey = moduleDefinition.semanticModelKey || null;
  const contentSpecificationIds = Array.isArray(baseProfile.contentSpecificationIds)
    && baseProfile.contentSpecificationIds.length
      ? baseProfile.contentSpecificationIds
      : (semanticModelKey ? [semanticModelKey] : DEFAULT_GENERIC_COMPLIANCE_PROFILE.contentSpecificationIds);

  return {
    ...baseProfile,
    key: baseProfile.key || DEFAULT_GENERIC_COMPLIANCE_PROFILE.key,
    displayName: baseProfile.displayName || DEFAULT_GENERIC_COMPLIANCE_PROFILE.displayName,
    contentSpecificationIds,
    requiredPassportFields: Array.isArray(baseProfile.requiredPassportFields)
      ? baseProfile.requiredPassportFields
      : DEFAULT_GENERIC_COMPLIANCE_PROFILE.requiredPassportFields,
    requireFacilityAtGranularities: Array.isArray(baseProfile.requireFacilityAtGranularities)
      ? baseProfile.requireFacilityAtGranularities
      : [],
    managedSemanticFieldKeys: Array.isArray(baseProfile.managedSemanticFieldKeys)
      ? baseProfile.managedSemanticFieldKeys
      : [],
  };
}

function normalizeModuleDefinition(moduleDefinition = {}) {
  const definition = clone(moduleDefinition);
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const complianceProfile = normalizeComplianceProfile(definition.complianceProfile, definition);

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
      sections,
      sourceModule: definition.moduleKey || null,
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

  const semanticModelKey = typeDef?.semanticModelKey || typeDef?.semantic_model_key || null;
  const fallbackProfile = normalizeComplianceProfile(null, { semanticModelKey });
  if (semanticModelKey) {
    fallbackProfile.contentSpecificationIds = [semanticModelKey];
  }
  return fallbackProfile;
}

function getComplianceProfileCatalog(options = {}) {
  const profilesByKey = new Map();
  for (const definition of getPassportTypeModules(options)) {
    if (!definition.complianceProfile?.key) continue;
    profilesByKey.set(definition.complianceProfile.key, clone(definition.complianceProfile));
  }
  profilesByKey.set(DEFAULT_GENERIC_COMPLIANCE_PROFILE.key, clone(DEFAULT_GENERIC_COMPLIANCE_PROFILE));
  return [...profilesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

module.exports = {
  DEFAULT_GENERIC_COMPLIANCE_PROFILE,
  getComplianceProfileCatalog,
  getComplianceProfileForPassportType,
  getPassportTypeModule,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
  normalizeComplianceProfile,
  normalizeModuleDefinition,
};
