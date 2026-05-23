"use strict";

const { isPublicVersionVisible } = require("../public-passports/visibility");

function createPassportQueryRepository({
  pool,
  logger,
  getTable,
  normalizePassportRow,
  normalizeInternalAliasIdValue,
  productIdentifierService,
  isPublicHistoryStatus,
}) {
  function isMissingRelationError(error) {
    return error?.code === "42P01";
  }

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
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, internal_alias_id
       FROM passport_archives
       WHERE dpp_id = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC, archived_at DESC
       LIMIT 1`,
      archiveParams
    );
    return archiveRes.rows[0] || null;
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
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, company_id, passport_type, version_number, model_name, internal_alias_id, product_identifier_did, release_status, archived_at, row_data
       FROM passport_archives
       WHERE lineage_id = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC, archived_at DESC`,
      archiveParams
    );

    const liveVersions = liveRes.rows.map(normalizePassportRow);
    const seenDppIds = new Set(liveVersions.map((row) => row.dppId));
    const archiveVersions = archiveRes.rows
      .map((row) => {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        return {
          ...rowData,
          dppId: row.dppId || rowData?.dppId || rowData?.dpp_id,
          lineageId: row.lineage_id || rowData?.lineageId || rowData?.lineage_id,
          companyId: row.company_id || rowData?.companyId || rowData?.company_id,
          passportType: row.passport_type || rowData?.passportType || rowData?.passport_type,
          versionNumber: row.version_number ?? rowData?.versionNumber ?? rowData?.version_number,
          modelName: row.model_name || rowData?.modelName || rowData?.model_name,
          internalAliasId: row.internal_alias_id || rowData?.internalAliasId || rowData?.internal_alias_id,
          uniqueProductIdentifier: row.product_identifier_did || rowData?.uniqueProductIdentifier || rowData?.product_identifier_did,
          releaseStatus: row.release_status || rowData?.releaseStatus || rowData?.release_status,
          archived: true,
          archivedAt: row.archived_at,
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
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2",
        [dppId, companyId]
      );
      if (regRes.rows.length) resolvedPassportType = regRes.rows[0].passport_type;
    }

    if (!resolvedPassportType) {
      const archiveTypeRes = await pool.query(
        `SELECT passport_type
         FROM passport_archives
         WHERE dpp_id = $1 AND company_id = $2
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [dppId, companyId]
      );
      if (archiveTypeRes.rows.length) resolvedPassportType = archiveTypeRes.rows[0].passport_type;
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
      `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
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
      archiveVersionSql = ` AND pa.version_number = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT pa.row_data
       FROM passport_archives pa
       WHERE pa.dpp_id = $1 AND pa.company_id = $2 AND pa.passport_type = $3${archiveVersionSql}
       ORDER BY pa.version_number DESC, pa.archived_at DESC
       LIMIT 1`,
      archiveParams
    );
    if (!archiveRes.rows.length) return null;

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;

    return {
      passport: { ...normalizePassportRow(rowData), passportType: resolvedPassportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByDppId(dppId) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
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
      `SELECT pa.row_data,
              pa.version_number,
              phv.is_public
       FROM passport_archives pa
       LEFT JOIN passport_history_visibility phv
         ON phv.passport_dpp_id = pa.dpp_id
        AND phv.version_number = pa.version_number
       WHERE pa.dpp_id = $1
         AND pa.passport_type = $2
       ORDER BY pa.version_number DESC, pa.archived_at DESC
       LIMIT 1`,
      [normalizedDppId, passportType]
    );
    if (!archiveRes.rows.length) return { passport: null, archived: false };

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;
    if (!isPublicVersionVisible(rowData?.releaseStatus || rowData?.release_status, archiveRes.rows[0].is_public, isPublicHistoryStatus)) {
      return { passport: null, archived: false };
    }
    return {
      passport: { ...normalizePassportRow(rowData), passportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByInternalAliasId(internalAliasId, {
    versionNumber = null,
    companyId = null,
    passportType = "battery",
    granularity = "item",
    strictProductId = false,
  } = {}) {
    const normalizedProductId = normalizeInternalAliasIdValue(internalAliasId);
    if (!normalizedProductId) return { passport: null, archived: false };
    const isDidIdentifier = productIdentifierService?.isDidIdentifier?.(normalizedProductId);
    const candidates = strictProductId
      ? [normalizedProductId]
      : isDidIdentifier
        ? [normalizedProductId]
        : productIdentifierService?.buildLookupCandidates?.({
            companyId,
            passportType,
            internalAliasId: normalizedProductId,
            granularity,
          }) || [normalizedProductId];
    const liveMatchSql = strictProductId
      ? `"internalAliasId" = ANY($1::text[])`
      : `("internalAliasId" = ANY($1::text[]) OR "uniqueProductIdentifier" = ANY($1::text[]))`;
    const archiveMatchSql = strictProductId
      ? "pa.internal_alias_id = ANY($1::text[])"
      : "(pa.internal_alias_id = ANY($1::text[]) OR pa.product_identifier_did = ANY($1::text[]))";

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      const liveParams = [candidates];
      let versionSql = "";
      let companySql = "";
      if (companyId !== null && companyId !== undefined) {
        liveParams.push(companyId);
        companySql = ` AND company_id = $${liveParams.length}`;
      }
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      let liveRes;
      try {
        liveRes = await pool.query(
          `SELECT *
           FROM ${tableName}
           WHERE ${liveMatchSql}
             AND ${
               versionNumber !== null && versionNumber !== undefined
                 ? `"releaseStatus" IN ('released', 'obsolete')`
                 : `"releaseStatus" = 'released'`
             }${companySql}
             AND "deletedAt" IS NULL${versionSql}
           ORDER BY "versionNumber" DESC, "updatedAt" DESC
           LIMIT 1`,
          liveParams
        );
      } catch (error) {
        if (isMissingRelationError(error)) {
          logger.warn({ tableName, passportType: type_name }, "Skipping passport type lookup because storage table does not exist yet");
          continue;
        }
        throw error;
      }
      if (liveRes.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passportType: type_name },
          archived: false,
        });
        continue;
      }

      const archiveParams = [candidates, type_name];
      let archiveCompanySql = "";
      let archiveVersionSql = "";
      if (companyId !== null && companyId !== undefined) {
        archiveParams.push(companyId);
        archiveCompanySql = ` AND pa.company_id = $${archiveParams.length}`;
      }
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
        archiveVersionSql = ` AND pa.version_number = $${archiveParams.length}`;
      }
      const archiveRes = await pool.query(
        `SELECT pa.product_identifier_did,
                pa.version_number,
                pa.row_data,
                phv.is_public
         FROM passport_archives pa
         LEFT JOIN passport_history_visibility phv
           ON phv.passport_dpp_id = pa.dpp_id
          AND phv.version_number = pa.version_number
         WHERE ${archiveMatchSql}
           AND pa.passport_type = $2${archiveCompanySql}
           ${archiveVersionSql}
         ORDER BY pa.version_number DESC, pa.archived_at DESC
         LIMIT 1`,
        archiveParams
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        if (!isPublicVersionVisible(rowData?.releaseStatus || rowData?.release_status, archiveRes.rows[0].is_public, isPublicHistoryStatus)) {
          continue;
        }
        matches.push({
          passport: {
            ...normalizePassportRow(rowData),
            uniqueProductIdentifier: archiveRes.rows[0].product_identifier_did || rowData?.uniqueProductIdentifier || rowData?.product_identifier_did,
            passportType: type_name,
            archived: true,
          },
          archived: true,
        });
      }
    }

    if (!matches.length) return { passport: null, archived: false };
    if (matches.length > 1) {
      const error = new Error(`Multiple released passports share product identifier "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return matches[0];
  }

  async function resolvePublicPassportByDppId(dppId, { versionNumber = null } = {}) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);

    if (versionNumber !== null && versionNumber !== undefined) {
      const lineageContext = await getPassportLineageContext({ dppId: normalizedDppId, passportType });
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
           WHERE passport_dpp_id = $1 AND version_number = $2
           LIMIT 1`,
          [passport.dppId, versionNumber]
        );
        const isVisible = visibilityRes.rows.length
          ? !!visibilityRes.rows[0].is_public
          : isPublicHistoryStatus(passport.release_status);
        return isVisible ? { passport, archived: false } : { passport: null, archived: false };
      }

      const archiveRes = await pool.query(
        `SELECT pa.row_data,
                phv.is_public
         FROM passport_archives pa
         LEFT JOIN passport_history_visibility phv
           ON phv.passport_dpp_id = pa.dpp_id
          AND phv.version_number = pa.version_number
         WHERE pa.lineage_id = $1
           AND pa.passport_type = $2
           AND pa.version_number = $3
         ORDER BY pa.archived_at DESC
         LIMIT 1`,
        [lineageContext.lineage_id, passportType, versionNumber]
      );
      if (!archiveRes.rows.length) return { passport: null, archived: false };

      const rowData = typeof archiveRes.rows[0].row_data === "string"
        ? JSON.parse(archiveRes.rows[0].row_data)
        : archiveRes.rows[0].row_data;
      if (!isPublicVersionVisible(rowData?.release_status, archiveRes.rows[0].is_public, isPublicHistoryStatus)) {
        return { passport: null, archived: false };
      }
      const passport = { ...normalizePassportRow(rowData), passport_type: passportType, archived: true };
      const visibilityRes = await pool.query(
        `SELECT is_public
         FROM passport_history_visibility
         WHERE passport_dpp_id = $1 AND version_number = $2
         LIMIT 1`,
        [passport.dppId, versionNumber]
      );
      const isVisible = visibilityRes.rows.length
        ? !!visibilityRes.rows[0].is_public
        : isPublicHistoryStatus(passport.release_status);
      return isVisible ? { passport, archived: true } : { passport: null, archived: false };
    }

    return resolveReleasedPassportByDppId(normalizedDppId);
  }

  async function resolveCompanyPreviewPassportByInternalAliasId(companyId, internalAliasId) {
    const normalizedProductId = normalizeInternalAliasIdValue(internalAliasId);
    if (!companyId || !normalizedProductId) return { passport: null, archived: false };
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      internalAliasId: normalizedProductId,
    }) || [normalizedProductId];

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const liveMatches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      let liveRes;
      try {
        liveRes = await pool.query(
          `SELECT *
           FROM ${tableName}
           WHERE "companyId" = $1
             AND ("internalAliasId" = ANY($2::text[]) OR "uniqueProductIdentifier" = ANY($2::text[]))
             AND "deletedAt" IS NULL
           ORDER BY "versionNumber" DESC, "updatedAt" DESC, id DESC
           LIMIT 1`,
          [companyId, candidates]
        );
      } catch (error) {
        if (isMissingRelationError(error)) {
          logger.warn({ tableName, passportType: type_name }, "Skipping preview lookup because storage table does not exist yet");
          continue;
        }
        throw error;
      }
      if (liveRes.rows.length) {
        liveMatches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passportType: type_name },
          archived: false,
        });
      }
    }

    if (liveMatches.length > 1) {
      const error = new Error(`Multiple passports in company "${companyId}" share product identifier "${normalizedProductId}".`);
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
           AND (internal_alias_id = ANY($3::text[]) OR product_identifier_did = ANY($3::text[]))
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [companyId, type_name, candidates]
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        archiveMatches.push({
          passport: { ...normalizePassportRow(rowData), passportType: type_name, archived: true },
          archived: true,
        });
      }
    }

    if (archiveMatches.length > 1) {
      const error = new Error(`Multiple archived passports in company "${companyId}" share product identifier "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return archiveMatches[0] || { passport: null, archived: false };
  }

  async function resolveCompanyPreviewPassport({ companyId, passportKey }) {
    const normalizedPassportKey = normalizeInternalAliasIdValue(passportKey);
    if (normalizedPassportKey) {
      const productMatch = await resolveCompanyPreviewPassportByInternalAliasId(companyId, normalizedPassportKey);
      if (productMatch?.passport) return productMatch;
    }
    return fetchCompanyPassportRecord({ companyId, dppId: passportKey });
  }

  return {
    findExistingPassportByInternalAliasId,
    getPassportLineageContext,
    getCompanyNameMap,
    getPassportVersionsByLineage,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolveReleasedPassportByInternalAliasId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassportByInternalAliasId,
    resolveCompanyPreviewPassport,
  };
}

module.exports = {
  createPassportQueryRepository,
};
