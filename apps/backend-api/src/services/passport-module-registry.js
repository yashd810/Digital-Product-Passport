"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSystemPassportHeader, validateSystemPassportHeader } = require("./passport-header-fields");
const { canonicalKeyFromSemanticId } = require("../shared/passports/canonical-field-keys");
const { assertCanonicalSchemaSections } = require("../shared/passports/passport-helpers");
const { getPassportFieldDataTypeError } = require("../shared/passports/passport-field-data-types");
const {
  getSemanticGraphClass,
  normalizeAndValidateSemanticGraph,
  runtimeFieldFromSemanticProperty,
} = require("../shared/passports/passport-semantic-graph");

const defaultPackagesDir = path.resolve(__dirname, "../../passport-modules");
const packageModuleFileName = "module.js";
const packageManifestFileName = "manifest.json";

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

function normalizeCanonicalModuleSections(sections = [], sourceModuleKey = null, semanticGraph = null) {
  assertCanonicalSchemaSections(sections);
  const seenSectionKeys = new Set();
  const seenFieldKeys = new Set();
  const rootClass = getSemanticGraphClass(semanticGraph, semanticGraph.rootClassKey);
  const rootPropertiesByKey = new Map(
    (rootClass?.properties || []).map((property) => [property.key, property])
  );

  const normalizeField = (field) => {
    if (!field?.key) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}" contains a field without a key.`);
    }
    if (seenFieldKeys.has(field.key)) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}" contains duplicate field key "${field.key}".`);
    }
    seenFieldKeys.add(field.key);
    const graphProperty = rootPropertiesByKey.get(field.key);
    if (!graphProperty) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}" field "${field.key}" is missing from the semantic graph root class.`);
    }
    const expectedField = runtimeFieldFromSemanticProperty(graphProperty, semanticGraph);
    for (const metadataKey of [
      "semanticId",
      "domainClassKey",
      "domainClassIri",
      "rangeKind",
      "rangeClassKey",
      "rangeEnumKey",
      "rangeIri",
      "relationshipType",
      "minCount",
      "maxCount",
      "type",
      "dataType",
      "objectType",
      "valueDataType",
    ]) {
      if ((field?.[metadataKey] ?? null) !== (expectedField?.[metadataKey] ?? null)) {
        throw new Error(
          `Passport module "${sourceModuleKey || "unknown"}" field "${field.key}" has inconsistent semantic graph metadata "${metadataKey}".`
        );
      }
    }
    const dataTypeError = getPassportFieldDataTypeError(field, { requireExplicit: true });
    if (dataTypeError) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}": ${dataTypeError}`);
    }
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
  };

  const normalizeSection = (section) => {
    if (!section?.key) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}" contains a section without a key.`);
    }
    if (seenSectionKeys.has(section.key)) {
      throw new Error(`Passport module "${sourceModuleKey || "unknown"}" contains duplicate section key "${section.key}".`);
    }
    seenSectionKeys.add(section.key);
    const { sections: nestedSections, ...sectionRest } = section;
    return {
      ...sectionRest,
      sourceModuleKey,
      fields: (section.fields || []).map(normalizeField),
      sections: (Array.isArray(nestedSections) ? nestedSections : []).map(normalizeSection),
    };
  };

  const normalizedSections = sections.map(normalizeSection);
  const missingRootProperties = [...rootPropertiesByKey.keys()].filter((key) => !seenFieldKeys.has(key));
  if (missingRootProperties.length) {
    throw new Error(
      `Passport module "${sourceModuleKey || "unknown"}" semantic graph root properties are missing runtime fields: ${missingRootProperties.join(", ")}.`
    );
  }
  return normalizedSections;
}

function normalizeModuleDefinition(moduleDefinition = {}) {
  const definition = clone(moduleDefinition);
  if (Object.prototype.hasOwnProperty.call(definition, "groups")) {
    throw new Error(`Passport module "${definition.moduleKey || definition.typeName || "unknown"}" must use "sections"; the retired "groups" property is not supported.`);
  }
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  assertCanonicalSchemaSections(sections);
  const semanticGraph = normalizeAndValidateSemanticGraph(definition.semanticGraph, { required: true });
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
      sections: normalizeCanonicalModuleSections(sections, sourceModuleKey, semanticGraph),
      semanticGraph,
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

function parsePassportModuleKey(moduleKey) {
  const normalized = String(moduleKey || "").trim();
  const parts = normalized.split(":");
  if (
    parts.length !== 2
    || !parts.every((part) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))
  ) {
    throw new Error(
      `Passport module key "${normalized || "<missing>"}" must use lowercase "<family>:<version>" format.`
    );
  }
  const [family, version] = parts;
  return {
    moduleKey: normalized,
    family,
    version,
    folderName: `${family}-${version}`,
  };
}

function readPackageManifest(manifestPath, folderName) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Passport module folder "${folderName}" is missing ${packageManifestFileName}.`);
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("manifest must be a JSON object");
    }
    return manifest;
  } catch (error) {
    throw new Error(`Passport module folder "${folderName}" has an invalid manifest.json: ${error.message}`);
  }
}

function discoverPassportModulePackages(options = {}) {
  const packagesDir = path.resolve(options.packagesDir || defaultPackagesDir);
  if (!fs.existsSync(packagesDir)) return [];

  const packages = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const packageDir = path.join(packagesDir, entry.name);
      const modulePath = path.join(packageDir, packageModuleFileName);
      const manifestPath = path.join(packageDir, packageManifestFileName);
      if (!fs.existsSync(modulePath)) {
        throw new Error(`Passport module folder "${entry.name}" is missing ${packageModuleFileName}.`);
      }

      const moduleDefinition = normalizeModuleExport(require(modulePath));
      if (!moduleDefinition || typeof moduleDefinition !== "object" || Array.isArray(moduleDefinition)) {
        throw new Error(`Passport module folder "${entry.name}" must export one module object from ${packageModuleFileName}.`);
      }
      const identity = parsePassportModuleKey(moduleDefinition.moduleKey);
      if (entry.name !== identity.folderName) {
        throw new Error(
          `Passport module folder "${entry.name}" must be named "${identity.folderName}" for moduleKey "${identity.moduleKey}".`
        );
      }

      const manifest = readPackageManifest(manifestPath, entry.name);
      const manifestModelKey = String(manifest.semanticModelKey || "").trim();
      const moduleModelKey = String(moduleDefinition.semanticModelKey || "").trim();
      if (!manifestModelKey || manifestModelKey !== moduleModelKey) {
        throw new Error(
          `Passport module folder "${entry.name}" must use the same semanticModelKey in module.js and manifest.json.`
        );
      }

      return {
        ...identity,
        packageDir,
        modulePath,
        manifestPath,
        manifest,
        moduleDefinition,
      };
    });

  for (const key of ["moduleKey", "typeName", "semanticModelKey"]) {
    const seen = new Map();
    for (const packageDefinition of packages) {
      const value = key === "moduleKey"
        ? packageDefinition.moduleKey
        : packageDefinition.moduleDefinition[key];
      if (!value) continue;
      if (seen.has(value)) {
        throw new Error(
          `Passport module folders "${seen.get(value)}" and "${packageDefinition.folderName}" have duplicate ${key} "${value}".`
        );
      }
      seen.set(value, packageDefinition.folderName);
    }
  }

  return packages;
}

function loadPassportTypeModuleDefinitions(options = {}) {
  return discoverPassportModulePackages(options).map((packageDefinition) =>
    packageDefinition.moduleDefinition
  );
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
  const sourceModule = typeDef?.fieldsJson?.sourceModule || null;
  const resolvedModule = getPassportTypeModule(sourceModule, options)
    || getPassportTypeModule(moduleKeyOrTypeName, options)
    || getPassportTypeModule(typeDef?.typeName, options);
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
  defaultPackagesDir,
  discoverPassportModulePackages,
  getPassportPolicyCatalog,
  getPassportPolicyForPassportType,
  getPassportTypeModule,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
  parsePassportModuleKey,
  normalizePassportPolicy,
  normalizeModuleDefinition,
};
