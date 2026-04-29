"use strict";

const logger = require("../services/logger");

module.exports = function registerPassportPublicRoutes(app, {
  pool,
  crypto,
  publicReadRateLimit,
  publicUnlockRateLimit,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  resolvePublicPassportByDppId,
  buildPassportVersionHistory,
  resolvePublicPathToSubjects,
  verifyPassportSignature,
  buildJsonLdContext,
  buildBatteryPassJsonExport,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  signingService,
  didService
}) {
  const API_ORIGIN = didService.getApiOrigin();
  const DID_DOMAIN = didService.getDidDomain();
  const PLATFORM_DID = didService.getPlatformDid();
  const CANONICAL_DPP_CONTEXT_URL = `https://${DID_DOMAIN}/contexts/dpp/v1`;
  const CANONICAL_BATTERY_CONTEXT_URL = `https://${DID_DOMAIN}/dictionary/battery/v1/context.jsonld`;

  const DPP_CONTEXT_RESPONSE = {
    "@context": {
      "@version": 1.1,
      dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
      clarosBattery: "https://www.claros-dpp.online/dictionary/battery/v1/terms/",
      DigitalProductPassport: "dpp:DigitalProductPassport",
      digitalProductPassportId: "dpp:digitalProductPassportId",
      uniqueProductIdentifier: "dpp:uniqueProductIdentifier",
      granularity: "dpp:granularity",
      dppSchemaVersion: "dpp:dppSchemaVersion",
      dppStatus: "dpp:dppStatus",
      lastUpdated: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
      lastUpdate: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
      economicOperatorId: "dpp:economicOperatorId",
      facilityId: "dpp:facilityId",
      contentSpecificationIds: "dpp:contentSpecificationIds",
      subjectDid: "dpp:subjectDid",
      dppDid: "dpp:dppDid",
      companyDid: "dpp:companyDid",
      passportType: "dpp:passportType",
      modelName: "dpp:modelName",
      versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" }
    }
  };

  function wantsSemanticResponse(req) {
    const accept = String(req.headers.accept || "").toLowerCase();
    return String(req.query.format || "").toLowerCase() === "semantic" || accept.includes("application/ld+json");
  }

  function getRepresentation(req) {
    const raw = String(req.query.representation || "").trim().toLowerCase();
    return ["expanded", "full"].includes(raw) ? "expanded" : "compressed";
  }

  function wantsJsonResolution(req) {
    const accept = String(req.headers.accept || "").toLowerCase();
    return accept.includes("application/json") || accept.includes("application/did+ld+json");
  }

  function wantsBrowserRedirect(req) {
    if (wantsJsonResolution(req)) return false;
    const accept = String(req.headers.accept || "").toLowerCase();
    return accept.includes("text/html") || String(req.headers["sec-fetch-dest"] || "").toLowerCase() === "document";
  }

  function isSafeDbFieldKey(fieldKey) {
    return /^[a-z][a-z0-9_]+$/.test(String(fieldKey || ""));
  }

  async function reserveCompanyDidSlug(companyName, companyId) {
    const baseSlug = didService.normalizeCompanySlug(companyName || `company-${companyId}`);
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
      const existing = await pool.query(
        `SELECT id
         FROM companies
         WHERE did_slug = $1
           AND id <> $2
         LIMIT 1`,
        [candidate, companyId]
      );
      if (!existing.rows.length) return candidate;
      candidate = `${baseSlug}-${suffix++}`;
    }
  }

  async function hydrateCompany(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS default_granularity,
              COALESCE(p.jsonld_export_enabled, true) AS jsonld_export_enabled,
              c.is_active
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    const company = result.rows[0] || null;
    if (!company) return null;
    if (!company.did_slug) {
      const didSlug = await reserveCompanyDidSlug(company.company_name, company.id);
      await pool.query(
        `UPDATE companies
         SET did_slug = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [didSlug, company.id]
      );
      company.did_slug = didSlug;
    }
    return company;
  }

  async function hydrateCompanyBySlug(companySlug) {
    const normalizedSlug = didService.normalizeCompanySlug(companySlug);
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS default_granularity,
              COALESCE(p.jsonld_export_enabled, true) AS jsonld_export_enabled,
              c.is_active
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.did_slug = $1
       LIMIT 1`,
      [normalizedSlug]
    );
    return result.rows[0] || null;
  }

  async function loadTypeDef(passportType) {
    const result = await pool.query(
      `SELECT type_name, umbrella_category, semantic_model_key, fields_json
       FROM passport_types
       WHERE type_name = $1
       LIMIT 1`,
      [passportType]
    );
    return result.rows[0] || null;
  }

  function buildPublicPassportUrl(passport, companyName) {
    const path = passport.release_status === "obsolete" ?
    buildInactivePublicPassportPath({
      companyName,
      manufacturerName: passport.manufacturer,
      manufacturedBy: passport.manufactured_by,
      modelName: passport.model_name,
      productId: passport.product_id,
      versionNumber: passport.version_number
    }) :
    buildCurrentPublicPassportPath({
      companyName,
      manufacturerName: passport.manufacturer,
      manufacturedBy: passport.manufactured_by,
      modelName: passport.model_name,
      productId: passport.product_id
    });
    return didService.buildPublicPassportUrl(path);
  }

  function buildDidServiceEndpoints(passport, companyName) {
    const publicUrl = buildPublicPassportUrl(passport, companyName);
    return [
    { id: "#passport", type: "DigitalProductPassport", serviceEndpoint: publicUrl },
    { id: "#canonical-json", type: "CanonicalJson", serviceEndpoint: didService.buildApiUrl(`/api/passports/${passport.dppId}/canonical`) },
    { id: "#jsonld", type: "JsonLd", serviceEndpoint: didService.buildApiUrl(`/api/passports/${passport.dppId}?format=semantic`) },
    { id: "#credential", type: "VerifiableCredential", serviceEndpoint: didService.buildApiUrl(`/api/passports/${passport.dppId}/signature`) }].
    filter((service) => Boolean(service.serviceEndpoint));
  }

  function buildVerificationMethod() {
    const signingKey = signingService.getSigningKey();
    if (!signingKey?.publicKey) return [];
    const publicKey = crypto.createPublicKey(signingKey.publicKey);
    const publicKeyJwk = publicKey.export({ format: "jwk" });
    return [{
      id: `${PLATFORM_DID}#key-1`,
      type: "JsonWebKey2020",
      controller: PLATFORM_DID,
      publicKeyJwk: { ...publicKeyJwk, kid: signingKey.keyId }
    }];
  }

  function buildDidDocument({ id, service = [] }) {
    return {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id,
      controller: PLATFORM_DID,
      verificationMethod: buildVerificationMethod(),
      ...(service.length ? { service } : {})
    };
  }

  function buildResolutionPayload(did, passport, company, typeDef) {
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, {
      company,
      granularity: company?.default_granularity || company?.dpp_granularity || passport.granularity || "model"
    });
    return {
      did,
      didDocument: didService.didToDocumentUrl(did),
      type: "DigitalProductPassport",
      publicUrl: buildPublicPassportUrl(passport, company?.company_name || ""),
      canonicalJson: didService.buildApiUrl(`/api/passports/${passport.dppId}/canonical`),
      jsonLd: didService.buildApiUrl(`/api/passports/${passport.dppId}?format=semantic`),
      verification: didService.buildApiUrl(`/api/passports/${passport.dppId}/signature`),
      subjectDid: canonicalPayload.subjectDid,
      dppDid: canonicalPayload.dppDid,
      companyDid: canonicalPayload.companyDid
    };
  }

  function buildRequestedPassportPayload(req, passport, typeDef, company) {
    const granularity = company?.default_granularity || company?.dpp_granularity || passport?.granularity || "model";
    const serializerOptions = { company, granularity };
    if (getRepresentation(req) === "expanded" && typeof buildExpandedPassportPayload === "function") {
      return buildExpandedPassportPayload(passport, typeDef, serializerOptions);
    }
    return buildCanonicalPassportPayload(passport, typeDef, serializerOptions);
  }

  function flattenSemanticPayload(canonicalPayload) {
    if (Array.isArray(canonicalPayload?.elements)) {
      return {
        ...canonicalPayload,
        "@type": "DigitalProductPassport"
      };
    }
    const { fields = {}, extensions, ...rest } = canonicalPayload || {};
    void extensions;
    const flattened = {
      ...rest,
      ...fields,
      "@type": "DigitalProductPassport"
    };
    delete flattened.fields;
    return flattened;
  }

  function sendSemanticPassport(res, canonicalPayload, passportType, typeDef) {
    const semanticSource = flattenSemanticPayload(canonicalPayload);
    const exported = buildBatteryPassJsonExport([semanticSource], passportType, {
      semanticModelKey: typeDef?.semantic_model_key,
      umbrellaCategory: typeDef?.umbrella_category
    });
    const graphItem = { ...(exported?.["@graph"]?.[0] || semanticSource) };
    delete graphItem.passport_type;
    delete graphItem.semantic_model;
    const exportedContexts = Array.isArray(exported?.["@context"]) ? exported["@context"].slice(1) : [];
    const semanticContexts = [];
    const seenStringContexts = new Set();
    const pushContext = (contextValue) => {
      if (!contextValue) return;
      if (typeof contextValue === "string") {
        if (seenStringContexts.has(contextValue)) return;
        seenStringContexts.add(contextValue);
      }
      semanticContexts.push(contextValue);
    };

    pushContext(CANONICAL_DPP_CONTEXT_URL);
    exportedContexts.forEach(pushContext);

    res.setHeader("Content-Type", "application/ld+json");
    return res.json({
      "@context": semanticContexts,
      ...graphItem
    });
  }

  function ensureJsonLdExportEnabled(company) {
    return company?.jsonld_export_enabled !== false;
  }

  async function loadPublicPassportByGuid(dppId, { versionNumber = null } = {}) {
    const normalizedGuid = String(dppId || "").trim();
    if (!normalizedGuid) return null;

    const resolved = await resolvePublicPassportByDppId(normalizedGuid, { versionNumber });
    let passport = resolved?.passport || null;

    if (!passport && versionNumber === null) {
      const registryRes = await pool.query(
        `SELECT passport_type
         FROM passport_registry
         WHERE dpp_id = $1
         LIMIT 1`,
        [normalizedGuid]
      );
      if (!registryRes.rows.length) return null;

      const passportType = registryRes.rows[0].passport_type;
      const tableName = getTable(passportType);
      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE dpp_id = $1
           AND deleted_at IS NULL
           AND release_status IN ('released', 'obsolete')
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        [normalizedGuid]
      );
      if (liveRes.rows.length) {
        passport = { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType };
      } else {
        const archiveRes = await pool.query(
          `SELECT row_data
           FROM passport_archives
           WHERE dpp_id = $1
             AND passport_type = $2
             AND release_status IN ('released', 'obsolete')
           ORDER BY version_number DESC, archived_at DESC
           LIMIT 1`,
          [normalizedGuid, passportType]
        );
        if (archiveRes.rows.length) {
          const rowData = typeof archiveRes.rows[0].row_data === "string" ?
          JSON.parse(archiveRes.rows[0].row_data) :
          archiveRes.rows[0].row_data;
          passport = { ...normalizePassportRow(rowData), passport_type: passportType, archived: true };
        }
      }
    }

    if (!passport) return null;

    const [typeDef, company] = await Promise.all([
    loadTypeDef(passport.passport_type),
    hydrateCompany(passport.company_id)]
    );

    return { passport, typeDef, company };
  }

  async function loadPublicPassportByLineage(stableId) {
    const lineageId = didService.normalizeStableId(stableId);
    const registryRes = await pool.query(
      `SELECT dpp_id, company_id, passport_type, lineage_id
       FROM passport_registry
       WHERE lineage_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [lineageId]
    );
    if (!registryRes.rows.length) return null;

    const registryRow = registryRes.rows[0];
    const tableName = getTable(registryRow.passport_type);
    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE lineage_id = $1
         AND deleted_at IS NULL
         AND release_status IN ('released', 'obsolete')
       ORDER BY version_number DESC, updated_at DESC
       LIMIT 1`,
      [lineageId]
    );

    let passport = null;
    if (liveRes.rows.length) {
      passport = { ...normalizePassportRow(liveRes.rows[0]), passport_type: registryRow.passport_type };
    } else {
      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE lineage_id = $1
           AND passport_type = $2
           AND release_status IN ('released', 'obsolete')
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [lineageId, registryRow.passport_type]
      );
      if (!archiveRes.rows.length) return null;
      const rowData = typeof archiveRes.rows[0].row_data === "string" ?
      JSON.parse(archiveRes.rows[0].row_data) :
      archiveRes.rows[0].row_data;
      passport = { ...normalizePassportRow(rowData), passport_type: registryRow.passport_type, archived: true };
    }

    const [typeDef, company] = await Promise.all([
    loadTypeDef(passport.passport_type),
    hydrateCompany(passport.company_id)]
    );

    return { passport, typeDef, company };
  }

  function getFacilityFieldKeys(typeDef) {
    return (typeDef?.fields_json?.sections || []).
    flatMap((section) => section.fields || []).
    filter((field) => field?.key && isSafeDbFieldKey(field.key)).
    filter((field) => {
      const compact = String(field.key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return compact.includes("facility");
    }).
    map((field) => field.key);
  }

  async function loadFacilitySubject(stableId) {
    const normalizedStableId = didService.normalizeFacilityStableId(stableId);
    const passportTypes = await pool.query(
      `SELECT type_name, semantic_model_key, fields_json
       FROM passport_types
       ORDER BY type_name ASC`
    );

    for (const typeDef of passportTypes.rows) {
      const facilityFieldKeys = getFacilityFieldKeys(typeDef);
      if (!facilityFieldKeys.length) continue;

      const tableName = getTable(typeDef.type_name);
      const selectFields = facilityFieldKeys.join(", ");
      const candidateRes = await pool.query(
        `SELECT dpp_id, lineage_id, company_id, model_name, product_id, release_status, version_number, updated_at, created_at, ${selectFields}
         FROM ${tableName}
         WHERE deleted_at IS NULL
           AND release_status IN ('released', 'obsolete')
           AND (${facilityFieldKeys.map((fieldKey) => `${fieldKey} IS NOT NULL`).join(" OR ")})
         ORDER BY updated_at DESC
         LIMIT 250`
      );

      for (const row of candidateRes.rows) {
        const matchingKey = facilityFieldKeys.find((fieldKey) => {
          const rawValue = row[fieldKey];
          if (rawValue === null || rawValue === undefined || rawValue === "") return false;
          return didService.normalizeFacilityStableId(rawValue) === normalizedStableId;
        });

        if (!matchingKey) continue;

        const passport = { ...normalizePassportRow(row), passport_type: typeDef.type_name };
        const company = await hydrateCompany(passport.company_id);
        return { passport, typeDef, company, facilityFieldKey: matchingKey };
      }
    }

    return null;
  }

  async function loadPassportTypeSchema(passportType) {
    const result = await pool.query(
      `SELECT id, type_name, display_name, umbrella_category, umbrella_icon, fields_json
       FROM passport_types
       WHERE type_name = $1`,
      [passportType]
    );
    return result.rows[0] || null;
  }

  // ─── PASSPORT TYPE SCHEMA (public) ───────────────────────────────────────

  app.get("/api/passport-types/:typeName", publicReadRateLimit, async (req, res) => {
    try {
      const schema = await loadPassportTypeSchema(req.params.typeName);
      if (!schema) return res.status(404).json({ error: "Passport type not found" });
      res.json(schema);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport type" });
    }
  });

  // ─── BY PRODUCT ID ───────────────────────────────────────────────────────

  app.get("/api/passports/by-product/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = normalizeProductIdValue(req.params.productId);
      const version = req.query.version ? parseInt(req.query.version, 10) : null;
      if (!productId) return res.status(400).json({ error: "productId is required" });
      if (req.query.version && !Number.isFinite(version)) {
        return res.status(400).json({ error: "version must be a valid integer" });
      }

      let resolved = await resolveReleasedPassportByProductId(productId, { versionNumber: version });
      if (!resolved?.passport) {
        resolved = await resolvePublicPassportByDppId(req.params.productId, { versionNumber: version });
      }
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const passport = resolved.passport;
      const [sanitizedPassport, typeDef, company] = await Promise.all([
      stripRestrictedFieldsForPublicView(passport, passport.passport_type),
      loadTypeDef(passport.passport_type),
      hydrateCompany(passport.company_id)]
      );
      const companyName = company?.company_name || "";
      const publicPath = buildCurrentPublicPassportPath({
        companyName,
        manufacturerName: sanitizedPassport.manufacturer,
        manufacturedBy: sanitizedPassport.manufactured_by,
        modelName: sanitizedPassport.model_name,
        productId: sanitizedPassport.product_id
      });
      const linkedSubjects = publicPath ?
      await resolvePublicPathToSubjects({ pool, publicPath, getTable, didService }) :
      null;
      const canonicalPayload = buildCanonicalPassportPayload(sanitizedPassport, typeDef, {
        company,
        granularity: company?.default_granularity || company?.dpp_granularity || sanitizedPassport.granularity || "model"
      });
      const requestedPayload = buildRequestedPassportPayload(req, sanitizedPassport, typeDef, company);

      const basePayload = {
        ...sanitizedPassport,
        public_path: publicPath,
        inactive_path: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: sanitizedPassport.manufacturer,
          manufacturedBy: sanitizedPassport.manufactured_by,
          modelName: sanitizedPassport.model_name,
          productId: sanitizedPassport.product_id,
          versionNumber: sanitizedPassport.version_number
        }),
        inactive_public_version: version !== null && Number(version) === Number(sanitizedPassport.version_number),
        linked_data: {
          public_url: didService.buildPublicPassportUrl(publicPath),
          canonical_json_url: didService.buildApiUrl(`/api/passports/${passport.dppId}/canonical`),
          related_subjects: linkedSubjects,
          canonical_subjects: {
            subjectDid: canonicalPayload.subjectDid,
            dppDid: canonicalPayload.dppDid,
            companyDid: canonicalPayload.companyDid,
            facilityDid: linkedSubjects?.facilityDid || null
          }
        }
      };

      if (getRepresentation(req) === "expanded") {
        if (wantsSemanticResponse(req)) {
          if (!ensureJsonLdExportEnabled(company)) {
            return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
          }
          return sendSemanticPassport(res, requestedPayload, passport.passport_type, typeDef);
        }
        return res.json(requestedPayload);
      }

      if (wantsSemanticResponse(req)) {
        if (!ensureJsonLdExportEnabled(company)) {
          return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
        }
        const semanticPayload = { ...basePayload };
        delete semanticPayload.linked_data;
        const exported = buildBatteryPassJsonExport([semanticPayload], passport.passport_type, {
          semanticModelKey: typeDef?.semantic_model_key,
          umbrellaCategory: typeDef?.umbrella_category
        });
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({
          "@context": [`${API_ORIGIN}/contexts/dpp/v1`, ...(exported?.["@context"] || []).slice(1)],
          ...(exported?.["@graph"]?.[0] || basePayload)
        });
      }

      res.json(basePayload);
    } catch (error) {
      if (error.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to fetch passport" });
    }
  });

  app.get("/api/passports/by-product/:productId/history", publicReadRateLimit, async (req, res) => {
    try {
      const productId = normalizeProductIdValue(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const { passport } = await resolveReleasedPassportByProductId(productId);
      if (!passport) return res.status(404).json({ error: "Passport not found" });

      const historyPayload = await buildPassportVersionHistory({
        dppId: passport.dppId,
        passportType: passport.passport_type,
        publicOnly: true
      });

      res.json(historyPayload);
    } catch (error) {
      if (error.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to fetch passport history" });
    }
  });

  // ─── BY GUID (public, canonical JSON by default) ────────────────────────

  async function handleCanonicalPassportRequest(req, res) {
    try {
      const loaded = await loadPublicPassportByGuid(req.params.dppId);
      if (!loaded?.passport) return res.status(404).json({ error: "Passport not found" });

      const sanitizedPassport = await stripRestrictedFieldsForPublicView(loaded.passport, loaded.passport.passport_type);
      const canonicalPayload = buildRequestedPassportPayload(req, sanitizedPassport, loaded.typeDef, loaded.company);

      if (wantsSemanticResponse(req)) {
        if (!ensureJsonLdExportEnabled(loaded.company)) {
          return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
        }
        return sendSemanticPassport(res, canonicalPayload, sanitizedPassport.passport_type, loaded.typeDef);
      }

      return res.json(canonicalPayload);
    } catch {
      return res.status(500).json({ error: "Failed to fetch passport" });
    }
  }

  app.get("/api/passports/:dppId", publicReadRateLimit, handleCanonicalPassportRequest);
  app.get("/api/passports/:dppId/canonical", publicReadRateLimit, handleCanonicalPassportRequest);

  app.get("/api/passports/:dppId/history", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByGuid(req.params.dppId);
      if (!loaded?.passport) return res.status(404).json({ error: "Passport not found" });

      const historyPayload = await buildPassportVersionHistory({
        dppId: req.params.dppId,
        passportType: loaded.passport.passport_type,
        publicOnly: true
      });

      res.json(historyPayload);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport history" });
    }
  });

  // ─── SIGNATURE (public verification) ───────────────────────────────────

  app.get("/api/passports/:dppId/signature", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const versionNum = req.query.version ? parseInt(req.query.version, 10) : null;

      let version = versionNum;
      if (!version) {
        const reg = await pool.query(
          `SELECT passport_type
           FROM passport_registry
           WHERE dpp_id = $1`,
          [dppId]
        );
        if (reg.rows.length) {
          const tableName = getTable(reg.rows[0].passport_type);
          const liveVersion = await pool.query(
            `SELECT version_number
             FROM ${tableName}
             WHERE dpp_id = $1
               AND release_status = 'released'
             ORDER BY version_number DESC
             LIMIT 1`,
            [dppId]
          );
          if (liveVersion.rows.length) {
            version = liveVersion.rows[0].version_number;
          } else {
            const archiveVersion = await pool.query(
              `SELECT version_number
               FROM passport_archives
               WHERE dpp_id = $1
                 AND release_status = 'released'
               ORDER BY version_number DESC
               LIMIT 1`,
              [dppId]
            );
            version = archiveVersion.rows[0]?.version_number || 1;
          }
        }
        version = version || 1;
      }

      const verifyResult = await verifyPassportSignature(dppId, version);
      let credential = null;

      if (verifyResult.status !== "unsigned" && verifyResult.status !== "not_found") {
        const vcRow = await pool.query(
          `SELECT vc_json
           FROM passport_signatures
           WHERE passport_dpp_id = $1
             AND version_number = $2`,
          [dppId, version]
        );
        if (vcRow.rows[0]?.vc_json) {
          credential = JSON.parse(vcRow.rows[0].vc_json);
        }
      }

      res.json({ ...verifyResult, ...(credential ? { credential } : {}) });
    } catch (error) {
      logger.error("Signature verify error:", error.message);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // ─── SIGNING KEY (public) ────────────────────────────────────────────────

  app.get("/api/signing-key", publicReadRateLimit, async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT key_id, public_key, algorithm, created_at
         FROM passport_signing_keys
         ORDER BY created_at DESC
         LIMIT 1`
      );
      if (!result.rows.length) return res.status(404).json({ error: "No signing key found" });
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to retrieve signing key" });
    }
  });

  // ─── DID DOCUMENTS ───────────────────────────────────────────────────────

  app.get("/.well-known/did.json", publicReadRateLimit, async (_req, res) => {
    try {
      if (!signingService.getSigningKey()) {
        return res.status(503).json({ error: "Signing key not loaded" });
      }
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({ id: PLATFORM_DID }));
    } catch (error) {
      logger.error("DID document error:", error.message);
      return res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  app.get("/did/company/:slug/did.json", publicReadRateLimit, async (req, res) => {
    try {
      let company = await hydrateCompanyBySlug(req.params.slug);

      if (!company && /^\d+$/.test(String(req.params.slug || ""))) {
        const legacyCompany = await hydrateCompany(Number.parseInt(req.params.slug, 10));
        if (legacyCompany?.is_active && legacyCompany.did_slug && legacyCompany.did_slug !== req.params.slug) {
          return res.redirect(301, `/did/company/${encodeURIComponent(legacyCompany.did_slug)}/did.json`);
        }
        company = legacyCompany;
      }

      if (!company?.is_active) return res.status(404).json({ error: "DID not found" });

      const did = didService.generateCompanyDid(company.did_slug);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: [
        { id: "#profile", type: "CompanyProfile", serviceEndpoint: didService.buildApiUrl(`/api/companies/${company.id}/profile`) }]

      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/battery/model/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByLineage(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const did = didService.generateModelDid("battery", loaded.passport.lineage_id);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.company_name || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/battery/item/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByLineage(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const did = didService.generateItemDid("battery", loaded.passport.lineage_id);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.company_name || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/dpp/:granularity/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const granularity = didService.normalizeGranularity(req.params.granularity);
      const loaded = await loadPublicPassportByLineage(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const did = didService.generateDppDid(granularity, loaded.passport.lineage_id);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.company_name || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/facility/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadFacilitySubject(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const did = didService.generateFacilityDid(req.params.stableId);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.company_name || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  // ─── DID RESOLVER ────────────────────────────────────────────────────────

  app.get("/resolve", publicReadRateLimit, async (req, res) => {
    try {
      const did = String(req.query.did || "").trim();
      if (!did.startsWith(`${PLATFORM_DID}`)) {
        return res.status(400).json({ error: "Invalid DID" });
      }

      const parsed = didService.parseDid(did);
      if (!parsed) return res.status(400).json({ error: "Invalid DID" });

      if (parsed.entityType === "platform") {
        if (wantsBrowserRedirect(req)) return res.redirect(302, didService.buildApiUrl("/.well-known/did.json"));
        return res.json({
          did,
          didDocument: didService.didToDocumentUrl(did),
          type: "Issuer",
          publicUrl: didService.buildApiUrl("/.well-known/did.json")
        });
      }

      if (parsed.entityType === "company") {
        const company = await hydrateCompanyBySlug(parsed.stableId);
        if (!company?.is_active) return res.status(404).json({ error: "DID not found" });
        const publicUrl = didService.buildApiUrl(`/api/companies/${company.id}/profile`);
        if (wantsBrowserRedirect(req)) return res.redirect(302, publicUrl);
        return res.json({
          did,
          didDocument: didService.didToDocumentUrl(did),
          type: "Company",
          publicUrl
        });
      }

      if (parsed.entityType === "facility") {
        const loaded = await loadFacilitySubject(parsed.stableId);
        if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
        const publicUrl = buildPublicPassportUrl(loaded.passport, loaded.company?.company_name || "");
        if (wantsBrowserRedirect(req)) return res.redirect(302, publicUrl || didService.didToDocumentUrl(did));
        return res.json({
          did,
          didDocument: didService.didToDocumentUrl(did),
          type: "Facility",
          publicUrl,
          canonicalJson: didService.buildApiUrl(`/api/passports/${loaded.passport.dppId}/canonical`),
          jsonLd: didService.buildApiUrl(`/api/passports/${loaded.passport.dppId}?format=semantic`),
          verification: didService.buildApiUrl(`/api/passports/${loaded.passport.dppId}/signature`)
        });
      }

      if (parsed.entityType === "model" || parsed.entityType === "item" || parsed.entityType === "dpp") {
        const loaded = await loadPublicPassportByLineage(parsed.stableId);
        if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
        const resolution = buildResolutionPayload(did, loaded.passport, loaded.company, loaded.typeDef);
        if (wantsBrowserRedirect(req)) return res.redirect(302, resolution.publicUrl || resolution.didDocument);
        return res.json(resolution);
      }

      return res.status(404).json({ error: "DID not found" });
    } catch {
      return res.status(404).json({ error: "DID not found" });
    }
  });

  // ─── JSON-LD CONTEXT ─────────────────────────────────────────────────────

  app.get("/contexts/dpp/v1", publicReadRateLimit, (_req, res) => {
    res.setHeader("Content-Type", "application/ld+json");
    res.json(DPP_CONTEXT_RESPONSE);
  });

  // ─── UNLOCK ──────────────────────────────────────────────────────────────

  app.post("/api/passports/:dppId/unlock", publicUnlockRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const { accessKey } = req.body;
      if (!accessKey) return res.status(400).json({ error: "accessKey is required" });

      const reg = await pool.query(
        `SELECT passport_type, access_key_hash
         FROM passport_registry
         WHERE dpp_id = $1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const suppliedHash = crypto.createHash("sha256").update(String(accessKey)).digest("hex");
      const storedHash = String(reg.rows[0].access_key_hash || "");
      if (!storedHash) return res.status(401).json({ error: "Access key is not configured for this passport" });
      const keysMatch = storedHash.length === suppliedHash.length &&
      crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(suppliedHash, "hex"));
      if (!keysMatch) return res.status(401).json({ error: "Invalid access key" });

      const tableName = getTable(reg.rows[0].passport_type);
      let row = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE dpp_id = $1
           AND deleted_at IS NULL
         ORDER BY version_number DESC
         LIMIT 1`,
        [dppId]
      );

      if (!row.rows.length) {
        const archiveRes = await pool.query(
          `SELECT row_data
           FROM passport_archives
           WHERE dpp_id = $1
           ORDER BY version_number DESC
           LIMIT 1`,
          [dppId]
        );
        if (archiveRes.rows.length) {
          const rowData = typeof archiveRes.rows[0].row_data === "string" ?
          JSON.parse(archiveRes.rows[0].row_data) :
          archiveRes.rows[0].row_data;
          row = { rows: [rowData] };
        }
      }
      if (!row.rows.length) return res.status(404).json({ error: "Passport not found" });

      res.json({
        success: true,
        passport: {
          ...normalizePassportRow(row.rows[0]),
          passport_type: reg.rows[0].passport_type,
          archived: !!row.rows[0]?.archived
        }
      });
    } catch {
      res.status(500).json({ error: "Failed to unlock passport" });
    }
  });
};
