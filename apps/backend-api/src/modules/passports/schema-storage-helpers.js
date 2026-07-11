"use strict";

const nodeCrypto = require("crypto");
const { normalizeSystemPassportHeader } = require("../../services/passport-header-fields");
const {
  flattenSchemaFieldsFromSections,
} = require("../../shared/passports/passport-helpers");

function createSchemaStorageHelpers({
  pool,
  logger,
  getTable,
  normalizePassportRow,
  isEditablePassportStatus,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  systemPassportColumnMappings,
  livePassportSystemColumns,
  livePassportSystemColumnDefinitions,
  inRevisionStatusesSql,
}) {
  function unquoteSqlIdentifier(identifier) {
    return String(identifier || "").replace(/^"|"$/g, "").replace(/""/g, "\"");
  }

  function buildDbIndexName(...parts) {
    const normalized = parts
      .join(" ")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part, index) => {
        const lower = part.toLowerCase();
        if (index === 0) return lower;
        return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      })
      .join("");
    const safe = normalized || "passportIndex";
    return quoteSqlIdentifier(safe.slice(0, 60));
  }

  async function getLiveTableColumnMap(tableName) {
    const rawTableName = unquoteSqlIdentifier(tableName);
    const columns = await pool.query(
      `SELECT column_name AS "columnName", data_type AS "dataType"
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [rawTableName]
    );
    return new Map(columns.rows.map((row) => [row.columnName, row.dataType]));
  }

  async function getLatestCompanyPassports({ companyId, passportType }) {
    const tableName = getTable(passportType);
    const result = await pool.query(
      `SELECT DISTINCT ON ("lineageId") *
       FROM ${tableName}
       WHERE "companyId" = $1
         AND "deletedAt" IS NULL
       ORDER BY "lineageId", "versionNumber" DESC, "updatedAt" DESC`,
      [companyId]
    );
    return result.rows.map((row) => {
      const normalized = normalizePassportRow(row);
      return {
        ...normalized,
        isEditable: isEditablePassportStatus(normalized.releaseStatus),
      };
    });
  }

  function normalizePassportTypeSchema({
    sections = [],
    systemHeader = null,
    currentSchemaVersion = 0,
    sourceModule = null,
    identity = null,
    semanticGraph = null,
  } = {}) {
    const parsedVersion = Number.parseInt(currentSchemaVersion, 10);
    const schema = {
      schemaVersion: Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1,
      systemHeader: normalizeSystemPassportHeader(systemHeader),
      sections: Array.isArray(sections) ? sections : [],
    };
    const normalizedSourceModule = String(sourceModule || "").trim();
    if (normalizedSourceModule) schema.sourceModule = normalizedSourceModule;
    if (identity && typeof identity === "object" && !Array.isArray(identity)) {
      schema.identity = identity;
    }
    if (semanticGraph && typeof semanticGraph === "object" && !Array.isArray(semanticGraph)) {
      schema.semanticGraph = semanticGraph;
    }
    return schema;
  }

  function getTypeSchemaVersion(fieldsJson) {
    const parsedVersion = Number.parseInt(fieldsJson?.schemaVersion, 10);
    return Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1;
  }

  function flattenTypeFields(fieldsJsonOrSections) {
    const sections = Array.isArray(fieldsJsonOrSections)
      ? fieldsJsonOrSections
      : fieldsJsonOrSections?.sections;
    return flattenSchemaFieldsFromSections(Array.isArray(sections) ? sections : [])
      .filter((field) => field?.key);
  }

  function isStructuredPassportField(field) {
    const storageType = String(field?.storageType || field?.valueType || "").trim().toLowerCase();
    return field?.type === "table"
      || field?.type === "object"
      || field?.type === "objectList"
      || field?.type === "multiselect"
      || field?.type === "scalarList"
      || field?.repeated === true
      || field?.structured === true
      || ["json", "jsonb", "object", "array"].includes(storageType);
  }

  function getPassportFieldColumnType(field) {
    if (field?.type === "boolean") return "BOOLEAN DEFAULT false";
    if (isStructuredPassportField(field)) return "JSONB";
    return "TEXT";
  }

  function getPassportFieldDataType(field) {
    if (field?.type === "boolean") return "boolean";
    if (isStructuredPassportField(field)) return "jsonb";
    return "text";
  }

  function buildPassportTypeSchemaChange({ currentFieldsJson = {}, nextSections = [] } = {}) {
    const currentFields = new Map(flattenTypeFields(currentFieldsJson).map((field) => [field.key, field]));
    const nextFields = new Map(flattenTypeFields(nextSections).map((field) => [field.key, field]));
    const added = [];
    const removed = [];
    const typeChanged = [];

    for (const [key, nextField] of nextFields.entries()) {
      const currentField = currentFields.get(key);
      if (!currentField) {
        added.push(key);
        continue;
      }
      if (getPassportFieldDataType(currentField) !== getPassportFieldDataType(nextField)) {
        typeChanged.push({
          key,
          from: getPassportFieldDataType(currentField),
          to: getPassportFieldDataType(nextField),
        });
      }
    }

    for (const key of currentFields.keys()) {
      if (!nextFields.has(key)) removed.push(key);
    }

    return {
      added,
      removed,
      typeChanged,
      additive: removed.length === 0 && typeChanged.length === 0,
    };
  }

  async function passportTypeHasStoredRecords(typeName) {
    const tableName = getTable(typeName);
    const liveCount = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`)
      .then((result) => Number(result.rows[0]?.count) || 0)
      .catch(() => 0);
    if (liveCount > 0) return true;

    const archivedCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM \"passportArchives\" WHERE \"passportType\" = $1",
      [typeName]
    ).then((result) => Number(result.rows[0]?.count) || 0).catch(() => 0);
    return archivedCount > 0;
  }

  async function recordPassportTypeSchemaEvent({
    typeName,
    tableName,
    schemaVersion = 1,
    eventType,
    changeSummary = {},
    createdBy = null,
  }) {
    const typeRes = await pool.query('SELECT id FROM "passportTypes" WHERE "typeName" = $1', [typeName]).catch(() => ({ rows: [] }));
    await pool.query(
      `INSERT INTO "passportTypeSchemaEvents"
         ("passportTypeId", "typeName", "tableName", "schemaVersion", "eventType", "changeSummary", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        typeRes.rows[0]?.id || null,
        typeName,
        tableName,
        Number.parseInt(schemaVersion, 10) || 1,
        eventType,
        JSON.stringify(changeSummary || {}),
        createdBy || null,
      ]
    ).catch((error) => logger.warn({ err: error }, "[Passport type schema event]"));
  }

  function buildQueryableIndexName(tableName, fieldKey) {
    const digest = nodeCrypto.createHash("sha1").update(`${tableName}:${fieldKey}`).digest("hex").slice(0, 10);
    return buildDbIndexName("idx", digest, fieldKey);
  }

  async function ensureQueryableFieldIndex({ tableName, field }) {
    if (field?.queryable !== true && field?.indexed !== true) return null;
    const indexName = buildQueryableIndexName(tableName, field.key);
    if (getPassportFieldDataType(field) === "jsonb") {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING GIN (${quoteSqlIdentifier(field.key)})`);
    } else {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${quoteSqlIdentifier(field.key)}) WHERE "deletedAt" IS NULL`);
    }
    return indexName;
  }

  async function createPassportTable(typeName, { createdBy = null, eventType = "createOrReconcileTable" } = {}) {
    const tableName = getTable(typeName);
    const rawTableName = unquoteSqlIdentifier(tableName);
    const typeRes = await pool.query(
      'SELECT "fieldsJson" AS "fieldsJson" FROM "passportTypes" WHERE "typeName" = $1',
      [typeName]
    );
    if (!typeRes.rows.length)
      throw new Error(`Passport type '${typeName}' not found in passportTypes`);

    const ddlCols = [];
    for (const field of flattenTypeFields(typeRes.rows[0].fieldsJson || {})) {
      const colType = getPassportFieldColumnType(field);
      ddlCols.push(`    ${quoteSqlIdentifier(field.key)} ${colType}`);
    }
    const customColsDDL = ddlCols.length ? ",\n" + ddlCols.join(",\n") : "";

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id             SERIAL       PRIMARY KEY,
        "dppId"         TEXT         NOT NULL,
        "lineageId"     TEXT         NOT NULL,
        "companyId"     INTEGER      NOT NULL,
        "modelName"     VARCHAR(255),
        "internalAliasId"     VARCHAR(255) NOT NULL,
        "uniqueProductIdentifier" TEXT,
        "passportPolicyKey" VARCHAR(120) NOT NULL,
        "contentSpecificationIds" TEXT,
        "carrierPolicyKey" VARCHAR(120),
        "carrierAuthenticity" JSONB,
        "economicOperatorId" TEXT,
        "economicOperatorIdentifierScheme" VARCHAR(80),
        "facilityId" TEXT,
        granularity    VARCHAR(20)  NOT NULL DEFAULT 'model',
        "releaseStatus" VARCHAR(50)  NOT NULL DEFAULT 'draft',
        "versionNumber" INTEGER      NOT NULL DEFAULT 1,
        "qrCode"        TEXT,
        "createdBy"     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        "updatedBy"     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "deletedAt"     TIMESTAMPTZ${customColsDDL}
      )
    `);

    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "dpp", "version", "unique")} ON ${tableName}("dppId", "versionNumber") WHERE "deletedAt" IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "company")} ON ${tableName}("companyId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "dpp")} ON ${tableName}("dppId") WHERE "deletedAt" IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "lineage")} ON ${tableName}("lineageId") WHERE "deletedAt" IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "status")} ON ${tableName}("releaseStatus") WHERE "deletedAt" IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${buildDbIndexName(rawTableName, "product", "identifier", "did")} ON ${tableName}("companyId", "uniqueProductIdentifier") WHERE "deletedAt" IS NULL`);

    for (const [columnName, columnDefinition] of livePassportSystemColumnDefinitions) {
      await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${quoteSqlIdentifier(columnName)} ${columnDefinition}`);
    }

    const addedColumns = [];
    const indexedColumns = [];
    for (const field of flattenTypeFields(typeRes.rows[0].fieldsJson)) {
      await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${quoteSqlIdentifier(field.key)} ${getPassportFieldColumnType(field)}`);
      addedColumns.push({
        key: field.key,
        dataType: getPassportFieldDataType(field),
      });
      const indexName = await ensureQueryableFieldIndex({ tableName, field });
      if (indexName) indexedColumns.push({ key: field.key, indexName });
    }

    await recordPassportTypeSchemaEvent({
      typeName,
      tableName: rawTableName,
      schemaVersion: getTypeSchemaVersion(typeRes.rows[0].fieldsJson),
      eventType,
      changeSummary: { ensuredColumns: addedColumns, indexedColumns },
      createdBy,
    });
  }

  async function migratePassportStorageToSchemaKeys({ apply = false, includeArchives = true } = {}) {
    const typeRows = await pool.query(
      `SELECT "typeName" AS "typeName", "fieldsJson" AS "fieldsJson"
       FROM "passportTypes"
       ORDER BY "typeName"`
    );
    const results = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.typeName);
      const rawTableName = unquoteSqlIdentifier(tableName);
      const tableExists = await pool.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
         LIMIT 1`,
        [rawTableName]
      ).then((result) => result.rows.length > 0);

      if (!tableExists) {
        results.push({
          typeName: typeRow.typeName,
          tableName: rawTableName,
          status: "skippedMissingTable",
          columnRenames: [],
          archiveKeyUpdates: [],
        });
        continue;
      }

      const columnMap = await getLiveTableColumnMap(tableName);
      const missingExactColumns = flattenTypeFields(typeRow.fieldsJson)
        .map((field) => String(field?.key || "").trim())
        .filter((key) => key && !columnMap.has(key));

      results.push({
        typeName: typeRow.typeName,
        tableName,
        status: missingExactColumns.length ? "missingExactColumns" : "ok",
        missingExactColumns,
        columnRenames: [],
        archiveKeyUpdates: [],
        exactKeyPolicy: true,
        applied: false,
      });
    }

    return {
      success: results.every((result) => !["failed"].includes(result.status)),
      applied: apply,
      checked: results.length,
      results,
    };
  }

  async function validatePassportTypeStorage({ repair = false } = {}) {
    const typeRows = await pool.query('SELECT id, "typeName" AS "typeName", "fieldsJson" AS "fieldsJson" FROM "passportTypes" ORDER BY "typeName"');
    const results = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.typeName);
      const rawTableName = unquoteSqlIdentifier(tableName);
      const tableExists = await pool.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
         LIMIT 1`,
        [rawTableName]
      ).then((result) => result.rows.length > 0);

      if (!tableExists) {
        if (repair) {
          await createPassportTable(typeRow.typeName);
          results.push({ typeName: typeRow.typeName, tableName: rawTableName, status: "repairedMissingTable", issues: [] });
        } else {
          results.push({ typeName: typeRow.typeName, tableName: rawTableName, status: "failed", issues: [{ type: "missingTable" }] });
        }
        continue;
      }

      const columnMap = await getLiveTableColumnMap(tableName);
      const issues = [];
      const expectedFieldKeys = new Set();

      for (const field of flattenTypeFields(typeRow.fieldsJson)) {
        expectedFieldKeys.add(field.key);
        const actualDataType = columnMap.get(field.key);
        const expectedDataType = getPassportFieldDataType(field);
        if (!actualDataType) {
          issues.push({ type: "missingColumn", field: field.key, expectedDataType });
          continue;
        }
        const normalizedActual = actualDataType === "boolean" ? "boolean" : actualDataType === "jsonb" ? "jsonb" : "text";
        if (normalizedActual !== expectedDataType) {
          issues.push({ type: "columnTypeMismatch", field: field.key, expectedDataType, actualDataType });
        }
      }

      for (const columnName of columnMap.keys()) {
        if (livePassportSystemColumns.has(columnName) || expectedFieldKeys.has(columnName)) continue;
        issues.push({ type: "extraColumn", field: columnName });
      }

      if (repair && issues.some((issue) => issue.type === "missingColumn")) {
        await createPassportTable(typeRow.typeName);
      }

      results.push({
        typeName: typeRow.typeName,
        tableName: rawTableName,
        schemaVersion: getTypeSchemaVersion(typeRow.fieldsJson),
        status: issues.length ? "failed" : "ok",
        issues,
      });
    }

    return {
      success: results.every((result) => result.status === "ok" || result.status === "repairedMissingTable"),
      checked: results.length,
      results,
    };
  }

  async function queryTableStats(typeName, companyId = null) {
    const tableName = getTable(typeName);
    const params = [];
    let companyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      companyFilter = " AND \"companyId\" = $1";
      params.push(companyId);
    }
    const r = await pool.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN "releaseStatus" = 'draft'     THEN 1 END) AS draft,
        COUNT(CASE WHEN "releaseStatus" = 'released'  THEN 1 END) AS released,
        COUNT(CASE WHEN "releaseStatus" IN ${inRevisionStatusesSql} THEN 1 END) AS revised,
        COUNT(CASE WHEN "releaseStatus" = 'inReview' THEN 1 END) AS inReview,
        COUNT(CASE WHEN "releaseStatus" = 'obsolete'  THEN 1 END) AS obsolete
      FROM ${tableName}
      WHERE "deletedAt" IS NULL${companyFilter}
    `, params);
    const row = r.rows[0];
    return {
      total: parseInt(row.total),
      draft: parseInt(row.draft),
      released: parseInt(row.released),
      revised: parseInt(row.revised),
      inReview: parseInt(row.inReview),
      obsolete: parseInt(row.obsolete),
    };
  }

  return {
    getLatestCompanyPassports,
    normalizePassportTypeSchema,
    getTypeSchemaVersion,
    buildPassportTypeSchemaChange,
    passportTypeHasStoredRecords,
    createPassportTable,
    validatePassportTypeStorage,
    queryTableStats,
    migratePassportStorageToSchemaKeys,
  };
}

module.exports = {
  createSchemaStorageHelpers,
};
