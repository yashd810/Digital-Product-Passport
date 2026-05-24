"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");
const { getTable } = require("../src/shared/passports/passport-helpers");

const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";
const BATTERY_TERM_BASE_URL = "https://www.claros-dpp.online/dictionary/battery/v1/terms";
const LEGACY_BATTERY_FIELD_UPGRADES = {
  raw_material_cf: {
    key: "contributionOfRawMaterialAndPreprocessingLifecycleStage",
    label: "Contribution of raw material acquisition and pre-processing lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-raw-materials`,
  },
  lifetime_cf: {
    key: "batteryCarbonFootprintPerFunctionalUnit",
    label: "Battery carbon footprint per Functional Unit",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-per-kwh`,
  },
  recycling_cf: {
    key: "contributionOfEndOfLifeAndRecyclingLifecycleStage",
    label: "Contribution of end of life and recycling lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-end-of-life`,
  },
  total_cf: {
    key: "absoluteCarbonFootprint",
    label: "Absolute Carbon Footprint",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/absolute-carbon-footprint`,
  },
  cf_class: {
    key: "carbonFootprintPerformanceClass",
    label: "Carbon footprint performance class",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-class`,
  },
  reference_study: {
    key: "webLinkToPublicCarbonFootprintStudy",
    label: "Web link to public carbon footprint study",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-study-url`,
  },
};

const BATTERY_FIELD_UPGRADES_BY_KEY = {
  batteryCarbonFootprintPerFunctionalUnit: LEGACY_BATTERY_FIELD_UPGRADES.lifetime_cf,
  battery_carbon_functional_unit: LEGACY_BATTERY_FIELD_UPGRADES.lifetime_cf,
  battery_carbon_footprint_per_functional_unit: LEGACY_BATTERY_FIELD_UPGRADES.lifetime_cf,
  batterycarbonfootprintperfunctionalunit: LEGACY_BATTERY_FIELD_UPGRADES.lifetime_cf,
  contributionOfRawMaterialAcquisitionAndPreProcessingLifecycleStage: LEGACY_BATTERY_FIELD_UPGRADES.raw_material_cf,
  contribution_of_and_preprocessing: LEGACY_BATTERY_FIELD_UPGRADES.raw_material_cf,
  contribution_of_raw_material_and_preprocessing_lifecycle_stage: LEGACY_BATTERY_FIELD_UPGRADES.raw_material_cf,
  contributionofrawmaterialacquisitionandpreprocessinglifecyclest: LEGACY_BATTERY_FIELD_UPGRADES.raw_material_cf,
  contributionOfMainProductProductionLifecycleStage: {
    key: "contributionOfMainProductProductionLifecycleStage",
    label: "Contribution of main product production lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-production`,
  },
  contribution_of_product_production: {
    key: "contributionOfMainProductProductionLifecycleStage",
    label: "Contribution of main product production lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-production`,
  },
  contribution_of_main_product_production_lifecycle_stage: {
    key: "contributionOfMainProductProductionLifecycleStage",
    label: "Contribution of main product production lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-production`,
  },
  contributionofmainproductproductionlifecyclestage: {
    key: "contributionOfMainProductProductionLifecycleStage",
    label: "Contribution of main product production lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-production`,
  },
  contributionOfDistributionLifecycleStage: {
    key: "contributionOfDistributionLifecycleStage",
    label: "Contribution of distribution lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-distribution`,
  },
  contribution_of_distribution: {
    key: "contributionOfDistributionLifecycleStage",
    label: "Contribution of distribution lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-distribution`,
  },
  contribution_of_distribution_lifecycle_stage: {
    key: "contributionOfDistributionLifecycleStage",
    label: "Contribution of distribution lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-distribution`,
  },
  contributionofdistributionlifecyclestage: {
    key: "contributionOfDistributionLifecycleStage",
    label: "Contribution of distribution lifecycle stage",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/carbon-footprint-distribution`,
  },
  contributionOfEndOfLifeAndRecyclingLifecycleStage: LEGACY_BATTERY_FIELD_UPGRADES.recycling_cf,
  contribution_of_and_recycling: LEGACY_BATTERY_FIELD_UPGRADES.recycling_cf,
  contribution_of_end_of_life_and_recycling_lifecycle_stage: LEGACY_BATTERY_FIELD_UPGRADES.recycling_cf,
  contributionofendoflifeandrecyclinglifecyclestage: LEGACY_BATTERY_FIELD_UPGRADES.recycling_cf,
  carbonFootprintPerformanceClass: LEGACY_BATTERY_FIELD_UPGRADES.cf_class,
  carbon_footprint_performance_class: LEGACY_BATTERY_FIELD_UPGRADES.cf_class,
  carbonfootprintperformanceclass: LEGACY_BATTERY_FIELD_UPGRADES.cf_class,
  webLinkToPublicCarbonFootprintStudy: LEGACY_BATTERY_FIELD_UPGRADES.reference_study,
  web_link_footprint_study: LEGACY_BATTERY_FIELD_UPGRADES.reference_study,
  web_link_to_public_carbon_footprint_study: LEGACY_BATTERY_FIELD_UPGRADES.reference_study,
  weblinktopubliccarbonfootprintstudy: LEGACY_BATTERY_FIELD_UPGRADES.reference_study,
  absoluteBatteryCarbonFootprint: {
    key: "absoluteCarbonFootprint",
    label: "Absolute Carbon Footprint",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/absolute-carbon-footprint`,
  },
  absolute_carbon_footprint: {
    key: "absoluteCarbonFootprint",
    label: "Absolute Carbon Footprint",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/absolute-carbon-footprint`,
  },
  absolutebatterycarbonfootprint: {
    key: "absoluteCarbonFootprint",
    label: "Absolute Carbon Footprint",
    type: "text",
    semanticId: `${BATTERY_TERM_BASE_URL}/absolute-carbon-footprint`,
  },
};

const BATTERY_FIELD_RENAME_SOURCES = Object.entries(BATTERY_FIELD_UPGRADES_BY_KEY)
  .filter(([sourceKey, upgrade]) => sourceKey !== upgrade.key)
  .map(([sourceKey, upgrade]) => ({ sourceKey, upgrade }));

function normalizeAliasKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function toSnakeCase(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function dbIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function isBatteryPassportTypeRow(typeRow) {
  return String(typeRow?.semantic_model_key || "").trim() === BATTERY_DICTIONARY_MODEL_KEY
    || /battery/i.test(String(typeRow?.product_category || ""));
}

function isSafeSqlIdentifier(value) {
  return /^[a-z][a-z0-9_]*$/i.test(String(value || ""));
}

function quoteSqlIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function buildBatteryFieldUpgradeMap(typeRow) {
  const upgradeMap = new Map(Object.entries(BATTERY_FIELD_UPGRADES_BY_KEY));
  const sections = Array.isArray(typeRow?.fields_json?.sections) ? typeRow.fields_json.sections : [];

  for (const section of sections) {
    for (const field of Array.isArray(section?.fields) ? section.fields : []) {
      if (!field?.key) continue;
      const canonical = {
        key: field.key,
        label: field.label,
        type: field.type || "text",
        semanticId: field.semanticId || null,
      };
      const aliases = new Set([
        field.key,
        dbIdentifier(field.key),
        toSnakeCase(field.key),
        normalizeAliasKey(field.key),
        normalizeAliasKey(field.label),
      ]);
      for (const alias of aliases) {
        if (alias) upgradeMap.set(alias, canonical);
      }
    }
  }

  return upgradeMap;
}

function buildBatteryFieldRenameSources(fieldUpgradeMap) {
  const seen = new Set();
  const renameSources = [];

  for (const [sourceKey, upgrade] of fieldUpgradeMap.entries()) {
    if (!sourceKey || !upgrade?.key) continue;
    const signature = `${sourceKey}=>${upgrade.key}`;
    if (sourceKey === upgrade.key || seen.has(signature)) continue;
    seen.add(signature);
    renameSources.push({ sourceKey, upgrade });
  }

  return renameSources;
}

function normalizeBatteryPassportFieldsJson(fieldsJson = {}, fieldUpgradeMap = new Map()) {
  const sections = Array.isArray(fieldsJson?.sections) ? fieldsJson.sections : [];
  let changed = false;

  const nextSections = sections.map((section) => {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    const seenKeys = new Set();
    const nextFields = [];

    for (const field of fields) {
      if (!field || !field.key) continue;
      const fieldKey = String(field.key).trim();
      const upgrade = fieldUpgradeMap.get(fieldKey)
        || fieldUpgradeMap.get(dbIdentifier(fieldKey))
        || fieldUpgradeMap.get(toSnakeCase(fieldKey))
        || fieldUpgradeMap.get(normalizeAliasKey(fieldKey))
        || null;
      const nextField = upgrade
        ? {
            ...field,
            key: upgrade.key,
            label: upgrade.label,
            type: upgrade.type,
            semanticId: upgrade.semanticId,
          }
        : field;

      if (nextField.key !== field.key
        || nextField.label !== field.label
        || nextField.type !== field.type
        || nextField.semanticId !== field.semanticId) {
        changed = true;
      }

      if (seenKeys.has(nextField.key)) {
        changed = true;
        continue;
      }
      seenKeys.add(nextField.key);
      nextFields.push(nextField);
    }

    if (nextFields.length !== fields.length) changed = true;
    return {
      ...section,
      fields: nextFields,
    };
  });

  return {
    changed,
    fieldsJson: changed ? { ...fieldsJson, sections: nextSections } : fieldsJson,
  };
}

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function repairBatteryPassportTypes(db) {
  const typeRows = await db.query(
    `SELECT id, type_name, product_category, semantic_model_key, fields_json
     FROM passport_types
     ORDER BY type_name`
  );

  let updatedTypes = 0;

  for (const typeRow of typeRows.rows) {
    if (!isBatteryPassportTypeRow(typeRow)) continue;
    const fieldUpgradeMap = buildBatteryFieldUpgradeMap(typeRow);
    const currentFieldsJson = typeRow.fields_json && typeof typeRow.fields_json === "object"
      ? typeRow.fields_json
      : { sections: [] };
    const normalized = normalizeBatteryPassportFieldsJson(currentFieldsJson, fieldUpgradeMap);
    if (!normalized.changed) continue;

    const nextSchemaVersion = Number.parseInt(currentFieldsJson.schemaVersion, 10);
    const updatedFieldsJson = {
      ...normalized.fieldsJson,
      schemaVersion: Number.isFinite(nextSchemaVersion) && nextSchemaVersion > 0
        ? nextSchemaVersion + 1
        : 2,
    };

    await db.query(
      `UPDATE passport_types
       SET fields_json = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [typeRow.id, JSON.stringify(updatedFieldsJson)]
    );
    updatedTypes += 1;
  }

  return updatedTypes;
}

async function repairBatteryPassportValues(db) {
  const typeRows = await db.query(
    `SELECT type_name, product_category, semantic_model_key
     FROM passport_types
     ORDER BY type_name`
  );

  let updatedColumns = 0;
  let updatedArchives = 0;

  for (const typeRow of typeRows.rows) {
    if (!isBatteryPassportTypeRow(typeRow)) continue;

    const tableName = getTable(typeRow.type_name);
    if (!isSafeSqlIdentifier(tableName)) continue;
    const quotedTableName = quoteSqlIdentifier(tableName);
    const fieldUpgradeMap = buildBatteryFieldUpgradeMap(typeRow);
    const renameSources = buildBatteryFieldRenameSources(fieldUpgradeMap);

    for (const upgrade of new Map(Array.from(fieldUpgradeMap.values()).map((field) => [field.key, field])).values()) {
      if (!isSafeSqlIdentifier(upgrade.key)) continue;
      await db.query(`ALTER TABLE ${quotedTableName} ADD COLUMN IF NOT EXISTS ${quoteSqlIdentifier(upgrade.key)} TEXT`);
    }

    for (const { sourceKey, upgrade } of renameSources) {
      if (!isSafeSqlIdentifier(sourceKey) || !isSafeSqlIdentifier(upgrade.key)) continue;

      const oldColumnExists = await db.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
         LIMIT 1`,
        [tableName, sourceKey]
      );
      if (!oldColumnExists.rows.length) continue;
      if (dbIdentifier(sourceKey) === dbIdentifier(upgrade.key)) continue;

      await db.query(
        `UPDATE ${quotedTableName}
         SET ${quoteSqlIdentifier(upgrade.key)} = CASE
           WHEN ${quoteSqlIdentifier(upgrade.key)} IS NULL OR ${quoteSqlIdentifier(upgrade.key)} = '' THEN ${quoteSqlIdentifier(sourceKey)}
           ELSE ${quoteSqlIdentifier(upgrade.key)}
         END
         WHERE ${quoteSqlIdentifier(sourceKey)} IS NOT NULL`
      );
      await db.query(`ALTER TABLE ${quotedTableName} DROP COLUMN IF EXISTS ${quoteSqlIdentifier(sourceKey)}`);
      updatedColumns += 1;

      const archiveResult = await db.query(
        `UPDATE passport_archives
         SET "rowData" = jsonb_set(
           "rowData" - $2,
           ARRAY[$3],
           COALESCE("rowData" -> $3, "rowData" -> $2),
           true
         )
         WHERE "passportType" = $1
           AND "rowData" ? $2`,
        [typeRow.type_name, sourceKey, upgrade.key]
      );
      updatedArchives += archiveResult.rowCount || 0;
    }
  }

  return { updatedColumns, updatedArchives };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updatedTypes = await repairBatteryPassportTypes(client);
    const { updatedColumns, updatedArchives } = await repairBatteryPassportValues(client);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      ok: true,
      updatedTypes,
      updatedColumns,
      updatedArchives,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("[repair-battery-field-keys] failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
