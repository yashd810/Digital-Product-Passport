"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");
const {
  SYSTEM_PASSPORT_COLUMN_MAPPINGS,
} = require("../src/shared/passports/system-passport-columns");

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

function buildLegacyCompatibilityDefinition(definition) {
  return String(definition || "")
    .replace(/\s+NOT\s+NULL\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLegacySyncFunctionSql() {
  const insertGuards = SYSTEM_PASSPORT_COLUMN_MAPPINGS.flatMap(({ storageKey, legacyKey }) => {
    if (!legacyKey || legacyKey === storageKey) return [];
    return [
      `IF NEW.${quoteIdentifier(storageKey)} IS NULL AND NEW.${quoteIdentifier(legacyKey)} IS NOT NULL THEN NEW.${quoteIdentifier(storageKey)} = NEW.${quoteIdentifier(legacyKey)}; END IF;`,
      `IF NEW.${quoteIdentifier(legacyKey)} IS NULL AND NEW.${quoteIdentifier(storageKey)} IS NOT NULL THEN NEW.${quoteIdentifier(legacyKey)} = NEW.${quoteIdentifier(storageKey)}; END IF;`,
    ];
  }).join("\n  ");

  const updateGuards = SYSTEM_PASSPORT_COLUMN_MAPPINGS.flatMap(({ storageKey, legacyKey }) => {
    if (!legacyKey || legacyKey === storageKey) return [];
    return [
      `IF NEW.${quoteIdentifier(storageKey)} IS DISTINCT FROM OLD.${quoteIdentifier(storageKey)} THEN NEW.${quoteIdentifier(legacyKey)} = NEW.${quoteIdentifier(storageKey)}; ELSIF NEW.${quoteIdentifier(legacyKey)} IS DISTINCT FROM OLD.${quoteIdentifier(legacyKey)} THEN NEW.${quoteIdentifier(storageKey)} = NEW.${quoteIdentifier(legacyKey)}; END IF;`,
    ];
  }).join("\n  ");

  return `
CREATE OR REPLACE FUNCTION sync_legacy_passport_system_columns()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
  ${insertGuards}
    RETURN NEW;
  END IF;

  ${updateGuards}
  ${insertGuards}
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;
}

async function ensureLegacyCompatibilityColumns(tableName) {
  const initialColumns = await getColumnNames(tableName);
  const compatibilityColumns = SYSTEM_PASSPORT_COLUMN_MAPPINGS
    .filter(({ storageKey, legacyKey }) => legacyKey && initialColumns.has(storageKey) && !initialColumns.has(legacyKey))
    .map(({ storageKey, legacyKey, definition }) => ({ storageKey, legacyKey, definition }));

  for (const column of compatibilityColumns) {
    await pool.query(
      `ALTER TABLE ${quoteIdentifier(tableName)}
       ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column.legacyKey)} ${buildLegacyCompatibilityDefinition(column.definition)}`
    );
    await pool.query(
      `UPDATE ${quoteIdentifier(tableName)}
       SET ${quoteIdentifier(column.legacyKey)} = ${quoteIdentifier(column.storageKey)}
       WHERE ${quoteIdentifier(column.legacyKey)} IS NULL
         AND ${quoteIdentifier(column.storageKey)} IS NOT NULL`
    );
  }

  const syncedColumns = await getColumnNames(tableName);
  for (const { storageKey, legacyKey } of SYSTEM_PASSPORT_COLUMN_MAPPINGS) {
    if (!legacyKey || !syncedColumns.has(storageKey) || !syncedColumns.has(legacyKey)) continue;
    await pool.query(
      `UPDATE ${quoteIdentifier(tableName)}
       SET ${quoteIdentifier(storageKey)} = ${quoteIdentifier(legacyKey)}
       WHERE ${quoteIdentifier(storageKey)} IS NULL
         AND ${quoteIdentifier(legacyKey)} IS NOT NULL`
    );
  }

  return compatibilityColumns;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const tables = await getPassportTables();
  const results = [];

  for (const tableName of tables) {
    const columns = await getColumnNames(tableName);
    const plannedRenames = SYSTEM_PASSPORT_COLUMN_MAPPINGS
      .filter(({ storageKey, legacyKey }) => legacyKey && columns.has(legacyKey) && !columns.has(storageKey))
      .map(({ storageKey, legacyKey }) => ({ from: legacyKey, to: storageKey }));
    const plannedCompatibilityColumns = SYSTEM_PASSPORT_COLUMN_MAPPINGS
      .filter(({ storageKey, legacyKey }) => legacyKey && columns.has(storageKey) && !columns.has(legacyKey))
      .map(({ storageKey, legacyKey, definition }) => ({ storageKey, legacyKey, definition }));
    let appliedCompatibilityColumns = plannedCompatibilityColumns;

    if (apply) {
      await pool.query(buildLegacySyncFunctionSql());
      for (const rename of plannedRenames) {
        await pool.query(
          `ALTER TABLE ${quoteIdentifier(tableName)}
           RENAME COLUMN ${quoteIdentifier(rename.from)}
           TO ${quoteIdentifier(rename.to)}`
        );
      }
      appliedCompatibilityColumns = await ensureLegacyCompatibilityColumns(tableName);
      await pool.query(`DROP TRIGGER IF EXISTS sync_legacy_passport_system_columns_trigger ON ${quoteIdentifier(tableName)}`);
      await pool.query(
        `CREATE TRIGGER sync_legacy_passport_system_columns_trigger
         BEFORE INSERT OR UPDATE ON ${quoteIdentifier(tableName)}
         FOR EACH ROW
         EXECUTE FUNCTION sync_legacy_passport_system_columns()`
      );
    }

    results.push({
      tableName,
      status: plannedRenames.length || plannedCompatibilityColumns.length ? (apply ? "applied" : "pending") : "ok",
      renames: plannedRenames,
      compatibilityColumns: apply ? appliedCompatibilityColumns : plannedCompatibilityColumns,
    });
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
