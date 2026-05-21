"use strict";

function createResolutionHelpers({
  pool,
  getTable,
  normalizePassportRow,
  getCompanyNameMap,
  normalizeProductIdValue,
  productIdentifierService,
  didService,
  dppIdentity,
  isDppRecordId,
  loadReleasedPassport,
  dbLookupByCompanyAndProduct,
  dbLookupByProductIdOnly,
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
    const digitalProductPassportId = passport?.dppId || passport?.dpp_id || null;
    return {
      dppId: digitalProductPassportId,
      digitalProductPassportId
    };
  }

  function buildIdentifierLineageEnvelope(passport, identifierLineage = []) {
    return {
      ...buildDppIdentifierFields(passport),
      uniqueProductIdentifier: passport?.product_identifier_did || null,
      localProductId: passport?.product_id || null,
      granularity: passport?.granularity || "item",
      lineageId: passport?.lineage_id || passport?.lineageId || null,
      identifierLineage,
    };
  }

  function buildRegistrationId(registration) {
    if (!registration?.registry_name || registration?.id === undefined || registration?.id === null) {
      return null;
    }
    return `${registration.registry_name}:${registration.id}`;
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
    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const liveParams = [stableId];
      const statusSql = editableOnly ?
        "release_status IN ('draft', 'in_revision')" :
        versionNumber !== null && versionNumber !== undefined ?
          "release_status IN ('released', 'obsolete')" :
          "release_status = 'released'";
      let versionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE (lineage_id = $1 OR dpp_id::text = $1)
           AND ${statusSql}
           AND deleted_at IS NULL${versionSql}
         ORDER BY version_number DESC, updated_at DESC`,
        liveParams
      );
      for (const row of liveRes.rows) {
        matches.push({
          passport: { ...normalizePassportRow(row), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }

      if (editableOnly) continue;

      const archiveParams = [stableId, typeRow.type_name];
      let archiveVersionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
        archiveVersionSql = ` AND version_number = $${archiveParams.length}`;
      }
      const archiveRes = await pool.query(
        `SELECT archived_at, product_identifier_did, row_data
         FROM passport_archives
         WHERE (lineage_id = $1 OR dpp_id::text = $1)
           AND passport_type = $2
           AND ${versionNumber !== null && versionNumber !== undefined ? "release_status IN ('released', 'obsolete')" : "release_status = 'released'"}${archiveVersionSql}
         ORDER BY version_number DESC, archived_at DESC`,
        archiveParams
      );
      for (const row of archiveRes.rows) {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        matches.push({
          passport: {
            ...normalizePassportRow(rowData),
            product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
            archived_at: row.archived_at || rowData?.archived_at,
            passport_type: typeRow.type_name,
            archived: true
          },
          typeDef: typeRow,
          tableName
        });
      }
    }

    const filteredMatches = atDate ?
      matches.filter(({ passport }) => {
        const candidateDate = new Date(passport.updated_at || passport.created_at || passport.archived_at || 0);
        return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
      }) :
      matches;

    if (!filteredMatches.length) return null;
    filteredMatches.sort((left, right) => {
      const leftTime = new Date(left.passport.updated_at || left.passport.created_at || left.passport.archived_at || 0).getTime();
      const rightTime = new Date(right.passport.updated_at || right.passport.created_at || right.passport.archived_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.version_number || 0) - Number(left.passport.version_number || 0);
    });
    if (filteredMatches.length > 1 && filteredMatches[0].passport.dppId !== filteredMatches[1].passport.dppId) {
      const error = new Error(`Multiple passports match DPP identifier "${stableId}".`);
      error.code = "AMBIGUOUS_DPP_ID";
      throw error;
    }

    const selected = filteredMatches[0];
    const companyNameMap = await getCompanyNameMap([selected.passport.company_id]);
    return {
      passport: selected.passport,
      typeDef: selected.typeDef,
      tableName: selected.tableName,
      companyName: companyNameMap.get(String(selected.passport.company_id)) || ""
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
    if (!["released", "obsolete"].includes(String(result.passport.release_status || "").trim().toLowerCase())) {
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
      dbLookupByProductIdOnly(productIdentifier, { versionNumber });
  }

  async function loadReleasedPassportAtDate(identifier, atDate, { strictProductId = false } = {}) {
    const parsedDppId = parseDppIdentifier(identifier);
    if (parsedDppId?.kind === "stable") {
      if (strictProductId) return null;
      return resolvePassportByStableDppId(parsedDppId.stableId, { atDate });
    }
    const baseline = strictProductId ?
      await dbLookupByProductIdOnly(identifier) :
      await resolveReleasedPassportForIdentifier(identifier, null, null);
    if (!baseline?.passport) return null;

    const companyId = baseline.passport.company_id;
    const passportType = baseline.passport.passport_type;
    const tableName = getTable(passportType);
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType,
      productId: baseline.passport.product_id,
      granularity: baseline.passport.granularity || "item"
    }) || [baseline.passport.product_id, baseline.passport.product_identifier_did].filter(Boolean);

    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE company_id = $2
         AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
         AND release_status IN ('released', 'obsolete')
         AND deleted_at IS NULL`,
      [candidates, companyId]
    );
    const archiveRes = await pool.query(
      `SELECT product_identifier_did, archived_at, row_data
       FROM passport_archives
       WHERE company_id = $2
         AND passport_type = $3
         AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
         AND release_status IN ('released', 'obsolete')`,
      [candidates, companyId, passportType]
    );

    const combined = [
      ...liveRes.rows.map((row) => ({ ...normalizePassportRow(row), passport_type: passportType })),
      ...archiveRes.rows.map((row) => {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        return {
          ...normalizePassportRow(rowData),
          product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
          archived_at: row.archived_at || rowData?.archived_at,
          passport_type: passportType,
          archived: true
        };
      })
    ].filter((row) => {
      const candidateDate = new Date(row.updated_at || row.created_at || row.archived_at || 0);
      return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
    });

    if (!combined.length) return null;
    combined.sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || left.archived_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || right.archived_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.version_number || 0) - Number(left.version_number || 0);
    });

    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([companyId]),
      pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passportType])]
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
      passportType: "battery",
      productId: parsed.productId,
      granularity: parsed.granularity || "item"
    }) || [parsed.productId];
    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");

    const matches = [];
    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $2
           AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
           AND release_status IN ('draft', 'in_revision')
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        [candidates, companyId]
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    if (matches.length > 1) {
      const error = new Error(`Multiple editable passports share DPP identifier "${dppId}".`);
      error.code = "AMBIGUOUS_DPP_ID";
      throw error;
    }
    return matches[0];
  }

  async function resolveEditablePassportForIdentifier(productIdentifier, companyId = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      return resolveEditablePassportByDppId(productIdentifier);
    }

    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const candidates = productIdentifierService?.buildLookupCandidates?.({
        companyId,
        passportType: typeRow.type_name,
        productId: productIdentifier,
        granularity: "item"
      }) || [productIdentifier];
      const params = [candidates];
      let companySql = "";
      if (companyId !== null && companyId !== undefined) {
        params.push(companyId);
        companySql = ` AND company_id = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))${companySql}
           AND release_status IN ('draft', 'in_revision')
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        params
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((left, right) => {
      const leftTime = new Date(left.passport.updated_at || left.passport.created_at || 0).getTime();
      const rightTime = new Date(right.passport.updated_at || right.passport.created_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.version_number || 0) - Number(left.passport.version_number || 0);
    });

    if (matches.length > 1 && matches[0].passport.dppId !== matches[1].passport.dppId) {
      const error = new Error(`Multiple editable passports match identifier "${productIdentifier}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      error.companyIds = [...new Set(matches.map(({ passport }) => Number(passport.company_id)).filter(Number.isFinite))];
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
        return { productIdentifier, found: false, error: "NOT_FOUND" };
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
      if (error.code === "AMBIGUOUS_PRODUCT_ID") {
        return {
          productIdentifier,
          found: false,
          error: "AMBIGUOUS_PRODUCT_ID",
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
    const rawValues = Array.isArray(body?.productId) ?
      body.productId :
      [];
    return rawValues
      .map((value) => decodeURIComponent(String(value || "").trim()))
      .filter(Boolean);
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
    const { product_id } = passport;
    const encodedPid = encodeURIComponent(String(product_id));
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
        serviceEndpoint: `${appUrl}/api/v1/dppsByProductId/${encodedPid}`,
        accept: ["application/json"]
      },
      {
        id: `${subjectDid}#passport-jsonld`,
        type: "DPPLinkedData",
        serviceEndpoint: `${appUrl}/api/v1/dppsByProductId/${encodedPid}`,
        accept: ["application/ld+json"]
      },
      {
        id: `${subjectDid}#passport-credential`,
        type: "VerifiableCredential",
        serviceEndpoint: `${appUrl}/api/passports/${passport.dppId}/signature`
      },
      {
        id: `${subjectDid}#passport-schema`,
        type: "DPPSchema",
        serviceEndpoint: `${appUrl}/api/passport-types/${passport.passport_type}`
      }
    ];
  }

  async function loadCompanyById(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              c.is_active,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function resolveLegacyPassportDidTarget(companyId, productId, fallbackGranularity = "model") {
    const result = await dbLookupByCompanyAndProduct(companyId, productId);
    if (!result?.passport) return null;
    const stableId = didService.normalizeStableId(result.passport.lineage_id || result.passport.dppId);
    const granularity = String(
      result.passport.granularity ||
      result.passport.dpp_granularity ||
      result.typeDef?.granularity ||
      result.typeDef?.fields_json?.granularity ||
      fallbackGranularity
    ).trim().toLowerCase() || fallbackGranularity;
    return {
      ...result,
      stableId,
      granularity
    };
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
    loadCompanyById,
    resolveLegacyPassportDidTarget,
  };
}

module.exports = {
  createResolutionHelpers,
};
