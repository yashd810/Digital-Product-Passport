"use strict";

const { isPublicVersionVisible } = require("../public-passports/visibility");

function createPassportQueryRepository({
  pool,
  getTable,
  normalizePassportRow,
  isPublicHistoryStatus,
}) {
  async function findExistingPassportByInternalAliasId({
    tableName,
    companyId,
    internalAliasId,
    excludeDppId = null,
    excludeGuid = null,
    excludeLineageId = null,
  }) {
    if (!internalAliasId) return null;
    const params = [companyId, internalAliasId];
    let exclusionSql = "";
    const resolvedExcludeDppId = excludeDppId || excludeGuid || null;
    if (resolvedExcludeDppId) {
      params.push(resolvedExcludeDppId);
      exclusionSql += ` AND "dppId" <> $${params.length}`;
    }
    if (excludeLineageId) {
      params.push(excludeLineageId);
      exclusionSql += ` AND "lineageId" <> $${params.length}`;
    }
    const existing = await pool.query(
      `SELECT id, "dppId", "lineageId", "internalAliasId", "releaseStatus", "versionNumber"
       FROM ${tableName}
       WHERE "companyId" = $1
         AND "internalAliasId" = $2
         AND "deletedAt" IS NULL${exclusionSql}
       ORDER BY "versionNumber" DESC, "updatedAt" DESC, id DESC
       LIMIT 1`,
      params
    );
    return existing.rows[0] || null;
  }

  async function getPassportLineageContext({ dppId = null, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [dppId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND "companyId" = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT "dppId", "lineageId", "internalAliasId"
       FROM ${tableName}
       WHERE "dppId" = $1${liveCompanyFilter}
       ORDER BY "versionNumber" DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) return liveRes.rows[0];

    const archiveParams = [dppId, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND "companyId" = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT "dppId", "lineageId", "internalAliasId"
       FROM "passportArchives"
       WHERE "dppId" = $1
         AND "passportType" = $2${archiveCompanyFilter}
       ORDER BY "versionNumber" DESC, "archivedAt" DESC
       LIMIT 1`,
      archiveParams
    );
    return archiveRes.rows[0] || null;
  }

  async function getCompanyNameMap(companyIds) {
    const uniqueCompanyIds = [...new Set((companyIds || []).filter(Boolean).map((value) => String(value)))];
    if (!uniqueCompanyIds.length) return new Map();
    const result = await pool.query(
      "SELECT id, \"companyName\" FROM companies WHERE id = ANY($1::int[])",
      [uniqueCompanyIds.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite)]
    );
    return new Map(result.rows.map((row) => [String(row.id), row.companyName || ""]));
  }

  async function getPassportVersionsByLineage({ lineageId, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [lineageId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND "companyId" = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "lineageId" = $1
         AND "deletedAt" IS NULL${liveCompanyFilter}
       ORDER BY "versionNumber" DESC, "updatedAt" DESC`,
      liveParams
    );

    const archiveParams = [lineageId, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND "companyId" = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT "dppId", "lineageId", "companyId", "passportType", "versionNumber", "modelName", "internalAliasId", "productIdentifierDid", "releaseStatus", "archivedAt", "rowData"
       FROM "passportArchives"
       WHERE "lineageId" = $1
         AND "passportType" = $2${archiveCompanyFilter}
       ORDER BY "versionNumber" DESC, "archivedAt" DESC`,
      archiveParams
    );

    const liveVersions = liveRes.rows.map(normalizePassportRow);
    const seenDppIds = new Set(liveVersions.map((row) => row.dppId));
    const archiveVersions = archiveRes.rows
      .map((row) => {
        const rowData = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData;
        return {
          ...rowData,
          dppId: row.dppId || rowData?.dppId,
          lineageId: row.lineageId || rowData?.lineageId,
          companyId: row.companyId || rowData?.companyId,
          passportType: row.passportType || rowData?.passportType,
          versionNumber: row.versionNumber ?? rowData?.versionNumber,
          modelName: row.modelName || rowData?.modelName,
          internalAliasId: row.internalAliasId || rowData?.internalAliasId,
          uniqueProductIdentifier: row.productIdentifierDid || rowData?.uniqueProductIdentifier,
          releaseStatus: row.releaseStatus || rowData?.releaseStatus,
          archived: true,
          archivedAt: row.archivedAt,
        };
      })
      .map(normalizePassportRow)
      .filter((row) => row?.dppId && !seenDppIds.has(row.dppId));

    return [...liveVersions, ...archiveVersions]
      .sort((a, b) => Number(b.versionNumber || 0) - Number(a.versionNumber || 0));
  }

  async function fetchCompanyPassportRecord({ companyId, dppId = null, passportType = null, versionNumber = null }) {
    let resolvedPassportType = passportType || null;
    const hasExplicitVersion = versionNumber !== null &&
      versionNumber !== undefined &&
      String(versionNumber).trim() !== "" &&
      Number.isFinite(Number(versionNumber));
    const parsedVersionNumber = hasExplicitVersion ? Number(versionNumber) : null;

    if (!resolvedPassportType) {
      const regRes = await pool.query(
        `SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 AND "companyId" = $2`,
        [dppId, companyId]
      );
      if (regRes.rows.length) resolvedPassportType = regRes.rows[0].passportType;
    }

    if (!resolvedPassportType) {
      const archiveTypeRes = await pool.query(
        `SELECT "passportType"
         FROM "passportArchives"
         WHERE "dppId" = $1 AND "companyId" = $2
         ORDER BY "versionNumber" DESC, "archivedAt" DESC
         LIMIT 1`,
        [dppId, companyId]
      );
      if (archiveTypeRes.rows.length) resolvedPassportType = archiveTypeRes.rows[0].passportType;
    }

    if (!resolvedPassportType) return null;

    const tableName = getTable(resolvedPassportType);
    const liveParams = [dppId, companyId];
    let liveVersionSql = "";
    if (parsedVersionNumber !== null) {
      liveParams.push(parsedVersionNumber);
      liveVersionSql = ` AND p."versionNumber" = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT p.*,
              u.email AS "createdByEmail",
              u."firstName" AS "firstName",
              u."lastName" AS "lastName",
              NULLIF(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), '') AS "createdByName"
       FROM ${tableName} p
       LEFT JOIN users u ON u.id = p."createdBy"
       WHERE p."dppId" = $1 AND p."companyId" = $2 AND p."deletedAt" IS NULL${liveVersionSql}
       ORDER BY p."versionNumber" DESC, p."updatedAt" DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passportType: resolvedPassportType },
        archived: false,
      };
    }

    const archiveParams = [dppId, companyId, resolvedPassportType];
    let archiveVersionSql = "";
    if (parsedVersionNumber !== null) {
      archiveParams.push(parsedVersionNumber);
      archiveVersionSql = ` AND pa."versionNumber" = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT pa."rowData"
       FROM "passportArchives" pa
       WHERE pa."dppId" = $1 AND pa."companyId" = $2 AND pa."passportType" = $3${archiveVersionSql}
       ORDER BY pa."versionNumber" DESC, pa."archivedAt" DESC
       LIMIT 1`,
      archiveParams
    );
    if (!archiveRes.rows.length) return null;

    const rowData = typeof archiveRes.rows[0].rowData === "string"
      ? JSON.parse(archiveRes.rows[0].rowData)
      : archiveRes.rows[0].rowData;

    return {
      passport: { ...normalizePassportRow(rowData), passportType: resolvedPassportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByDppId(dppId) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      `SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1`,
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passportType;
    const tableName = getTable(passportType);

    const liveRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE "dppId" = $1
         AND "releaseStatus" = 'released'
         AND "deletedAt" IS NULL
       ORDER BY "versionNumber" DESC
       LIMIT 1`,
      [normalizedDppId]
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passportType },
        archived: false,
      };
    }

    const archiveRes = await pool.query(
      `SELECT pa."rowData",
              pa."versionNumber",
              phv."isPublic" AS "isPublic"
       FROM "passportArchives" pa
       LEFT JOIN "passportHistoryVisibility" phv
         ON phv."passportDppId" = pa."dppId"
        AND phv."versionNumber" = pa."versionNumber"
       WHERE pa."dppId" = $1
         AND pa."passportType" = $2
         AND pa."releaseStatus" IN ('released', 'obsolete')
       ORDER BY pa."versionNumber" DESC, pa."archivedAt" DESC
       LIMIT 1`,
      [normalizedDppId, passportType]
    );
    if (!archiveRes.rows.length) return { passport: null, archived: false };

    const rowData = typeof archiveRes.rows[0].rowData === "string"
      ? JSON.parse(archiveRes.rows[0].rowData)
      : archiveRes.rows[0].rowData;
    if (!isPublicVersionVisible(rowData?.releaseStatus, archiveRes.rows[0].isPublic, isPublicHistoryStatus)) {
      return { passport: null, archived: false };
    }
    return {
      passport: { ...normalizePassportRow(rowData), passportType, archived: true },
      archived: true,
    };
  }

  async function resolvePublicPassportByDppId(dppId, { versionNumber = null } = {}) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      `SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1`,
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passportType;
    const tableName = getTable(passportType);

    if (versionNumber !== null && versionNumber !== undefined) {
      const lineageContext = await getPassportLineageContext({ dppId: normalizedDppId, passportType });
      if (!lineageContext?.lineageId) return { passport: null, archived: false };

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "lineageId" = $1
           AND "versionNumber" = $2
           AND "releaseStatus" IN ('released', 'obsolete')
           AND "deletedAt" IS NULL
         ORDER BY "updatedAt" DESC
         LIMIT 1`,
        [lineageContext.lineageId, versionNumber]
      );
      if (liveRes.rows.length) {
        const passport = { ...normalizePassportRow(liveRes.rows[0]), passportType };
        const visibilityRes = await pool.query(
          `SELECT "isPublic"
           FROM "passportHistoryVisibility"
           WHERE "passportDppId" = $1 AND "versionNumber" = $2
           LIMIT 1`,
          [passport.dppId, versionNumber]
        );
        const isVisible = visibilityRes.rows.length
          ? !!visibilityRes.rows[0].isPublic
          : isPublicHistoryStatus(passport.releaseStatus);
        return isVisible ? { passport, archived: false } : { passport: null, archived: false };
      }

      const archiveRes = await pool.query(
        `SELECT pa."rowData",
                phv."isPublic" AS "isPublic"
         FROM "passportArchives" pa
         LEFT JOIN "passportHistoryVisibility" phv
           ON phv."passportDppId" = pa."dppId"
          AND phv."versionNumber" = pa."versionNumber"
         WHERE pa."lineageId" = $1
           AND pa."passportType" = $2
           AND pa."versionNumber" = $3
         ORDER BY pa."archivedAt" DESC
         LIMIT 1`,
        [lineageContext.lineageId, passportType, versionNumber]
      );
      if (!archiveRes.rows.length) return { passport: null, archived: false };

      const rowData = typeof archiveRes.rows[0].rowData === "string"
        ? JSON.parse(archiveRes.rows[0].rowData)
        : archiveRes.rows[0].rowData;
      if (!isPublicVersionVisible(rowData?.releaseStatus, archiveRes.rows[0].isPublic, isPublicHistoryStatus)) {
        return { passport: null, archived: false };
      }
      const passport = { ...normalizePassportRow(rowData), passportType, archived: true };
      const visibilityRes = await pool.query(
        `SELECT "isPublic"
         FROM "passportHistoryVisibility"
         WHERE "passportDppId" = $1 AND "versionNumber" = $2
         LIMIT 1`,
        [passport.dppId, versionNumber]
      );
      const isVisible = visibilityRes.rows.length
        ? !!visibilityRes.rows[0].isPublic
        : isPublicHistoryStatus(passport.releaseStatus);
      return isVisible ? { passport, archived: true } : { passport: null, archived: false };
    }

    return resolveReleasedPassportByDppId(normalizedDppId);
  }

  async function resolveCompanyPreviewPassport({ companyId, passportKey }) {
    return fetchCompanyPassportRecord({ companyId, dppId: passportKey });
  }

  return {
    findExistingPassportByInternalAliasId,
    getPassportLineageContext,
    getCompanyNameMap,
    getPassportVersionsByLineage,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassport,
  };
}

module.exports = {
  createPassportQueryRepository,
};
