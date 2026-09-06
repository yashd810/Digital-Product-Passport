"use strict";

const {
  parseQualifiedSqlIdentifier,
  passportRuntimeSchema,
} = require("../../shared/passports/passport-helpers");

const databaseRolePattern = /^[a-z_][a-z0-9_]{0,62}$/;
const databaseIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function requireDatabaseRoleName(value, name) {
  const roleName = String(value || "").trim();
  if (!databaseRolePattern.test(roleName)) {
    throw new Error(`${name} must be a lowercase PostgreSQL role name`);
  }
  return roleName;
}

function requireDatabaseName(value, name = "DB_NAME") {
  const databaseName = String(value || "").trim();
  if (!databaseIdentifierPattern.test(databaseName)) {
    throw new Error(`${name} must be a PostgreSQL identifier`);
  }
  return databaseName;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function readMigrationDatabaseCredentials(environment = process.env, { allowRuntimeFallback = false } = {}) {
  const configuredAdminUser = String(environment.DB_ADMIN_USER || "").trim();
  const configuredAdminPassword = String(environment.DB_ADMIN_PASSWORD || "");
  // Local bootstrap output can contain a future DB_ADMIN_PASSWORD before a
  // local PostgreSQL admin role is configured. Keep local developer setup
  // compatible by falling back only when the admin *user* is absent. A partial
  // configured admin identity remains an error, and production never falls
  // back to DB_USER.
  const useRuntimeFallback = allowRuntimeFallback && !configuredAdminUser;
  const user = useRuntimeFallback
    ? requireDatabaseRoleName(environment.DB_USER, "DB_USER")
    : requireDatabaseRoleName(configuredAdminUser, "DB_ADMIN_USER");
  const password = useRuntimeFallback
    ? String(environment.DB_PASSWORD || "")
    : configuredAdminPassword;
  if (!password) throw new Error("DB_ADMIN_PASSWORD is required for controlled database migrations");
  return {
    user,
    password,
    host: environment.DB_HOST,
    port: environment.DB_PORT || 5432,
    database: requireDatabaseName(environment.DB_NAME),
  };
}

function readRuntimeDatabaseRole(environment = process.env) {
  const user = requireDatabaseRoleName(environment.DB_USER, "DB_USER");
  const password = String(environment.DB_PASSWORD || "");
  if (!password) throw new Error("DB_PASSWORD is required for the runtime database role");
  return { user, password };
}

async function buildFormattedStatement(pool, template, values) {
  const formatArguments = values
    .map((_, index) => `$${index + 2}::text`)
    .join(", ");
  const result = await pool.query(
    formatArguments
      ? `SELECT format($1::text, ${formatArguments}) AS statement`
      : "SELECT format($1::text) AS statement",
    [template, ...values]
  );
  const statement = result.rows?.[0]?.statement;
  if (!statement) throw new Error("PostgreSQL failed to construct a safe role-management statement");
  return statement;
}

async function executeFormattedStatement(pool, template, values) {
  const statement = await buildFormattedStatement(pool, template, values);
  await pool.query(statement);
}

async function getCurrentMigrationRole(pool) {
  const identity = await pool.query("SELECT current_user AS \"currentUser\"");
  const adminRole = String(identity.rows?.[0]?.currentUser || "").trim();
  if (!adminRole) throw new Error("Unable to determine the controlled migration role");
  return adminRole;
}

async function ensurePassportRuntimeSchema(pool) {
  const adminRole = await getCurrentMigrationRole(pool);
  const quotedAdminRole = quoteIdentifier(adminRole);
  const quotedRuntimeSchema = quoteIdentifier(passportRuntimeSchema);
  // The migration identity owns the schema. The application role gets CREATE
  // only inside it, limiting a compromised API process to passport tables.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedRuntimeSchema} AUTHORIZATION ${quotedAdminRole}`);
  await pool.query(`ALTER SCHEMA ${quotedRuntimeSchema} OWNER TO ${quotedAdminRole}`);
  return { adminRole, quotedAdminRole, quotedRuntimeSchema };
}

async function ensureRuntimeDatabaseRole(pool, {
  runtimeRole,
  runtimePassword,
  databaseName,
} = {}) {
  const normalizedRuntimeRole = requireDatabaseRoleName(runtimeRole, "DB_USER");
  const normalizedDatabaseName = requireDatabaseName(databaseName);
  if (!String(runtimePassword || "")) throw new Error("DB_PASSWORD is required for the runtime database role");

  const existingRole = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1 LIMIT 1",
    [normalizedRuntimeRole]
  );
  const roleStatement = existingRole.rows?.length
    ? "ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L"
    : "CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L";
  await executeFormattedStatement(pool, roleStatement, [normalizedRuntimeRole, runtimePassword]);

  const quotedRuntimeRole = quoteIdentifier(normalizedRuntimeRole);
  const quotedDatabaseName = quoteIdentifier(normalizedDatabaseName);
  const { adminRole, quotedAdminRole, quotedRuntimeSchema } = await ensurePassportRuntimeSchema(pool);
  // REASSIGN OWNED during the controlled migration needs the migration role
  // to be a member of the old owner. This direction is deliberate: the admin
  // can manage the runtime role, while the runtime login never receives any
  // administrative role membership.
  await pool.query(`GRANT ${quotedRuntimeRole} TO ${quotedAdminRole}`);

  // NOINHERIT is not sufficient on its own: a login role can still SET ROLE
  // into a role it is a member of. Strip legacy memberships before granting
  // the narrowly scoped database privileges below.
  const memberships = await pool.query(
    `SELECT parent.rolname AS "roleName"
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE member.rolname = $1`,
    [normalizedRuntimeRole]
  );
  for (const row of memberships.rows || []) {
    const parentRole = String(row.roleName || "").trim();
    if (!parentRole) continue;
    await pool.query(`REVOKE ${quoteIdentifier(parentRole)} FROM ${quotedRuntimeRole}`);
  }

  // Clear legacy direct grants before regranting the exact runtime surface.
  // Ownership is handled after migrations; memberships are removed above.
  await pool.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabaseName} FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${quotedRuntimeSchema} FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${quotedRuntimeSchema} FROM ${quotedRuntimeRole}`);
  await pool.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${quotedRuntimeSchema} FROM ${quotedRuntimeRole}`);

  // public contains application-wide static tables. Its DDL surface must stay
  // closed to the runtime role; dynamic passport storage has its own schema.
  await pool.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${quotedDatabaseName} FROM PUBLIC`);
  await pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await pool.query(`GRANT CONNECT ON DATABASE ${quotedDatabaseName} TO ${quotedRuntimeRole}`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRuntimeRole}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRuntimeRole}`);
  // Inserts only need USAGE (nextval). SELECT enables currval and UPDATE
  // enables setval, neither of which the API needs and both permit a
  // compromised runtime login to inspect or perturb identifier allocation.
  await pool.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${quotedRuntimeRole}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${quotedRuntimeRole}`);
  // Runtime table creation needs only a schema-local CREATE grant and the
  // REFERENCES privilege required by createdBy/updatedBy foreign keys.
  await pool.query(`GRANT USAGE, CREATE ON SCHEMA ${quotedRuntimeSchema} TO ${quotedRuntimeRole}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quotedRuntimeSchema} TO ${quotedRuntimeRole}`);
  await pool.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${quotedRuntimeSchema} TO ${quotedRuntimeRole}`);
  // The first controlled migration can run against an empty database, before
  // initDb creates users. Reapply this function after initDb, at which point
  // the grant is made; never fail a new installation just because the table is
  // not present yet.
  const usersTable = await pool.query("SELECT to_regclass('public.users') AS \"tableName\"");
  if (usersTable.rows?.[0]?.tableName) {
    await pool.query(`GRANT REFERENCES (id) ON TABLE "public".users TO ${quotedRuntimeRole}`);
  }
  await pool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedAdminRole} IN SCHEMA ${quotedRuntimeSchema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedAdminRole} IN SCHEMA ${quotedRuntimeSchema} GRANT USAGE ON SEQUENCES TO ${quotedRuntimeRole}`);
  // A pre-existing schema named after the application login must not be able
  // to shadow public static tables when the service starts a new connection.
  await pool.query(`ALTER ROLE ${quotedRuntimeRole} IN DATABASE ${quotedDatabaseName} SET search_path TO pg_catalog, public`);

  return { adminRole };
}

async function getDynamicPassportTables(pool, getTable) {
  if (typeof getTable !== "function") throw new Error("getTable is required to resolve dynamic passport tables");
  const typeRows = await pool.query(
    'SELECT "typeName" AS "typeName" FROM "public"."passportTypes" ORDER BY "typeName"'
  );
  const dynamicTables = new Map();
  for (const row of typeRows.rows || []) {
    let reference;
    try {
      reference = parseQualifiedSqlIdentifier(getTable(row.typeName), {
        expectedSchema: passportRuntimeSchema,
      });
    } catch (_error) {
      throw new Error(`Refusing to transfer unexpected passport table name for type ${row.typeName}`);
    }
    const existingTypeName = dynamicTables.get(reference.table);
    if (existingTypeName && existingTypeName !== row.typeName) {
      throw new Error(`Passport types ${existingTypeName} and ${row.typeName} resolve to the same storage table`);
    }
    dynamicTables.set(reference.table, row.typeName);
  }
  return [...dynamicTables.entries()].map(([table, typeName]) => ({
    schema: passportRuntimeSchema,
    table,
    typeName,
  }));
}

async function moveLegacyPassportTables(pool, { getTable } = {}) {
  const dynamicTables = await getDynamicPassportTables(pool, getTable);
  if (!dynamicTables.length) return { moved: 0, tables: [] };

  const relationStates = [];
  for (const reference of dynamicTables) {
    const relations = await pool.query(
      `SELECT namespace.nspname AS "schema", relation.relkind AS "kind"
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ANY($1::text[])
          AND relation.relname = $2`,
      [["public", passportRuntimeSchema], reference.table]
    );
    const bySchema = new Map((relations.rows || []).map((row) => [row.schema, row.kind]));
    const legacyKind = bySchema.get("public") || null;
    const runtimeKind = bySchema.get(passportRuntimeSchema) || null;
    if (legacyKind && runtimeKind) {
      throw new Error(
        `Refusing to migrate passport type ${reference.typeName}: both public and ${passportRuntimeSchema} tables exist for ${reference.table}`
      );
    }
    if (legacyKind && !["r", "p"].includes(legacyKind)) {
      throw new Error(`Refusing to migrate ${reference.table}: public relation is not a table`);
    }
    if (runtimeKind && !["r", "p"].includes(runtimeKind)) {
      throw new Error(`Refusing to use ${reference.table}: ${passportRuntimeSchema} relation is not a table`);
    }
    relationStates.push({ reference, legacyKind, runtimeKind });
  }

  const quotedRuntimeSchema = quoteIdentifier(passportRuntimeSchema);
  const movedTables = [];
  for (const { reference, legacyKind } of relationStates) {
    if (!legacyKind) continue;
    // ALTER TABLE ... SET SCHEMA moves the existing relation together with its
    // dependent indexes, constraints, owned sequences, data, and foreign keys.
    await pool.query(`ALTER TABLE "public".${quoteIdentifier(reference.table)} SET SCHEMA ${quotedRuntimeSchema}`);
    movedTables.push(reference.table);
  }
  return { moved: movedTables.length, tables: movedTables };
}

async function transferCoreDatabaseOwnership(pool, {
  runtimeRole,
  databaseName,
} = {}) {
  const normalizedRuntimeRole = requireDatabaseRoleName(runtimeRole, "DB_USER");
  const normalizedDatabaseName = requireDatabaseName(databaseName);
  const adminRole = await getCurrentMigrationRole(pool);
  const quotedAdminRole = quoteIdentifier(adminRole);

  // A legacy runtime login might already own the database, public schema, or
  // static tables. Ownership bypasses grants, so migrate that ownership back
  // to the controlled admin before assigning only dynamic passport tables
  // back to the runtime role.
  await pool.query(`ALTER DATABASE ${quoteIdentifier(normalizedDatabaseName)} OWNER TO ${quotedAdminRole}`);
  await pool.query(`ALTER SCHEMA public OWNER TO ${quotedAdminRole}`);
  // REASSIGN OWNED covers every legacy object class in this database (tables,
  // sequences, views, routines, and schemas), rather than leaving an ownership
  // bypass on an overlooked static sequence or relation. The dynamic passport
  // tables are deliberately reassigned back to the runtime role afterwards.
  await pool.query(`REASSIGN OWNED BY ${quoteIdentifier(normalizedRuntimeRole)} TO ${quotedAdminRole}`);
  // Reassert the administrative schema owner after REASSIGN OWNED handles any
  // older installation where the runtime login created or owned the schema.
  await pool.query(`ALTER SCHEMA ${quoteIdentifier(passportRuntimeSchema)} OWNER TO ${quotedAdminRole}`);
}

async function transferPassportTableOwnership(pool, {
  runtimeRole,
  getTable,
} = {}) {
  const normalizedRuntimeRole = requireDatabaseRoleName(runtimeRole, "DB_USER");
  const quotedRuntimeRole = quoteIdentifier(normalizedRuntimeRole);
  const tables = await getDynamicPassportTables(pool, getTable);

  for (const table of tables) {
    await pool.query(
      `ALTER TABLE IF EXISTS ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)} OWNER TO ${quotedRuntimeRole}`
    );
  }
}

module.exports = {
  ensureRuntimeDatabaseRole,
  readMigrationDatabaseCredentials,
  readRuntimeDatabaseRole,
  requireDatabaseName,
  requireDatabaseRoleName,
  ensurePassportRuntimeSchema,
  getDynamicPassportTables,
  moveLegacyPassportTables,
  transferCoreDatabaseOwnership,
  transferPassportTableOwnership,
};
