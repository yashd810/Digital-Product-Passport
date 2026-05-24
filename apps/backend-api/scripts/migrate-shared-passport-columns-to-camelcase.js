"use strict";

const { Pool } = require("pg");
const { SHARED_PASSPORT_TABLE_COLUMN_MAPPINGS } = require("../src/shared/passports/shared-passport-table-columns");

function isSafeSqlIdentifier(value) {
  return /^[a-z][a-z0-9_]*$/i.test(String(value || ""));
}

function quoteDbIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function renameTableColumnsToCamelCase(client, tableName, columnMappings = []) {
  const columns = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const existingColumns = new Set(columns.rows.map((row) => row.column_name));
  if (!existingColumns.size) {
    return { tableName, status: "missing", renamedColumns: [] };
  }

  const renamedColumns = [];
  for (const [legacyName, camelName] of columnMappings) {
    if (!existingColumns.has(legacyName) || existingColumns.has(camelName)) continue;
    await client.query(
      `ALTER TABLE ${quoteDbIdentifier(tableName)}
       RENAME COLUMN ${quoteDbIdentifier(legacyName)}
       TO ${quoteDbIdentifier(camelName)}`
    );
    existingColumns.delete(legacyName);
    existingColumns.add(camelName);
    renamedColumns.push(`${legacyName}->${camelName}`);
  }

  return {
    tableName,
    status: renamedColumns.length ? "applied" : "ok",
    renamedColumns,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const [tableName, mappings] of Object.entries(SHARED_PASSPORT_TABLE_COLUMN_MAPPINGS)) {
      results.push(await renameTableColumnsToCamelCase(client, tableName, mappings));
    }
    if (apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    process.stdout.write(JSON.stringify({ apply, results }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
