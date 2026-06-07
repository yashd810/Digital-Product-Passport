"use strict";

const logger = require("../../infrastructure/logging/logger");
const { buildCanonicalIdentityBundle } = require("../../shared/identifiers/canonical-identity-bundle");
const { isPublicVersionVisible } = require("../../modules/public-passports/visibility");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../../shared/repository/repository-file-links");
const {
  mapCompanyRow,
  mapPassportTypeRow,
} = require("../../shared/passports/passport-helpers");

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
  buildSemanticPassportJsonExport,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  backupProviderService,
  signingService,
  didService,
  productIdentifierService,
  semanticModelRegistry
}) {
  const API_ORIGIN = didService.getApiOrigin();
  const DID_DOMAIN = didService.getDidDomain();
  const PLATFORM_DID = didService.getPlatformDid();
  const CANONICAL_DPP_CONTEXT_URL = `https://${DID_DOMAIN}/contexts/dpp/v1`;

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
    return /^[a-z][A-Za-z0-9]+$/.test(String(fieldKey || ""));
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
              c.company_name AS "companyName",
              c.company_logo AS "companyLogo",
              c.did_slug AS "didSlug",
              c.customer_trust_level AS "customerTrustLevel",
              COALESCE(p.default_granularity, 'item') AS "dppGranularity",
              COALESCE(p.default_granularity, 'item') AS "defaultGranularity",
              COALESCE(p.jsonld_export_enabled, true) AS "jsonldExportEnabled",
              c.is_active AS "isActive"
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    const company = result.rows[0] || null;
    if (!company) return null;
    if (!company.didSlug) {
      const didSlug = await reserveCompanyDidSlug(company.companyName, company.id);
      await pool.query(
        `UPDATE companies
         SET did_slug = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [didSlug, company.id]
      );
      company.didSlug = didSlug;
    }
    return mapCompanyRow(company);
  }

  async function hydrateCompanyBySlug(companySlug) {
    const normalizedSlug = didService.normalizeCompanySlug(companySlug);
    const result = await pool.query(
      `SELECT c.id,
              c.company_name AS "companyName",
              c.company_logo AS "companyLogo",
              c.did_slug AS "didSlug",
              c.customer_trust_level AS "customerTrustLevel",
              COALESCE(p.default_granularity, 'item') AS "dppGranularity",
              COALESCE(p.default_granularity, 'item') AS "defaultGranularity",
              COALESCE(p.jsonld_export_enabled, true) AS "jsonldExportEnabled",
              c.is_active AS "isActive"
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.did_slug = $1
       LIMIT 1`,
      [normalizedSlug]
    );
    return result.rows[0] ? mapCompanyRow(result.rows[0]) : null;
  }

  async function loadTypeDef(passportType) {
    const result = await pool.query(
      `SELECT "typeName" AS "typeName",
              "productCategory" AS "productCategory",
              "semanticModelKey" AS "semanticModelKey",
              "fieldsJson" AS "fieldsJson"
       FROM passport_types
       WHERE "typeName" = $1
       LIMIT 1`,
      [passportType]
    );
    return result.rows[0] ? mapPassportTypeRow(result.rows[0]) : null;
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
      publicUrl: buildPublicPassportUrl(passport, company?.companyName || ""),
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
      companyName: company?.companyName || "",
      granularity,
      passportType: getPassportType(passport, typeDef?.typeName || "passport"),
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
      companyName: company.companyName || "",
      companyLogo: company.companyLogo || null,
      didSlug: company.didSlug || null,
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
    const exported = buildSemanticPassportJsonExport([semanticSource], passportType, {
      semanticModelKey: typeDef?.semanticModelKey,
      productCategory: typeDef?.productCategory
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
        `SELECT "passportType"
         FROM passport_registry
         WHERE "dppId" = $1
         LIMIT 1`,
        [normalizedGuid]
      );
      if (!registryRes.rows.length) return null;

      const passportType = registryRes.rows[0].passportType;
      const tableName = getTable(passportType);
      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "dppId" = $1
           AND "deletedAt" IS NULL
           AND "releaseStatus" IN ('released', 'obsolete')
         ORDER BY "versionNumber" DESC, "updatedAt" DESC
         LIMIT 1`,
        [normalizedGuid]
      );
      if (liveRes.rows.length) {
        passport = { ...normalizePassportRow(liveRes.rows[0]), passportType };
      } else {
        const archiveRes = await pool.query(
          `SELECT pa."rowData",
                  phv."isPublic"
           FROM passport_archives pa
           LEFT JOIN passport_history_visibility phv
             ON phv."passportDppId" = pa."dppId"
            AND phv."versionNumber" = pa."versionNumber"
           WHERE pa."dppId" = $1
             AND pa."passportType" = $2
           ORDER BY pa."versionNumber" DESC, pa."archivedAt" DESC
           LIMIT 1`,
          [normalizedGuid, passportType]
        );
        if (archiveRes.rows.length) {
          const rowData = typeof archiveRes.rows[0].rowData === "string" ?
          JSON.parse(archiveRes.rows[0].rowData) :
          archiveRes.rows[0].rowData;
          if (isPublicVersionVisible(rowData?.releaseStatus, archiveRes.rows[0].isPublic)) {
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
      `SELECT ps."dataHash" AS "dataHash",
              ps.signature,
              ps.algorithm,
              ps."signingKeyId" AS "signingKeyId",
              ps."releasedAt" AS "signatureReleasedAt",
              ps."signedAt" AS "signedAt",
              ps."vcJson" AS "vcJson",
              rr."releasedByEmail" AS "releasedByEmail",
              rr."releasedAt" AS "releaseRecordReleasedAt",
              rr.companyname AS "companyName"
       FROM passport_signatures ps
       LEFT JOIN dpp_release_records rr
         ON rr."dppId" = ps."passportDppId"
        AND rr."releaseVersion" = ps."versionNumber"
       WHERE ps."passportDppId" = $1
         AND ps."versionNumber" = $2
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
    const dppUrl = buildPublicPassportUrl(sanitizedPassport, company?.companyName || "");
    const signatureUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}/signature.json`);
    const canonicalDppJsonUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}.json`);
    const verificationBundleUrl = didService.buildApiUrl(`/api/public/dpp/${passportDppId}/verification-bundle.json`);
    const didDocumentUrl = `https://${DID_DOMAIN}/.well-known/did.json`;
    const verificationStatus = resolveVerificationStatus(verifyResult);
    const dppDataUnchanged = verifyResult?.status === "valid";

    return {
      dppId: passportDppId,
      companyId: company?.id ?? getCompanyId(passport) ?? null,
      companyName: company?.companyName || signatureRow?.companyName || "",
      trustLevel: company?.customerTrustLevel || "BASIC",
      releasedBy: signatureRow?.releasedByEmail || null,
      releasedAt: signatureRow?.releaseRecordReleasedAt || verifyResult?.releasedAt || signatureRow?.signatureReleasedAt || null,
      dppHash: verifyResult?.dataHash || signatureRow?.dataHash || null,
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
      dppId: rawRow?.dppId || handover.passportDppId,
      guid: rawRow?.guid || rawRow?.dppId || handover.passportDppId,
      lineageId: rawRow?.lineageId || handover.lineageId || handover.passportDppId,
      companyId: rawRow?.companyId || handover.companyId,
      passportType: rawRow?.passportType || handover.passportType,
      internalAliasId: rawRow?.internalAliasId || handover.internalAliasId,
      versionNumber: rawRow?.versionNumber || handover.versionNumber,
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
      `SELECT "dppId", "companyId", "passportType", "lineageId"
       FROM passport_registry
       WHERE "lineageId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [lineageId]
    );
    if (!registryRes.rows.length) return null;

    const registryRow = registryRes.rows[0];
    const tableName = getTable(registryRow.passportType);
    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "lineageId" = $1
         AND "deletedAt" IS NULL
         AND "releaseStatus" IN ('released', 'obsolete')
       ORDER BY "versionNumber" DESC, "updatedAt" DESC
       LIMIT 1`,
      [lineageId]
    );

    let passport = null;
    if (liveRes.rows.length) {
      passport = { ...normalizePassportRow(liveRes.rows[0]), passportType: registryRow.passportType };
    } else {
      const archiveRes = await pool.query(
        `SELECT pa."rowData",
                phv."isPublic"
         FROM passport_archives pa
         LEFT JOIN passport_history_visibility phv
           ON phv."passportDppId" = pa."dppId"
          AND phv."versionNumber" = pa."versionNumber"
         WHERE pa."lineageId" = $1
           AND pa."passportType" = $2
         ORDER BY pa."versionNumber" DESC, pa."archivedAt" DESC
         LIMIT 1`,
        [lineageId, registryRow.passportType]
      );
      if (!archiveRes.rows.length) return null;
      const rowData = typeof archiveRes.rows[0].rowData === "string" ?
      JSON.parse(archiveRes.rows[0].rowData) :
      archiveRes.rows[0].rowData;
      if (!isPublicVersionVisible(rowData?.releaseStatus, archiveRes.rows[0].isPublic)) return null;
      passport = { ...normalizePassportRow(rowData), passportType: registryRow.passportType, archived: true };
    }

    const [typeDef, company] = await Promise.all([
    loadTypeDef(getPassportType(passport)),
    hydrateCompany(getCompanyId(passport))]
    );

    return { passport, typeDef, company };
  }

  function getFacilityFieldKeys(typeDef) {
    return (typeDef?.fieldsJson?.sections || []).
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
      `SELECT "typeName" AS "typeName",
              "semanticModelKey" AS "semanticModelKey",
              "fieldsJson" AS "fieldsJson"
       FROM passport_types
       ORDER BY "typeName" ASC`
    );

    for (const typeDef of passportTypes.rows) {
      const facilityFieldKeys = getFacilityFieldKeys(typeDef);
      if (!facilityFieldKeys.length) continue;

      const tableName = getTable(typeDef.typeName);
      const selectFields = facilityFieldKeys.join(", ");
      const candidateRes = await pool.query(
        `SELECT "dppId", "lineageId", "companyId", "modelName", "internalAliasId", "releaseStatus", "versionNumber", "updatedAt", "createdAt", ${selectFields}
         FROM ${tableName}
         WHERE "deletedAt" IS NULL
           AND "releaseStatus" IN ('released', 'obsolete')
           AND (${facilityFieldKeys.map((fieldKey) => `${fieldKey} IS NOT NULL`).join(" OR ")})
         ORDER BY "updatedAt" DESC
         LIMIT 250`
      );

      for (const row of candidateRes.rows) {
        const matchingKey = facilityFieldKeys.find((fieldKey) => {
          const rawValue = row[fieldKey];
          if (rawValue === null || rawValue === undefined || rawValue === "") return false;
          return didService.normalizeFacilityStableId(rawValue) === normalizedStableId;
        });

        if (!matchingKey) continue;

        const passport = { ...normalizePassportRow(row), passportType: typeDef.typeName };
        const company = await hydrateCompany(getCompanyId(passport));
        return { passport, typeDef, company, facilityFieldKey: matchingKey };
      }
    }

    return null;
  }

  async function loadPassportTypeSchema(passportType) {
    const result = await pool.query(
      `SELECT id,
              "typeName" AS "typeName",
              "displayName" AS "displayName",
              "productCategory" AS "productCategory",
              "productIcon" AS "productIcon",
              "semanticModelKey" AS "semanticModelKey",
              "fieldsJson" AS "fieldsJson"
       FROM passport_types
       WHERE "typeName" = $1`,
      [passportType]
    );
    const row = result.rows[0] ? mapPassportTypeRow(result.rows[0]) : null;
    if (!row) return null;
    const registeredSemanticModel = semanticModelRegistry?.getModel?.(row.semanticModelKey);
    const semanticModel = registeredSemanticModel && semanticModelRegistry?.summarizeModel
      ? semanticModelRegistry.summarizeModel(registeredSemanticModel)
      : null;
    return semanticModel ? { ...row, semanticModel } : row;
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
      const companyName = company?.companyName || "";
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
        const exported = buildSemanticPassportJsonExport([semanticPayload], getPassportType(passport), {
          semanticModelKey: typeDef?.semanticModelKey,
          productCategory: typeDef?.productCategory
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
          `SELECT "passportType"
           FROM passport_registry
           WHERE "dppId" = $1`,
          [dppId]
        );
        if (reg.rows.length) {
          const tableName = getTable(reg.rows[0].passportType);
          const liveVersion = await pool.query(
            `SELECT "versionNumber"
             FROM ${tableName}
             WHERE "dppId" = $1
               AND "releaseStatus" = 'released'
             ORDER BY "versionNumber" DESC
             LIMIT 1`,
            [dppId]
          );
          if (liveVersion.rows.length) {
            version = liveVersion.rows[0].versionNumber;
          } else {
            const archiveVersion = await pool.query(
              `SELECT "versionNumber"
               FROM passport_archives
               WHERE "dppId" = $1
                 AND "releaseStatus" = 'released'
               ORDER BY "versionNumber" DESC
               LIMIT 1`,
              [dppId]
            );
            version = archiveVersion.rows[0]?.versionNumber || 1;
          }
        }
        version = version || 1;
      }

      const verifyResult = await verifyPassportSignature(dppId, version);
      let credential = null;

      if (verifyResult.status !== "unsigned" && verifyResult.status !== "not_found") {
        const vcRow = await pool.query(
          `SELECT "vcJson"
           FROM passport_signatures
           WHERE "passportDppId" = $1
             AND "versionNumber" = $2`,
          [dppId, version]
        );
        if (vcRow.rows[0]?.vcJson) {
          credential = JSON.parse(vcRow.rows[0].vcJson);
        }
      }

      if (["invalid", "tampered", "key_missing"].includes(String(verifyResult.status || "")) && typeof logAudit === "function") {
        const registryRow = await pool.query(
          `SELECT "companyId"
           FROM passport_registry
           WHERE "dppId" = $1
           LIMIT 1`,
          [dppId]
        ).catch(() => ({ rows: [] }));
        const companyId = registryRow.rows[0]?.companyId || null;
        if (companyId) {
        await logAudit(
          companyId,
          null,
          "VERIFY_SIGNATURE_FAILURE",
          "passport_signatures",
          dppId,
          null,
          {
            versionNumber: version,
            verificationStatus: verifyResult.status,
            keyId: verifyResult.keyId || null,
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
      if (signatureRow?.vcJson) {
        try {
          credential = JSON.parse(signatureRow.vcJson);
        } catch {
          credential = null;
        }
      }

      return res.json({
        ...verifyResult,
        signature: signatureRow?.signature || null,
        algorithm: verifyResult?.algorithm || signatureRow?.algorithm || null,
        signingKeyId: signatureRow?.signingKeyId || verifyResult?.keyId || null,
        releasedBy: signatureRow?.releasedByEmail || null,
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
      const company = await hydrateCompanyBySlug(req.params.slug);
      if (!company?.isActive) return res.status(404).json({ error: "DID not found" });

      const did = didService.generateCompanyDid(company.didSlug);
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

  async function sendSubjectDidDocument({ res, passportType, level, stableId }) {
    const normalizedLevel = String(level || "").trim().toLowerCase();
    if (!["model", "batch", "item"].includes(normalizedLevel)) {
      return res.status(404).json({ error: "DID not found" });
    }
    const subjectNamespace = didService.normalizePassportTypeSegment(passportType || "passport");
    const loaded = await loadPublicPassportByLineage(stableId);
    if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
    const did = normalizedLevel === "model"
      ? didService.generateModelDid(subjectNamespace, loaded.passport.lineageId)
      : normalizedLevel === "batch"
        ? didService.generateBatchDid(subjectNamespace, loaded.passport.lineageId)
        : didService.generateItemDid(subjectNamespace, loaded.passport.lineageId);
    res.setHeader("Content-Type", "application/did+ld+json");
    return res.json(buildDidDocument({
      id: did,
      service: buildDidServiceEndpoints(loaded.passport, loaded.company?.companyName || "")
    }));
  }

  app.get("/did/dpp/:granularity/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      const granularity = didService.normalizeGranularity(req.params.granularity);
      const loaded = await loadPublicPassportByLineage(req.params.stableId);
      if (!loaded?.passport) return res.status(404).json({ error: "DID not found" });
      const did = didService.generateDppDid(granularity, loaded.passport.lineageId);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.companyName || "")
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
        service: buildDidServiceEndpoints(loaded.passport, loaded.company?.companyName || "")
      }));
    } catch {
      return res.status(400).json({ error: "Invalid DID path" });
    }
  });

  app.get("/did/:passportType/:level/:stableId/did.json", publicReadRateLimit, async (req, res) => {
    try {
      return sendSubjectDidDocument({
        res,
        passportType: req.params.passportType,
        level: req.params.level,
        stableId: req.params.stableId,
      });
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
        if (!company?.isActive) return res.status(404).json({ error: "DID not found" });
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
        const publicUrl = buildPublicPassportUrl(loaded.passport, loaded.company?.companyName || "");
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
        `SELECT "passportType", "accessKeyHash"
         FROM passport_registry
         WHERE "dppId" = $1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const suppliedHash = crypto.createHash("sha256").update(String(accessKey)).digest("hex");
      const storedHash = String(reg.rows[0].accessKeyHash || "");
      if (!storedHash) return res.status(401).json({ error: "Access key is not configured for this passport" });
      const keysMatch = storedHash.length === suppliedHash.length &&
      crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(suppliedHash, "hex"));
      if (!keysMatch) return res.status(401).json({ error: "Invalid access key" });

      const tableName = getTable(reg.rows[0].passportType);
      let row = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE "dppId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "versionNumber" DESC
         LIMIT 1`,
        [dppId]
      );

      if (!row.rows.length) {
        const archiveRes = await pool.query(
          `SELECT "rowData"
           FROM passport_archives
           WHERE "dppId" = $1
           ORDER BY "versionNumber" DESC
           LIMIT 1`,
          [dppId]
        );
        if (archiveRes.rows.length) {
          const rowData = typeof archiveRes.rows[0].rowData === "string" ?
          JSON.parse(archiveRes.rows[0].rowData) :
          archiveRes.rows[0].rowData;
          row = { rows: [rowData] };
        }
      }
      if (!row.rows.length) return res.status(404).json({ error: "Passport not found" });

      res.json({
        success: true,
          passport: {
            ...normalizePassportRow(row.rows[0]),
          passportType: reg.rows[0].passportType,
          archived: !!row.rows[0]?.archived
        }
      });
    } catch {
      res.status(500).json({ error: "Failed to unlock passport" });
    }
  });
};
