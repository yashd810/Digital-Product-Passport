"use strict";

require("dotenv").config();

const { Pool } = require("pg");
const createPassportService = require("../services/passport-service");
const {
  IN_REVISION_STATUS,
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
const logger = require("../services/logger");

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function main() {
  const repair = process.argv.includes("--repair");
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
    productIdentifierService: null,
  });

  const result = await passportService.validatePassportTypeStorage({ repair });
  const failed = result.results.filter((row) => row.status === "failed");

  console.log(JSON.stringify(result, null, 2));
  if (failed.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    logger.error({ err: error }, "[Passport storage check] failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
