"use strict";

require("dotenv").config();

const { Pool } = require("pg");
const { initDb } = require("../db/init");
const createDidService = require("../services/did-service");
const createPassportService = require("../services/passport-service");
const createProductIdentifierService = require("../services/product-identifier-service");
const logger = require("../services/logger");
const {
  IN_REVISION_STATUS,
  LEGACY_IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  getTable,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizeProductIdValue,
  generateProductIdValue,
  getWritablePassportColumns,
  getStoredPassportValues,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  coerceBulkFieldValue,
  getHistoryFieldDefs,
  formatHistoryFieldValue,
  comparableHistoryFieldValue,
} = require("../helpers/passport-helpers");

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
    normalizeProductIdValue,
    generateProductIdValue,
    IN_REVISION_STATUS,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    getStoredPassportValues,
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
    IN_REVISION_STATUS,
    LEGACY_IN_REVISION_STATUS,
    productIdentifierService,
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
