"use strict";

function createProductIdentifierService({ didService, pool = null }) {
  function normalizeRawProductId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isDidIdentifier(value) {
    return typeof value === "string" && value.trim().startsWith("did:");
  }

  function isGeneratedLocalPassportId(value) {
    return typeof value === "string" && value.trim().toLowerCase().startsWith("dpp_");
  }

  function getBusinessIdentifierField(typeDef = null) {
    const fieldsJson = typeDef?.fieldsJson || typeDef?.fields_json || typeDef || {};
    return normalizeRawProductId(fieldsJson?.identity?.businessIdentifierField || "");
  }

  function extractBusinessProductIdentifier(source = {}, typeDef = null) {
    const fieldKey = getBusinessIdentifierField(typeDef);
    if (!fieldKey || !source || typeof source !== "object") return "";
    return normalizeRawProductId(source[fieldKey]);
  }

  function buildStableProductId({ rawProductId }) {
    const normalized = normalizeRawProductId(rawProductId);
    if (!normalized) return "";
    return didService.normalizeStableId(normalized);
  }

  function normalizeGranularity(granularity) {
    const value = String(granularity || "").trim().toLowerCase();
    if (value === "model") return "model";
    if (value === "batch") return "batch";
    return "item";
  }

  function buildCanonicalProductDid({
    companyId,
    companySlug = null,
    companyName = null,
    passportType = "passport",
    rawProductId,
    granularity = "item",
  }) {
    const normalized = normalizeRawProductId(rawProductId);
    if (!normalized) return "";
    if (isDidIdentifier(normalized)) return normalized;

    const stableId = buildStableProductId({ rawProductId: normalized });
    const namespaceSegment = companySlug
      ? didService.normalizePassportTypeSegment(companySlug)
      : companyName
        ? didService.normalizePassportTypeSegment(companyName)
        : didService.normalizePassportTypeSegment(passportType || "passport");
    const normalizedGranularity = normalizeGranularity(granularity);

    if (normalizedGranularity === "model") {
      return didService.generateModelDid(namespaceSegment, stableId);
    }
    if (normalizedGranularity === "batch") {
      return didService.generateBatchDid(namespaceSegment, stableId);
    }
    return didService.generateItemDid(namespaceSegment, stableId);
  }

  function normalizeProductIdentifiers({
    companyId,
    companySlug = null,
    companyName = null,
    passportType = "passport",
    rawProductId,
    canonicalProductIdSource = null,
    uniqueProductIdentifier = null,
    granularity = "item",
  }) {
    const internalAliasIdInput = normalizeRawProductId(rawProductId);
    const explicitUniqueIdentifier = normalizeRawProductId(uniqueProductIdentifier);
    const canonicalSource = normalizeRawProductId(canonicalProductIdSource);
    const productIdentifierDid = explicitUniqueIdentifier
      ? explicitUniqueIdentifier
      : (canonicalSource
          ? buildCanonicalProductDid({
              companyId,
              companySlug,
              companyName,
              passportType,
              rawProductId: canonicalSource,
              granularity,
            }) || null
          : null);

    return {
      internalAliasIdInput,
      productIdentifierDid,
    };
  }

  function buildLookupCandidates({
    companyId = null,
    passportType = "passport",
    internalAliasId,
    granularity = "item",
  }) {
    const normalized = normalizeRawProductId(internalAliasId);
    if (!normalized) return [];
    if (isDidIdentifier(normalized)) return [normalized];

    const candidates = [normalized];
    if (companyId) {
      const canonicalDid = buildCanonicalProductDid({
        companyId,
        passportType,
        rawProductId: normalized,
        granularity,
      });
      if (canonicalDid) candidates.push(canonicalDid);
    }
    return [...new Set(candidates)];
  }

  function getIdentifierPersistencePolicy({ companyId = null } = {}) {
    return {
      companyId: companyId !== null && companyId !== undefined ? Number.parseInt(companyId, 10) || null : null,
      selectedGlobalIdentifierScheme: "did_web_product_identifier",
      uniqueProductIdentifierField: "uniqueProductIdentifier",
      localProductIdField: "internalAliasId",
      dppRecordIdentifierField: "dppId",
      lineageIdentifierField: "lineageId",
      didWebDomain: typeof didService?.getDidDomain === "function" ? didService.getDidDomain() : null,
      rules: {
        identifiersNeverReused: true,
        dppRecordIdentifiersNeverReassigned: true,
        localProductIdIsNotTreatedAsGloballyUnique: true,
        oldIdentifiersRemainResolvable: true,
        archivedIdentifiersRemainResolvable: true,
        backupProviderContinuationSupported: true,
        granularityChangesRequireLinkedNewIdentifier: true,
        inPlaceGranularityReassignmentAllowed: false,
      },
      granularityChangePolicy: {
        mode: "linked_new_identifier_required",
        linkageField: "lineageId",
        note: "Granularity changes must mint a new identifier linked through the shared lineageId rather than reassigning an existing identifier in place.",
      },
      resolutionContinuity: {
        activeSource: "live_passport_or_public_route",
        archiveSource: "passport_archives",
        economicOperatorInactiveSource: "backup_public_handover_when_activated",
      },
      operationalDependencies: [
        "did_web_domain_continuity",
        "public_origin_continuity",
        "backup_provider_verification",
        "archive_retention",
      ],
    };
  }

  function normalizeIdentifierLineageRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.companyId ?? null,
      lineageId: row.lineageId ?? null,
      previousDppId: row.previousPassportDppId ?? null,
      replacementDppId: row.replacementPassportDppId ?? null,
      previousIdentifier: row.previousIdentifier ?? null,
      replacementIdentifier: row.replacementIdentifier ?? null,
      previousInternalAliasId: row.previousInternalAliasId ?? null,
      replacementInternalAliasId: row.replacementInternalAliasId ?? null,
      previousGranularity: row.previousGranularity ?? null,
      replacementGranularity: row.replacementGranularity ?? null,
      transitionReason: row.transitionReason ?? null,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt ?? null,
    };
  }

  async function recordGranularityTransition({
    companyId,
    lineageId,
    previousPassportDppId,
    replacementPassportDppId,
    previousIdentifier,
    replacementIdentifier,
    previousInternalAliasId = null,
    replacementInternalAliasId = null,
    previousGranularity,
    replacementGranularity,
    transitionReason = null,
    createdBy = null,
    client = pool,
  }) {
    if (!client) throw new Error("A database client is required to record identifier lineage");

    const result = await client.query(
      `INSERT INTO product_identifier_lineage
         ("companyId", "lineageId", "previousPassportDppId", "replacementPassportDppId",
          "previousIdentifier", "replacementIdentifier", "previousInternalAliasId",
          "replacementInternalAliasId", "previousGranularity", "replacementGranularity",
          "transitionReason", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        companyId,
        lineageId,
        previousPassportDppId,
        replacementPassportDppId,
        previousIdentifier,
        replacementIdentifier,
        previousInternalAliasId,
        replacementInternalAliasId,
        normalizeGranularity(previousGranularity),
        normalizeGranularity(replacementGranularity),
        transitionReason,
        createdBy,
      ]
    );

    return normalizeIdentifierLineageRow(result.rows[0] || null);
  }

  async function listIdentifierLineage({
    companyId = null,
    lineageId = null,
    dppId = null,
    identifier = null,
    client = pool,
  } = {}) {
    if (!client) return [];

    const filters = [];
    const params = [];

    if (companyId !== null && companyId !== undefined) {
      params.push(Number.parseInt(companyId, 10) || companyId);
      filters.push(`"companyId" = $${params.length}`);
    }
    if (lineageId) {
      params.push(String(lineageId));
      filters.push(`"lineageId" = $${params.length}`);
    }
    if (dppId) {
      params.push(String(dppId));
      filters.push(`("previousPassportDppId" = $${params.length} OR "replacementPassportDppId" = $${params.length})`);
    }
    if (identifier) {
      params.push(String(identifier));
      filters.push(`("previousIdentifier" = $${params.length} OR "replacementIdentifier" = $${params.length})`);
    }
    if (!filters.length) return [];

    const result = await client.query(
      `SELECT *
       FROM product_identifier_lineage
       WHERE ${filters.join(" AND ")}
       ORDER BY "createdAt" ASC, id ASC`,
      params
    );
    return result.rows.map(normalizeIdentifierLineageRow);
  }

  return {
    normalizeRawProductId,
    isDidIdentifier,
    isGeneratedLocalPassportId,
    extractBusinessProductIdentifier,
    buildStableProductId,
    normalizeGranularity,
    buildCanonicalProductDid,
    normalizeProductIdentifiers,
    buildLookupCandidates,
    getIdentifierPersistencePolicy,
    recordGranularityTransition,
    listIdentifierLineage,
    getBusinessIdentifierField,
  };
}

module.exports = createProductIdentifierService;
