"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSystemPassportHeader, validateSystemPassportHeader } = require("../services/passport-header-fields");
const { canonicalKeyFromSemanticId } = require("../shared/passports/canonical-field-keys");

const defaultModulesDir = __dirname;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePassportPolicy(policyDefinition = null, moduleDefinition = {}) {
  if (!policyDefinition || typeof policyDefinition !== "object" || Array.isArray(policyDefinition)) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" must define an explicit passportPolicy.`);
  }
  const basePolicy = clone(policyDefinition);
  const semanticModelKey = moduleDefinition.semanticModelKey || null;
  const contentSpecificationIds = Array.isArray(basePolicy.contentSpecificationIds)
    && basePolicy.contentSpecificationIds.length
      ? basePolicy.contentSpecificationIds
      : (semanticModelKey ? [semanticModelKey] : []);
  if (!basePolicy.key) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" passportPolicy.key is required.`);
  }
  if (!contentSpecificationIds.length) {
    throw new Error(`Passport module "${moduleDefinition.moduleKey || moduleDefinition.typeName || "unknown"}" passportPolicy.contentSpecificationIds is required.`);
  }

  return {
    ...basePolicy,
    key: basePolicy.key,
    displayName: basePolicy.displayName || basePolicy.key,
    contentSpecificationIds,
    defaultCarrierPolicyKey: basePolicy.defaultCarrierPolicyKey || null,
  };
}

function normalizeCanonicalModuleSections(sections = [], sourceModuleKey = null) {
  return sections.map((section) => ({
    ...section,
    sourceModuleKey,
    fields: (section.fields || []).map((field) => {
      const canonicalFieldKey = canonicalKeyFromSemanticId(field.semanticId);
      if (canonicalFieldKey && field.key !== canonicalFieldKey) {
        throw new Error(`Passport module field "${field.key || "unknown"}" must use canonical semantic key "${canonicalFieldKey}".`);
      }
      const nextField = {
        ...field,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
      };
      if (field.type === "table" && Array.isArray(field.tableColumns)) {
        nextField.tableColumns = field.tableColumns.map((column) => ({
          ...column,
          canonicalLocked: true,
          sourceModuleKey,
          sourceModuleColumnKey: column.key,
        })).map((column) => {
          const canonicalColumnKey = canonicalKeyFromSemanticId(column.semanticId);
          if (canonicalColumnKey && column.key !== canonicalColumnKey) {
            throw new Error(`Passport module table column "${field.key || "unknown"}.${column.key || "unknown"}" must use canonical semantic key "${canonicalColumnKey}".`);
          }
          return column;
        });
        nextField.tableColumnCount = nextField.tableColumns.length;
      }
      return nextField;
    }),
  }));
}

function normalizeModuleDefinition(moduleDefinition = {}) {
  const definition = clone(moduleDefinition);
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const passportPolicy = normalizePassportPolicy(definition.passportPolicy, definition);
  const sourceModuleKey = definition.moduleKey || null;
  const headerValidation = validateSystemPassportHeader(definition.systemHeader || {}, sections);
  if (!definition.systemHeader || !headerValidation.valid) {
    throw new Error(
      `Passport module "${definition.moduleKey || definition.typeName || "unknown"}" must define an explicit valid systemHeader.`
    );
  }

  return {
    moduleKey: definition.moduleKey,
    typeName: definition.typeName,
    displayName: definition.displayName,
    productCategory: definition.productCategory,
    productIcon: definition.productIcon || "📋",
    semanticModelKey: definition.semanticModelKey || null,
    passportPolicy,
    lifecycle: definition.lifecycle || null,
    fieldsJson: {
      schemaVersion: Number.parseInt(definition.schemaVersion, 10) || 1,
      systemHeader: normalizeSystemPassportHeader(definition.systemHeader),
      sections: normalizeCanonicalModuleSections(sections, sourceModuleKey),
      sourceModule: sourceModuleKey,
      identity: definition.identity,
      passportPolicyKey: passportPolicy.key,
      passportPolicy,
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
  const modulesDir = options.modulesDir || defaultModulesDir;
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

function getPassportPolicyForPassportType(moduleKeyOrTypeName, typeDef = null, options = {}) {
  const sourceModule = typeDef?.fieldsJson?.sourceModule || typeDef?.fieldsJson?.sourceModule || null;
  const resolvedModule = getPassportTypeModule(sourceModule, options)
    || getPassportTypeModule(moduleKeyOrTypeName, options)
    || getPassportTypeModule(typeDef?.typeName || typeDef?.typeName, options);
  if (resolvedModule?.passportPolicy) return clone(resolvedModule.passportPolicy);
  return null;
}

function getPassportPolicyCatalog(options = {}) {
  const policiesByKey = new Map();
  for (const definition of getPassportTypeModules(options)) {
    if (!definition.passportPolicy?.key) continue;
    policiesByKey.set(definition.passportPolicy.key, clone(definition.passportPolicy));
  }
  return [...policiesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

module.exports = {
  getPassportPolicyCatalog,
  getPassportPolicyForPassportType,
  getPassportTypeModule,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
  normalizePassportPolicy,
  normalizeModuleDefinition,
};
