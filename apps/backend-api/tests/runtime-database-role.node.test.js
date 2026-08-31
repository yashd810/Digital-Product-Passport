"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ensureRuntimeDatabaseRole,
  moveLegacyPassportTables,
  readMigrationDatabaseCredentials,
  readRuntimeDatabaseRole,
  requireDatabaseRoleName,
  transferCoreDatabaseOwnership,
  transferPassportTableOwnership,
} = require("../src/infrastructure/postgres/runtime-role");

const runtimeRole = ["dpp", "app"].join("_");
const adminRole = ["dpp", "admin"].join("_");
const quote = (identifier) => `"${identifier}"`;

function createPool({
  roleExists = false,
  passportTypes = [],
  memberships = [],
  relationsByTable = {},
  usersTableExists = true,
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === "SELECT 1 FROM pg_roles WHERE rolname = $1 LIMIT 1") {
        return { rows: roleExists ? [{ exists: 1 }] : [] };
      }
      if (sql.startsWith("SELECT format(")) {
        return {
          rows: [{
            statement: `${roleExists ? "ALTER" : "CREATE"} ROLE ${quote(runtimeRole)}`,
          }],
        };
      }
      if (sql.includes("FROM pg_auth_members membership")) {
        return { rows: memberships.map((roleName) => ({ roleName })) };
      }
      if (sql === 'SELECT "typeName" AS "typeName" FROM "public"."passportTypes" ORDER BY "typeName"') {
        return { rows: passportTypes.map((typeName) => ({ typeName })) };
      }
      if (sql === 'SELECT current_user AS "currentUser"') {
        return { rows: [{ currentUser: adminRole }] };
      }
      if (sql === "SELECT to_regclass('public.users') AS \"tableName\"") {
        return { rows: [{ tableName: usersTableExists ? "users" : null }] };
      }
      if (sql.includes("FROM pg_class relation")) {
        return { rows: relationsByTable[values[1]] || [] };
      }
      return { rows: [] };
    },
  };
}

test("controlled migrations isolate runtime DDL while keeping only required grants", async () => {
  const pool = createPool();

  await ensureRuntimeDatabaseRole(pool, {
    runtimeRole,
    runtimePassword: "runtime-password",
    databaseName: "dppSystem",
  });

  const sql = pool.calls.map((call) => call.sql).join("\n");
  const formatCall = pool.calls.find((call) => call.sql.startsWith("SELECT format("));
  const quotedRuntimeRole = quote(runtimeRole);
  const quotedAdminRole = quote(adminRole);
  assert.match(formatCall.values[0], /^CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L$/);
  assert.equal(formatCall.sql, "SELECT format($1::text, $2::text, $3::text) AS statement");
  assert.match(sql, new RegExp(`CREATE SCHEMA IF NOT EXISTS "passport_runtime" AUTHORIZATION ${quotedAdminRole}`));
  assert.match(sql, new RegExp(`ALTER SCHEMA "passport_runtime" OWNER TO ${quotedAdminRole}`));
  assert.match(sql, new RegExp(`GRANT ${quotedRuntimeRole} TO ${quotedAdminRole}`));
  assert.doesNotMatch(sql, new RegExp(`GRANT ${quotedAdminRole} TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON DATABASE "dppSystem" FROM ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON SCHEMA "passport_runtime" FROM ${quotedRuntimeRole}`));
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.match(sql, /REVOKE CREATE, TEMPORARY ON DATABASE "dppSystem" FROM PUBLIC/);
  assert.match(sql, new RegExp(`GRANT USAGE ON SCHEMA public TO ${quotedRuntimeRole}`));
  assert.doesNotMatch(sql, new RegExp(`GRANT USAGE, CREATE ON SCHEMA public TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`GRANT USAGE, CREATE ON SCHEMA "passport_runtime" TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "passport_runtime" TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA "passport_runtime" TO ${quotedRuntimeRole}`));
  assert.ok(sql.includes(`GRANT REFERENCES (id) ON TABLE "public".users TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedAdminRole} IN SCHEMA "passport_runtime" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`ALTER ROLE ${quotedRuntimeRole} IN DATABASE "dppSystem" SET search_path TO pg_catalog, public`));
  assert.doesNotMatch(sql, /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES/);
  assert.doesNotMatch(sql, /GRANT ALL PRIVILEGES/);
  assert.doesNotMatch(formatCall.values[0], /\sCREATEDB(?:\s|$)/);
  assert.equal(formatCall.values[1], runtimeRole);
  assert.equal(formatCall.values[2], "runtime-password");
});

test("first migration defers the users REFERENCES grant until initDb has created users", async () => {
  const pool = createPool({ usersTableExists: false });

  await ensureRuntimeDatabaseRole(pool, {
    runtimeRole,
    runtimePassword: "runtime-password",
    databaseName: "dppSystem",
  });

  const sql = pool.calls.map((call) => call.sql).join("\n");
  assert.equal(sql.includes('GRANT REFERENCES (id) ON TABLE "public".users'), false);
  assert.match(sql, /GRANT USAGE, CREATE ON SCHEMA "passport_runtime"/);
});

test("runtime role memberships and legacy object ownership are removed", async () => {
  const pool = createPool({ memberships: ["pg_read_all_data", "legacy_admin"] });

  await ensureRuntimeDatabaseRole(pool, {
    runtimeRole,
    runtimePassword: "runtime-password",
    databaseName: "dppSystem",
  });
  await transferCoreDatabaseOwnership(pool, {
    runtimeRole,
    databaseName: "dppSystem",
  });

  const sql = pool.calls.map((call) => call.sql).join("\n");
  const quotedRuntimeRole = quote(runtimeRole);
  const quotedAdminRole = quote(adminRole);
  assert.match(sql, new RegExp(`REVOKE "pg_read_all_data" FROM ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`REVOKE "legacy_admin" FROM ${quotedRuntimeRole}`));
  assert.match(sql, new RegExp(`ALTER DATABASE "dppSystem" OWNER TO ${quotedAdminRole}`));
  assert.match(sql, new RegExp(`ALTER SCHEMA public OWNER TO ${quotedAdminRole}`));
  assert.match(sql, new RegExp(`REASSIGN OWNED BY ${quotedRuntimeRole} TO ${quotedAdminRole}`));
  assert.match(sql, new RegExp(`ALTER SCHEMA "passport_runtime" OWNER TO ${quotedAdminRole}`));
});

test("runtime-role provisioning updates an existing non-superuser role", async () => {
  const pool = createPool({ roleExists: true });

  await ensureRuntimeDatabaseRole(pool, {
    runtimeRole,
    runtimePassword: "runtime-password",
    databaseName: "dppSystem",
  });

  const formatCall = pool.calls.find((call) => call.sql.startsWith("SELECT format("));
  assert.match(formatCall.values[0], /^ALTER ROLE %I LOGIN NOSUPERUSER/);
});

test("controlled migrations reject unsafe or shared database role names", () => {
  assert.throws(() => requireDatabaseRoleName("Postgres", "DB_USER"), /lowercase PostgreSQL role name/);
  assert.throws(() => requireDatabaseRoleName("dpp-app", "DB_USER"), /lowercase PostgreSQL role name/);
  assert.throws(() => readMigrationDatabaseCredentials({
    DB_ADMIN_USER: adminRole,
    DB_ADMIN_PASSWORD: "",
    DB_NAME: "dppSystem",
  }), /DB_ADMIN_PASSWORD/);
  assert.deepEqual(readRuntimeDatabaseRole({
    DB_USER: runtimeRole,
    DB_PASSWORD: "runtime-password",
  }), { user: runtimeRole, password: "runtime-password" });
  assert.deepEqual(readMigrationDatabaseCredentials({
    DB_USER: runtimeRole,
    DB_PASSWORD: "runtime-password",
    DB_NAME: "dppSystem",
  }, { allowRuntimeFallback: true }), {
    user: runtimeRole,
    password: "runtime-password",
    host: undefined,
    port: 5432,
    database: "dppSystem",
  });
});

test("legacy public passport tables move as intact relations before qualified storage is used", async () => {
  const pool = createPool({
    passportTypes: ["battery", "textile"],
    relationsByTable: {
      batteryPassports: [{ schema: "public", kind: "r" }],
      textilePassports: [{ schema: "public", kind: "p" }],
    },
  });
  const getTable = (typeName) => `"passport_runtime"."${typeName}Passports"`;

  const result = await moveLegacyPassportTables(pool, { getTable });

  assert.deepEqual(result, { moved: 2, tables: ["batteryPassports", "textilePassports"] });
  const moves = pool.calls
    .map((call) => call.sql)
    .filter((sql) => sql.startsWith("ALTER TABLE \"public\""));
  assert.deepEqual(moves, [
    'ALTER TABLE "public"."batteryPassports" SET SCHEMA "passport_runtime"',
    'ALTER TABLE "public"."textilePassports" SET SCHEMA "passport_runtime"',
  ]);
});

test("legacy table migration fails closed before moving any table when both locations exist", async () => {
  const pool = createPool({
    passportTypes: ["battery", "textile"],
    relationsByTable: {
      batteryPassports: [{ schema: "public", kind: "r" }],
      textilePassports: [
        { schema: "public", kind: "r" },
        { schema: "passport_runtime", kind: "r" },
      ],
    },
  });
  const getTable = (typeName) => `"passport_runtime"."${typeName}Passports"`;

  await assert.rejects(
    moveLegacyPassportTables(pool, { getTable }),
    /both public and passport_runtime tables exist/
  );
  assert.equal(pool.calls.some((call) => call.sql.startsWith("ALTER TABLE \"public\"")), false);
});

test("only expected qualified dynamic passport tables transfer to the runtime role", async () => {
  const pool = createPool({ passportTypes: ["battery", "textile"] });
  const getTable = (typeName) => `"passport_runtime"."${typeName}Passports"`;

  await transferPassportTableOwnership(pool, { runtimeRole, getTable });

  const ownershipChanges = pool.calls
    .map((call) => call.sql)
    .filter((sql) => sql.startsWith("ALTER TABLE IF EXISTS"));
  assert.deepEqual(ownershipChanges, [
    `ALTER TABLE IF EXISTS "passport_runtime"."batteryPassports" OWNER TO ${quote(runtimeRole)}`,
    `ALTER TABLE IF EXISTS "passport_runtime"."textilePassports" OWNER TO ${quote(runtimeRole)}`,
  ]);

  await assert.rejects(
    transferPassportTableOwnership(createPool({ passportTypes: ["battery"] }), {
      runtimeRole,
      getTable: () => '"passport_runtime"."batteryPassports"; DROP TABLE users; --',
    }),
    /Refusing to transfer unexpected passport table name/
  );
});

test("controlled migration pins its search path and moves legacy tables before reconciliation", () => {
  const migrationSource = fs.readFileSync(path.resolve(__dirname, "../scripts/migrate-db.js"), "utf8");
  const initSource = fs.readFileSync(path.resolve(__dirname, "../src/db/init.js"), "utf8");
  const preInitOwnership = migrationSource.indexOf("await transferCoreDatabaseOwnership(client");
  const initCall = migrationSource.indexOf("await initDb(client");
  const runtimeSchemaEnsure = initSource.indexOf('CREATE SCHEMA IF NOT EXISTS "passport_runtime"');
  const legacyMove = initSource.indexOf("await moveLegacyPassportTables()");
  const passportTableReconciliation = initSource.indexOf("const ptRows = await pool.query");

  assert.match(migrationSource, /SET search_path TO pg_catalog, public/);
  assert.equal(migrationSource.includes("passport_runtime, public"), false);
  assert.ok(preInitOwnership >= 0 && preInitOwnership < initCall);
  assert.ok(runtimeSchemaEnsure >= 0 && runtimeSchemaEnsure < legacyMove);
  assert.ok(legacyMove >= 0 && legacyMove < passportTableReconciliation);
});

test("live confidentiality verifier remains a runtime-role check without privileged trigger bypasses", () => {
  const verifierSource = fs.readFileSync(path.resolve(__dirname, "../scripts/verify-live-confidentiality.js"), "utf8");

  assert.match(verifierSource, /const tableName = getTable\(typeName\)/);
  assert.equal(verifierSource.includes("session_replication_role"), false);
  assert.equal(verifierSource.includes("DB_ADMIN_PASSWORD"), false);
});
