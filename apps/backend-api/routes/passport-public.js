"use strict";

const logger = require("../src/infrastructure/logging/logger");
const { buildCanonicalIdentityBundle } = require("../src/shared/identifiers/canonical-identity-bundle");
const { isPublicVersionVisible } = require("../src/modules/public-passports/visibility");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../src/shared/repository/repository-file-links");

module.exports = function registerPassportPublicRoutes(app, {
  pool,
  crypto,
  publicReadRateLimit,
  publicUnlockRateLimit,
  getTable,
  normalizePassportRow,
  normalizeInternalAliasIdValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByInternalAliasId,
  resolvePublicPassportByDppId,
  buildPassportVersionHistory,
  resolvePublicPathToSubjects,
  verifyPassportSignature,
  logAudit,
  buildJsonLdContext,
  buildBatteryPassJsonExport,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  backupProviderService,
  signingService,
  didService,
  productIdentifierService
}) {
  const API_ORIGIN = didService.getApiOrigin();
  const DID_DOMAIN = didService.getDidDomain();
  const PLATFORM_DID = didService.getPlatformDid();
  const CANONICAL_DPP_CONTEXT_URL = `https://${DID_DOMAIN}/contexts/dpp/v1`;
  const CANONICAL_BATTERY_CONTEXT_URL = `https://${DID_DOMAIN}/dictionary/battery/v1/context.jsonld`;

  function securePublicRepositoryLinks(value) {
    return rewriteRepositoryLinksForSignedAccessDeep(value, {
      appBaseUrl: API_ORIGIN,
    });
  }

  const getPassportType = (passport, fallback = null) => passport?.passportType || fallback;
  const getCompanyId = (passport, fallback = null) => passport?.companyId ?? fallback;
  const getInternalAliasId = (passport, fallback = null) => passport?.internalAliasId || fallback;
  const getModelName = (passport, fallback = null) => passport?.modelName || fallback;
  const getVersionNumber = (passport, fallback = null) => passport?.versionNumber ?? fallback;
  const getReleaseStatus = (passport, fallback = null) => passport?.releaseStatus || fallback;

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
    return raw === "full" ? "full" : "compressed";
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
              c.company_logo,
              c.did_slug,
              c.customer_trust_level,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, 'item') AS default_granularity,
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
              c.company_logo,
              c.did_slug,
              c.customer_trust_level,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, 'item') AS default_granularity,
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
      `SELECT type_name, product_category, semantic_model_key, fields_json
       FROM passport_types
       WHERE type_name = $1
       LIMIT 1`,
      [passportType]
    );
    return result.rows[0] || null;
  }

  function buildPublicPassportUrl(passport, companyName) {
    const path = getReleaseStatus(passport) === "obsolete" ?
    buildInactivePublicPassportPath({
      companyName,
      manufacturerName: passport.manufacturer,
      manufacturedBy: passport.manufactured_by,
      modelName: getModelName(passport),
      internalAliasId: getInternalAliasId(passport),
      versionNumber: getVersionNumber(passport)
    }) :
    buildCurrentPublicPassportPath({
      companyName,
      manufacturerName: passport.manufacturer,
      manufacturedBy: passport.manufactured_by,
      modelName: getModelName(passport),
      internalAliasId: getInternalAliasId(passport)
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
      granularity: company?.default_granularity || passport.granularity || "model"
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
    const granularity = company?.default_granularity || passport?.granularity || "model";
    const serializerOptions = { company, granularity };
    const payload = getRepresentation(req) === "full" && typeof buildExpandedPassportPayload === "function"
      ? buildExpandedPassportPayload(passport, typeDef, serializerOptions)
      : buildCanonicalPassportPayload(passport, typeDef, serializerOptions);
    const identityBundle = buildCanonicalIdentityBundle({
      passport,
      company,
      companyName: company?.company_name || "",
      granularity,
      passportType: getPassportType(passport, typeDef?.type_name || "battery"),
      didService,
      productIdentifierService,
    });
    return {
      ...payload,
      digitalProductPassportId: payload?.digitalProductPassportId || identityBundle.digitalProductPassportId || null,
      uniqueProductIdentifier: payload?.uniqueProductIdentifier || identityBundle.uniqueProductIdentifier || null,
      subjectDid: payload?.subjectDid || identityBundle.subjectDid || null,
      dppDid: payload?.dppDid || identityBundle.dppDid || null,
      companyDid: payload?.companyDid || identityBundle.companyDid || null,
    };
  }

  function buildPublicCompanyProfile(company) {
    if (!company) return null;
    return {
      company_name: company.company_name || "",
      company_logo: company.company_logo || null,
      did_slug: company.did_slug || null,
    };
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
      productCategory: typeDef?.product_category
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

  function resolveVerificationStatus(verifyResult) {
    const status = String(verifyResult?.status || "").toLowerCase();
    if (status === "valid") return "signed_by_claros";
    if (status === "tampered") return "tampered";
    if (status === "unsigned") return "unsigned";
    if (status === "key_missing") return "signing_key_missing";
    return "verification_failed";
  }

  function resolveIntegrityLabel(verifyResult) {
    const status = String(verifyResult?.status || "").toLowerCase();
    if (status === "valid") return "Signed";
    if (status === "tampered") return "Tampered";
    if (status === "unsigned") return "Unsigned";
    return "Verification failed";
  }

  async function loadPublicPassportByGuid(dppId, { versionNumber = null } = {}) {
    const normalizedGuid = String(dppId || "").trim();
    if (!normalizedGuid) return null;

    const handoverLoaded = await loadBackupHandoverPassport({
      passportDppId: normalizedGuid,
      versionNumber,
    });
    if (handoverLoaded) return handoverLoaded;

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
        passport = { ...normalizePassportRow(liveRes.rows[0]), passportType };
      } else {
        const archiveRes = await pool.query(
          `SELECT pa.row_data,
                  phv.is_public
           FROM passport_archives pa
           LEFT JOIN passport_history_visibility phv
             ON phv.passport_dpp_id = pa.dpp_id
            AND phv.version_number = pa.version_number
           WHERE pa.dpp_id = $1
             AND pa.passport_type = $2
           ORDER BY pa.version_number DESC, pa.archived_at DESC
           LIMIT 1`,
          [normalizedGuid, passportType]
        );
        if (archiveRes.rows.length) {
          const rowData = typeof archiveRes.rows[0].row_data === "string" ?
          JSON.parse(archiveRes.rows[0].row_data) :
          archiveRes.rows[0].row_data;
          if (isPublicVersionVisible(rowData?.releaseStatus || rowData?.release_status, archiveRes.rows[0].is_public)) {
            passport = { ...normalizePassportRow(rowData), passportType, archived: true };
          }
        }
      }
    }

    if (!passport) return null;

    const [typeDef, company] = await Promise.all([
    loadTypeDef(getPassportType(passport)),
    hydrateCompany(getCompanyId(passport))]
    );

    return { passport, typeDef, company };
  }

  async function loadPublicVerificationContext(dppId, { versionNumber = null } = {}) {
    const loaded = await loadPublicPassportByGuid(dppId, { versionNumber });
    if (!loaded?.passport) return null;

    const sanitizedPassport = securePublicRepositoryLinks(loaded.passport.backup_public_handover ?
    loaded.passport :
    await stripRestrictedFieldsForPublicView(loaded.passport, getPassportType(loaded.passport)));
    const passportDppId = loaded.passport.dppId || loaded.passport.dppId || loaded.passport.guid || dppId;
    const resolvedVersion = versionNumber || getVersionNumber(sanitizedPassport) || getVersionNumber(loaded.passport) || 1;
    const verifyResult = await verifyPassportSignature(passportDppId, resolvedVersion);
    const signatureRecord = await pool.query(
      `SELECT ps.data_hash,
              ps.signature,
              COALESCE(ps.algorithm, ps.algorithm) AS algorithm,
              ps.signing_key_id,
              ps.released_at AS signature_released_at,
              ps.signed_at,
              ps.vc_json,
              rr.released_by_email,
              rr.released_at AS release_record_released_at,
              rr.companyname
       FROM passport_signatures ps
       LEFT JOIN dpp_release_records rr
         ON rr.dpp_id = ps.passport_dpp_id
        AND rr.release_version = ps.version_number
       WHERE ps.passport_dpp_id = $1
         AND ps.version_number = $2
       LIMIT 1`,
      [passportDppId, resolvedVersion]
    ).catch(() => ({ rows: [] }));
    const signatureRow = signatureRecord.rows[0] || null;

    return {
      ...loaded,
      sanitizedPassport,
      resolvedVersion,
      verifyResult,
      signatureRow,
    };
  }

  function buildPublicVerificationPayload(verificationContext) {
    const { passport, company, sanitizedPassport, signatureRow, verifyResult } = verificationContext;
    const passportDppId = passport.dppId || passport.dppId || passport.guid || null;
    const dppUrl = buildPublicPassportUrl(sanitizedPassport, company?.company_name || "");
    const signatureUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}/signature.json`);
    const canonicalDppJsonUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}.json`);
    const verificationBundleUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}/verification-bundle.json`);
    const didDocumentUrl = `https://${DID_DOMAIN}/.well-known/did.json`;
    const verificationStatus = resolveVerificationStatus(verifyResult);
    const dppDataUnchanged = verifyResult?.status === "valid";

    return {
      dppId: passportDppId,
      companyId: company?.id ?? getCompanyId(passport) ?? null,
      companyName: company?.company_name || signatureRow?.companyname || "",
      trustLevel: company?.customer_trust_level || "BASIC",
      releasedBy: signatureRow?.released_by_email || null,
      releasedAt: signatureRow?.release_record_released_at || verifyResult?.releasedAt || signatureRow?.signature_released_at || null,
      dppHash: verifyResult?.dataHash || signatureRow?.data_hash || null,
      signature: signatureRow?.signature || null,
      algorithm: verifyResult?.algorithm || signatureRow?.algorithm || "ES256",
      signedBy: PLATFORM_DID,
      publicKeyUrl: didDocumentUrl,
      didDocumentUrl,
      verificationStatus,
      dppDataUnchanged,
      integrity: resolveIntegrityLabel(verifyResult),
      externalCompanyCertificate: "Not provided",
      dppUrl,
      canonicalDppJsonUrl,
      signatureUrl,
      verificationBundleUrl,
    };
  }

  async function loadBackupHandoverPassport({
    passportDppId = null,
    internalAliasId = null,
    versionNumber = null
  }) {
    if (!backupProviderService?.getActivePublicHandover) return null;

    let handover = await backupProviderService.getActivePublicHandover({
      passportDppId,
      internalAliasId,
      versionNumber,
    });
    if (!handover && backupProviderService?.ensureAutomaticPublicHandover) {
      handover = await backupProviderService.ensureAutomaticPublicHandover({
        passportDppId,
        internalAliasId,
        versionNumber,
      });
    }
    if (!handover) return null;

    const rawRow = typeof handover.public_row_data === "string" ?
    JSON.parse(handover.public_row_data) :
    handover.public_row_data;

    const passport = {
      ...normalizePassportRow(rawRow || {}),
      dppId: rawRow?.dppId || rawRow?.dpp_id || handover.passport_dpp_id,
      guid: rawRow?.guid || rawRow?.dppId || rawRow?.dpp_id || handover.passport_dpp_id,
      lineageId: rawRow?.lineageId || rawRow?.lineage_id || handover.lineage_id || handover.passport_dpp_id,
      companyId: rawRow?.companyId || rawRow?.company_id || handover.company_id,
      passportType: rawRow?.passportType || rawRow?.passport_type || handover.passport_type,
      internalAliasId: rawRow?.internalAliasId || rawRow?.internal_alias_id || handover.internal_alias_id,
      versionNumber: rawRow?.versionNumber || rawRow?.version_number || handover.version_number,
      backup_public_handover: true,
      backup_public_url: handover.public_url || null,
      backup_handover_source: {
        providerKey: handover.backup_provider_key || null,
        sourceReplicationId: handover.source_replication_id || null,
        verificationStatus: handover.verification_status || null,
      },
    };

    const [typeDef, company] = await Promise.all([
      loadTypeDef(getPassportType(passport)),
      hydrateCompany(getCompanyId(passport)),
    ]);

    return { passport, typeDef, company, handover };
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
      passport = { ...normalizePassportRow(liveRes.rows[0]), passportType: registryRow.passport_type };
    } else {
      const archiveRes = await pool.query(
        `SELECT pa.row_data,
                phv.is_public
         FROM passport_archives pa
         LEFT JOIN passport_history_visibility phv
           ON phv.passport_dpp_id = pa.dpp_id
          AND phv.version_number = pa.version_number
         WHERE pa.lineage_id = $1
           AND pa.passport_type = $2
         ORDER BY pa.version_number DESC, pa.archived_at DESC
         LIMIT 1`,
        [lineageId, registryRow.passport_type]
      );
      if (!archiveRes.rows.length) return null;
      const rowData = typeof archiveRes.rows[0].row_data === "string" ?
      JSON.parse(archiveRes.rows[0].row_data) :
      archiveRes.rows[0].row_data;
      if (!isPublicVersionVisible(rowData?.releaseStatus || rowData?.release_status, archiveRes.rows[0].is_public)) return null;
      passport = { ...normalizePassportRow(rowData), passportType: registryRow.passport_type, archived: true };
    }

    const [typeDef, company] = await Promise.all([
    loadTypeDef(getPassportType(passport)),
    hydrateCompany(getCompanyId(passport))]
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
        `SELECT dpp_id, lineage_id, company_id, model_name, internal_alias_id, release_status, version_number, updated_at, created_at, ${selectFields}
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

        const passport = { ...normalizePassportRow(row), passportType: typeDef.type_name };
        const company = await hydrateCompany(getCompanyId(passport));
        return { passport, typeDef, company, facilityFieldKey: matchingKey };
      }
    }

    return null;
  }

  async function loadPassportTypeSchema(passportType) {
    const result = await pool.query(
      `SELECT id, type_name, display_name, product_category, product_icon, fields_json
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

  app.get("/api/passports/by-product/:internalAliasId", publicReadRateLimit, async (req, res) => {
    try {
      const internalAliasId = normalizeInternalAliasIdValue(req.params.internalAliasId);
      const version = req.query.version ? parseInt(req.query.version, 10) : null;
      if (!internalAliasId) return res.status(400).json({ error: "internalAliasId is required" });
      if (req.query.version && !Number.isFinite(version)) {
        return res.status(400).json({ error: "version must be a valid integer" });
      }

      let resolved = await loadBackupHandoverPassport({ internalAliasId, versionNumber: version });
      if (!resolved?.passport) {
        resolved = await resolveReleasedPassportByInternalAliasId(internalAliasId, { versionNumber: version });
      }
      if (!resolved?.passport) {
        resolved = await resolvePublicPassportByDppId(req.params.internalAliasId, { versionNumber: version });
      }
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const passport = resolved.passport;
      const [sanitizedPassportRaw, typeDef, company] = await Promise.all([
      passport.backup_public_handover ? passport : stripRestrictedFieldsForPublicView(passport, getPassportType(passport)),
      resolved.typeDef || loadTypeDef(getPassportType(passport)),
      resolved.company || hydrateCompany(getCompanyId(passport))]
      );
      const sanitizedPassport = securePublicRepositoryLinks(sanitizedPassportRaw);
      const companyName = company?.company_name || "";
      const publicPath = buildCurrentPublicPassportPath({
        companyName,
        manufacturerName: sanitizedPassport.manufacturer,
        manufacturedBy: sanitizedPassport.manufactured_by,
        modelName: getModelName(sanitizedPassport),
        internalAliasId: getInternalAliasId(sanitizedPassport)
      });
      const linkedSubjects = publicPath ?
      await resolvePublicPathToSubjects({ pool, publicPath, getTable, didService }) :
      null;
      const canonicalPayloadRaw = buildCanonicalPassportPayload(passport, typeDef, {
        company,
        granularity: company?.default_granularity || passport.granularity || "model"
      });
      const canonicalIdentity = buildCanonicalIdentityBundle({
        passport,
        company,
        companyName,
        granularity: company?.default_granularity || passport.granularity || "model",
        passportType: getPassportType(passport),
        didService,
        productIdentifierService,
      });
      const canonicalPayload = {
        ...canonicalPayloadRaw,
        digitalProductPassportId: canonicalPayloadRaw?.digitalProductPassportId || canonicalIdentity.digitalProductPassportId || null,
        uniqueProductIdentifier: canonicalPayloadRaw?.uniqueProductIdentifier || canonicalIdentity.uniqueProductIdentifier || null,
        subjectDid: canonicalPayloadRaw?.subjectDid || canonicalIdentity.subjectDid || linkedSubjects?.productDid || null,
        dppDid: canonicalPayloadRaw?.dppDid || canonicalIdentity.dppDid || linkedSubjects?.dppDid || null,
        companyDid: canonicalPayloadRaw?.companyDid || canonicalIdentity.companyDid || linkedSubjects?.companyDid || null,
      };
      const requestedPayload = securePublicRepositoryLinks(buildRequestedPassportPayload(req, sanitizedPassport, typeDef, company));

      const basePayload = {
        ...sanitizedPassport,
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        internalAliasId: canonicalPayload.internalAliasId,
        economicOperatorId: canonicalPayload.economicOperatorId,
        facilityId: canonicalPayload.facilityId,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        company_profile: buildPublicCompanyProfile(company),
        public_path: publicPath,
        inactive_path: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: sanitizedPassport.manufacturer,
          manufacturedBy: sanitizedPassport.manufactured_by,
          modelName: getModelName(sanitizedPassport),
          internalAliasId: getInternalAliasId(sanitizedPassport),
          versionNumber: getVersionNumber(sanitizedPassport)
        }),
        inactive_public_version: version !== null && Number(version) === Number(getVersionNumber(sanitizedPassport)),
        linked_data: {
          public_url: didService.buildPublicPassportUrl(publicPath),
          canonical_json_url: didService.buildApiUrl(`/api/passports/${passport.dppId}/canonical`),
          backup_public_url: sanitizedPassport.backup_public_url || null,
          public_source_mode: sanitizedPassport.backup_public_handover ? "backup_handover" : "economic_operator",
          related_subjects: linkedSubjects,
          canonical_subjects: {
            subjectDid: canonicalPayload.subjectDid || linkedSubjects?.productDid || null,
            dppDid: canonicalPayload.dppDid || linkedSubjects?.dppDid || null,
            companyDid: canonicalPayload.companyDid || linkedSubjects?.companyDid || null,
            facilityDid: linkedSubjects?.facilityDid
              || (canonicalPayload.facilityId && String(canonicalPayload.facilityId).startsWith("did:")
                ? canonicalPayload.facilityId
                : (sanitizedPassport.facilityId ? didService.generateFacilityDid(sanitizedPassport.facilityId) : null))
          }
        }
      };
      delete basePayload.companyId;

      if (getRepresentation(req) === "full") {
        if (wantsSemanticResponse(req)) {
          if (!ensureJsonLdExportEnabled(company)) {
            return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
          }
          return sendSemanticPassport(res, requestedPayload, getPassportType(passport), typeDef);
        }
        return res.json(requestedPayload);
      }

      if (wantsSemanticResponse(req)) {
        if (!ensureJsonLdExportEnabled(company)) {
          return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
        }
        const semanticPayload = { ...basePayload };
        delete semanticPayload.linked_data;
        delete semanticPayload.company_profile;
        const exported = buildBatteryPassJsonExport([semanticPayload], getPassportType(passport), {
          semanticModelKey: typeDef?.semantic_model_key,
          productCategory: typeDef?.product_category
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
      logger.error({ err: error, internalAliasId: req.params.internalAliasId, version: req.query.version || null }, "GET /api/passports/by-product/:internalAliasId failed");
      res.status(500).json({ error: "Failed to fetch passport" });
    }
  });

  app.get("/api/passports/by-product/:internalAliasId/history", publicReadRateLimit, async (req, res) => {
    try {
      const internalAliasId = normalizeInternalAliasIdValue(req.params.internalAliasId);
      if (!internalAliasId) return res.status(400).json({ error: "internalAliasId is required" });

      const { passport } = await resolveReleasedPassportByInternalAliasId(internalAliasId);
      if (!passport) return res.status(404).json({ error: "Passport not found" });

      const historyPayload = await buildPassportVersionHistory({
        dppId: passport.dppId,
        passportType: getPassportType(passport),
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

    const sanitizedPassport = securePublicRepositoryLinks(loaded.passport.backup_public_handover ?
    loaded.passport :
    await stripRestrictedFieldsForPublicView(loaded.passport, getPassportType(loaded.passport)));
      const canonicalPayload = buildRequestedPassportPayload(req, sanitizedPassport, loaded.typeDef, loaded.company);

      if (wantsSemanticResponse(req)) {
        if (!ensureJsonLdExportEnabled(loaded.company)) {
          return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
        }
        return sendSemanticPassport(res, canonicalPayload, getPassportType(sanitizedPassport), loaded.typeDef);
      }

      return res.json(canonicalPayload);
    } catch {
      return res.status(500).json({ error: "Failed to fetch passport" });
    }
  }

  app.get("/api/passports/:dppId", publicReadRateLimit, handleCanonicalPassportRequest);
  app.get("/api/passports/:dppId/canonical", publicReadRateLimit, handleCanonicalPassportRequest);
  app.get("/api/public/dpp/:dppId.json", publicReadRateLimit, handleCanonicalPassportRequest);

  app.get("/api/passports/:dppId/history", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByGuid(req.params.dppId);
      if (!loaded?.passport) return res.status(404).json({ error: "Passport not found" });

      const historyPayload = await buildPassportVersionHistory({
        dppId: req.params.dppId,
        passportType: getPassportType(loaded.passport),
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

      if (["invalid", "tampered", "key_missing"].includes(String(verifyResult.status || "")) && typeof logAudit === "function") {
        const registryRow = await pool.query(
          `SELECT company_id
           FROM passport_registry
           WHERE dpp_id = $1
           LIMIT 1`,
          [dppId]
        ).catch(() => ({ rows: [] }));
        const companyId = registryRow.rows[0]?.company_id || null;
        if (companyId) {
        await logAudit(
          companyId,
          null,
          "VERIFY_SIGNATURE_FAILURE",
          "passport_signatures",
          dppId,
          null,
          {
            version_number: version,
            verification_status: verifyResult.status,
            key_id: verifyResult.keyId || null,
            algorithm: verifyResult.algorithm || null
          },
          {
            actorIdentifier: "public:signature-verifier",
            audience: "public",
          }
        ).catch(() => {});
        }
      }

      res.json({ ...verifyResult, ...(credential ? { credential } : {}) });
    } catch (error) {
      logger.error("Signature verify error:", error.message);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.get("/api/public/dpp/:dppId/signature.json", publicReadRateLimit, async (req, res) => {
    try {
      const verificationContext = await loadPublicVerificationContext(req.params.dppId, {
        versionNumber: req.query.version ? parseInt(req.query.version, 10) : null,
      });
      if (!verificationContext?.passport) return res.status(404).json({ error: "Passport not found" });

      const { verifyResult, signatureRow } = verificationContext;
      let credential = null;
      if (signatureRow?.vc_json) {
        try {
          credential = JSON.parse(signatureRow.vc_json);
        } catch {
          credential = null;
        }
      }

      return res.json({
        ...verifyResult,
        signature: signatureRow?.signature || null,
        algorithm: verifyResult?.algorithm || signatureRow?.algorithm || null,
        signingKeyId: signatureRow?.signing_key_id || verifyResult?.keyId || null,
        releasedBy: signatureRow?.released_by_email || null,
        ...(credential ? { credential } : {}),
      });
    } catch {
      return res.status(500).json({ error: "Failed to fetch signature proof" });
    }
  });

  app.get("/api/public/dpp/:dppId/verify", publicReadRateLimit, async (req, res) => {
    try {
      const verificationContext = await loadPublicVerificationContext(req.params.dppId, {
        versionNumber: req.query.version ? parseInt(req.query.version, 10) : null,
      });
      if (!verificationContext?.passport) return res.status(404).json({ error: "Passport not found" });
      return res.json(buildPublicVerificationPayload(verificationContext));
    } catch {
      return res.status(500).json({ error: "Failed to build verification summary" });
    }
  });

  app.get("/api/public/dpp/:dppId/verification-bundle.json", publicReadRateLimit, async (req, res) => {
    try {
      const verificationContext = await loadPublicVerificationContext(req.params.dppId, {
        versionNumber: req.query.version ? parseInt(req.query.version, 10) : null,
      });
      if (!verificationContext?.passport) return res.status(404).json({ error: "Passport not found" });

      const verificationPayload = buildPublicVerificationPayload(verificationContext);
      const { verifyResult, signatureRow } = verificationContext;

      return res.json({
        ...verificationPayload,
        hash: verificationPayload.dppHash,
        signature: verificationPayload.signature,
        verificationProofStatus: verifyResult?.status || "unsigned",
        credentialId: verifyResult?.credentialId || null,
        proofType: verifyResult?.proofType || null,
        issuer: verifyResult?.issuer || verificationPayload.signedBy,
      });
    } catch {
      return res.status(500).json({ error: "Failed to build verification bundle" });
    }
  });

  // ─── SIGNING KEY (public) ────────────────────────────────────────────────

  app.get("/api/signing-key", publicReadRateLimit, async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT key_id, public_key, algorithm, algorithm_version, created_at
         FROM passport_signing_keys
         ORDER BY created_at DESC
         LIMIT 1`
      );
      if (!result.rows.length) return res.status(404).json({ error: "No signing key found" });
      const historicalKeys = await pool.query(
        `SELECT key_id, algorithm, algorithm_version, created_at
         FROM passport_signing_keys
         ORDER BY created_at DESC`
      );
      const trustMetadata = typeof signingService?.getSigningTrustMetadata === "function" ?
      signingService.getSigningTrustMetadata() :
      { issuerDid: PLATFORM_DID };
      res.json({
        ...result.rows[0],
        issuerDid: trustMetadata.issuerDid || PLATFORM_DID,
        trustMetadata,
        historicalKeys: historicalKeys.rows.map((row) => ({
          keyId: row.key_id,
          algorithm: row.algorithm_version || row.algorithm || null,
          createdAt: row.created_at
        })),
        verification: {
          verificationMethod: "JsonWebSignature2020 detached JWS proof",
          verificationEndpoint: `${API_ORIGIN}/api/passports/{dppId}/signature`,
          didDocument: `https://${DID_DOMAIN}/.well-known/did.json`,
          oldKeysRetained: true
        }
      });
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
      const subjectNamespace = didService.normalizePassportTypeSegment(loaded.company?.company_name || loaded.company?.did_slug || "battery");
      const did = didService.generateModelDid(subjectNamespace, loaded.passport.lineageId);
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
      const subjectNamespace = didService.normalizePassportTypeSegment(loaded.company?.company_name || loaded.company?.did_slug || "battery");
      const did = didService.generateItemDid(subjectNamespace, loaded.passport.lineageId);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.company_name || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/battery/batch/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByLineage(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const subjectNamespace = didService.normalizePassportTypeSegment(loaded.company?.company_name || loaded.company?.did_slug || "battery");
      const did = didService.generateBatchDid(subjectNamespace, loaded.passport.lineageId);
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
      const did = didService.generateDppDid(granularity, loaded.passport.lineageId);
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
          passportType: reg.rows[0].passport_type,
          archived: !!row.rows[0]?.archived
        }
      });
    } catch {
      res.status(500).json({ error: "Failed to unlock passport" });
    }
  });
};
