"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");

const LEGACY_SYSTEM_PASSPORT_COLUMNS = [
  ["dpp_id", "dppId"],
  ["lineage_id", "lineageId"],
  ["company_id", "companyId"],
  ["model_name", "modelName"],
  ["internal_alias_id", "internalAliasId"],
  ["product_identifier_did", "uniqueProductIdentifier"],
  ["product_image", "productImage"],
  ["compliance_profile_key", "complianceProfileKey"],
  ["content_specification_ids", "contentSpecificationIds"],
  ["carrier_policy_key", "carrierPolicyKey"],
  ["carrier_authenticity", "carrierAuthenticity"],
  ["economic_operator_id", "economicOperatorId"],
  ["economic_operator_identifier_scheme", "economicOperatorIdentifierScheme"],
  ["facility_id", "facilityId"],
  ["release_status", "releaseStatus"],
  ["version_number", "versionNumber"],
  ["qr_code", "qrCode"],
  ["created_by", "createdBy"],
  ["updated_by", "updatedBy"],
  ["created_at", "createdAt"],
  ["updated_at", "updatedAt"],
  ["deleted_at", "deletedAt"],
];

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function getPassportTables() {
  const result = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name LIKE '%\\_passports' ESCAPE '\\'
     ORDER BY table_name`
  );
  return result.rows.map((row) => row.table_name);
}

async function getColumnNames(tableName) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const tables = await getPassportTables();
  const results = [];

  for (const tableName of tables) {
    const columns = await getColumnNames(tableName);
    const plannedRenames = LEGACY_SYSTEM_PASSPORT_COLUMNS
      .filter(([legacyKey, storageKey]) => columns.has(legacyKey) && !columns.has(storageKey))
      .map(([legacyKey, storageKey]) => ({ from: legacyKey, to: storageKey }));
    const plannedLegacyDrops = LEGACY_SYSTEM_PASSPORT_COLUMNS
      .filter(([legacyKey, storageKey]) => columns.has(storageKey) && columns.has(legacyKey))
      .map(([legacyKey, storageKey]) => ({ storageKey, legacyKey }));

    if (apply) {
      for (const rename of plannedRenames) {
        await pool.query(
          `ALTER TABLE ${quoteIdentifier(tableName)}
           RENAME COLUMN ${quoteIdentifier(rename.from)}
           TO ${quoteIdentifier(rename.to)}`
        );
      }
      await pool.query(`DROP TRIGGER IF EXISTS sync_legacy_passport_system_columns_trigger ON ${quoteIdentifier(tableName)}`);
      for (const column of plannedLegacyDrops) {
        await pool.query(
          `ALTER TABLE ${quoteIdentifier(tableName)}
           DROP COLUMN IF EXISTS ${quoteIdentifier(column.legacyKey)}`
        );
      }
    }

    results.push({
      tableName,
      status: plannedRenames.length || plannedLegacyDrops.length ? (apply ? "applied" : "pending") : "ok",
      renames: plannedRenames,
      droppedLegacyColumns: plannedLegacyDrops,
    });
  }

  if (apply) {
    await pool.query("DROP FUNCTION IF EXISTS sync_legacy_passport_system_columns()");
  }

  console.log(JSON.stringify({ apply, results }, null, 2));
  if (!apply && results.some((item) => item.status === "pending")) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
