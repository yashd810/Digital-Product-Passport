"use strict";

const IN_REVISION_STATUSES_SQL       = `('in_revision','revised')`;
const EDITABLE_RELEASE_STATUSES_SQL  = `('draft','in_revision','revised')`;
const REVISION_BLOCKING_STATUSES_SQL = `('draft','in_revision','revised','in_review')`;
const EDIT_SESSION_TIMEOUT_HOURS     = 12;
const EDIT_SESSION_TIMEOUT_SQL       = `${EDIT_SESSION_TIMEOUT_HOURS} hours`;

module.exports = function createPassportService({
  pool,
  // pure helpers (from passport-helpers.js)
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
  // email service
  createTransporter,
  brandedEmail,
}) {
  // ─── AUDIT / NOTIFICATION ────────────────────────────────────────────────

  async function logAudit(companyId, userId, action, tableName, passportGuid, oldData, newData) {
    try {
      await pool.query(
        `INSERT INTO audit_logs (company_id,user_id,action,table_name,record_id,old_values,new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId || null, userId || null, action, tableName, passportGuid || null,
         oldData ? JSON.stringify(oldData) : null,
         newData ? JSON.stringify(newData) : null]
      );
    } catch (e) { console.error("Audit log error (non-fatal):", e.message); }
  }

  async function createNotification(userId, type, title, message, passportGuid, actionUrl) {
    if (!userId) return;
    try {
      await pool.query(
        `INSERT INTO notifications (user_id,type,title,message,passport_guid,action_url)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, type, title, message || null, passportGuid || null, actionUrl || null]
      );
    } catch (e) { console.error("Notification error (non-fatal):", e.message); }
  }

  // ─── PASSPORT TYPE SCHEMA ────────────────────────────────────────────────

  async function getPassportTypeSchema(typeName) {
    const normalizedInput = String(typeName || "").trim();
    if (!normalizedInput) return null;
    const typeRes = await pool.query(
      `SELECT type_name, display_name, fields_json
       FROM passport_types
       WHERE type_name = $1 OR LOWER(display_name) = LOWER($1)
       LIMIT 1`,
      [normalizedInput]
    );
    if (!typeRes.rows.length) return null;
    const sections = typeRes.rows[0]?.fields_json?.sections || [];
    const schemaFields = sections.flatMap(section => section.fields || []);
    return {
      typeName: typeRes.rows[0].type_name,
      displayName: typeRes.rows[0].display_name,
      schemaFields,
      allowedKeys: new Set(schemaFields.map(field => field.key).filter(Boolean)),
    };
  }

  // ─── PASSPORT QUERIES ────────────────────────────────────────────────────

  async function findExistingPassportByProductId({
    tableName,
    companyId,
    productId,
    excludeGuid = null,
    excludeLineageId = null,
  }) {
    if (!productId) return null;
    const params = [companyId, productId];
    let exclusionSql = "";
    if (excludeGuid) {
      params.push(excludeGuid);
      exclusionSql += ` AND guid <> $${params.length}`;
    }
    if (excludeLineageId) {
      params.push(excludeLineageId);
      exclusionSql += ` AND lineage_id <> $${params.length}`;
    }
    const existing = await pool.query(
      `SELECT id, guid, lineage_id, product_id, release_status, version_number
       FROM ${tableName}
       WHERE company_id = $1
         AND product_id = $2
         AND deleted_at IS NULL${exclusionSql}
       ORDER BY version_number DESC, updated_at DESC, id DESC
       LIMIT 1`,
      params
    );
    return existing.rows[0] || null;
  }

  async function getPassportLineageContext({ guid, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [guid];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND company_id = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT guid, lineage_id, product_id
       FROM ${tableName}
       WHERE guid = $1${liveCompanyFilter}
       ORDER BY version_number DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) return liveRes.rows[0];

    const archiveParams = [guid, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT guid, lineage_id, product_id
       FROM passport_archives
       WHERE guid = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC
       LIMIT 1`,
      archiveParams
    );
    return archiveRes.rows[0] || null;
  }

  async function getPassportVersionsByLineage({ lineageId, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [lineageId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND company_id = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE lineage_id = $1
         AND deleted_at IS NULL${liveCompanyFilter}
       ORDER BY version_number DESC, updated_at DESC`,
      liveParams
    );

    const archiveParams = [lineageId, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT guid, lineage_id, company_id, passport_type, version_number, model_name, product_id, release_status, archived_at, row_data
       FROM passport_archives
       WHERE lineage_id = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC, archived_at DESC`,
      archiveParams
    );

    const liveVersions = liveRes.rows.map(normalizePassportRow);
    const seenGuids = new Set(liveVersions.map((row) => row.guid));
    const archiveVersions = archiveRes.rows
      .map((row) => {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        return {
          ...rowData,
          guid: row.guid || rowData?.guid,
          lineage_id: row.lineage_id || rowData?.lineage_id,
          company_id: row.company_id || rowData?.company_id,
          passport_type: row.passport_type || rowData?.passport_type,
          version_number: row.version_number ?? rowData?.version_number,
          model_name: row.model_name || rowData?.model_name,
          product_id: row.product_id || rowData?.product_id,
          release_status: row.release_status || rowData?.release_status,
          archived: true,
          archived_at: row.archived_at,
        };
      })
      .map(normalizePassportRow)
      .filter((row) => row?.guid && !seenGuids.has(row.guid));

    return [...liveVersions, ...archiveVersions]
      .sort((a, b) => Number(b.version_number || 0) - Number(a.version_number || 0));
  }

  async function getCompanyNameMap(companyIds) {
    const uniqueCompanyIds = [...new Set((companyIds || []).filter(Boolean).map((value) => String(value)))];
    if (!uniqueCompanyIds.length) return new Map();
    const result = await pool.query(
      "SELECT id, company_name FROM companies WHERE id = ANY($1::int[])",
      [uniqueCompanyIds.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite)]
    );
    return new Map(result.rows.map((row) => [String(row.id), row.company_name || ""]));
  }

  async function stripRestrictedFieldsForPublicView(passport, passportType) {
    if (!passport || !passportType) return passport;
    const sanitized = { ...passport };
    try {
      const typeRes = await pool.query(
        "SELECT fields_json FROM passport_types WHERE type_name = $1",
        [passportType]
      );
      if (!typeRes.rows.length) return sanitized;
      const sections = typeRes.rows[0].fields_json?.sections || [];
      for (const section of sections) {
        for (const field of (section.fields || [])) {
          const access = field.access || ["public"];
          if (!access.includes("public")) delete sanitized[field.key];
        }
      }
    } catch {
      return sanitized;
    }
    return sanitized;
  }

  async function fetchCompanyPassportRecord({ companyId, guid, passportType = null }) {
    let resolvedPassportType = passportType || null;

    if (!resolvedPassportType) {
      const regRes = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2",
        [guid, companyId]
      );
      if (regRes.rows.length) resolvedPassportType = regRes.rows[0].passport_type;
    }

    if (!resolvedPassportType) {
      const archiveTypeRes = await pool.query(
        `SELECT passport_type
         FROM passport_archives
         WHERE guid = $1 AND company_id = $2
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [guid, companyId]
      );
      if (archiveTypeRes.rows.length) resolvedPassportType = archiveTypeRes.rows[0].passport_type;
    }

    if (!resolvedPassportType) return null;

    const tableName = getTable(resolvedPassportType);
    const liveRes = await pool.query(
      `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
       FROM ${tableName} p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.guid = $1 AND p.company_id = $2 AND p.deleted_at IS NULL
       LIMIT 1`,
      [guid, companyId]
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: resolvedPassportType },
        archived: false,
      };
    }

    const archiveRes = await pool.query(
      `SELECT pa.row_data
       FROM passport_archives pa
       WHERE pa.guid = $1 AND pa.company_id = $2 AND pa.passport_type = $3
       ORDER BY pa.version_number DESC, pa.archived_at DESC
       LIMIT 1`,
      [guid, companyId, resolvedPassportType]
    );
    if (!archiveRes.rows.length) return null;

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;

    return {
      passport: { ...normalizePassportRow(rowData), passport_type: resolvedPassportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByGuid(guid) {
    const normalizedGuid = String(guid || "").trim();
    if (!normalizedGuid) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
      [normalizedGuid]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);

    const liveRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE guid = $1
         AND release_status = 'released'
         AND deleted_at IS NULL
       ORDER BY version_number DESC
       LIMIT 1`,
      [normalizedGuid]
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType },
        archived: false,
      };
    }

    const archiveRes = await pool.query(
      `SELECT row_data FROM passport_archives
       WHERE guid = $1
         AND passport_type = $2
         AND release_status = 'released'
       ORDER BY version_number DESC
       LIMIT 1`,
      [normalizedGuid, passportType]
    );
    if (!archiveRes.rows.length) return { passport: null, archived: false };

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;
    return {
      passport: { ...normalizePassportRow(rowData), passport_type: passportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByProductId(productId, { versionNumber = null } = {}) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!normalizedProductId) return { passport: null, archived: false };

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      const liveParams = [normalizedProductId];
      let versionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE product_id = $1
           AND ${
             versionNumber !== null && versionNumber !== undefined
               ? "release_status IN ('released', 'obsolete')"
               : "release_status = 'released'"
           }
           AND deleted_at IS NULL${versionSql}
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        liveParams
      );
      if (liveRes.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
          archived: false,
        });
        continue;
      }

      const archiveParams = versionNumber !== null && versionNumber !== undefined
        ? [normalizedProductId, type_name, versionNumber]
        : [normalizedProductId, type_name];
      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE product_id = $1
           AND passport_type = $2
           AND ${
             versionNumber !== null && versionNumber !== undefined
               ? "release_status IN ('released', 'obsolete')"
               : "release_status = 'released'"
           }${versionNumber !== null && versionNumber !== undefined ? " AND version_number = $3" : ""}
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        archiveParams
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        matches.push({
          passport: { ...normalizePassportRow(rowData), passport_type: type_name, archived: true },
          archived: true,
        });
      }
    }

    if (!matches.length) return { passport: null, archived: false };
    if (matches.length > 1) {
      const error = new Error(`Multiple released passports share product_id "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return matches[0];
  }

  async function resolvePublicPassportByGuid(guid, { versionNumber = null } = {}) {
    const normalizedGuid = String(guid || "").trim();
    if (!normalizedGuid) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
      [normalizedGuid]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);

    if (versionNumber !== null && versionNumber !== undefined) {
      const lineageContext = await getPassportLineageContext({ guid: normalizedGuid, passportType });
      if (!lineageContext?.lineage_id) return { passport: null, archived: false };

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE lineage_id = $1
           AND version_number = $2
           AND release_status IN ('released', 'obsolete')
           AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
        [lineageContext.lineage_id, versionNumber]
      );
      if (liveRes.rows.length) {
        const passport = { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType };
        const visibilityRes = await pool.query(
          `SELECT is_public
           FROM passport_history_visibility
           WHERE passport_guid = $1 AND version_number = $2
           LIMIT 1`,
          [passport.guid, versionNumber]
        );
        const isVisible = visibilityRes.rows.length
          ? !!visibilityRes.rows[0].is_public
          : isPublicHistoryStatus(passport.release_status);
        return isVisible ? { passport, archived: false } : { passport: null, archived: false };
      }

      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE lineage_id = $1
           AND passport_type = $2
           AND version_number = $3
           AND release_status IN ('released', 'obsolete')
         ORDER BY archived_at DESC
         LIMIT 1`,
        [lineageContext.lineage_id, passportType, versionNumber]
      );
      if (!archiveRes.rows.length) return { passport: null, archived: false };

      const rowData = typeof archiveRes.rows[0].row_data === "string"
        ? JSON.parse(archiveRes.rows[0].row_data)
        : archiveRes.rows[0].row_data;
      const passport = { ...normalizePassportRow(rowData), passport_type: passportType, archived: true };
      const visibilityRes = await pool.query(
        `SELECT is_public
         FROM passport_history_visibility
         WHERE passport_guid = $1 AND version_number = $2
         LIMIT 1`,
        [passport.guid, versionNumber]
      );
      const isVisible = visibilityRes.rows.length
        ? !!visibilityRes.rows[0].is_public
        : isPublicHistoryStatus(passport.release_status);
      return isVisible ? { passport, archived: true } : { passport: null, archived: false };
    }

    return resolveReleasedPassportByGuid(normalizedGuid);
  }

  async function resolveCompanyPreviewPassportByProductId(companyId, productId) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!companyId || !normalizedProductId) return { passport: null, archived: false };

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const liveMatches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $1
           AND product_id = $2
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC, id DESC
         LIMIT 1`,
        [companyId, normalizedProductId]
      );
      if (liveRes.rows.length) {
        liveMatches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
          archived: false,
        });
      }
    }

    if (liveMatches.length > 1) {
      const error = new Error(`Multiple passports in company "${companyId}" share product_id "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    if (liveMatches.length === 1) return liveMatches[0];

    const archiveMatches = [];
    for (const { type_name } of ptRows.rows) {
      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE company_id = $1
           AND passport_type = $2
           AND product_id = $3
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [companyId, type_name, normalizedProductId]
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        archiveMatches.push({
          passport: { ...normalizePassportRow(rowData), passport_type: type_name, archived: true },
          archived: true,
        });
      }
    }

    if (archiveMatches.length > 1) {
      const error = new Error(`Multiple archived passports in company "${companyId}" share product_id "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return archiveMatches[0] || { passport: null, archived: false };
  }

  async function resolveCompanyPreviewPassport({ companyId, passportKey }) {
    const normalizedPassportKey = normalizeProductIdValue(passportKey);
    if (normalizedPassportKey) {
      const productMatch = await resolveCompanyPreviewPassportByProductId(companyId, normalizedPassportKey);
      if (productMatch?.passport) return productMatch;
    }
    return fetchCompanyPassportRecord({ companyId, guid: passportKey });
  }

  async function updatePassportRowById({ tableName, rowId, userId, data, excluded = SYSTEM_PASSPORT_FIELDS }) {
    const updateCols = getWritablePassportColumns(data, excluded);
    if (!updateCols.length) return [];

    const vals = getStoredPassportValues(updateCols, data);
    const sets = updateCols.map((col, i) => `${col} = $${i + 1}`).join(", ");
    await pool.query(
      `UPDATE ${tableName}
       SET ${sets}, updated_by = $${vals.length + 1}, updated_at = NOW()
       WHERE id = $${vals.length + 2}`,
      [...vals, userId, rowId]
    );
    return updateCols;
  }

  const buildPassportVersionHistory = async ({
    guid,
    passportType,
    companyId = null,
    publicOnly = false,
  }) => {
    const typeRes = await pool.query(
      "SELECT display_name, fields_json FROM passport_types WHERE type_name = $1",
      [passportType]
    );
    const typeRow = typeRes.rows[0] || null;
    const fieldDefs = getHistoryFieldDefs(typeRow);

    const lineageContext = await getPassportLineageContext({ guid, passportType, companyId });
    if (!lineageContext?.lineage_id) {
      return {
        passportType,
        displayName: typeRow?.display_name || passportType,
        history: [],
      };
    }

    const versions = await getPassportVersionsByLineage({
      lineageId: lineageContext.lineage_id,
      passportType,
      companyId,
    });

    const creatorIds = [...new Set(versions.map((row) => row.created_by).filter(Boolean))];
    const creatorMap = new Map();
    const companyNameMap = await getCompanyNameMap(versions.map((row) => row.company_id).filter(Boolean));
    if (creatorIds.length) {
      const userRes = await pool.query(
        "SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::int[])",
        [creatorIds]
      );
      userRes.rows.forEach((row) => {
        creatorMap.set(
          row.id,
          `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || `User #${row.id}`
        );
      });
    }

    const versionGuids = versions.map((row) => row.guid).filter(Boolean);
    const visibilityRes = versionGuids.length
      ? await pool.query(
          `SELECT passport_guid, version_number, is_public
           FROM passport_history_visibility
           WHERE passport_guid = ANY($1::uuid[])`,
          [versionGuids]
        )
      : { rows: [] };
    const visibilityMap = new Map(
      visibilityRes.rows.map((row) => [`${row.passport_guid}:${Number(row.version_number)}`, !!row.is_public])
    );

    const ascending = [...versions].sort((a, b) => Number(a.version_number) - Number(b.version_number));
    const previousByVersion = new Map();
    ascending.forEach((version, index) => {
      previousByVersion.set(Number(version.version_number), index > 0 ? ascending[index - 1] : null);
    });

    const latestVersionNumber = versions[0]?.version_number ?? null;
    const latestReleasedVersionNumber = versions
      .filter((row) => isPublicHistoryStatus(row.release_status))
      .reduce((max, row) => Math.max(max, Number(row.version_number || 0)), 0);

    const history = versions
      .map((version) => {
        const versionNumber = Number(version.version_number);
        const previous = previousByVersion.get(versionNumber) || null;
        const normalizedStatus = normalizeReleaseStatus(version.release_status);
        const defaultPublic = isPublicHistoryStatus(normalizedStatus);
        const visibilityKey = `${version.guid}:${versionNumber}`;
        const isPublic = visibilityMap.has(visibilityKey)
          ? visibilityMap.get(visibilityKey)
          : defaultPublic;

        if (publicOnly && (!defaultPublic || !isPublic)) return null;

        const changedFields = previous
          ? fieldDefs.flatMap((field) => {
              const beforeComparable = comparableHistoryFieldValue(field, previous[field.key]);
              const afterComparable = comparableHistoryFieldValue(field, version[field.key]);
              if (beforeComparable === afterComparable) return [];
              return [{
                key: field.key,
                label: field.label || field.key,
                before: formatHistoryFieldValue(field, previous[field.key]),
                after: formatHistoryFieldValue(field, version[field.key]),
              }];
            })
          : [];

        return {
          version_number: versionNumber,
          release_status: normalizedStatus,
          created_at: version.created_at,
          updated_at: version.updated_at,
          created_by_name: creatorMap.get(version.created_by) || null,
          is_public: isPublic,
          guid: version.guid,
          public_path: buildCurrentPublicPassportPath({
            companyName: companyNameMap.get(String(version.company_id)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.model_name,
            productId: version.product_id,
          }),
          inactive_path: buildInactivePublicPassportPath({
            companyName: companyNameMap.get(String(version.company_id)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.model_name,
            productId: version.product_id,
            versionNumber,
          }),
          changed_fields: changedFields,
          change_count: changedFields.length,
          summary: previous
            ? (changedFields.length
                ? `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed from v${previous.version_number}.`
                : `No field changes detected from v${previous.version_number}.`)
            : "Initial version.",
          is_current: publicOnly
            ? versionNumber === Number(latestReleasedVersionNumber || latestVersionNumber)
            : versionNumber === Number(latestVersionNumber),
        };
      })
      .filter(Boolean);

    return {
      passportType,
      displayName: typeRow?.display_name || passportType,
      history,
    };
  };

  // ─── EDIT SESSION HELPERS ────────────────────────────────────────────────

  async function clearExpiredEditSessions() {
    await pool.query(
      `DELETE FROM passport_edit_sessions
       WHERE last_activity_at < NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'`
    );
  }

  async function listActiveEditSessions(passportGuid, currentUserId = null) {
    await clearExpiredEditSessions();
    const params = [passportGuid];
    let currentUserFilter = "";
    if (currentUserId) {
      params.push(currentUserId);
      currentUserFilter = ` AND pes.user_id <> $${params.length}`;
    }
    const res = await pool.query(
      `SELECT
         pes.user_id,
         pes.last_activity_at,
         u.first_name,
         u.last_name,
         u.email
       FROM passport_edit_sessions pes
       JOIN users u ON u.id = pes.user_id
       WHERE pes.passport_guid = $1
         AND pes.last_activity_at >= NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'
         ${currentUserFilter}
       ORDER BY pes.last_activity_at DESC`,
      params
    );
    return res.rows.map((row) => ({
      user_id: row.user_id,
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
      email: row.email,
      last_activity_at: row.last_activity_at,
    }));
  }

  // ─── MARK OBSOLETE ────────────────────────────────────────────────────────

  async function markOlderVersionsObsolete(tableName, guid, newVersionNumber) {
    try {
      const lineageRes = await pool.query(
        `SELECT lineage_id FROM ${tableName} WHERE guid = $1 LIMIT 1`, [guid]
      );
      if (!lineageRes.rows.length) return;
      const lineageId = lineageRes.rows[0].lineage_id;
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = 'obsolete', updated_at = NOW()
         WHERE lineage_id = $1
           AND version_number < $2
           AND release_status = 'released'
           AND deleted_at IS NULL`,
        [lineageId, newVersionNumber]
      );
    } catch (e) {
      console.error("Mark obsolete error (non-fatal):", e.message);
    }
  }

  // ─── ANALYTICS HELPERS ────────────────────────────────────────────────────

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

  async function createPassportTable(typeName) {
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
        const colType = field.type === "boolean" ? "BOOLEAN DEFAULT false" : "TEXT";
        ddlCols.push(`    ${field.key} ${colType}`);
      }
    }
    const customColsDDL = ddlCols.length ? ",\n" + ddlCols.join(",\n") : "";

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id             SERIAL       PRIMARY KEY,
        guid           UUID         NOT NULL DEFAULT gen_random_uuid(),
        lineage_id     UUID         NOT NULL DEFAULT gen_random_uuid(),
        company_id     INTEGER      NOT NULL,
        model_name     VARCHAR(255),
        product_id     VARCHAR(255) NOT NULL,
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
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_guid_version_unique ON ${tableName}(guid, version_number) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_guid ON ${tableName}(guid) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_lineage ON ${tableName}(lineage_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName}(release_status) WHERE deleted_at IS NULL`);
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
      total:     parseInt(row.total),
      draft:     parseInt(row.draft),
      released:  parseInt(row.released),
      revised:   parseInt(row.revised),
      in_review: parseInt(row.in_review),
      obsolete:  parseInt(row.obsolete),
    };
  }

  // ─── WORKFLOW SUBMISSION ──────────────────────────────────────────────────

  async function submitPassportToWorkflow({
    companyId,
    guid,
    passportType,
    userId,
    reviewerId,
    approverId,
  }) {
    const tableName = getTable(passportType);
    const resolvedReviewerId = reviewerId ? parseInt(reviewerId, 10) : null;
    const resolvedApproverId = approverId ? parseInt(approverId, 10) : null;

    if (!resolvedReviewerId && !resolvedApproverId) {
      throw new Error("At least one reviewer or approver is required to submit a revision to workflow.");
    }

    const pRes = await pool.query(
      `SELECT id, model_name, product_id, version_number, release_status FROM ${tableName}
       WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [guid]
    );
    if (!pRes.rows.length) throw new Error("Editable passport not found");
    const passport = normalizePassportRow(pRes.rows[0]);

    await pool.query(
      `UPDATE ${tableName} SET release_status = 'in_review', updated_at = NOW()
       WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`,
      [guid]
    );

    const wfRes = await pool.query(
      `INSERT INTO passport_workflow
         (passport_guid, passport_type, company_id, submitted_by, reviewer_id, approver_id,
          review_status, approval_status, overall_status, previous_release_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)
       RETURNING id`,
      [
        guid,
        passportType,
        companyId,
        userId,
        resolvedReviewerId,
        resolvedApproverId,
        resolvedReviewerId ? "pending" : "skipped",
        resolvedApproverId ? "pending" : "skipped",
        normalizeReleaseStatus(passport.release_status) || IN_REVISION_STATUS,
      ]
    );

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    if (resolvedReviewerId) {
      await createNotification(
        resolvedReviewerId,
        "workflow_review",
        `Review requested: ${passport.product_id}`,
        `v${passport.version_number} needs your review`,
        guid,
        "/dashboard/workflow"
      );
      try {
        const reviewer = await pool.query("SELECT email, first_name FROM users WHERE id = $1", [resolvedReviewerId]);
        const submitter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [userId]);
        if (reviewer.rows.length) {
          const reviewerName = reviewer.rows[0].first_name || "Reviewer";
          const submitterName =
            `${submitter.rows[0]?.first_name || ""} ${submitter.rows[0]?.last_name || ""}`.trim() ||
            submitter.rows[0]?.email ||
            "A colleague";
          await createTransporter().sendMail({
            from: process.env.EMAIL_FROM || "noreply@example.com",
            to: reviewer.rows[0].email,
            subject: `[DPP] Review requested — ${passport.product_id}`,
            html: brandedEmail({
              preheader: `${submitterName} submitted a passport for your review`,
              bodyHtml: `
                <p>Hi <strong>${reviewerName}</strong>,</p>
                <p><strong>${submitterName}</strong> has submitted a passport for your review.</p>
                <div class="info-box">
                  <div class="info-row"><span class="info-label">Serial Number</span><span class="info-value">${passport.product_id}</span></div>
                  ${passport.model_name ? `<div class="info-row"><span class="info-label">Model</span><span class="info-value">${passport.model_name}</span></div>` : ""}
                  <div class="info-row"><span class="info-label">Version</span><span class="info-value">v${passport.version_number}</span></div>
                  <div class="info-row"><span class="info-label">Type</span><span class="info-value">${passportType}</span></div>
                </div>
                <div class="cta-wrap"><a href="${appUrl}/dashboard/workflow" class="cta-btn">🔍 Review Now →</a></div>`,
            }),
          });
        }
      } catch (e) {
        console.error("Review email error:", e.message);
      }
    }

    if (resolvedApproverId && !resolvedReviewerId) {
      await createNotification(
        resolvedApproverId,
        "workflow_approval",
        `Approval requested: ${passport.product_id}`,
        `v${passport.version_number} needs your approval`,
        guid,
        "/dashboard/workflow"
      );
    }

    await logAudit(companyId, userId, "SUBMIT_REVIEW", tableName, guid, null, {
      reviewerId: resolvedReviewerId,
      approverId: resolvedApproverId,
      status: "in_review",
    });

    return { workflowId: wfRes.rows[0].id };
  }

  return {
    // SQL constants (useful for route files to construct queries)
    IN_REVISION_STATUSES_SQL,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    EDIT_SESSION_TIMEOUT_HOURS,
    EDIT_SESSION_TIMEOUT_SQL,
    // functions
    logAudit,
    createNotification,
    getPassportTypeSchema,
    findExistingPassportByProductId,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    getCompanyNameMap,
    stripRestrictedFieldsForPublicView,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByGuid,
    resolveReleasedPassportByProductId,
    resolvePublicPassportByGuid,
    resolveCompanyPreviewPassportByProductId,
    resolveCompanyPreviewPassport,
    updatePassportRowById,
    buildPassportVersionHistory,
    clearExpiredEditSessions,
    listActiveEditSessions,
    markOlderVersionsObsolete,
    getLatestCompanyPassports,
    createPassportTable,
    queryTableStats,
    submitPassportToWorkflow,
  };
};
