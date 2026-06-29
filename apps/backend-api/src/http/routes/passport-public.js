"use strict";

const logger = require("../../services/logger");
const { buildCanonicalIdentityBundle } = require("../../shared/identifiers/canonical-identity-bundle");
const { isPublicVersionVisible } = require("../../modules/public-passports/visibility");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../../shared/repository/repository-file-links");
const {
  mapCompanyRow,
  mapPassportTypeRow,
} = require("../../shared/passports/passport-helpers");
const { createApiKeyHelpers } = require("../../modules/passports/api-key-helpers");

module.exports = function registerPassportPublicRoutes(app, {
  pool,
  crypto,
  publicReadRateLimit,
  publicUnlockRateLimit,
  getTable,
  normalizePassportRow,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolvePublicPassportByDppId,
  buildPassportVersionHistory,
  verifyPassportSignature,
  logAudit,
  buildSemanticPassportJsonExport,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  backupProviderService,
  signingService,
  didService,
  productIdentifierService,
}) {
  const apiOrigin = didService.getApiOrigin();
  const didDomain = didService.getDidDomain();
  const platformDid = didService.getPlatformDid();
  const canonicalDppContextUrl = `https://${didDomain}/contexts/dpp/v1`;
  const {
    buildRestrictedUnlockPassportPayload,
    checkSecurityGroupApiKeyAccess,
    getSecurityGroupKeyFromRequest,
    resolveSecurityGroupApiKey,
  } = createApiKeyHelpers({ crypto });

  function securePublicRepositoryLinks(value, passportDppId) {
    return rewriteRepositoryLinksForSignedAccessDeep(value, {
      appBaseUrl: apiOrigin,
      passportDppId,
    });
  }

  const getPassportType = (passport, fallback = null) => passport?.passportType || fallback;
  const getCompanyId = (passport, fallback = null) => passport?.companyId ?? fallback;
  const getModelName = (passport, fallback = null) => passport?.modelName || fallback;
  const getVersionNumber = (passport, fallback = null) => passport?.versionNumber ?? fallback;
  const getReleaseStatus = (passport, fallback = null) => passport?.releaseStatus || fallback;

  const dppContextResponse = {
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
         WHERE "didSlug" = $1
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
              c."companyName" AS "companyName",
              c."companyLogo" AS "companyLogo",
              c."didSlug" AS "didSlug",
              c."customerTrustLevel" AS "customerTrustLevel",
              COALESCE(p."defaultGranularity", 'item') AS "dppGranularity",
              COALESCE(p."defaultGranularity", 'item') AS "defaultGranularity",
              COALESCE(p."jsonldExportEnabled", true) AS "jsonldExportEnabled",
              c."isActive" AS "isActive"
       FROM companies c
       LEFT JOIN "companyDppPolicies" p ON p."companyId" = c.id
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
         SET "didSlug" = $1,
             "updatedAt" = NOW()
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
              c."companyName" AS "companyName",
              c."companyLogo" AS "companyLogo",
              c."didSlug" AS "didSlug",
              c."customerTrustLevel" AS "customerTrustLevel",
              COALESCE(p."defaultGranularity", 'item') AS "dppGranularity",
              COALESCE(p."defaultGranularity", 'item') AS "defaultGranularity",
              COALESCE(p."jsonldExportEnabled", true) AS "jsonldExportEnabled",
              c."isActive" AS "isActive"
       FROM companies c
       LEFT JOIN "companyDppPolicies" p ON p."companyId" = c.id
       WHERE c."didSlug" = $1
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
       FROM "passportTypes"
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
      manufacturedBy: passport.manufacturedBy,
      modelName: getModelName(passport),
      dppId: passport.dppId,
      versionNumber: getVersionNumber(passport)
    }) :
    buildCurrentPublicPassportPath({
      companyName,
      manufacturerName: passport.manufacturer,
      manufacturedBy: passport.manufacturedBy,
      modelName: getModelName(passport),
      dppId: passport.dppId
    });
    return didService.buildPublicPassportUrl(path);
  }

  function buildDidServiceEndpoints(passport, companyName) {
    const publicUrl = buildPublicPassportUrl(passport, companyName);
    return [
    { id: "#passport", type: "DigitalProductPassport", serviceEndpoint: publicUrl },
    { id: "#canonical-json", type: "CanonicalJson", serviceEndpoint: didService.buildApiUrl(`/api/public/passports/${passport.dppId}`) },
    { id: "#jsonld", type: "JsonLd", serviceEndpoint: didService.buildApiUrl(`/api/public/passports/${passport.dppId}?format=semantic`) },
    { id: "#credential", type: "VerifiableCredential", serviceEndpoint: didService.buildApiUrl(`/api/public/passports/${passport.dppId}/signature`) }].
    filter((service) => Boolean(service.serviceEndpoint));
  }

  function buildVerificationMethod() {
    const signingKey = signingService.getSigningKey();
    if (!signingKey?.publicKey) return [];
    const publicKey = crypto.createPublicKey(signingKey.publicKey);
    const publicKeyJwk = publicKey.export({ format: "jwk" });
    return [{
      id: `${platformDid}#key-1`,
      type: "JsonWebKey2020",
      controller: platformDid,
      publicKeyJwk: { ...publicKeyJwk, kid: signingKey.keyId }
    }];
  }

  function buildDidDocument({ id, service = [] }) {
    return {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id,
      controller: platformDid,
      verificationMethod: buildVerificationMethod(),
      ...(service.length ? { service } : {})
    };
  }

  function buildResolutionPayload(did, passport, company, typeDef) {
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, {
      company,
      granularity: company?.defaultGranularity || passport.granularity || "model"
    });
    return {
      did,
      didDocument: didService.didToDocumentUrl(did),
      type: "DigitalProductPassport",
      publicUrl: buildPublicPassportUrl(passport, company?.companyName || ""),
      canonicalJson: didService.buildApiUrl(`/api/public/passports/${passport.dppId}`),
      jsonLd: didService.buildApiUrl(`/api/public/passports/${passport.dppId}?format=semantic`),
      verification: didService.buildApiUrl(`/api/public/passports/${passport.dppId}/signature`),
      subjectDid: canonicalPayload.subjectDid,
      dppDid: canonicalPayload.dppDid,
      companyDid: canonicalPayload.companyDid
    };
  }

  function buildRequestedPassportPayload(req, passport, typeDef, company) {
    const granularity = company?.defaultGranularity || passport?.granularity || "model";
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

  function buildPublicPassportEnvelope(passport, typeDef) {
    const publicFields = {};
    for (const section of typeDef?.fieldsJson?.sections || []) {
      for (const field of section.fields || []) {
        if (!field?.key || !Object.prototype.hasOwnProperty.call(passport || {}, field.key)) continue;
        publicFields[field.key] = passport[field.key];
      }
    }

    const metadata = {
      dppId: passport?.dppId || null,
      passportType: getPassportType(passport, typeDef?.typeName),
      versionNumber: getVersionNumber(passport),
      releaseStatus: getReleaseStatus(passport),
      archived: Boolean(passport?.archived),
      modelName: getModelName(passport),
      granularity: passport?.granularity || null,
      manufacturer: passport?.manufacturer || null,
      manufacturedBy: passport?.manufacturedBy || null,
      createdAt: passport?.createdAt || null,
      updatedAt: passport?.updatedAt || null,
      releasedAt: passport?.releasedAt || null,
      carrierAuthenticity: passport?.carrierAuthenticity || null,
    };

    return {
      ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null)),
      ...publicFields,
    };
  }

  function scrubInternalPublicIdentifiers(value) {
    if (Array.isArray(value)) return value.map(scrubInternalPublicIdentifiers);
    if (!value || typeof value !== "object") return value;
    const scrubbed = {};
    for (const [key, childValue] of Object.entries(value)) {
      if (
        key === "internalAliasId"
        || key === "internalAliasIds"
        || key === "companyId"
        || key === "dataCarrierVerificationEvidence"
      ) continue;
      if (key === "signedCarrierPayload" && childValue && typeof childValue === "object") {
        const { credential: _credential, ...verificationMetadata } = childValue;
        scrubbed[key] = scrubInternalPublicIdentifiers(verificationMetadata);
        continue;
      }
      scrubbed[key] = scrubInternalPublicIdentifiers(childValue);
    }
    return scrubbed;
  }

  function buildPublicCompanyProfile(company) {
    if (!company) return null;
    return {
      companyName: company.companyName || "",
      companyLogo: company.companyLogo || null,
      didSlug: company.didSlug || null,
    };
  }

  function buildPublicCompanyProfilePath(company) {
    const slug = company?.didSlug || didService.normalizeCompanySlug(company?.companyName || "");
    return slug ? `/api/public/companies/${encodeURIComponent(slug)}/profile` : null;
  }

  function scrubPublicSchemaMetadata(value) {
    if (Array.isArray(value)) return value.map(scrubPublicSchemaMetadata);
    if (!value || typeof value !== "object") return value;
    const omittedKeys = new Set([
      "canonicalLocked",
      "elementIdPath",
      "objectType",
      "semanticId",
      "sourceModule",
      "sourceModuleColumnKey",
      "sourceModuleFieldKey",
      "sourceModuleKey",
      "valueDataType",
    ]);
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (omittedKeys.has(key)) continue;
      if (key === "confidentiality") {
        result[key] = String(child || "").toLowerCase() === "public" ? "public" : "restricted";
        continue;
      }
      result[key] = scrubPublicSchemaMetadata(child);
    }
    return result;
  }

  function buildViewerSafeTypeDef(typeDef) {
    if (!typeDef) return null;
    const fieldsJson = scrubPublicSchemaMetadata(typeDef.fieldsJson || {});
    fieldsJson.sections = (fieldsJson.sections || []).map((section) => ({
      ...section,
      fields: (section.fields || []).map((field) => ({
        ...field,
        confidentiality: String(field?.confidentiality || "").trim().toLowerCase() === "public"
          ? "public"
          : "restricted",
      })),
    }));
    return {
      typeName: typeDef.typeName || null,
      displayName: typeDef.displayName || typeDef.typeName || null,
      productCategory: typeDef.productCategory || null,
      productIcon: typeDef.productIcon || null,
      fieldsJson,
    };
  }

  function securityGroupReadLimiter(req, res, next) {
    if (!getSecurityGroupKeyFromRequest(req)) return next();
    return publicUnlockRateLimit(req, res, next);
  }

  function pickUnlockedRestrictedFields(unlockedPassport, unlockedFieldKeys = []) {
    const selected = {};
    for (const fieldKey of unlockedFieldKeys) {
      if (!Object.prototype.hasOwnProperty.call(unlockedPassport || {}, fieldKey)) continue;
      selected[fieldKey] = unlockedPassport[fieldKey];
    }
    return selected;
  }

  function mergeRestrictedFieldsIntoPublicPayload(payload, restrictedAccessPayload) {
    if (!restrictedAccessPayload?.passport) return payload;
    const selectedFields = pickUnlockedRestrictedFields(
      restrictedAccessPayload.passport,
      restrictedAccessPayload.unlockedFieldKeys
    );
    return {
      ...payload,
      ...selectedFields,
      fields: {
        ...(payload.fields || {}),
        ...selectedFields,
      },
      restrictedAccess: {
        unlocked: true,
        fieldKeys: restrictedAccessPayload.unlockedFieldKeys,
        securityGroup: restrictedAccessPayload.securityGroup,
      },
    };
  }

  async function buildRestrictedAccessPayloadForRequest(req, passport, typeDef, requestedVersion) {
    const rawApiKey = getSecurityGroupKeyFromRequest(req);
    if (!rawApiKey) return null;

    const matchedKey = await resolveSecurityGroupApiKey(pool, rawApiKey);
    const accessDecision = checkSecurityGroupApiKeyAccess(matchedKey, {
      dppId: passport.dppId,
      companyId: getCompanyId(passport),
      passportType: getPassportType(passport, typeDef?.typeName),
    });
    if (!accessDecision.allowed) {
      const error = new Error(accessDecision.error || "API key is not valid for this passport");
      error.statusCode = accessDecision.statusCode || 403;
      throw error;
    }

    const normalizedPassport = {
      ...normalizePassportRow(passport, typeDef),
      passportType: getPassportType(passport, typeDef?.typeName),
      companyId: getCompanyId(passport),
      archived: !!passport?.archived,
    };
    const unlockPayload = await buildRestrictedUnlockPassportPayload({
      pool,
      passport: normalizedPassport,
      typeDef,
      apiKey: matchedKey,
      includeDynamicLatest: requestedVersion === null && !normalizedPassport.archived,
      normalizePassportRow: (passportRow) => passportRow,
    });
    pool.query('UPDATE "apiKeys" SET "lastUsedAt" = NOW() WHERE id = $1', [matchedKey.id]).catch((error) => {
      logger.warn({ err: error, apiKeyId: matchedKey.id }, "Failed to update security group API key last used timestamp");
    });

    return {
      passport: unlockPayload.passport,
      unlockedFieldKeys: unlockPayload.unlockedFieldKeys,
      securityGroup: {
        name: matchedKey.name || null,
        scopeType: matchedKey.scopeType || "passportType",
      },
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
      productCategory: typeDef?.productCategory,
      typeDef
    });
    const graphItem = { ...(exported?.["@graph"]?.[0] || semanticSource) };
    delete graphItem.passportType;
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

    pushContext(canonicalDppContextUrl);
    exportedContexts.forEach(pushContext);

    res.setHeader("Content-Type", "application/ld+json");
    return res.json({
      "@context": semanticContexts,
      ...graphItem
    });
  }

  function ensureJsonLdExportEnabled(company) {
    return company?.jsonldExportEnabled !== false;
  }

  function resolveVerificationStatus(verifyResult) {
    const status = String(verifyResult?.status || "").toLowerCase();
    if (status === "valid") return "signedByPlatform";
    if (status === "tampered") return "tampered";
    if (status === "unsigned") return "unsigned";
    if (status === "keymissing") return "signingKeyMissing";
    return "verificationFailed";
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
         FROM "passportRegistry"
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
           FROM "passportArchives" pa
           LEFT JOIN "passportHistoryVisibility" phv
             ON phv."passportDppId" = pa."dppId"
            AND phv."versionNumber" = pa."versionNumber"
           WHERE pa."dppId" = $1
             AND pa."passportType" = $2
             AND pa."releaseStatus" IN ('released', 'obsolete')
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

    const passportDppId = loaded.passport.dppId || loaded.passport.guid || dppId;
    const sanitizedPassport = securePublicRepositoryLinks(
      await stripRestrictedFieldsForPublicView(loaded.passport, getPassportType(loaded.passport)),
      passportDppId
    );
    const resolvedVersion = versionNumber || getVersionNumber(sanitizedPassport) || getVersionNumber(loaded.passport) || 1;
    const verifyResult = await verifyPassportSignature(passportDppId, resolvedVersion);
    const signatureRecord = await pool.query(
      `SELECT ps."dataHash" AS "dataHash",
              ps.signature,
              ps.algorithm,
              ps."signingKeyId" AS "signingKeyId",
              ps."releasedAt" AS "signatureReleasedAt",
              ps."signedAt" AS "signedAt",
              rr."releasedAt" AS "releaseRecordReleasedAt",
              rr.companyname AS "companyName"
       FROM "passportSignatures" ps
       LEFT JOIN "dppReleaseRecords" rr
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
    const passportDppId = passport.dppId || passport.guid || null;
    const dppUrl = buildPublicPassportUrl(sanitizedPassport, company?.companyName || "");
    const signatureUrl = didService.buildApiUrl(`/api/public/passports/${passportDppId}/signature`);
    const canonicalDppJsonUrl = didService.buildApiUrl(`/api/public/passports/${passportDppId}`);
    const verificationBundleUrl = didService.buildApiUrl(`/api/public/passports/${passportDppId}/verification-bundle`);
    const didDocumentUrl = `https://${didDomain}/.well-known/did.json`;
    const verificationStatus = resolveVerificationStatus(verifyResult);
    const dppDataUnchanged = verifyResult?.status === "valid";

    return {
      dppId: passportDppId,
      companyName: company?.companyName || signatureRow?.companyName || "",
      trustLevel: company?.customerTrustLevel || "basic",
      releasedAt: signatureRow?.releaseRecordReleasedAt || verifyResult?.releasedAt || signatureRow?.signatureReleasedAt || null,
      dppHash: verifyResult?.dataHash || signatureRow?.dataHash || null,
      signature: signatureRow?.signature || null,
      algorithm: verifyResult?.algorithm || signatureRow?.algorithm || "ES256",
      signedBy: platformDid,
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
    versionNumber = null
  }) {
    if (!backupProviderService?.getActivePublicHandover) return null;

    let handover = await backupProviderService.getActivePublicHandover({
      passportDppId,
      versionNumber,
    });
    if (!handover && backupProviderService?.ensureAutomaticPublicHandover) {
      handover = await backupProviderService.ensureAutomaticPublicHandover({
        passportDppId,
        versionNumber,
      });
    }
    if (!handover) return null;

    const rawRow = typeof handover.publicRowData === "string" ?
    JSON.parse(handover.publicRowData) :
    handover.publicRowData;

    const passport = {
      ...normalizePassportRow(rawRow || {}),
      dppId: rawRow?.dppId || handover.passportDppId,
      guid: rawRow?.guid || rawRow?.dppId || handover.passportDppId,
      lineageId: rawRow?.lineageId || handover.lineageId || handover.passportDppId,
      companyId: rawRow?.companyId || handover.companyId,
      passportType: rawRow?.passportType || handover.passportType,
      versionNumber: rawRow?.versionNumber || handover.versionNumber,
      backupPublicHandover: true,
      backupHandoverSource: {
        providerKey: handover.backupProviderKey || null,
        sourceReplicationId: handover.sourceReplicationId || null,
        verificationStatus: handover.verificationStatus || null,
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
       FROM "passportRegistry"
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
         FROM "passportArchives" pa
         LEFT JOIN "passportHistoryVisibility" phv
           ON phv."passportDppId" = pa."dppId"
          AND phv."versionNumber" = pa."versionNumber"
         WHERE pa."lineageId" = $1
           AND pa."passportType" = $2
           AND pa."releaseStatus" IN ('released', 'obsolete')
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
    filter((field) =>
      field?.key
      && isSafeDbFieldKey(field.key)
      && String(field.confidentiality || "").trim().toLowerCase() === "public"
    ).
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
       FROM "passportTypes"
       ORDER BY "typeName" ASC`
    );

    for (const typeDef of passportTypes.rows) {
      const facilityFieldKeys = getFacilityFieldKeys(typeDef);
      if (!facilityFieldKeys.length) continue;

      const tableName = getTable(typeDef.typeName);
      const selectFields = facilityFieldKeys.map((fieldKey) => `"${fieldKey}"`).join(", ");
      const candidateRes = await pool.query(
        `SELECT "dppId", "lineageId", "companyId", "modelName", "releaseStatus", "versionNumber", "updatedAt", "createdAt", ${selectFields}
         FROM ${tableName}
         WHERE "deletedAt" IS NULL
           AND "releaseStatus" IN ('released', 'obsolete')
           AND (${facilityFieldKeys.map((fieldKey) => `"${fieldKey}" IS NOT NULL`).join(" OR ")})
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

  // ─── BY GUID (public, canonical JSON by default) ────────────────────────

  async function handleCanonicalPassportRequest(req, res) {
    try {
      const versionNumber = req.query.version ? Number.parseInt(req.query.version, 10) : null;
      if (req.query.version && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
        return res.status(400).json({ error: "version must be a positive integer" });
      }
      const loaded = await loadPublicPassportByGuid(req.params.dppId, { versionNumber });
      if (!loaded?.passport) return res.status(404).json({ error: "Passport not found" });

      const sanitizedPassport = await stripRestrictedFieldsForPublicView(
        loaded.passport,
        getPassportType(loaded.passport)
      );
      const restrictedAccessPayload = await buildRestrictedAccessPayloadForRequest(
        req,
        loaded.passport,
        loaded.typeDef,
        versionNumber
      );
      const securedRestrictedAccessPayload = restrictedAccessPayload
        ? {
            ...restrictedAccessPayload,
            passport: securePublicRepositoryLinks(
              restrictedAccessPayload.passport,
              loaded.passport.dppId
            ),
          }
        : null;
      const selectedRestrictedFields = pickUnlockedRestrictedFields(
        securedRestrictedAccessPayload?.passport,
        securedRestrictedAccessPayload?.unlockedFieldKeys || []
      );
      const responsePassport = securePublicRepositoryLinks({
        ...sanitizedPassport,
        ...selectedRestrictedFields,
      }, loaded.passport.dppId);
      const companyName = loaded.company?.companyName || "";
      const publicPath = buildCurrentPublicPassportPath({
        companyName,
        manufacturerName: responsePassport.manufacturer,
        manufacturedBy: responsePassport.manufacturedBy,
        modelName: getModelName(responsePassport),
        dppId: responsePassport.dppId
      });
      let canonicalPayload = {
        ...buildPublicPassportEnvelope(responsePassport, loaded.typeDef),
        ...buildRequestedPassportPayload(req, responsePassport, loaded.typeDef, loaded.company),
        viewerSchema: buildViewerSafeTypeDef(loaded.typeDef),
        companyProfile: buildPublicCompanyProfile(loaded.company),
        publicPath,
        inactivePath: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: responsePassport.manufacturer,
          manufacturedBy: responsePassport.manufacturedBy,
          modelName: getModelName(responsePassport),
          dppId: responsePassport.dppId,
          versionNumber: getVersionNumber(responsePassport)
        }),
        inactivePublicVersion: versionNumber !== null && Number(versionNumber) === Number(getVersionNumber(responsePassport)),
        linkedData: {
          publicUrl: didService.buildPublicPassportUrl(publicPath),
          canonicalJsonUrl: didService.buildApiUrl(`/api/public/passports/${responsePassport.dppId}`),
          publicSourceMode: responsePassport.backupPublicHandover ? "backupHandover" : "economicOperator",
        }
      };

      canonicalPayload = scrubInternalPublicIdentifiers(
        mergeRestrictedFieldsIntoPublicPayload(canonicalPayload, securedRestrictedAccessPayload)
      );

      if (wantsSemanticResponse(req)) {
        if (!ensureJsonLdExportEnabled(loaded.company)) {
          return res.status(403).json({ error: "JSON-LD export is disabled for this company." });
        }
        const semanticPayload = { ...canonicalPayload };
        delete semanticPayload.companyProfile;
        delete semanticPayload.linkedData;
        delete semanticPayload.viewerSchema;
        delete semanticPayload.restrictedAccess;
        return sendSemanticPassport(res, semanticPayload, getPassportType(responsePassport), loaded.typeDef);
      }

      return res.json(canonicalPayload);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      logger.error({ err: error }, "Public passport fetch error");
      return res.status(500).json({ error: "Failed to fetch passport" });
    }
  }

  app.get("/api/public/passports/:dppId", publicReadRateLimit, securityGroupReadLimiter, handleCanonicalPassportRequest);

  app.get("/api/public/passports/:dppId/history", publicReadRateLimit, securityGroupReadLimiter, async (req, res) => {
    try {
      const loaded = await loadPublicPassportByGuid(req.params.dppId);
      if (!loaded?.passport) return res.status(404).json({ error: "Passport not found" });

      let allowedRestrictedFieldKeys = [];
      let allowedRestrictedPassportDppIds = [];
      const rawApiKey = getSecurityGroupKeyFromRequest(req);
      if (rawApiKey) {
        const matchedKey = await resolveSecurityGroupApiKey(pool, rawApiKey);
        const accessDecision = checkSecurityGroupApiKeyAccess(matchedKey, {
          dppId: loaded.passport.dppId,
          companyId: getCompanyId(loaded.passport),
          passportType: getPassportType(loaded.passport, loaded.typeDef?.typeName),
        });
        if (!accessDecision.allowed) {
          return res.status(accessDecision.statusCode).json({ error: accessDecision.error });
        }
        allowedRestrictedFieldKeys = Array.isArray(matchedKey.fieldKeys) ? matchedKey.fieldKeys : [];
        allowedRestrictedPassportDppIds = matchedKey.scopeType === "passports"
          ? (Array.isArray(matchedKey.passportDppIds) ? matchedKey.passportDppIds : [])
          : null;
        pool.query('UPDATE "apiKeys" SET "lastUsedAt" = NOW() WHERE id = $1', [matchedKey.id]).catch((error) => {
          logger.warn({ err: error, apiKeyId: matchedKey.id }, "Failed to update security group API key last used timestamp");
        });
      }

      const historyPayload = await buildPassportVersionHistory({
        dppId: req.params.dppId,
        passportType: getPassportType(loaded.passport),
        publicOnly: true,
        allowedRestrictedFieldKeys,
        allowedRestrictedPassportDppIds,
      });

      res.json(historyPayload);
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to fetch passport history",
      });
    }
  });

  // ─── SIGNATURE (public verification) ───────────────────────────────────

  app.get("/api/public/passports/:dppId/signature", publicReadRateLimit, async (req, res) => {
    try {
      const requestedVersion = req.query.version ? parseInt(req.query.version, 10) : null;
      if (requestedVersion !== null && (!Number.isInteger(requestedVersion) || requestedVersion < 1)) {
        return res.status(400).json({ error: "version must be a positive integer" });
      }
      const verificationContext = await loadPublicVerificationContext(req.params.dppId, {
        versionNumber: requestedVersion,
      });
      if (!verificationContext?.passport) return res.status(404).json({ error: "Passport not found" });

      const { verifyResult } = verificationContext;
      if (["invalid", "tampered", "keyMissing"].includes(String(verifyResult.status || "")) && typeof logAudit === "function") {
        const companyId = getCompanyId(verificationContext.passport);
        if (companyId) {
          await logAudit(
            companyId,
            null,
            "verifySignatureFailure",
            "passportSignatures",
            req.params.dppId,
            null,
            {
              versionNumber: verificationContext.passport.versionNumber || requestedVersion,
              verificationStatus: verifyResult.status,
              keyId: verifyResult.keyId || null,
              algorithm: verifyResult.algorithm || null
            },
            {
              actorIdentifier: "public:signature-verifier",
              audience: "public",
            }
          ).catch((error) => {
            logger.warn(
              { err: error, dppId: req.params.dppId, versionNumber: requestedVersion },
              "Failed to record public signature verification audit"
            );
          });
        }
      }

      res.json(verifyResult);
    } catch (error) {
      logger.error("Signature verify error:", error.message);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.get("/api/public/passports/:dppId/verification-bundle", publicReadRateLimit, async (req, res) => {
    try {
      const requestedVersion = req.query.version ? Number.parseInt(req.query.version, 10) : null;
      if (requestedVersion !== null && (!Number.isInteger(requestedVersion) || requestedVersion < 1)) {
        return res.status(400).json({ error: "version must be a positive integer" });
      }
      const verificationContext = await loadPublicVerificationContext(req.params.dppId, {
        versionNumber: requestedVersion,
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

  app.get("/api/public/signing-key", publicReadRateLimit, async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT "keyId", "publicKey", algorithm, "algorithmVersion", "createdAt"
         FROM "passportSigningKeys"
         ORDER BY "createdAt" DESC
         LIMIT 1`
      );
      if (!result.rows.length) return res.status(404).json({ error: "No signing key found" });
      const historicalKeys = await pool.query(
        `SELECT "keyId", algorithm, "algorithmVersion", "createdAt"
         FROM "passportSigningKeys"
         ORDER BY "createdAt" DESC`
      );
      const trustMetadata = typeof signingService?.getSigningTrustMetadata === "function" ?
      signingService.getSigningTrustMetadata() :
      { issuerDid: platformDid };
      res.json({
        ...result.rows[0],
        issuerDid: trustMetadata.issuerDid || platformDid,
        trustMetadata,
        historicalKeys: historicalKeys.rows.map((row) => ({
          keyId: row.keyId,
          algorithm: row.algorithmVersion || row.algorithm || null,
          createdAt: row.createdAt
        })),
        verification: {
          verificationMethod: "JsonWebSignature2020 detached JWS proof",
          verificationEndpoint: `${apiOrigin}/api/public/passports/{dppId}/signature`,
          didDocument: `https://${didDomain}/.well-known/did.json`,
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
      return res.json(buildDidDocument({ id: platformDid }));
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
      const profilePath = buildPublicCompanyProfilePath(company);
      res.setHeader("Content-Type", "application/did+ld+json");
      return res.json(buildDidDocument({
        id: did,
        service: profilePath
          ? [{ id: "#profile", type: "CompanyProfile", serviceEndpoint: didService.buildApiUrl(profilePath) }]
          : []

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
      if (!did.startsWith(`${platformDid}`)) {
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
        const profilePath = buildPublicCompanyProfilePath(company);
        const publicUrl = profilePath ? didService.buildApiUrl(profilePath) : didService.didToDocumentUrl(did);
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
          canonicalJson: didService.buildApiUrl(`/api/public/passports/${loaded.passport.dppId}`),
          jsonLd: didService.buildApiUrl(`/api/public/passports/${loaded.passport.dppId}?format=semantic`),
          verification: didService.buildApiUrl(`/api/public/passports/${loaded.passport.dppId}/signature`)
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
    res.json(dppContextResponse);
  });

  app.get("/api/public/companies/:companySlug/profile", publicReadRateLimit, async (req, res) => {
    try {
      const company = await hydrateCompanyBySlug(req.params.companySlug);
      if (!company?.isActive) return res.status(404).json({ error: "Company not found" });
      return res.json(buildPublicCompanyProfile(company));
    } catch {
      return res.status(400).json({ error: "Invalid company profile path" });
    }
  });

};
