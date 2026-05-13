"use strict";

const nodeCrypto = require("crypto");
const { normalizeSystemPassportHeader } = require("../../../services/passport-header-fields");

function createSchemaStorageHelpers({
  pool,
  logger,
  getTable,
  normalizePassportRow,
  isEditablePassportStatus,
  LIVE_PASSPORT_SYSTEM_COLUMNS,
  LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS,
  IN_REVISION_STATUSES_SQL,
}) {
  async function getLatestCompanyPassports({ companyId, passportType }) {
    const tableName = getTable(passportType);
    const result = await pool.query(
      `SELECT DISTINCT ON (lineage_id) *
       FROM ${tableName}
       WHERE company_id = $1
         AND deleted_at IS NULL
       ORDER BY lineage_id, version_number DESC, updated_at DESC`,
      [companyId]
    );
    return result.rows.map((row) => {
      const normalized = normalizePassportRow(row);
      return {
        ...normalized,
        is_editable: isEditablePassportStatus(normalized.release_status),
      };
    });
  }

  function normalizePassportTypeSchema({ sections = [], systemHeader = null, currentSchemaVersion = 0 } = {}) {
    const parsedVersion = Number.parseInt(currentSchemaVersion, 10);
    return {
      schemaVersion: Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1,
      systemHeader: normalizeSystemPassportHeader(systemHeader),
      sections: Array.isArray(sections) ? sections : [],
    };
  }

  function getTypeSchemaVersion(fieldsJson) {
    const parsedVersion = Number.parseInt(fieldsJson?.schemaVersion, 10);
    return Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1;
  }

  function flattenTypeFields(fieldsJsonOrSections) {
    const sections = Array.isArray(fieldsJsonOrSections)
      ? fieldsJsonOrSections
      : fieldsJsonOrSections?.sections;
    return (Array.isArray(sections) ? sections : [])
      .flatMap((section) => Array.isArray(section?.fields) ? section.fields : [])
      .filter((field) => field?.key);
  }

  function isStructuredPassportField(field) {
    const storageType = String(field?.storageType || field?.storage_type || field?.valueType || "").trim().toLowerCase();
    return field?.type === "table"
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
      "SELECT COUNT(*)::int AS count FROM passport_archives WHERE passport_type = $1",
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
    const typeRes = await pool.query("SELECT id FROM passport_types WHERE type_name = $1", [typeName]).catch(() => ({ rows: [] }));
    await pool.query(
      `INSERT INTO passport_type_schema_events
         (passport_type_id, type_name, table_name, schema_version, event_type, change_summary, created_by)
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
    return `idx_${digest}_${fieldKey}`.slice(0, 60);
  }

  async function ensureQueryableFieldIndex({ tableName, field }) {
    if (field?.queryable !== true && field?.indexed !== true) return null;
    const indexName = buildQueryableIndexName(tableName, field.key);
    if (getPassportFieldDataType(field) === "jsonb") {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING GIN (${field.key})`);
    } else {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${field.key}) WHERE deleted_at IS NULL`);
    }
    return indexName;
  }

  async function createPassportTable(typeName, { createdBy = null, eventType = "create_or_reconcile_table" } = {}) {
    const tableName = getTable(typeName);
    const typeRes = await pool.query(
      "SELECT fields_json FROM passport_types WHERE type_name = $1",
      [typeName]
    );
    if (!typeRes.rows.length)
      throw new Error(`Passport type '${typeName}' not found in passport_types`);

    const sections = typeRes.rows[0].fields_json?.sections || [];
    const ddlCols = [];
    for (const section of sections) {
      for (const field of (section.fields || [])) {
        const colType = getPassportFieldColumnType(field);
        ddlCols.push(`    ${field.key} ${colType}`);
      }
    }
    const customColsDDL = ddlCols.length ? ",\n" + ddlCols.join(",\n") : "";

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id             SERIAL       PRIMARY KEY,
        dpp_id         TEXT         NOT NULL,
        lineage_id     TEXT         NOT NULL,
        company_id     INTEGER      NOT NULL,
        model_name     VARCHAR(255),
        product_id     VARCHAR(255) NOT NULL,
        product_identifier_did TEXT,
        compliance_profile_key VARCHAR(120) NOT NULL DEFAULT 'generic_dpp_v1',
        content_specification_ids TEXT,
        carrier_policy_key VARCHAR(120),
        carrier_authenticity JSONB,
        economic_operator_id TEXT,
        economic_operator_identifier_scheme VARCHAR(80),
        facility_id TEXT,
        granularity    VARCHAR(20)  NOT NULL DEFAULT 'model',
        release_status VARCHAR(50)  NOT NULL DEFAULT 'draft',
        version_number INTEGER      NOT NULL DEFAULT 1,
        qr_code        TEXT,
        created_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        updated_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ${customColsDDL}
      )
    `);

    await pool.query(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${tableName}_guid_key`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_dpp_id_version_unique ON ${tableName}(dpp_id, version_number) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_dpp_id ON ${tableName}(dpp_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_lineage ON ${tableName}(lineage_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName}(release_status) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_product_identifier_did ON ${tableName}(company_id, product_identifier_did) WHERE deleted_at IS NULL`);

    for (const [columnName, columnDefinition] of LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS) {
      await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnDefinition}`);
    }

    const addedColumns = [];
    const indexedColumns = [];
    for (const field of flattenTypeFields(typeRes.rows[0].fields_json)) {
      await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${field.key} ${getPassportFieldColumnType(field)}`);
      addedColumns.push({
        key: field.key,
        dataType: getPassportFieldDataType(field),
      });
      const indexName = await ensureQueryableFieldIndex({ tableName, field });
      if (indexName) indexedColumns.push({ key: field.key, indexName });
    }

    await recordPassportTypeSchemaEvent({
      typeName,
      tableName,
      schemaVersion: getTypeSchemaVersion(typeRes.rows[0].fields_json),
      eventType,
      changeSummary: { ensuredColumns: addedColumns, indexedColumns },
      createdBy,
    });
  }

  async function validatePassportTypeStorage({ repair = false } = {}) {
    const typeRows = await pool.query("SELECT id, type_name, fields_json FROM passport_types ORDER BY type_name");
    const results = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const tableExists = await pool.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
         LIMIT 1`,
        [tableName]
      ).then((result) => result.rows.length > 0);

      if (!tableExists) {
        if (repair) {
          await createPassportTable(typeRow.type_name);
          results.push({ typeName: typeRow.type_name, tableName, status: "repaired_missing_table", issues: [] });
        } else {
          results.push({ typeName: typeRow.type_name, tableName, status: "failed", issues: [{ type: "missing_table" }] });
        }
        continue;
      }

      const columns = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );
      const columnMap = new Map(columns.rows.map((row) => [row.column_name, row.data_type]));
      const issues = [];
      const expectedFieldKeys = new Set();

      for (const field of flattenTypeFields(typeRow.fields_json)) {
        expectedFieldKeys.add(field.key);
        const actualDataType = columnMap.get(field.key);
        const expectedDataType = getPassportFieldDataType(field);
        if (!actualDataType) {
          issues.push({ type: "missing_column", field: field.key, expectedDataType });
          continue;
        }
        const normalizedActual = actualDataType === "boolean" ? "boolean" : actualDataType === "jsonb" ? "jsonb" : "text";
        if (normalizedActual !== expectedDataType) {
          issues.push({ type: "column_type_mismatch", field: field.key, expectedDataType, actualDataType });
        }
      }

      for (const columnName of columnMap.keys()) {
        if (LIVE_PASSPORT_SYSTEM_COLUMNS.has(columnName) || expectedFieldKeys.has(columnName)) continue;
        issues.push({ type: "extra_column", field: columnName });
      }

      if (repair && issues.some((issue) => issue.type === "missing_column")) {
        await createPassportTable(typeRow.type_name);
      }

      results.push({
        typeName: typeRow.type_name,
        tableName,
        schemaVersion: getTypeSchemaVersion(typeRow.fields_json),
        status: issues.length ? "failed" : "ok",
        issues,
      });
    }

    return {
      success: results.every((result) => result.status === "ok" || result.status === "repaired_missing_table"),
      checked: results.length,
      results,
    };
  }

  async function queryTableStats(typeName, companyId = null) {
    const tableName = getTable(typeName);
    const params = [];
    let companyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      companyFilter = " AND company_id = $1";
      params.push(companyId);
    }
    const r = await pool.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN release_status = 'draft'     THEN 1 END) AS draft,
        COUNT(CASE WHEN release_status = 'released'  THEN 1 END) AS released,
        COUNT(CASE WHEN release_status IN ${IN_REVISION_STATUSES_SQL} THEN 1 END) AS revised,
        COUNT(CASE WHEN release_status = 'in_review' THEN 1 END) AS in_review,
        COUNT(CASE WHEN release_status = 'obsolete'  THEN 1 END) AS obsolete
      FROM ${tableName}
      WHERE deleted_at IS NULL${companyFilter}
    `, params);
    const row = r.rows[0];
    return {
      total: parseInt(row.total),
      draft: parseInt(row.draft),
      released: parseInt(row.released),
      revised: parseInt(row.revised),
      in_review: parseInt(row.in_review),
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
  };
}

module.exports = {
  createSchemaStorageHelpers,
};
