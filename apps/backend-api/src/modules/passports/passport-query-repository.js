"use strict";

const { isPublicVersionVisible } = require("../public-passports/visibility");

function createPassportQueryRepository({
  pool,
  logger,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  productIdentifierService,
  isPublicHistoryStatus,
}) {
  function isMissingRelationError(error) {
    return error?.code === "42P01";
  }

  async function findExistingPassportByProductId({
    tableName,
    companyId,
    productId,
    excludeDppId = null,
    excludeGuid = null,
    excludeLineageId = null,
  }) {
    if (!productId) return null;
    const params = [companyId, productId];
    let exclusionSql = "";
    const resolvedExcludeDppId = excludeDppId || excludeGuid || null;
    if (resolvedExcludeDppId) {
      params.push(resolvedExcludeDppId);
      exclusionSql += ` AND dpp_id <> $${params.length}`;
    }
    if (excludeLineageId) {
      params.push(excludeLineageId);
      exclusionSql += ` AND lineage_id <> $${params.length}`;
    }
    const existing = await pool.query(
      `SELECT id, dpp_id AS "dppId", lineage_id, product_id, release_status, version_number
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

  async function getPassportLineageContext({ dppId = null, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [dppId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND company_id = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, product_id
       FROM ${tableName}
       WHERE dpp_id = $1${liveCompanyFilter}
       ORDER BY version_number DESC
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
      `SELECT dpp_id AS "dppId", lineage_id, product_id
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
      `SELECT dpp_id AS "dppId", lineage_id, company_id, passport_type, version_number, model_name, product_id, product_identifier_did, release_status, archived_at, row_data
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
          dpp_id: row.dppId || rowData?.dpp_id || rowData?.dppId,
          lineage_id: row.lineage_id || rowData?.lineage_id,
          company_id: row.company_id || rowData?.company_id,
          passport_type: row.passport_type || rowData?.passport_type,
          version_number: row.version_number ?? rowData?.version_number,
          model_name: row.model_name || rowData?.model_name,
          product_id: row.product_id || rowData?.product_id,
          product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
          release_status: row.release_status || rowData?.release_status,
          archived: true,
          archived_at: row.archived_at,
        };
      })
      .map(normalizePassportRow)
      .filter((row) => row?.dppId && !seenDppIds.has(row.dppId));

    return [...liveVersions, ...archiveVersions]
      .sort((a, b) => Number(b.version_number || 0) - Number(a.version_number || 0));
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
      liveVersionSql = ` AND p.version_number = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
       FROM ${tableName} p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.dpp_id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL${liveVersionSql}
       ORDER BY p.version_number DESC, p.updated_at DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: resolvedPassportType },
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
      passport: { ...normalizePassportRow(rowData), passport_type: resolvedPassportType, archived: true },
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
       WHERE dpp_id = $1
         AND release_status = 'released'
         AND deleted_at IS NULL
       ORDER BY version_number DESC
       LIMIT 1`,
      [normalizedDppId]
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType },
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
    if (!isPublicVersionVisible(rowData?.release_status, archiveRes.rows[0].is_public, isPublicHistoryStatus)) {
      return { passport: null, archived: false };
    }
    return {
      passport: { ...normalizePassportRow(rowData), passport_type: passportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByProductId(productId, {
    versionNumber = null,
    companyId = null,
    passportType = "battery",
    granularity = "item",
    strictProductId = false,
  } = {}) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!normalizedProductId) return { passport: null, archived: false };
    const isDidIdentifier = productIdentifierService?.isDidIdentifier?.(normalizedProductId);
    const candidates = strictProductId
      ? [normalizedProductId]
      : isDidIdentifier
        ? [normalizedProductId]
        : productIdentifierService?.buildLookupCandidates?.({
            companyId,
            passportType,
            productId: normalizedProductId,
            granularity,
          }) || [normalizedProductId];
    const matchSql = strictProductId
      ? "product_id = ANY($1::text[])"
      : "(product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))";

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
           WHERE ${matchSql}
             AND ${
               versionNumber !== null && versionNumber !== undefined
                 ? "release_status IN ('released', 'obsolete')"
                 : "release_status = 'released'"
             }${companySql}
             AND deleted_at IS NULL${versionSql}
           ORDER BY version_number DESC, updated_at DESC
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
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
          archived: false,
        });
        continue;
      }

      const archiveParams = [candidates, type_name];
      let archiveCompanySql = "";
      if (companyId !== null && companyId !== undefined) {
        archiveParams.push(companyId);
        archiveCompanySql = ` AND company_id = $${archiveParams.length}`;
      }
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
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
         WHERE ${matchSql.replaceAll("product_identifier_did", "pa.product_identifier_did").replaceAll("product_id", "pa.product_id")}
           AND pa.passport_type = $2${archiveCompanySql}
           ${versionNumber !== null && versionNumber !== undefined ? ` AND pa.version_number = $${archiveParams.length}` : ""}
         ORDER BY pa.version_number DESC, pa.archived_at DESC
         LIMIT 1`,
        archiveParams
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        if (!isPublicVersionVisible(rowData?.release_status, archiveRes.rows[0].is_public, isPublicHistoryStatus)) {
          continue;
        }
        matches.push({
          passport: {
            ...normalizePassportRow(rowData),
            product_identifier_did: archiveRes.rows[0].product_identifier_did || rowData?.product_identifier_did,
            passport_type: type_name,
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

  async function resolveCompanyPreviewPassportByProductId(companyId, productId) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!companyId || !normalizedProductId) return { passport: null, archived: false };
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      productId: normalizedProductId,
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
           WHERE company_id = $1
             AND (product_id = ANY($2::text[]) OR product_identifier_did = ANY($2::text[]))
             AND deleted_at IS NULL
           ORDER BY version_number DESC, updated_at DESC, id DESC
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
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
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
           AND (product_id = ANY($3::text[]) OR product_identifier_did = ANY($3::text[]))
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [companyId, type_name, candidates]
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
      const error = new Error(`Multiple archived passports in company "${companyId}" share product identifier "${normalizedProductId}".`);
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
    return fetchCompanyPassportRecord({ companyId, dppId: passportKey });
  }

  return {
    findExistingPassportByProductId,
    getPassportLineageContext,
    getCompanyNameMap,
    getPassportVersionsByLineage,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolveReleasedPassportByProductId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassportByProductId,
    resolveCompanyPreviewPassport,
  };
}

module.exports = {
  createPassportQueryRepository,
};
