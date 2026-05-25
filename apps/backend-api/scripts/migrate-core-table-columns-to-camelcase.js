"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");
const { CORE_TABLE_COLUMN_MAPPINGS } = require("../src/shared/core/core-table-column-mappings");

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

async function dropLegacyDuplicateColumns(client, tableName, columnMappings = []) {
  const columns = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const existingColumns = new Set(columns.rows.map((row) => row.column_name));
  if (!existingColumns.size) {
    return { tableName, status: "missing", droppedColumns: [] };
  }

  const droppedColumns = [];
  for (const [legacyName, camelName] of columnMappings) {
    if (!existingColumns.has(legacyName) || !existingColumns.has(camelName)) continue;
    await client.query(
      `ALTER TABLE ${quoteDbIdentifier(tableName)}
       DROP COLUMN ${quoteDbIdentifier(legacyName)}`
    );
    existingColumns.delete(legacyName);
    droppedColumns.push(legacyName);
  }

  return {
    tableName,
    status: droppedColumns.length ? "applied" : "ok",
    droppedColumns,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dropLegacy = process.argv.includes("--drop-legacy");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || undefined,
    port: process.env.DB_PORT ? Number.parseInt(process.env.DB_PORT, 10) : undefined,
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME || undefined,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const [tableName, mappings] of Object.entries(CORE_TABLE_COLUMN_MAPPINGS)) {
      results.push(await renameTableColumnsToCamelCase(client, tableName, mappings));
      if (dropLegacy) {
        results.push(await dropLegacyDuplicateColumns(client, tableName, mappings));
      }
    }
    if (apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    process.stdout.write(JSON.stringify({ apply, dropLegacy, results }, null, 2));
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
