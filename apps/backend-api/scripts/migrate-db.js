"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || process.env.DPP_ENV_FILE || path.resolve(__dirname, "../../../../../env/local-compose.env"),
  quiet: true,
});

const { Pool } = require("pg");
const { initDb } = require("../src/db/init");
const {
  ensureRuntimeDatabaseRole,
  ensurePassportRuntimeSchema,
  moveLegacyPassportTables,
  readMigrationDatabaseCredentials,
  readRuntimeDatabaseRole,
  transferCoreDatabaseOwnership,
  transferPassportTableOwnership,
} = require("../src/infrastructure/postgres/runtime-role");
const createDidService = require("../src/platform/identity/did-service");
const createPassportService = require("../src/modules/passports/services/passport-service");
const createProductIdentifierService = require("../src/modules/passports/services/product-identifier-service");
const { getApiOrigin, getPublicViewerOrigin } = require("../src/shared/security/configured-origin");
const logger = require("../src/platform/observability/logger");
const {
  inRevisionStatus,
  systemPassportFields,
  getTable,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  getWritablePassportColumns,
  getStoredPassportValues,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  coerceBulkFieldValue,
  getHistoryFieldDefs,
  formatHistoryFieldValue,
  comparableHistoryFieldValue,
} = require("../src/shared/passports/passport-helpers");

const isProductionMigration = process.env.NODE_ENV === "production";
const migrationDatabaseCredentials = readMigrationDatabaseCredentials(process.env, {
  allowRuntimeFallback: !isProductionMigration,
});
const runtimeDatabaseRole = readRuntimeDatabaseRole();
const hasDedicatedMigrationRole = migrationDatabaseCredentials.user !== runtimeDatabaseRole.user;

if (isProductionMigration && !hasDedicatedMigrationRole) {
  throw new Error("DB_ADMIN_USER and DB_USER must be distinct for controlled database migrations");
}

const pool = new Pool(migrationDatabaseCredentials);

async function main() {
  const client = await pool.connect();
  try {
    // Keep all unqualified migration references pinned to trusted system and
    // static application schemas. Dynamic passport tables are always fully
    // qualified and must never be pulled into the migration search path.
    await client.query("SET search_path TO pg_catalog, public");
    const didService = createDidService({
      publicOrigin: getPublicViewerOrigin(),
      apiOrigin: getApiOrigin(),
    });
    const productIdentifierService = createProductIdentifierService({ didService, pool: client });
    const passportService = createPassportService({
      pool: client,
      getTable,
      normalizePassportRow,
      normalizeReleaseStatus,
      isPublicHistoryStatus,
      isEditablePassportStatus,
      normalizeInternalAliasIdValue,
      generateInternalAliasIdValue,
      inRevisionStatus,
      systemPassportFields,
      getWritablePassportColumns,
      getStoredPassportValues,
      quoteSqlIdentifier,
      joinQuotedSqlIdentifiers,
      toStoredPassportValue,
      coerceBulkFieldValue,
      comparableHistoryFieldValue,
      formatHistoryFieldValue,
      getHistoryFieldDefs,
      buildCurrentPublicPassportPath,
      buildInactivePublicPassportPath,
      productIdentifierService,
    });

    await client.query("SELECT NOW()");
    if (hasDedicatedMigrationRole) {
      await ensureRuntimeDatabaseRole(client, {
        runtimeRole: runtimeDatabaseRole.user,
        runtimePassword: runtimeDatabaseRole.password,
        databaseName: migrationDatabaseCredentials.database,
      });
      // Existing dynamic tables belong to the runtime role so the API can
      // reconcile them at runtime. Hand them back to the controlled migration
      // role before initDb issues ALTER TABLE/CREATE INDEX, then transfer only
      // those tables back after all changes succeed.
      await transferCoreDatabaseOwnership(client, {
        runtimeRole: runtimeDatabaseRole.user,
        databaseName: migrationDatabaseCredentials.database,
      });
    } else {
      logger.warn("[DB] Local migration is using the runtime database role; dedicated production role provisioning is skipped");
      await ensurePassportRuntimeSchema(client);
    }
    await initDb(client, {
      getTable,
      createPassportTable: passportService.createPassportTable,
      inRevisionStatus,
      moveLegacyPassportTables: async () => moveLegacyPassportTables(client, { getTable }),
    });
    // Reapply grants after schema changes, then assign only dynamic passport
    // tables to the runtime role. Core tables remain migration-admin owned.
    if (hasDedicatedMigrationRole) {
      await ensureRuntimeDatabaseRole(client, {
        runtimeRole: runtimeDatabaseRole.user,
        runtimePassword: runtimeDatabaseRole.password,
        databaseName: migrationDatabaseCredentials.database,
      });
      await transferPassportTableOwnership(client, {
        runtimeRole: runtimeDatabaseRole.user,
        getTable,
      });
    }
    logger.info("[DB] Migrations completed successfully");
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    logger.error({ err: error }, "[DB] Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
