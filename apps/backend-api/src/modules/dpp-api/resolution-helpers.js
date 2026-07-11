"use strict";

function createResolutionHelpers({
  pool,
  getTable,
  normalizePassportRow,
  getCompanyNameMap,
  productIdentifierService,
  didService,
  isDppRecordId,
}) {
  function parseDppIdentifier(dppId) {
    const rawValue = String(dppId || "").trim();
    if (typeof isDppRecordId === "function" && isDppRecordId(rawValue)) {
      return {
        kind: "stable",
        granularity: "item",
        stableId: rawValue
      };
    }
    const stable = didService?.parseDid?.(rawValue);
    if (stable?.entityType === "dpp") {
      return {
        kind: "stable",
        granularity: stable.granularity || "item",
        stableId: stable.stableId
      };
    }
    return null;
  }

  function buildDppIdentifierFields(passport) {
    const digitalProductPassportId = passport?.dppId || null;
    return {
      dppId: digitalProductPassportId,
      digitalProductPassportId
    };
  }

  function setDppMergePatchHeaders(res) {
    res.setHeader("Accept-Patch", "application/merge-patch+json, application/json");
  }

  function isSupportedPatchContentType(req) {
    const contentType = String(req.headers?.["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return !contentType || contentType === "application/json" || contentType === "application/merge-patch+json";
  }

  async function resolvePassportByStableDppId(stableId, {
    versionNumber = null,
    editableOnly = false
  } = {}) {
    const typeRows = await pool.query('SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson" FROM "passportTypes" ORDER BY "typeName"');
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.typeName);
      const liveParams = [stableId];
      const statusSql = editableOnly ?
        `"releaseStatus" IN ('draft', 'inRevision')` :
        versionNumber !== null && versionNumber !== undefined ?
          `"releaseStatus" IN ('released', 'obsolete')` :
          `"releaseStatus" = 'released'`;
      let versionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND "versionNumber" = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE ("lineageId" = $1 OR "dppId"::text = $1)
           AND ${statusSql}
           AND "deletedAt" IS NULL${versionSql}
         ORDER BY "versionNumber" DESC, "updatedAt" DESC`,
        liveParams
      );
      for (const row of liveRes.rows) {
        matches.push({
          passport: { ...normalizePassportRow(row, typeRow), passportType: typeRow.typeName },
          typeDef: typeRow,
          tableName
        });
      }

      if (editableOnly) continue;

      const archiveParams = [stableId, typeRow.typeName];
      let archiveVersionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
        archiveVersionSql = ` AND "versionNumber" = $${archiveParams.length}`;
      }
      const archiveRes = await pool.query(
        `SELECT "archivedAt", "productIdentifierDid", "rowData"
         FROM "passportArchives"
         WHERE ("lineageId" = $1 OR "dppId"::text = $1)
           AND "passportType" = $2
           AND ${versionNumber !== null && versionNumber !== undefined ? `"releaseStatus" IN ('released', 'obsolete')` : `"releaseStatus" = 'released'`}${archiveVersionSql}
         ORDER BY "versionNumber" DESC, "archivedAt" DESC`,
        archiveParams
      );
      for (const row of archiveRes.rows) {
        const rowData = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData;
        matches.push({
          passport: {
            ...normalizePassportRow(rowData, typeRow),
            uniqueProductIdentifier: row.productIdentifierDid || rowData?.uniqueProductIdentifier,
            archivedAt: row.archivedAt || rowData?.archivedAt,
            passportType: typeRow.typeName,
            archived: true
          },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((left, right) => {
      const leftTime = new Date(left.passport.updatedAt || left.passport.createdAt || left.passport.archivedAt || 0).getTime();
      const rightTime = new Date(right.passport.updatedAt || right.passport.createdAt || right.passport.archivedAt || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.versionNumber || 0) - Number(left.passport.versionNumber || 0);
    });
    if (matches.length > 1 && matches[0].passport.dppId !== matches[1].passport.dppId) {
      const error = new Error(`Multiple passports match DPP identifier "${stableId}".`);
      error.code = "ambiguousDppId";
      throw error;
    }

    const selected = matches[0];
    const companyNameMap = await getCompanyNameMap([selected.passport.companyId]);
    return {
      passport: selected.passport,
      typeDef: selected.typeDef,
      tableName: selected.tableName,
      companyName: companyNameMap.get(String(selected.passport.companyId)) || ""
    };
  }

  async function resolveReleasedPassportByDppId(dppId, { versionNumber = null } = {}) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    return resolvePassportByStableDppId(parsed.stableId, { versionNumber });
  }

  async function resolveActiveReleasedPassportByDppId(dppId) {
    const result = await resolveReleasedPassportByDppId(dppId, { versionNumber: null });
    if (!result?.passport || result.passport.archived) return null;
    if (!["released", "obsolete"].includes(String(result.passport.releaseStatus || "").trim().toLowerCase())) {
      return null;
    }
    return result;
  }

  async function resolveEditablePassportByDppId(dppId) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    return resolvePassportByStableDppId(parsed.stableId, { editableOnly: true });
  }

  function usesConfiguredGlobalProductIdentifierScheme(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    if (typeof productIdentifierService?.isDidIdentifier === "function") {
      return productIdentifierService.isDidIdentifier(normalized);
    }
    return normalized.startsWith("did:");
  }

  return {
    parseDppIdentifier,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    resolveActiveReleasedPassportByDppId,
    resolveEditablePassportByDppId,
    usesConfiguredGlobalProductIdentifierScheme,
  };
}

module.exports = {
  createResolutionHelpers,
};
