"use strict";

function createArchiveHistoryHelpers({
  pool,
  logger,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  getStoredPassportValues,
  quoteSqlIdentifier,
  normalizePassportRow,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  comparableHistoryFieldValue,
  formatHistoryFieldValue,
  getHistoryFieldDefs,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  getPassportLineageContext,
  getPassportVersionsByLineage,
  getCompanyNameMap,
}) {
  function buildArchiveSnapshotRow(passport) {
    if (!passport || typeof passport !== "object") return null;
    const rowData = { ...passport };
    delete rowData.id;
    return rowData;
  }

  async function archivePassportSnapshot({
    passport,
    passportType,
    archivedBy = null,
    actorIdentifier = null,
    snapshotReason = "state_snapshot",
    client = pool,
  }) {
    const rowData = buildArchiveSnapshotRow(passport);
    if (!rowData || !passportType) return null;

    const dppId = rowData.dppId || null;
    const lineageId = rowData.lineageId || dppId || null;
    if (!dppId || !lineageId) return null;

    await client.query(
      `INSERT INTO passport_archives
         (dpp_id, lineage_id, company_id, passport_type, version_number, model_name,
          internal_alias_id, product_identifier_did, release_status, row_data, archived_by,
          actor_identifier, snapshot_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        dppId,
        lineageId,
        rowData.companyId || null,
        passportType,
        Number.isFinite(Number(rowData.versionNumber)) ? Number(rowData.versionNumber) : 1,
        rowData.modelName || null,
        rowData.internalAliasId || null,
        rowData.uniqueProductIdentifier || null,
        rowData.releaseStatus || null,
        JSON.stringify(rowData),
        archivedBy || null,
        actorIdentifier || null,
        snapshotReason || "state_snapshot",
      ]
    );

    return rowData;
  }

  async function archivePassportSnapshots({
    passports,
    passportType,
    archivedBy = null,
    actorIdentifier = null,
    snapshotReason = "state_snapshot",
    client = pool,
  }) {
    if (!Array.isArray(passports) || !passports.length || !passportType) return 0;
    let count = 0;
    for (const passport of passports) {
      await archivePassportSnapshot({
        passport,
        passportType,
        archivedBy,
        actorIdentifier,
        snapshotReason,
        client,
      });
      count += 1;
    }
    return count;
  }

  async function updatePassportRowById({ tableName, rowId, userId, data, excluded = SYSTEM_PASSPORT_FIELDS, includeUpdatedRow = false }) {
    const updateCols = getWritablePassportColumns(data, excluded);
    if (!updateCols.length) return [];

    const vals = getStoredPassportValues(updateCols, data);
    const sets = updateCols.map((col, i) => `${quoteSqlIdentifier(col)} = $${i + 1}`).join(", ");
    const sql = `UPDATE ${tableName}
       SET ${sets}, "updatedBy" = $${vals.length + 1}, "updatedAt" = NOW()
       WHERE id = $${vals.length + 2}
       ${includeUpdatedRow ? "RETURNING *" : ""}`;
    const result = await pool.query(sql, [...vals, userId, rowId]);
    if (includeUpdatedRow) {
      return {
        updateCols,
        updatedRow: result.rows[0] || null,
      };
    }
    return updateCols;
  }

  async function buildPassportVersionHistory({
    dppId = null,
    passportType,
    companyId = null,
    publicOnly = false,
  }) {
    const typeRes = await pool.query(
      "SELECT display_name, fields_json FROM passport_types WHERE type_name = $1",
      [passportType]
    );
    const typeRow = typeRes.rows[0] || null;
    const fieldDefs = getHistoryFieldDefs(typeRow);

    const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
    if (!lineageContext?.lineage_id) {
      return {
        passportType,
        displayName: typeRow?.display_name || passportType,
        history: [],
      };
    }

    const versions = await getPassportVersionsByLineage({
      lineageId: lineageContext.lineageId,
      passportType,
      companyId,
    });

    const creatorIds = [...new Set(versions.map((row) => row.createdBy).filter(Boolean))];
    const creatorMap = new Map();
    const companyNameMap = await getCompanyNameMap(versions.map((row) => row.companyId).filter(Boolean));
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

    const versionDppIds = versions.map((row) => row.dppId).filter(Boolean);
    const visibilityRes = versionDppIds.length
      ? await pool.query(
          `SELECT passport_dpp_id, version_number, is_public
           FROM passport_history_visibility
           WHERE passport_dpp_id = ANY($1::text[])`,
          [versionDppIds]
        )
      : { rows: [] };
    const visibilityMap = new Map(
      visibilityRes.rows.map((row) => [`${row.passport_dpp_id}:${Number(row.versionNumber)}`, !!row.is_public])
    );

    const ascending = [...versions].sort((a, b) => Number(a.version_number) - Number(b.version_number));
    const previousByVersion = new Map();
    ascending.forEach((version, index) => {
      previousByVersion.set(Number(version.versionNumber), index > 0 ? ascending[index - 1] : null);
    });

    const latestVersionNumber = versions[0]?.version_number ?? null;
    const latestReleasedVersionNumber = versions
      .filter((row) => isPublicHistoryStatus(row.releaseStatus))
      .reduce((max, row) => Math.max(max, Number(row.versionNumber || 0)), 0);

    const history = versions
      .map((version) => {
        const versionNumber = Number(version.versionNumber);
        const previous = previousByVersion.get(versionNumber) || null;
        const normalizedStatus = normalizeReleaseStatus(version.releaseStatus);
        const defaultPublic = isPublicHistoryStatus(normalizedStatus);
        const visibilityKey = `${version.dppId}:${versionNumber}`;
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
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          createdByName: creatorMap.get(version.createdBy) || null,
          is_public: isPublic,
          dppId: version.dppId,
          public_path: buildCurrentPublicPassportPath({
            companyName: companyNameMap.get(String(version.companyId)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.modelName,
            internalAliasId: version.internalAliasId,
          }),
          inactive_path: buildInactivePublicPassportPath({
            companyName: companyNameMap.get(String(version.companyId)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.modelName,
            internalAliasId: version.internalAliasId,
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
  }

  async function clearExpiredEditSessions(editSessionTimeoutSql) {
    await pool.query(
      `DELETE FROM passport_edit_sessions
       WHERE last_activity_at < NOW() - INTERVAL '${editSessionTimeoutSql}'`
    );
  }

  async function listActiveEditSessions(passportDppId, currentUserId = null, editSessionTimeoutSql) {
    await clearExpiredEditSessions(editSessionTimeoutSql);
    const params = [passportDppId];
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
       WHERE pes.passport_dpp_id = $1
         AND pes.last_activity_at >= NOW() - INTERVAL '${editSessionTimeoutSql}'
         ${currentUserFilter}
       ORDER BY pes.last_activity_at DESC`,
      params
    );
    return res.rows.map((row) => ({
      userId: row.user_id,
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
      email: row.email,
      lastActivityAt: row.last_activity_at,
    }));
  }

  async function markOlderVersionsObsolete(tableName, dppId, newVersionNumber, passportType = null) {
    try {
      const lineageRes = await pool.query(
        `SELECT "lineageId" FROM ${tableName} WHERE "dppId" = $1 LIMIT 1`, [dppId]
      );
      if (!lineageRes.rows.length) return;
      const lineageId = lineageRes.rows[0].lineageId;
      const resolvedPassportType = passportType || tableName.replace(/^passports_/, "");
      const affectedRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "lineageId" = $1
           AND "versionNumber" < $2
           AND "releaseStatus" = 'released'
           AND "deletedAt" IS NULL`,
        [lineageId, newVersionNumber]
      );
      if (affectedRes.rows.length) {
        await archivePassportSnapshots({
          passports: affectedRes.rows,
          passportType: resolvedPassportType,
          snapshotReason: "before_mark_obsolete",
        });
      }
      await pool.query(
        `UPDATE ${tableName}
         SET "releaseStatus" = 'obsolete', "updatedAt" = NOW()
         WHERE "lineageId" = $1
           AND "versionNumber" < $2
           AND "releaseStatus" = 'released'
           AND "deletedAt" IS NULL
         RETURNING *`,
        [lineageId, newVersionNumber]
      );
      const updatedRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "lineageId" = $1
           AND "versionNumber" < $2
           AND "releaseStatus" = 'obsolete'
           AND "deletedAt" IS NULL`,
        [lineageId, newVersionNumber]
      );
      if (updatedRes.rows.length) {
        await archivePassportSnapshots({
          passports: updatedRes.rows,
          passportType: resolvedPassportType,
          snapshotReason: "after_mark_obsolete",
        });
      }
    } catch (e) {
      logger.error("Mark obsolete error (non-fatal):", e.message);
    }
  }

  return {
    archivePassportSnapshot,
    archivePassportSnapshots,
    updatePassportRowById,
    buildPassportVersionHistory,
    clearExpiredEditSessions,
    listActiveEditSessions,
    markOlderVersionsObsolete,
  };
}

module.exports = {
  createArchiveHistoryHelpers,
};
