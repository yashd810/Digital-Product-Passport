"use strict";

const {
  passportRuntimeSchema,
  quotePostgresIdentifier,
  quoteSqlIdentifier,
} = require("../../shared/passports/passport-helpers");

const applicationSchemas = ["public", passportRuntimeSchema];

async function analyzeApplicationGinTables(client, { logger, statementTimeoutMs = 120_000 } = {}) {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 120_000) {
    throw new Error("GIN statistics analysis requires a timeout between 1 and 120000 milliseconds");
  }
  const tables = await client.query(
    `SELECT DISTINCT relation.oid,
            namespace.nspname AS "schemaName", relation.relname AS "tableName"
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_catalog.pg_index index ON index.indrelid = relation.oid
     JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index.indexrelid
     JOIN pg_catalog.pg_am access_method ON access_method.oid = index_relation.relam
     WHERE namespace.nspname = ANY($1::text[])
       AND relation.relkind = 'r'
       AND relation.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
       AND access_method.amname = 'gin'
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend dependency
         WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
           AND dependency.objid = relation.oid AND dependency.deptype = 'e'
       )
     ORDER BY namespace.nspname, relation.relname`,
    [applicationSchemas]
  );
  // PostgreSQL 18.6 fixes parallel GIN builds that could corrupt reltuples.
  // Refresh every matching application table, including finite-but-wrong
  // estimates, after DDL finishes and before ownership returns to the API.
  const targets = tables.rows.map((table) => {
    if (!applicationSchemas.includes(table.schemaName)) throw new Error("Unexpected GIN table schema");
    return {
      oid: table.oid,
      qualifiedName: `${quotePostgresIdentifier(table.schemaName)}.${quoteSqlIdentifier(table.tableName)}`,
    };
  });
  if (targets.length) {
    const settings = await client.query("SELECT current_setting('statement_timeout') AS value");
    const previousTimeout = settings.rows[0]?.value;
    if (typeof previousTimeout !== "string") throw new Error("Cannot preserve migration statement timeout");
    try {
      await client.query("SELECT pg_catalog.set_config('statement_timeout', $1, false)", [String(statementTimeoutMs)]);
      for (const target of targets) {
        // ONLY prevents inheritance children outside the selected schemas
        // from being analyzed as a side effect of an application parent.
        await client.query(`ANALYZE ONLY ${target.qualifiedName}`);
        const statistics = await client.query("SELECT reltuples FROM pg_catalog.pg_class WHERE oid = $1", [target.oid]);
        const row = statistics.rows[0];
        if (!row || !Number.isFinite(Number(row.reltuples)) || Number(row.reltuples) < 0) {
          throw new Error("GIN table statistics remain invalid after ANALYZE");
        }
      }
    } finally {
      await client.query("SELECT pg_catalog.set_config('statement_timeout', $1, false)", [previousTimeout]);
    }
  }
  logger?.info?.({ tableCount: targets.length }, "[DB] Application GIN table statistics refreshed and verified");
  return { tableCount: targets.length };
}

module.exports = { analyzeApplicationGinTables };
