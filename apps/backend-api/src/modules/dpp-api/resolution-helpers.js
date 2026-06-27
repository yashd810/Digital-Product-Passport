"use strict";

const { collectRequestedInternalAliasIds } = require("../../shared/passports/passport-helpers");

function createResolutionHelpers({
  pool,
  getTable,
  normalizePassportRow,
  getCompanyNameMap,
  normalizeInternalAliasIdValue,
  productIdentifierService,
  didService,
  dppIdentity,
  isDppRecordId,
  loadReleasedPassport,
  dbLookupByCompanyAndProduct,
  dbLookupByInternalAliasIdOnly,
  buildPassportResponse,
  getRepresentationFromValue,
  buildPassportJsonLdContext,
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

  function buildIdentifierLineageEnvelope(passport, identifierLineage = []) {
    return {
      ...buildDppIdentifierFields(passport),
      uniqueProductIdentifier: passport?.uniqueProductIdentifier || null,
      internalAliasId: passport?.internalAliasId || null,
      granularity: passport?.granularity || "item",
      lineageId: passport?.lineageId || null,
      identifierLineage,
    };
  }

  function buildRegistrationId(registration) {
    if (!registration?.registryName || registration?.id === undefined || registration?.id === null) {
      return null;
    }
    return `${registration.registryName}:${registration.id}`;
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
    editableOnly = false,
    atDate = null
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

    const filteredMatches = atDate ?
      matches.filter(({ passport }) => {
        const candidateDate = new Date(passport.updatedAt || passport.createdAt || passport.archivedAt || 0);
        return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
      }) :
      matches;

    if (!filteredMatches.length) return null;
    filteredMatches.sort((left, right) => {
      const leftTime = new Date(left.passport.updatedAt || left.passport.createdAt || left.passport.archivedAt || 0).getTime();
      const rightTime = new Date(right.passport.updatedAt || right.passport.createdAt || right.passport.archivedAt || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.versionNumber || 0) - Number(left.passport.versionNumber || 0);
    });
    if (filteredMatches.length > 1 && filteredMatches[0].passport.dppId !== filteredMatches[1].passport.dppId) {
      const error = new Error(`Multiple passports match DPP identifier "${stableId}".`);
      error.code = "ambiguousDppId";
      throw error;
    }

    const selected = filteredMatches[0];
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

  async function resolveReleasedPassportForIdentifier(productIdentifier, companyId = null, versionNumber = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      if (companyId !== null && Number(companyId) !== Number(parsedDppId.companyId)) return null;
      return resolveReleasedPassportByDppId(productIdentifier, { versionNumber });
    }
    return companyId ?
      loadReleasedPassport(companyId, productIdentifier, { versionNumber }) :
      dbLookupByInternalAliasIdOnly(productIdentifier, { versionNumber });
  }

  async function loadReleasedPassportAtDate(identifier, atDate, { strictProductId = false } = {}) {
    const parsedDppId = parseDppIdentifier(identifier);
    if (parsedDppId?.kind === "stable") {
      if (strictProductId) return null;
      return resolvePassportByStableDppId(parsedDppId.stableId, { atDate });
    }
    const baseline = strictProductId ?
      await dbLookupByInternalAliasIdOnly(identifier) :
      await resolveReleasedPassportForIdentifier(identifier, null, null);
    if (!baseline?.passport) return null;

    const companyId = baseline.passport.companyId;
    const passportType = baseline.passport.passportType;
    const tableName = getTable(passportType);
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType,
      internalAliasId: baseline.passport.internalAliasId,
      granularity: baseline.passport.granularity || "item"
    }) || [baseline.passport.internalAliasId, baseline.passport.uniqueProductIdentifier].filter(Boolean);

    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "companyId" = $2
         AND ("internalAliasId" = ANY($1::text[]) OR "uniqueProductIdentifier" = ANY($1::text[]))
         AND "releaseStatus" IN ('released', 'obsolete')
         AND "deletedAt" IS NULL`,
      [candidates, companyId]
    );
    const archiveRes = await pool.query(
      `SELECT "productIdentifierDid", "archivedAt", "rowData"
       FROM "passportArchives"
       WHERE "companyId" = $2
         AND "passportType" = $3
         AND ("internalAliasId" = ANY($1::text[]) OR "productIdentifierDid" = ANY($1::text[]))
         AND "releaseStatus" IN ('released', 'obsolete')`,
      [candidates, companyId, passportType]
    );

    const combined = [
      ...liveRes.rows.map((row) => ({ ...normalizePassportRow(row, baseline.typeDef), passportType })),
      ...archiveRes.rows.map((row) => {
        const rowData = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData;
        return {
          ...normalizePassportRow(rowData, baseline.typeDef),
          uniqueProductIdentifier: row.productIdentifierDid || rowData?.uniqueProductIdentifier,
          archivedAt: row.archivedAt || rowData?.archivedAt,
          passportType,
          archived: true
        };
      })
    ].filter((row) => {
      const candidateDate = new Date(row.updatedAt || row.createdAt || row.archivedAt || 0);
      return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
    });

    if (!combined.length) return null;
    combined.sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || left.archivedAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || right.archivedAt || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.versionNumber || 0) - Number(left.versionNumber || 0);
    });

    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([companyId]),
      pool.query('SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson" FROM "passportTypes" WHERE "typeName" = $1', [passportType])]
    );

    return {
      passport: combined[0],
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(companyId)) || ""
    };
  }

  async function resolveEditablePassportByDppId(dppId) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    if (parsed.kind === "stable") {
      return resolvePassportByStableDppId(parsed.stableId, { editableOnly: true });
    }
    const companyId = Number.parseInt(parsed.companyId, 10);
    if (!Number.isFinite(companyId)) return null;
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType: "passport",
      internalAliasId: parsed.internalAliasId,
      granularity: parsed.granularity || "item"
    }) || [parsed.internalAliasId];
    const typeRows = await pool.query('SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson" FROM "passportTypes" ORDER BY "typeName"');

    const matches = [];
    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.typeName);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "companyId" = $2
           AND ("internalAliasId" = ANY($1::text[]) OR "uniqueProductIdentifier" = ANY($1::text[]))
           AND "releaseStatus" IN ('draft', 'inRevision')
           AND "deletedAt" IS NULL
         ORDER BY "versionNumber" DESC, "updatedAt" DESC
         LIMIT 1`,
        [candidates, companyId]
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passportType: typeRow.typeName },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    if (matches.length > 1) {
      const error = new Error(`Multiple editable passports share DPP identifier "${dppId}".`);
      error.code = "ambiguousDppId";
      throw error;
    }
    return matches[0];
  }

  async function resolveEditablePassportForIdentifier(productIdentifier, companyId = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      return resolveEditablePassportByDppId(productIdentifier);
    }

    const typeRows = await pool.query('SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson" FROM "passportTypes" ORDER BY "typeName"');
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.typeName);
      const candidates = productIdentifierService?.buildLookupCandidates?.({
        companyId,
        passportType: typeRow.typeName,
        internalAliasId: productIdentifier,
        granularity: "item"
      }) || [productIdentifier];
      const params = [candidates];
      let companySql = "";
      if (companyId !== null && companyId !== undefined) {
        params.push(companyId);
        companySql = ` AND "companyId" = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE ("internalAliasId" = ANY($1::text[]) OR "uniqueProductIdentifier" = ANY($1::text[]))${companySql}
           AND "releaseStatus" IN ('draft', 'inRevision')
           AND "deletedAt" IS NULL
         ORDER BY "versionNumber" DESC, "updatedAt" DESC
         LIMIT 1`,
        params
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passportType: typeRow.typeName },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((left, right) => {
      const leftTime = new Date(left.passport.updatedAt || left.passport.createdAt || 0).getTime();
      const rightTime = new Date(right.passport.updatedAt || right.passport.createdAt || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.versionNumber || 0) - Number(left.passport.versionNumber || 0);
    });

    if (matches.length > 1 && matches[0].passport.dppId !== matches[1].passport.dppId) {
      const error = new Error(`Multiple editable passports match identifier "${productIdentifier}".`);
      error.code = "ambiguousProductId";
      error.companyIds = [...new Set(matches.map(({ passport }) => Number(passport.companyId)).filter(Number.isFinite))];
      throw error;
    }

    return matches[0];
  }

  async function buildBatchLookupResult(productIdentifier, {
    companyId = null,
    versionNumber = null,
    representation = "compressed",
    acceptJsonLd = false
  } = {}) {
    try {
      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) {
        return { productIdentifier, found: false, error: "notFound" };
      }

      const requestShape = {
        headers: acceptJsonLd ? { accept: "application/ld+json" } : { accept: "application/json" },
        query: { representation }
      };
      const payload = await buildPassportResponse(requestShape, result.passport, result.typeDef, result.companyName);
      return {
        productIdentifier,
        found: true,
        payload: acceptJsonLd ?
          { "@context": buildPassportJsonLdContext(result.typeDef), ...payload } :
          payload
      };
    } catch (error) {
      if (error.code === "ambiguousProductId") {
        return {
          productIdentifier,
          found: false,
          error: "ambiguousProductId",
          companyIds: error.companyIds || []
        };
      }
      throw error;
    }
  }

  function encodeBatchCursor(offset) {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
  }

  function decodeBatchCursor(cursor) {
    if (!cursor) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
      const offset = Number.parseInt(parsed?.offset, 10);
      return Number.isFinite(offset) && offset >= 0 ? offset : null;
    } catch {
      return null;
    }
  }

  function normalizeRequestedProductIds(body = {}) {
    return collectRequestedInternalAliasIds(body);
  }

  function parseBatchLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === "") return 100;
    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) return null;
    return parsedLimit;
  }

  function usesConfiguredGlobalProductIdentifierScheme(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    if (typeof productIdentifierService?.isDidIdentifier === "function") {
      return productIdentifierService.isDidIdentifier(normalized);
    }
    return normalized.startsWith("did:");
  }

  function buildPassportServiceEndpoints(subjectDid, passport, typeDef, companyName) {
    const appUrl = getAppUrl();
    const encodedDppId = encodeURIComponent(String(passport.dppId || ""));
    const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);

    return [
      {
        id: `${subjectDid}#passport-page`,
        type: "LinkedDomains",
        serviceEndpoint: publicUrl
      },
      {
        id: `${subjectDid}#passport-json`,
        type: "DPPOperationalAPI",
        serviceEndpoint: `${appUrl}/api/public/passports/${encodedDppId}`,
        accept: ["application/json"]
      },
      {
        id: `${subjectDid}#passport-jsonld`,
        type: "DPPLinkedData",
        serviceEndpoint: `${appUrl}/api/public/passports/${encodedDppId}?format=semantic`,
        accept: ["application/ld+json"]
      },
      {
        id: `${subjectDid}#passport-credential`,
        type: "VerifiableCredential",
        serviceEndpoint: `${appUrl}/api/public/passports/${passport.dppId}/signature`
      }
    ];
  }

  return {
    parseDppIdentifier,
    buildDppIdentifierFields,
    buildIdentifierLineageEnvelope,
    buildRegistrationId,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    resolvePassportByStableDppId,
    resolveReleasedPassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    loadReleasedPassportAtDate,
    resolveEditablePassportByDppId,
    resolveEditablePassportForIdentifier,
    buildBatchLookupResult,
    encodeBatchCursor,
    decodeBatchCursor,
    normalizeRequestedProductIds,
    parseBatchLimit,
    usesConfiguredGlobalProductIdentifierScheme,
    buildPassportServiceEndpoints,
  };
}

module.exports = {
  createResolutionHelpers,
};
