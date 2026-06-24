"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");
const { initDb } = require("../src/db/init");
const createDidService = require("../src/services/did-service");
const createPassportService = require("../src/services/passport-service");
const createProductIdentifierService = require("../src/services/product-identifier-service");
const logger = require("../src/services/logger");
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

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function main() {
  const didService = createDidService({
    didDomain: process.env.DID_WEB_DOMAIN,
    publicOrigin: process.env.PUBLIC_ORIGIN || process.env.APP_URL,
    apiOrigin: process.env.SERVER_URL,
  });
  const productIdentifierService = createProductIdentifierService({ didService, pool });
  const passportService = createPassportService({
    pool,
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

  await pool.query("SELECT NOW()");
  await initDb(pool, {
    getTable,
    createPassportTable: passportService.createPassportTable,
    inRevisionStatus,
  });
  logger.info("[DB] Migrations completed successfully");
}

main()
  .catch((error) => {
    logger.error({ err: error }, "[DB] Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
