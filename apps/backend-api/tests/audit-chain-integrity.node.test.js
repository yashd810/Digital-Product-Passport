"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createAuditServiceHelpers } = require("../src/modules/passports/audit-service-helpers");
const canonicalizeJson = require("../src/platform/serialization/canonicalize-json");

function computeHash(previousHash, payload) {
  return crypto
    .createHash("sha256")
    .update(`${previousHash || ""}:${canonicalizeJson(payload)}`)
    .digest("hex");
}

function createSerializingPool() {
  const events = [];
  const statements = [];
  let lockTail = Promise.resolve();

  return {
    events,
    statements,
    async connect() {
      let releaseLock = null;
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("pg_advisory_xact_lock")) {
            const previousLock = lockTail;
            lockTail = new Promise((resolve) => {
              releaseLock = resolve;
            });
            await previousLock;
            return { rows: [] };
          }
          if (sql.includes('SELECT "eventHash"')) {
            const latest = events.at(-1);
            return { rows: latest ? [{ eventHash: latest.eventHash }] : [] };
          }
          if (sql.includes('INSERT INTO "auditLogs"')) {
            events.push({
              previousEventHash: values[9],
              eventHash: values[10],
            });
            return { rows: [] };
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            releaseLock?.();
            return { rows: [] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        release() {},
      };
    },
  };
}

function createRoundTripPool() {
  const events = [];
  const client = {
    async query(sql, values = []) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes('SELECT "eventHash"')) {
        const latest = events.at(-1);
        return { rows: latest ? [{ eventHash: latest.eventHash }] : [] };
      }
      if (sql.includes('INSERT INTO "auditLogs"')) {
        events.push({
          companyId: values[0],
          userId: values[1],
          action: values[2],
          tableName: values[3],
          recordId: values[4],
          oldValues: values[5] ? JSON.parse(values[5]) : null,
          newValues: values[6] ? JSON.parse(values[6]) : null,
          actorIdentifier: values[7],
          audience: values[8],
          previousEventHash: values[9],
          eventHash: values[10],
          createdAt: new Date(values[11]),
          hashVersion: values[12],
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };

  return {
    events,
    async connect() {
      return client;
    },
    async query(sql) {
      if (sql.includes('FROM "auditLogs"')) {
        return {
          rows: events.map((event) => ({
            ...event,
            companyId: Number(event.companyId),
            userId: Number(event.userId),
            recordId: event.recordId === null ? null : String(event.recordId),
          })),
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("concurrent audit events are serialized into one per-company hash chain", async () => {
  const pool = createSerializingPool();
  const helpers = createAuditServiceHelpers({
    pool,
    logger: { error() {} },
  });

  await Promise.all([
    helpers.logAudit(17, 1, "firstAction", "passports", "dpp-1", null, { sequence: 1 }, {
      createdAt: "2026-07-16T10:00:00.000Z",
    }),
    helpers.logAudit(17, 2, "secondAction", "passports", "dpp-2", null, { sequence: 2 }, {
      createdAt: "2026-07-16T10:00:01.000Z",
    }),
  ]);

  assert.equal(pool.events.length, 2);
  assert.equal(pool.events[0].previousEventHash, null);
  assert.equal(pool.events[1].previousEventHash, pool.events[0].eventHash);
  assert.equal(
    pool.statements.filter(({ sql }) => sql.includes("pg_advisory_xact_lock")).length,
    2
  );
});

test("audit failures roll back and propagate instead of creating a new chain root", async () => {
  const statements = [];
  let released = false;
  const helpers = createAuditServiceHelpers({
    pool: {
      async connect() {
        return {
          async query(sql) {
            statements.push(sql);
            if (sql.includes('SELECT "eventHash"')) {
              throw new Error("audit lookup failed");
            }
            return { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    },
    logger: { error() {} },
  });

  await assert.rejects(
    helpers.logAudit(17, 1, "failingAction", "passports", "dpp-1", null, null),
    /audit lookup failed/
  );

  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(released, true);
});

test("release transactions can append audit events on their existing database client", async () => {
  const statements = [];
  let poolConnectCalled = false;
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes('SELECT "eventHash"')) return { rows: [] };
      if (sql.includes('INSERT INTO "auditLogs"')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const helpers = createAuditServiceHelpers({
    pool: {
      async connect() {
        poolConnectCalled = true;
        throw new Error("nested audit transaction must not be opened");
      },
    },
    logger: { error() {} },
  });

  await helpers.logAudit(17, 1, "release", "passports", "dpp-1", null, {
    releaseStatus: "released",
  }, { client });

  assert.equal(poolConnectCalled, false);
  assert.equal(statements.some((sql) => sql.includes("pg_advisory_xact_lock")), true);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO "auditLogs"')), true);
});

test("version 3 audit hashes normalize identifiers before database round trips", async () => {
  const pool = createRoundTripPool();
  const helpers = createAuditServiceHelpers({
    pool,
    logger: { error() {} },
  });

  await helpers.logAudit("17", "1", "changeUserRole", "users", 101, null, {
    role: "editor",
  }, {
    createdAt: "2026-08-01T20:48:41.742Z",
  });

  const report = await helpers.verifyAuditLogChain(17);
  assert.equal(report.verified, true);
  assert.equal(pool.events[0].hashVersion, 3);
});

test("version 2 verification accepts identifier types normalized by PostgreSQL", async () => {
  const pool = createRoundTripPool();
  const createdAt = new Date("2026-08-01T20:48:41.742Z");
  const payload = {
    createdAt,
    companyId: "17",
    userId: 1,
    action: "changeUserRole",
    tableName: "users",
    recordId: "101",
    oldData: null,
    newData: { role: "editor" },
    actorIdentifier: "user:1",
    audience: "superAdmin",
  };
  pool.events.push({
    companyId: 17,
    userId: 1,
    action: payload.action,
    tableName: payload.tableName,
    recordId: payload.recordId,
    oldValues: payload.oldData,
    newValues: payload.newData,
    actorIdentifier: payload.actorIdentifier,
    audience: payload.audience,
    previousEventHash: null,
    eventHash: computeHash(null, payload),
    createdAt,
    hashVersion: 2,
  });

  const helpers = createAuditServiceHelpers({
    pool,
    logger: { error() {} },
  });

  const report = await helpers.verifyAuditLogChain(17);
  assert.equal(report.verified, true);
});
