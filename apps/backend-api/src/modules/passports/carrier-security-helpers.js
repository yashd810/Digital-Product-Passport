function createCarrierSecurityHelpers({
  pool,
  logger,
  normalizeReleaseStatus,
  buildCurrentPublicPassportPath,
  buildPreviewPassportPath,
  signPortableDataConstruct,
}) {
  function buildCarrierAuthenticityStorageValue(value) {
    return value ? JSON.stringify(value) : null;
  }

  function buildPublicAccessUrl(pathname) {
    if (!pathname) return null;
    const origin = process.env.PUBLIC_ORIGIN || process.env.APP_URL || "http://localhost:3001";
    try {
      return new URL(pathname, origin).toString();
    } catch {
      return pathname;
    }
  }

  function buildPassportCarrierPublicPath(passport, companyName = "") {
    if (!passport) return null;

    if (normalizeReleaseStatus(passport.releaseStatus) === "released") {
      return buildCurrentPublicPassportPath({
        companyName,
        modelName: passport.modelName,
        dppId: passport.dppId,
        internalAliasId: passport.internalAliasId,
      });
    }

    return buildPreviewPassportPath({
      companyName,
      modelName: passport.modelName,
      internalAliasId: passport.internalAliasId,
      previewDppId: passport.dppId,
    });
  }

  function getTrustedViewerOrigin() {
    return process.env.PUBLIC_APP_URL || process.env.PUBLIC_VIEWER_URL || process.env.APP_URL || "http://localhost:3000";
  }

  function getTrustedViewerHost() {
    try {
      return new URL(getTrustedViewerOrigin()).host;
    } catch {
      return "";
    }
  }

  function parseUrlHost(value) {
    try {
      return new URL(String(value || "")).host || "";
    } catch {
      return "";
    }
  }

  async function recordPassportSecurityEvent({
    dppId,
    companyId = null,
    eventType,
    severity = "info",
    source = "system",
    details = {},
  }) {
    if (!dppId || !eventType) return;
    await pool.query(
      `INSERT INTO "passportSecurityEvents"
         ("passportDppId", "companyId", "eventType", severity, source, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [dppId, companyId, eventType, severity, source, JSON.stringify(details || {})]
    ).catch((error) => {
      logger?.warn?.({ err: error, dppId, companyId, eventType }, "Failed to record passport security event");
    });
  }

  function normalizeEvidenceItems(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        return Object.fromEntries(
          Object.entries(item)
            .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== "")
            .map(([key, entryValue]) => [key, typeof entryValue === "string" ? entryValue.trim().slice(0, 1000) : entryValue])
        );
      })
      .filter((item) => item && Object.keys(item).length);
  }

  function buildDataCarrierVerificationRecord(source = {}, actor = {}) {
    const verifiedAt = source.verifiedAt || new Date().toISOString();
    return {
      evidenceType: "physicalDataCarrierVerification",
      verifiedAt,
      recordedAt: new Date().toISOString(),
      recordedBy: actor.userId || null,
      printGrade: String(source.printGrade || "").trim().slice(0, 32) || null,
      gradingStandard: String(source.gradingStandard || "ISO/IEC 15415 or ISO/IEC 15416").trim().slice(0, 160),
      verifierDevice: String(source.verifierDevice || "").trim().slice(0, 160) || null,
      verifierSerialNumber: String(source.verifierSerialNumber || "").trim().slice(0, 160) || null,
      labelSpecificationId: String(source.labelSpecificationId || "").trim().slice(0, 160) || null,
      hriPlacement: String(source.hriPlacement || "").trim().slice(0, 80) || null,
      scannerTests: normalizeEvidenceItems(source.scannerTests),
      durabilityTests: normalizeEvidenceItems(source.durabilityTests),
      placementChecks: normalizeEvidenceItems(source.placementChecks),
      evidenceUris: (Array.isArray(source.evidenceUris) ? source.evidenceUris : [source.evidenceUri])
        .map((uri) => String(uri || "").trim().slice(0, 2000))
        .filter(Boolean),
      notes: String(source.notes || "").trim().slice(0, 2000) || null,
    };
  }

  async function maybeSignCarrierPayload({
    passport,
    companyName = "",
    metadata,
    forceSign = false,
  }) {
    if (!metadata) return metadata;
    const enrichedMetadata = {
      ...metadata,
      trustedViewerOrigin: metadata.trustedViewerOrigin || getTrustedViewerOrigin(),
      trustedViewerHost: metadata.trustedViewerHost || getTrustedViewerHost(),
      counterfeitRiskLevel: metadata.counterfeitRiskLevel || (String(passport?.granularity || "item").toLowerCase() === "item" ? "high" : "medium"),
      antiCounterfeitInstructions: metadata.antiCounterfeitInstructions || [
        "Only trust the QR code when it opens on the verified DPP viewer domain.",
        "Do not enter passwords or payment details on a public DPP page.",
        "Use the signature or certificate details to verify protected carriers when available.",
      ],
    };
    if (!forceSign && enrichedMetadata.signedCarrierPayload) return enrichedMetadata;
    if (typeof signPortableDataConstruct !== "function") return enrichedMetadata;

    const publicPath = buildPassportCarrierPublicPath(passport, companyName);
    const publicAccessUrl = buildPublicAccessUrl(publicPath);
    const dppId = passport?.dppId || null;
    const internalAliasId = passport?.internalAliasId || null;
    const storedProductIdentifier = passport?.productIdentifierDid || passport?.uniqueProductIdentifier || null;
    const uniqueProductIdentifier = storedProductIdentifier
      && String(storedProductIdentifier) !== String(internalAliasId || "")
      ? storedProductIdentifier
      : null;
    const credential = await signPortableDataConstruct({
      type: "DataCarrierBindingCredential",
      id: `${publicAccessUrl || `urn:dpp:${dppId || "unknown"}`}#carrier-binding`,
      subjectId: `${publicAccessUrl || `urn:dpp:${dppId || "unknown"}`}#carrier`,
      payload: {
        digitalProductPassportId: dppId,
        uniqueProductIdentifier,
        publicAccessUrl,
        carrierSecurityStatus: metadata.carrierSecurityStatus || null,
        carrierAuthenticationMethod: metadata.carrierAuthenticationMethod || null,
        carrierVerificationInstructions: metadata.carrierVerificationInstructions || null,
        carrierCompatibilityProfiles: enrichedMetadata.carrierCompatibilityProfiles || [],
        physicalCarrierSecurityFeatures: enrichedMetadata.physicalCarrierSecurityFeatures || [],
      },
      contexts: ["https://api.claros-dpp.online/contexts/dpp/v1"],
    });

    if (!credential) return enrichedMetadata;

    return {
      ...enrichedMetadata,
      issuerCertificateId: enrichedMetadata.issuerCertificateId || credential.trustMetadata?.issuerCertificateId || null,
      signedCarrierPayload: {
        format: "platformDppCarrierBindingV1",
        dataHash: credential.dataHash,
        keyId: credential.keyId,
        signatureAlgorithm: credential.signatureAlgorithm,
        signedAt: credential.signedAt,
        credential: credential.document,
      },
    };
  }

  return {
    buildCarrierAuthenticityStorageValue,
    buildDataCarrierVerificationRecord,
    getTrustedViewerHost,
    maybeSignCarrierPayload,
    parseUrlHost,
    recordPassportSecurityEvent,
  };
}

module.exports = {
  createCarrierSecurityHelpers,
};
