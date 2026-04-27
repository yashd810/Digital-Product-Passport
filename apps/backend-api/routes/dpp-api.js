"use strict";
const logger = require("../services/logger");

// ─── DPP API ROUTES ───────────────────────────────────────────────────────────
// All DID paths use companyId + product_id — never guid.
// Conforms to the did:web spec for DID document resolution.

module.exports = function registerDppApiRoutes(app, {
  pool,
  publicReadRateLimit,
  authenticateToken,
  requireEditor,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  signingService,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildPassportJsonLdContext,
  didService,
  dppIdentity, // the dpp-identity-service module
  productIdentifierService,
  updatePassportRowById,
  isEditablePassportStatus,
  logAudit,
  accessRightsService,
}) {

  // ─── HELPERS ───────────────────────────────────────────────────────────────

  function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3001";
  }

  /**
   * Load a released passport record by companyId + productId.
   * Returns { passport, typeDef, companyName } or null.
   */
  async function loadReleasedPassport(companyId, rawProductId, options = {}) {
    const productId = normalizeProductIdValue
      ? normalizeProductIdValue(rawProductId)
      : rawProductId;
    if (!productId) return null;

    const result = await resolveReleasedPassportByProductId(productId, {
      companyId,
      versionNumber: options.versionNumber ?? null,
      granularity: options.granularity || "item",
    });
    if (!result?.passport) return null;

    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.company_id]),
      pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type]),
    ]);

    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || "",
    };
  }

  /**
   * Determine content negotiation: returns 'jsonld' or 'json'.
   */
  function acceptsJsonLd(req) {
    const accept = req.headers.accept || "";
    return accept.includes("application/ld+json");
  }

  function getRepresentation(req) {
    const raw = String(req.query.representation || "").trim().toLowerCase();
    return raw === "full" ? "full" : "compressed";
  }

  function getRepresentationFromValue(value) {
    return String(value || "").trim().toLowerCase() === "full" ? "full" : "compressed";
  }

  async function buildPassportResponse(req, passport, typeDef, companyName) {
    const sanitized = await stripRestrictedFieldsForPublicView(passport, passport.passport_type);
    if (getRepresentation(req) === "full") {
      return buildCanonicalPassportPayload(sanitized, typeDef, { companyName });
    }
    return buildOperationalDppPayload(sanitized, typeDef, {
      companyName,
      granularity: sanitized.granularity || "model",
      dppIdentity,
    });
  }

  function extractCanonicalElementValue(payload, elementIdPath) {
    if (!payload || !elementIdPath) return undefined;
    if (payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, elementIdPath)) {
      return payload.fields[elementIdPath];
    }
    if (Object.prototype.hasOwnProperty.call(payload, elementIdPath)) {
      return payload[elementIdPath];
    }
    return undefined;
  }

  function getSchemaFieldDefinitions(typeDef) {
    return (typeDef?.fields_json?.sections || [])
      .flatMap((section) => section.fields || [])
      .filter((field) => field?.key);
  }

  function findSchemaFieldDefinition(typeDef, elementIdPath) {
    return getSchemaFieldDefinitions(typeDef).find((field) =>
      field.key === elementIdPath
      || field.semanticId === elementIdPath
      || field.semantic_id === elementIdPath
      || field.elementId === elementIdPath
      || field.element_id === elementIdPath
    ) || null;
  }

  function buildElementEnvelope(passport, typeDef, elementIdPath, value) {
    const fieldDef = findSchemaFieldDefinition(typeDef, elementIdPath);
    const granularity = String(passport?.granularity || "item").trim().toLowerCase() || "item";
    const derivedProductIdentifier = passport?.product_id
      ? productIdentifierService?.buildCanonicalProductDid?.({
          companyId: passport.company_id,
          passportType: passport.passport_type || typeDef?.type_name || "battery",
          rawProductId: passport.product_id,
          granularity,
        }) || null
      : null;
    let dppId = null;
    try {
      if (passport?.company_id && passport?.product_id) {
        dppId = dppIdentity.dppDid(granularity, passport.company_id, passport.product_id);
      }
    } catch {}

    return {
      productIdentifier: passport?.product_identifier_did || derivedProductIdentifier || null,
      dppId,
      elementIdPath,
      elementId: fieldDef?.elementId || fieldDef?.element_id || fieldDef?.key || elementIdPath,
      dictionaryReference: fieldDef?.semanticId || fieldDef?.semantic_id || null,
      cardinality: Array.isArray(value) ? "multi" : "single",
      value,
    };
  }

  function parseDppIdentifier(dppId) {
    const rawValue = String(dppId || "").trim();
    const legacy = dppIdentity?.parseDid?.(rawValue);
    if (legacy?.type === "dpp") {
      return {
        kind: "legacy",
        granularity: legacy.granularity || "item",
        companyId: Number.parseInt(legacy.companyId, 10),
        productId: legacy.productId,
      };
    }

    const stable = didService?.parseDid?.(rawValue);
    if (stable?.entityType === "dpp") {
      return {
        kind: "stable",
        granularity: stable.granularity || "item",
        stableId: stable.stableId,
      };
    }
    return null;
  }

  async function resolvePassportByStableDppId(stableId, {
    versionNumber = null,
    editableOnly = false,
    atDate = null,
  } = {}) {
    const typeRows = await pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const liveParams = [stableId];
      const statusSql = editableOnly
        ? "release_status IN ('draft', 'in_revision', 'revised')"
        : (versionNumber !== null && versionNumber !== undefined
            ? "release_status IN ('released', 'obsolete')"
            : "release_status = 'released'");
      let versionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE (lineage_id = $1 OR guid::text = $1)
           AND ${statusSql}
           AND deleted_at IS NULL${versionSql}
         ORDER BY version_number DESC, updated_at DESC`,
        liveParams
      );
      for (const row of liveRes.rows) {
        matches.push({
          passport: { ...normalizePassportRow(row), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName,
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
         WHERE (lineage_id = $1 OR guid::text = $1)
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
            archived: true,
          },
          typeDef: typeRow,
          tableName,
        });
      }
    }

    const filteredMatches = atDate
      ? matches.filter(({ passport }) => {
          const candidateDate = new Date(passport.updated_at || passport.created_at || passport.archived_at || 0);
          return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
        })
      : matches;

    if (!filteredMatches.length) return null;
    filteredMatches.sort((left, right) => {
      const leftTime = new Date(left.passport.updated_at || left.passport.created_at || left.passport.archived_at || 0).getTime();
      const rightTime = new Date(right.passport.updated_at || right.passport.created_at || right.passport.archived_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.version_number || 0) - Number(left.passport.version_number || 0);
    });
    if (filteredMatches.length > 1 && filteredMatches[0].passport.guid !== filteredMatches[1].passport.guid) {
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
      companyName: companyNameMap.get(String(selected.passport.company_id)) || "",
    };
  }

  async function resolveReleasedPassportByDppId(dppId, { versionNumber = null } = {}) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    if (parsed.kind === "legacy") {
      return loadReleasedPassport(parsed.companyId, parsed.productId, {
        versionNumber,
        granularity: parsed.granularity || "item",
      });
    }
    return resolvePassportByStableDppId(parsed.stableId, { versionNumber });
  }

  async function resolveReleasedPassportForIdentifier(productIdentifier, companyId = null, versionNumber = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      if (companyId !== null && Number(companyId) !== Number(parsedDppId.companyId)) return null;
      return resolveReleasedPassportByDppId(productIdentifier, { versionNumber });
    }
    return companyId
      ? loadReleasedPassport(companyId, productIdentifier, { versionNumber })
      : dbLookupByProductIdOnly(productIdentifier, { versionNumber });
  }

  async function loadReleasedPassportAtDate(identifier, atDate) {
    const parsedDppId = parseDppIdentifier(identifier);
    if (parsedDppId?.kind === "stable") {
      return resolvePassportByStableDppId(parsedDppId.stableId, { atDate });
    }
    const baseline = await resolveReleasedPassportForIdentifier(identifier, null, null);
    if (!baseline?.passport) return null;

    const companyId = baseline.passport.company_id;
    const passportType = baseline.passport.passport_type;
    const tableName = getTable(passportType);
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType,
      productId: baseline.passport.product_id,
      granularity: baseline.passport.granularity || "item",
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
          archived: true,
        };
      }),
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
      pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passportType]),
    ]);

    return {
      passport: combined[0],
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(companyId)) || "",
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
      granularity: parsed.granularity || "item",
    }) || [parsed.productId];
    const typeRows = await pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");

    const matches = [];
    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $2
           AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
           AND release_status IN ('draft', 'in_revision', 'revised')
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        [candidates, companyId]
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName,
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

  async function buildBatchLookupResult(productIdentifier, {
    companyId = null,
    versionNumber = null,
    representation = "compressed",
    acceptJsonLd = false,
  } = {}) {
    try {
      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) {
        return { productIdentifier, found: false, error: "NOT_FOUND" };
      }

      const requestShape = {
        headers: acceptJsonLd ? { accept: "application/ld+json" } : { accept: "application/json" },
        query: { representation },
      };
      const payload = await buildPassportResponse(requestShape, result.passport, result.typeDef, result.companyName);
      return {
        productIdentifier,
        found: true,
        payload: acceptJsonLd
          ? { "@context": buildPassportJsonLdContext(result.typeDef), ...payload }
          : payload,
      };
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return {
          productIdentifier,
          found: false,
          error: "AMBIGUOUS_PRODUCT_ID",
          companyIds: e.companyIds || [],
        };
      }
      throw e;
    }
  }

  /**
   * Build service endpoints array for a battery/product passport DID document.
   */
  function buildPassportServiceEndpoints(subjectDid, passport, typeDef, companyName) {
    const appUrl = getAppUrl();
    const { company_id, product_id } = passport;
    const encodedPid = encodeURIComponent(String(product_id));
    const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);

    return [
      {
        id: `${subjectDid}#passport-page`,
        type: "LinkedDomains",
        serviceEndpoint: publicUrl,
      },
      {
        id: `${subjectDid}#passport-json`,
        type: "DPPOperationalAPI",
        serviceEndpoint: `${appUrl}/api/dpp/${company_id}/${encodedPid}`,
        accept: ["application/json"],
      },
      {
        id: `${subjectDid}#passport-jsonld`,
        type: "DPPLinkedData",
        serviceEndpoint: `${appUrl}/api/dpp/${company_id}/${encodedPid}`,
        accept: ["application/ld+json"],
      },
      {
        id: `${subjectDid}#passport-credential`,
        type: "VerifiableCredential",
        serviceEndpoint: `${appUrl}/api/passports/${passport.guid}/signature`,
      },
      {
        id: `${subjectDid}#passport-schema`,
        type: "DPPSchema",
        serviceEndpoint: `${appUrl}/api/passport-types/${passport.passport_type}`,
      },
    ];
  }

  // ─── LOOKUP HELPER ─────────────────────────────────────────────────────────

  /**
   * Look up a released passport by companyId + productId from the DB directly.
   * Returns { passport, typeDef, companyName } or null.
   * If multiple unambiguous matches exist, returns the most recent.
   * Throws { ambiguous: true } if genuinely ambiguous across companies.
   */
  async function dbLookupByCompanyAndProduct(companyId, productId) {
    return loadReleasedPassport(companyId, productId);
  }

  async function loadCompanyById(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              c.is_active,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity
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
    const stableId = didService.normalizeStableId(result.passport.lineage_id || result.passport.guid);
    const granularity = String(
      result.passport.granularity
      || result.passport.dpp_granularity
      || result.typeDef?.granularity
      || result.typeDef?.fields_json?.granularity
      || fallbackGranularity
    ).trim().toLowerCase() || fallbackGranularity;
    return {
      ...result,
      stableId,
      granularity,
    };
  }

  /**
   * Look up a released passport by product_id only (across all companies).
   * Returns { passport, typeDef, companyName } or null.
   * Throws { code: 'AMBIGUOUS_PRODUCT_ID' } if multiple companies have the same product_id.
   */
  async function dbLookupByProductIdOnly(productId, { versionNumber = null } = {}) {
    const result = await resolveReleasedPassportByProductId(productId, { versionNumber });
    if (!result?.passport) return null;
    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.company_id]),
      pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type]),
    ]);
    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || "",
    };
  }

  // ─── GET /api/dpp/by-product/:productId ────────────────────────────────────
  // Find released passport by product_id (any company).
  // 409 if ambiguous across companies.
  app.get("/api/dpp/by-product/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const rawProductId = decodeURIComponent(req.params.productId);
      if (!rawProductId) return res.status(400).json({ error: "productId is required" });

      let result;
      try {
        result = await dbLookupByProductIdOnly(rawProductId);
      } catch (e) {
        if (e.code === "AMBIGUOUS_PRODUCT_ID") {
          return res.status(409).json({
            error: "AMBIGUOUS_PRODUCT_ID",
            message: "This product ID exists under multiple companies. Use /api/dpp/:companyId/:productId instead.",
            companyIds: e.companyIds,
          });
        }
        throw e;
      }

      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      res.json(payload);
    } catch (e) {
      logger.error({ err: e }, "[DPP API by-product]");
      res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  // ─── GET /api/dpp/:companyId/:productId ────────────────────────────────────
  // Find released passport by company + product_id (URL-decode productId).
  app.get("/api/dpp/:companyId/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const result = await dbLookupByCompanyAndProduct(companyId, productId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      res.json(payload);
    } catch (e) {
      logger.error({ err: e }, "[DPP API by-company-product]");
      res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = req.query.versionNumber ? Number.parseInt(req.query.versionNumber, 10) : null;
      if (!productIdentifier) return res.status(400).json({ error: "productIdentifier is required" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);

      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP API]");
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.get("/api/v1/dppsByProductId/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productId);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = req.query.versionNumber ? Number.parseInt(req.query.versionNumber, 10) : null;
      if (!productIdentifier) return res.status(400).json({ error: "productId is required" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP by-product-id API]");
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.post("/api/v1/dppsByProductIds", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifiers = Array.isArray(req.body?.productIdentifiers)
        ? req.body.productIdentifiers.map((value) => decodeURIComponent(String(value || "").trim())).filter(Boolean)
        : [];
      const companyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const versionNumber = req.body?.versionNumber !== undefined ? Number.parseInt(req.body.versionNumber, 10) : null;
      const representation = getRepresentationFromValue(req.body?.representation);
      const wantsJsonLd = String(req.body?.format || "").trim().toLowerCase() === "jsonld" || acceptsJsonLd(req);

      if (!productIdentifiers.length) {
        return res.status(400).json({ error: "productIdentifiers must be a non-empty array" });
      }
      if (productIdentifiers.length > 100) {
        return res.status(400).json({ error: "productIdentifiers may contain at most 100 entries" });
      }
      if (req.body?.companyId !== undefined && !Number.isFinite(companyId)) {
        return res.status(400).json({ error: "Invalid companyId" });
      }
      if (req.body?.versionNumber !== undefined && !Number.isFinite(versionNumber)) {
        return res.status(400).json({ error: "Invalid versionNumber" });
      }

      const results = [];
      for (const productIdentifier of productIdentifiers) {
        results.push(await buildBatchLookupResult(productIdentifier, {
          companyId,
          versionNumber,
          representation,
          acceptJsonLd: wantsJsonLd,
        }));
      }

      res.setHeader("Content-Type", wantsJsonLd ? "application/ld+json" : "application/json");
      return res.json({
        representation,
        format: wantsJsonLd ? "jsonld" : "json",
        results,
      });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP batch API]");
      return res.status(500).json({ error: "Failed to fetch DPP batch" });
    }
  });

  app.post("/api/v1/dppIdsByProductIds", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifiers = Array.isArray(req.body?.productIdentifiers)
        ? req.body.productIdentifiers.map((value) => decodeURIComponent(String(value || "").trim())).filter(Boolean)
        : [];
      const companyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      if (!productIdentifiers.length) {
        return res.status(400).json({ error: "productIdentifiers must be a non-empty array" });
      }
      if (productIdentifiers.length > 100) {
        return res.status(400).json({ error: "productIdentifiers may contain at most 100 entries" });
      }
      if (req.body?.companyId !== undefined && !Number.isFinite(companyId)) {
        return res.status(400).json({ error: "Invalid companyId" });
      }

      const results = [];
      for (const productIdentifier of productIdentifiers) {
        try {
          const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, null);
          if (!result?.passport) {
            results.push({ productIdentifier, found: false, error: "NOT_FOUND" });
            continue;
          }
          const granularity = String(result.passport.granularity || "item").trim().toLowerCase() || "item";
          results.push({
            productIdentifier,
            found: true,
            dppId: dppIdentity.dppDid(granularity, result.passport.company_id, result.passport.product_id),
            uniqueProductIdentifier: result.passport.product_identifier_did
              || productIdentifierService?.buildCanonicalProductDid?.({
                  companyId: result.passport.company_id,
                  passportType: result.passport.passport_type,
                  rawProductId: result.passport.product_id,
                  granularity,
                }) || null,
            companyId: result.passport.company_id,
            passportType: result.passport.passport_type,
          });
        } catch (e) {
          if (e.code === "AMBIGUOUS_PRODUCT_ID") {
            results.push({ productIdentifier, found: false, error: "AMBIGUOUS_PRODUCT_ID" });
            continue;
          }
          throw e;
        }
      }

      return res.json({ results });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP id batch API]");
      return res.status(500).json({ error: "Failed to fetch DPP identifiers" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/versions/:versionNumber", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = Number.parseInt(req.params.versionNumber, 10);
      if (!productIdentifier) return res.status(400).json({ error: "productIdentifier is required" });
      if (!Number.isFinite(versionNumber)) return res.status(400).json({ error: "Invalid versionNumber" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(
        { ...req, query: { ...req.query, representation: req.query.representation } },
        result.passport,
        result.typeDef,
        result.companyName
      );
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP version API]");
      return res.status(500).json({ error: "Failed to fetch DPP version" });
    }
  });

  app.get("/api/v1/dppsByIdAndDate/:dppId", publicReadRateLimit, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId);
      const rawDate = String(req.query.date || "").trim();
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!rawDate) return res.status(400).json({ error: "date query parameter is required" });
      const atDate = new Date(rawDate);
      if (Number.isNaN(atDate.getTime())) return res.status(400).json({ error: "Invalid date" });

      const result = await loadReleasedPassportAtDate(dppId, atDate);
      if (!result) return res.status(404).json({ error: "Passport not found for the requested date" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP by-id-and-date API]");
      return res.status(500).json({ error: "Failed to fetch DPP version by date" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/elements/:elementIdPath", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const elementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      if (!productIdentifier || !elementIdPath) return res.status(400).json({ error: "productIdentifier and elementIdPath are required" });

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportGuid: result.passport.guid,
        typeDef: result.typeDef,
        elementIdPath,
        user: null,
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "DATA_ELEMENT_RESTRICTED",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality,
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractCanonicalElementValue(payload, elementIdPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json(buildElementEnvelope(result.passport, result.typeDef, elementIdPath, value));
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP element API]");
      return res.status(500).json({ error: "Failed to fetch DPP data element" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/elements/:elementIdPath/authorized", authenticateToken, publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const elementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      if (!productIdentifier || !elementIdPath) {
        return res.status(400).json({ error: "productIdentifier and elementIdPath are required" });
      }

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportGuid: result.passport.guid,
        typeDef: result.typeDef,
        elementIdPath,
        user: req.user,
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "FORBIDDEN",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality,
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractCanonicalElementValue(payload, elementIdPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json({
        ...buildElementEnvelope(result.passport, result.typeDef, elementIdPath, value),
        access: {
          audience: accessDecision.matchedAudience,
          confidentiality: accessDecision.confidentiality,
        },
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP authorized element API]");
      return res.status(500).json({ error: "Failed to fetch authorized DPP data element" });
    }
  });

  app.patch("/api/v1/dpps/:dppId/elements/:elementIdPath", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const elementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      if (!dppId || !elementIdPath) {
        return res.status(400).json({ error: "dppId and elementIdPath are required" });
      }

      const parsedDppId = parseDppIdentifier(dppId);
      if (!parsedDppId) {
        return res.status(400).json({ error: "dppId must be a valid DPP DID" });
      }

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        return res.status(404).json({ error: "Editable passport not found. Create or revise a draft before updating elements." });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, "value")) {
        return res.status(400).json({ error: "value is required" });
      }

      const headerFieldMap = {
        dppSchemaVersion: "dpp_schema_version",
        facilityId: "facility_id",
        economicOperatorId: "economic_operator_id",
        complianceProfileKey: "compliance_profile_key",
        carrierPolicyKey: "carrier_policy_key",
        contentSpecificationIds: "content_specification_ids",
      };
      const schemaField = findSchemaFieldDefinition(editable.typeDef, elementIdPath);
      const targetColumn = schemaField?.key || headerFieldMap[elementIdPath] || null;
      if (!targetColumn) {
        return res.status(400).json({ error: "This element path is not writable through the standards element API" });
      }

      const writeDecision = await accessRightsService.canWriteElement({
        passportGuid: editable.passport.guid,
        typeDef: editable.typeDef,
        elementIdPath,
        user: req.user,
        passportCompanyId: editable.passport.company_id,
      });
      if (!writeDecision.allowed) {
        return res.status(403).json({
          error: "FORBIDDEN",
          updateAuthority: writeDecision.updateAuthority,
          confidentiality: writeDecision.confidentiality,
        });
      }

      await updatePassportRowById({
        tableName: editable.tableName,
        rowId: editable.passport.id,
        userId: req.user.userId,
        data: { [targetColumn]: req.body.value },
      });

      await logAudit(
        editable.passport.company_id,
        req.user.userId,
        "PATCH_DPP_ELEMENT",
        editable.tableName,
        editable.passport.guid,
        { [targetColumn]: editable.passport[targetColumn] ?? null },
        { [targetColumn]: req.body.value },
        {
          actorIdentifier: req.user.email || `user:${req.user.userId}`,
          audience: writeDecision.matchedAuthority || "economic_operator",
        }
      );

      const refreshedEditable = await resolveEditablePassportByDppId(dppId);
      const sourcePassport = refreshedEditable?.passport || { ...editable.passport, [targetColumn]: req.body.value };
      const sourceTypeDef = refreshedEditable?.typeDef || editable.typeDef;
      const canonicalPayload = buildCanonicalPassportPayload(sourcePassport, sourceTypeDef, { companyName: "" });
      const value = extractCanonicalElementValue(canonicalPayload, elementIdPath);
      return res.json(buildElementEnvelope(sourcePassport, sourceTypeDef, elementIdPath, value));
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP element PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP data element" });
    }
  });

  app.post("/api/v1/registerDPP", authenticateToken, requireEditor, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(String(req.body?.productIdentifier || "").trim());
      const registryName = String(req.body?.registryName || "local").trim().toLowerCase();
      const submittedCompanyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const companyId = req.user.role === "super_admin"
        ? submittedCompanyId
        : Number.parseInt(req.user.companyId, 10);

      if (!productIdentifier) {
        return res.status(400).json({ error: "productIdentifier is required" });
      }
      if (!Number.isFinite(companyId)) {
        return res.status(400).json({ error: "A valid companyId is required" });
      }
      if (!registryName || !/^[a-z0-9_-]{2,120}$/.test(registryName)) {
        return res.status(400).json({ error: "registryName must be 2-120 chars using lowercase letters, numbers, underscores, or dashes" });
      }

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId);
      if (!result) {
        return res.status(404).json({ error: "Passport not found or not released" });
      }

      const canonicalPayload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const registrationPayload = {
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        publicUrl: dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName),
        contentSpecificationIds: canonicalPayload.contentSpecificationIds || [],
        passportType: canonicalPayload.passportType,
        versionNumber: canonicalPayload.versionNumber,
        requestedBy: req.user.userId,
      };

      const upsert = await pool.query(
        `INSERT INTO dpp_registry_registrations (
           passport_guid, company_id, product_identifier, dpp_id, registry_name, status, registration_payload, registered_by
         )
         VALUES ($1, $2, $3, $4, $5, 'registered', $6::jsonb, $7)
         ON CONFLICT (registry_name, dpp_id)
         DO UPDATE SET
           product_identifier = EXCLUDED.product_identifier,
           status = 'registered',
           registration_payload = EXCLUDED.registration_payload,
           registered_by = EXCLUDED.registered_by,
           updated_at = NOW()
         RETURNING id, passport_guid, company_id, product_identifier, dpp_id, registry_name, status, registered_at, updated_at`,
        [
          result.passport.guid,
          result.passport.company_id,
          canonicalPayload.uniqueProductIdentifier || productIdentifier,
          canonicalPayload.digitalProductPassportId,
          registryName,
          JSON.stringify(registrationPayload),
          req.user.userId,
        ]
      );

      return res.status(201).json({
        success: true,
        registration: upsert.rows[0],
        payload: registrationPayload,
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      logger.error({ err: e }, "[Standards DPP register API]");
      return res.status(500).json({ error: "Failed to register DPP" });
    }
  });

  // ─── GET /did/company/:companyId/did.json ──────────────────────────────────
  // Legacy numeric company DID URL. Redirect to subject-level company DID doc.
  app.get("/did/company/:companyId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Company DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/model/:companyId/:productId/did.json ─────────────────
  // Legacy model DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/model/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "model");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/model/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Model DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/item/:companyId/:productId/did.json ─────────────────
  // Legacy item DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/item/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "item");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/item/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Item DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/dpp/:granularity/:companyId/:productId/did.json ─────────────
  // Legacy DPP DID URL. Redirect to lineage-based DID doc.
  app.get("/did/dpp/:granularity/:companyId/:productId/did.json", async (req, res) => {
    try {
      const { granularity } = req.params;
      const validGranularities = ["model", "item", "batch"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `granularity must be one of: ${validGranularities.join(", ")}` });
      }

      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, granularity);
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      const nextGranularity = didService.normalizeGranularity(target.granularity || granularity);
      return res.redirect(301, `/did/dpp/${encodeURIComponent(nextGranularity)}/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[DPP DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/facility/:facilityId/did.json ────────────────────────────────
  // Facility DID document.
  app.get("/did/facility/:facilityId/did.json", async (req, res) => {
    try {
      const facilityId = decodeURIComponent(req.params.facilityId);
      if (!facilityId) return res.status(400).json({ error: "facilityId is required" });

      const appUrl      = getAppUrl();
      const fDid        = dppIdentity.facilityDid(facilityId);
      const controller  = dppIdentity.platformDid();

      const didDocument = {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id:         fDid,
        controller,
        service: [
          {
            id:              `${fDid}#facility-profile`,
            type:            "LinkedDomains",
            serviceEndpoint: `${appUrl}/api/facilities/${encodeURIComponent(facilityId)}`,
          },
        ],
      };

      res.setHeader("Content-Type", "application/did+ld+json");
      res.json(didDocument);
    } catch (e) {
      logger.error({ err: e }, "[Facility DID]");
      res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  // ─── GET /resolve ──────────────────────────────────────────────────────────
  // Universal DID resolver.
  // Browser clients (Accept: text/html) get redirected to the consumer public URL.
  // API clients (Accept: application/json or application/did+ld+json) get redirected
  // to the did.json document URL.
  app.get("/resolve", publicReadRateLimit, async (req, res) => {
    try {
      const { did } = req.query;
      if (!did) return res.status(400).json({ error: "did query parameter required" });

      if (!did.startsWith("did:web:")) {
        return res.status(400).json({ error: "Only did:web method is supported" });
      }

      const parsed = dppIdentity.parseDid(did);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid DID syntax — could not parse" });
      }

      const accept = req.headers.accept || "";
      const wantsBrowser = accept.includes("text/html") &&
        !accept.includes("application/json") &&
        !accept.includes("application/did+ld+json");

      // Platform DID — redirect to .well-known
      if (parsed.type === "platform") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        return res.redirect(307, docUrl);
      }

      // Company DID
      if (parsed.type === "company") {
        const appUrl = getAppUrl();
        if (wantsBrowser) {
          return res.redirect(307, `${appUrl}/companies/${parsed.companyId}`);
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Battery (model or item) DID
      if (parsed.type === "battery") {
        if (wantsBrowser) {
          // Look up the passport to build the consumer URL
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // DPP DID
      if (parsed.type === "dpp") {
        if (wantsBrowser) {
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Facility DID
      if (parsed.type === "facility") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      res.status(404).json({ error: "DID type not supported or not found" });
    } catch (e) {
      logger.error({ err: e }, "[Resolver]");
      res.status(500).json({ error: "DID resolution failed" });
    }
  });

  // ─── GET /api/passports/:guid/public-url ───────────────────────────────────
  // Return the canonical HTTPS public URL for QR code generation.
  app.get("/api/passports/:guid/public-url", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      if (!guid) return res.status(400).json({ error: "guid is required" });

      // Look up passport type
      const reg = await pool.query(
        "SELECT passport_type, company_id FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passport_type, company_id } = reg.rows[0];
      const tableName = getTable(passport_type);

      const r = await pool.query(
        `SELECT guid, product_id, model_name, company_id FROM ${tableName}
         WHERE guid = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport record not found" });

      const passport = normalizePassportRow(r.rows[0]);
      passport.passport_type = passport_type;

      const companyNameMap = await getCompanyNameMap([company_id]);
      const companyName    = companyNameMap.get(String(company_id)) || "";

      const publicUrl  = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      const productDid = passport.product_identifier_did || (passport.product_id
        ? dppIdentity.productModelDid(company_id, passport.product_id)
        : null);
      const pDppDid = passport.product_id
        ? dppIdentity.dppDid("model", company_id, passport.product_id)
        : null;

      res.json({
        publicUrl,
        productId:   passport.product_id || null,
        productIdentifierDid: passport.product_identifier_did || null,
        modelName:   passport.model_name  || null,
        companyName,
        dppDid:      pDppDid,
        productDid,
      });
    } catch (e) {
      logger.error({ err: e }, "[Public URL]");
      res.status(500).json({ error: "Failed to resolve public URL" });
    }
  });

  // ─── LEGACY: GET /api/dpp/:guid (guid-based, backwards compat) ─────────────
  // Kept for backwards compatibility — routes that were issuing guid-based DPP requests.
  // The UUID regex prevents collision with /api/dpp/:companyId/:productId.
  app.get(
    /^\/api\/dpp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    publicReadRateLimit,
    async (req, res) => {
      try {
        const guid = req.params[0];
        const acceptJsonLd = acceptsJsonLd(req);

        const reg = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE guid = $1",
          [guid]
        );
        if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

        const { passport_type } = reg.rows[0];
        const tableName = getTable(passport_type);

        const r = await pool.query(
          `SELECT * FROM ${tableName}
           WHERE guid = $1 AND deleted_at IS NULL AND release_status = 'released'
           LIMIT 1`,
          [guid]
        );
        if (!r.rows.length) return res.status(404).json({ error: "Passport not found or not released" });

        const passport  = { ...normalizePassportRow(r.rows[0]), passport_type };

        const [companyNameMap, typeRes] = await Promise.all([
          getCompanyNameMap([passport.company_id]),
          pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passport_type]),
        ]);
        const companyName = companyNameMap.get(String(passport.company_id)) || "";
        const typeDef     = typeRes.rows[0] || null;

        const payload = await buildPassportResponse(req, passport, typeDef, companyName);

        if (acceptJsonLd) {
          const context = buildPassportJsonLdContext(typeDef);
          res.setHeader("Content-Type", "application/ld+json");
          return res.json({ "@context": context, ...payload });
        }

        res.setHeader("Content-Type", "application/json");
        res.json(payload);
      } catch (e) {
        logger.error({ err: e }, "[DPP API legacy guid]");
        res.status(500).json({ error: "Failed to fetch DPP" });
      }
    }
  );

  // ─── LEGACY: GET /did/dpp/:guid/did.json (guid-based DID document) ─────────
  // Kept for backwards compatibility — clients that cached guid-based DID URLs.
  app.get(
    /^\/did\/dpp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/did\.json$/i,
    async (req, res) => {
      try {
        const guid = req.params[0];

        const reg = await pool.query(
          "SELECT passport_type, company_id FROM passport_registry WHERE guid = $1",
          [guid]
        );
        if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

        const { passport_type, company_id } = reg.rows[0];
        const tableName = getTable(passport_type);

        const r = await pool.query(
          `SELECT product_id, company_id, lineage_id FROM ${tableName}
           WHERE guid = $1 AND deleted_at IS NULL AND release_status = 'released'
           LIMIT 1`,
          [guid]
        );
        if (!r.rows.length) return res.status(404).json({ error: "Passport not released" });

        const { product_id, lineage_id } = r.rows[0];

        const stableId = didService.normalizeStableId(lineage_id || guid);

        // Redirect any legacy guid DID URL to the lineage-based DPP DID document.
        if (product_id || lineage_id) {
          const company = await loadCompanyById(company_id);
          const granularity = didService.normalizeGranularity(company?.dpp_granularity || "model");
          const canonicalUrl = `/did/dpp/${encodeURIComponent(granularity)}/${encodeURIComponent(stableId)}/did.json`;
          return res.redirect(301, canonicalUrl);
        }

        // Fallback: serve a minimal DID document using guid
        const appUrl        = getAppUrl();
        const domain        = new URL(appUrl).host;
        const subjectDid    = `did:web:${domain}:dpp:${guid}`;
        const controllerDid = dppIdentity.companyDid(company_id);

        const didDocument = {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id:         subjectDid,
          controller: controllerDid,
          service: [
            {
              id:              `${subjectDid}#passport-page`,
              type:            "LinkedDomains",
              serviceEndpoint: `${appUrl}/passport/${guid}`,
            },
            {
              id:              `${subjectDid}#passport-json`,
              type:            "DPPOperationalAPI",
              serviceEndpoint: `${appUrl}/api/dpp/${guid}`,
              accept:          ["application/json"],
            },
            {
              id:              `${subjectDid}#passport-schema`,
              type:            "DPPSchema",
              serviceEndpoint: `${appUrl}/api/passport-types/${passport_type}`,
            },
          ],
        };

        res.setHeader("Content-Type", "application/did+ld+json");
        res.json(didDocument);
      } catch (e) {
        logger.error({ err: e }, "[Legacy DPP DID]");
        res.status(500).json({ error: "Failed to generate DID document" });
      }
    }
  );

  // ─── LEGACY: GET /did/org/:companyId/did.json ──────────────────────────────
  // Redirect old :org: paths to new :company: paths.
  app.get("/did/org/:companyId/did.json", async (req, res) => {
    const companyId = parseInt(req.params.companyId, 10);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

    try {
      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Legacy Org DID]");
      return res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });
};
