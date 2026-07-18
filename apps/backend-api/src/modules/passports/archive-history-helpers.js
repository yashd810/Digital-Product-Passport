"use strict";

function createArchiveHistoryHelpers({
  pool,
  logger,
  systemPassportFields,
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
  const publicHistoryExcludedFieldKeys = new Set([
    "internalAliasId",
    "companyId",
    "createdBy",
    "updatedBy",
    "deletedAt",
  ]);

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
    snapshotReason = "stateSnapshot",
    client = pool,
  }) {
    const rowData = buildArchiveSnapshotRow(passport);
    if (!rowData || !passportType) return null;

    const dppId = rowData.dppId || null;
    const lineageId = rowData.lineageId || dppId || null;
    if (!dppId || !lineageId) return null;

    await client.query(
      `INSERT INTO "passportArchives"
         ("dppId", "lineageId", "companyId", "passportType", "versionNumber", "modelName",
          "internalAliasId", "productIdentifierDid", "releaseStatus", "rowData", "archivedBy",
          "actorIdentifier", "snapshotReason")
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
        snapshotReason || "stateSnapshot",
      ]
    );

    return rowData;
  }

  async function archivePassportSnapshots({
    passports,
    passportType,
    archivedBy = null,
    actorIdentifier = null,
    snapshotReason = "stateSnapshot",
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

  async function updatePassportRowById({ tableName, rowId, userId, data, excluded = systemPassportFields, includeUpdatedRow = false }) {
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
    allowedRestrictedFieldKeys = [],
    allowedRestrictedPassportDppIds = [],
  }) {
    const typeRes = await pool.query(
      'SELECT "displayName" AS "displayName", "fieldsJson" AS "fieldsJson" FROM "passportTypes" WHERE "typeName" = $1',
      [passportType]
    );
    const typeRow = typeRes.rows[0] || null;
    const fieldDefs = getHistoryFieldDefs(typeRow);
    const allowedRestrictedFields = new Set(
      (Array.isArray(allowedRestrictedFieldKeys) ? allowedRestrictedFieldKeys : [])
        .map((fieldKey) => String(fieldKey || "").trim())
        .filter(Boolean)
    );
    const unrestrictedPassportScope = allowedRestrictedPassportDppIds === null;
    const allowedRestrictedPassports = new Set(
      (Array.isArray(allowedRestrictedPassportDppIds) ? allowedRestrictedPassportDppIds : [])
        .map((passportDppId) => String(passportDppId || "").trim())
        .filter(Boolean)
    );
    const visibleFieldDefs = publicOnly
      ? fieldDefs.filter((field) => {
          const fieldKey = String(field?.key || "");
          const confidentiality = String(field?.confidentiality || "").trim().toLowerCase();
          return (
            !publicHistoryExcludedFieldKeys.has(fieldKey)
            && (
              confidentiality === "public"
              || (confidentiality === "restricted" && allowedRestrictedFields.has(fieldKey))
            )
          );
        })
      : fieldDefs;

    const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
    if (!lineageContext?.lineageId) {
      return {
        passportType,
        displayName: typeRow?.displayName || passportType,
        history: [],
      };
    }

    const versions = await getPassportVersionsByLineage({
      lineageId: lineageContext.lineageId,
      passportType,
      companyId,
    });

    const creatorIds = publicOnly
      ? []
      : [...new Set(versions.map((row) => row.createdBy).filter(Boolean))];
    const creatorMap = new Map();
    const companyNameMap = await getCompanyNameMap(versions.map((row) => row.companyId).filter(Boolean));
    if (creatorIds.length) {
      const userRes = await pool.query(
        'SELECT id, "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = ANY($1::int[])',
        [creatorIds]
      );
      userRes.rows.forEach((row) => {
        creatorMap.set(
          row.id,
          `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.email || `User #${row.id}`
        );
      });
    }

    const versionDppIds = versions.map((row) => row.dppId).filter(Boolean);
    const visibilityRes = versionDppIds.length
      ? await pool.query(
          `SELECT "passportDppId", "versionNumber", "isPublic"
           FROM "passportHistoryVisibility"
           WHERE "passportDppId" = ANY($1::text[])`,
          [versionDppIds]
        )
      : { rows: [] };
    const visibilityMap = new Map(
      visibilityRes.rows.map((row) => [`${row.passportDppId}:${Number(row.versionNumber)}`, !!row.isPublic])
    );

    const ascending = [...versions].sort((a, b) => Number(a.versionNumber) - Number(b.versionNumber));
    const previousByVersion = new Map();
    ascending.forEach((version, index) => {
      previousByVersion.set(Number(version.versionNumber), index > 0 ? ascending[index - 1] : null);
    });

    const latestVersionNumber = versions[0]?.versionNumber ?? null;
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
          ? visibleFieldDefs.flatMap((field) => {
              const restrictedField =
                String(field?.confidentiality || "").trim().toLowerCase() === "restricted";
              if (
                publicOnly
                && restrictedField
                && !unrestrictedPassportScope
                && (
                  !allowedRestrictedPassports.has(String(version.dppId || ""))
                  || !allowedRestrictedPassports.has(String(previous.dppId || ""))
                )
              ) {
                return [];
              }
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
          versionNumber,
          releaseStatus: normalizedStatus,
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          ...(publicOnly ? {} : { createdByName: creatorMap.get(version.createdBy) || null }),
          isPublic,
          dppId: version.dppId,
          publicPath: buildCurrentPublicPassportPath({
            companyName: companyNameMap.get(String(version.companyId)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufacturedBy,
            modelName: version.modelName,
            dppId: version.dppId,
          }),
          inactivePath: buildInactivePublicPassportPath({
            companyName: companyNameMap.get(String(version.companyId)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufacturedBy,
            modelName: version.modelName,
            dppId: version.dppId,
            versionNumber,
          }),
          changedFields,
          changeCount: changedFields.length,
          summary: previous
            ? (changedFields.length
                ? `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed from v${previous.versionNumber}.`
                : `No field changes detected from v${previous.versionNumber}.`)
            : "Initial version.",
          isCurrent: publicOnly
            ? versionNumber === Number(latestReleasedVersionNumber || latestVersionNumber)
            : versionNumber === Number(latestVersionNumber),
        };
      })
      .filter(Boolean);

    return {
      passportType,
      displayName: typeRow?.displayName || passportType,
      history,
    };
  }

  async function clearExpiredEditSessions(editSessionTimeoutSql) {
    await pool.query(
      `DELETE FROM "passportEditSessions"
       WHERE "lastActivityAt" < NOW() - INTERVAL '${editSessionTimeoutSql}'`
    );
  }

  async function listActiveEditSessions(passportDppId, currentUserId = null, editSessionTimeoutSql) {
    await clearExpiredEditSessions(editSessionTimeoutSql);
    const params = [passportDppId];
    let currentUserFilter = "";
    if (currentUserId) {
      params.push(currentUserId);
      currentUserFilter = ` AND pes."userId" <> $${params.length}`;
    }
    const res = await pool.query(
      `SELECT
         pes."userId",
         pes."lastActivityAt",
         u."firstName" AS "firstName",
         u."lastName" AS "lastName",
         u.email
       FROM "passportEditSessions" pes
       JOIN users u ON u.id = pes."userId"
       WHERE pes."passportDppId" = $1
         AND pes."lastActivityAt" >= NOW() - INTERVAL '${editSessionTimeoutSql}'
         ${currentUserFilter}
       ORDER BY pes."lastActivityAt" DESC`,
      params
    );
    return res.rows.map((row) => ({
      userId: row.userId,
      name: `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.email,
      email: row.email,
      lastActivityAt: row.lastActivityAt,
    }));
  }

  async function markOlderVersionsObsolete(
    tableName,
    dppId,
    newVersionNumber,
    passportType = null,
    {
      client = pool,
      failOnError = false,
      archivedBy = null,
      actorIdentifier = null,
    } = {}
  ) {
    try {
      const lineageRes = await client.query(
        `SELECT "lineageId" FROM ${tableName} WHERE "dppId" = $1 LIMIT 1`, [dppId]
      );
      if (!lineageRes.rows.length) return;
      const lineageId = lineageRes.rows[0].lineageId;
      const resolvedPassportType = passportType || tableName.replace(/^passports_/, "");
      const affectedRes = await client.query(
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
          archivedBy,
          actorIdentifier,
          snapshotReason: "beforeMarkObsolete",
          client,
        });
      }
      await client.query(
        `UPDATE ${tableName}
         SET "releaseStatus" = 'obsolete', "updatedAt" = NOW()
         WHERE "lineageId" = $1
           AND "versionNumber" < $2
           AND "releaseStatus" = 'released'
           AND "deletedAt" IS NULL
         RETURNING *`,
        [lineageId, newVersionNumber]
      );
      const updatedRes = await client.query(
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
          archivedBy,
          actorIdentifier,
          snapshotReason: "afterMarkObsolete",
          client,
        });
      }
    } catch (e) {
      if (failOnError) throw e;
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
