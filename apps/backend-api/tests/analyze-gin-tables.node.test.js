"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeApplicationGinTables } = require("../src/infrastructure/postgres/analyze-gin-tables");

function harness({ rows = [], reltuples = 23, analyzeError = null } = {}) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    logger: { info: (...args) => logs.push(args) },
    client: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("SELECT DISTINCT relation.oid")) return { rows };
        if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: "30s" }] };
        if (sql.startsWith("ANALYZE") && analyzeError) throw analyzeError;
        if (sql.startsWith("SELECT reltuples")) return { rows: [{ reltuples }] };
        return { rows: [] };
      },
    },
  };
}

test("GIN analysis selects only migration-owned application schemas and safely analyzes each table once", async () => {
  const fixture = harness({ rows: [
    { oid: 21, schemaName: "passport_runtime", tableName: "batteryPassports" },
    { oid: 22, schemaName: "public", tableName: "passportArchives" },
  ] });
  const result = await analyzeApplicationGinTables(fixture.client, { logger: fixture.logger });
  assert.deepEqual(result, { tableCount: 2 });
  assert.deepEqual(fixture.calls[0].params, [["public", "passport_runtime"]]);
  assert.match(fixture.calls[0].sql, /relation\.relowner = .*current_user/);
  assert.match(fixture.calls[0].sql, /access_method\.amname = 'gin'/);
  assert.match(fixture.calls[0].sql, /dependency\.deptype = 'e'/);
  assert.deepEqual(fixture.calls.filter(({ sql }) => sql.startsWith("ANALYZE")).map(({ sql }) => sql), [
    'ANALYZE ONLY "passport_runtime"."batteryPassports"',
    'ANALYZE ONLY "public"."passportArchives"',
  ]);
  assert.deepEqual(fixture.calls.at(-1).params, ["30s"]);
  assert.deepEqual(fixture.logs, [[{ tableCount: 2 }, "[DB] Application GIN table statistics refreshed and verified"]]);
});

test("GIN analysis is a catalog-only no-op when the application has no GIN indexes", async () => {
  const fixture = harness();
  assert.deepEqual(await analyzeApplicationGinTables(fixture.client), { tableCount: 0 });
  assert.equal(fixture.calls.length, 1);
});

test("GIN analysis fails closed and restores statement timeout after failed or unverifiable analysis", async () => {
  for (const options of [
    { analyzeError: new Error("analysis timed out") },
    { reltuples: "NaN" }, { reltuples: "Infinity" }, { reltuples: "-Infinity" }, { reltuples: -1 },
  ]) {
    const fixture = harness({ rows: [{ oid: 21, schemaName: "passport_runtime", tableName: "batteryPassports" }], ...options });
    await assert.rejects(analyzeApplicationGinTables(fixture.client, { logger: fixture.logger }), /analysis timed out|statistics remain invalid/);
    assert.deepEqual(fixture.calls.at(-1).params, ["30s"]);
    assert.equal(fixture.logs.length, 0);
  }
});

test("GIN analysis rejects unexpected identifiers before running maintenance", async () => {
  for (const row of [
    { oid: 21, schemaName: "other_schema", tableName: "batteryPassports" },
    { oid: 21, schemaName: "public", tableName: 'table"; DROP TABLE users; --' },
  ]) {
    const fixture = harness({ rows: [row] });
    await assert.rejects(analyzeApplicationGinTables(fixture.client), /Unexpected GIN table schema|Invalid SQL identifier/);
    assert.equal(fixture.calls.length, 1);
  }
});
