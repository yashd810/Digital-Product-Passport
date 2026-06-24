"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");
const createPassportService = require("../src/services/passport-service");
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
const logger = require("../src/services/logger");

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
