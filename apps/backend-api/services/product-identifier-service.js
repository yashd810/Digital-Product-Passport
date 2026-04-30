"use strict";

const crypto = require("crypto");

function createProductIdentifierService({ didService, pool = null }) {
  function normalizeRawProductId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isDidIdentifier(value) {
    return typeof value === "string" && value.trim().startsWith("did:");
  }

  function buildStableProductId({ companyId, rawProductId }) {
    const normalized = normalizeRawProductId(rawProductId);
    if (!normalized) return "";

    const slugBase = didService.slugify(normalized).slice(0, 48) || "product";
    const hash = crypto
      .createHash("sha256")
      .update(`${companyId || "global"}::${normalized}`)
      .digest("hex")
      .slice(0, 12);

    return didService.normalizeStableId(`c${companyId}-${slugBase}-${hash}`);
  }

  function normalizeGranularity(granularity) {
    const value = String(granularity || "").trim().toLowerCase();
    if (value === "model") return "model";
    if (value === "batch") return "batch";
    return "item";
  }

  function buildCanonicalProductDid({
    companyId,
    passportType = "battery",
    rawProductId,
    granularity = "item",
  }) {
    const normalized = normalizeRawProductId(rawProductId);
    if (!normalized) return "";
    if (isDidIdentifier(normalized)) return normalized;

    const stableId = buildStableProductId({ companyId, rawProductId: normalized });
    const normalizedPassportType = didService.normalizePassportTypeSegment(passportType || "battery");
    const normalizedGranularity = normalizeGranularity(granularity);

    return normalizedGranularity === "model"
      ? didService.generateModelDid(normalizedPassportType, stableId)
      : didService.generateItemDid(normalizedPassportType, stableId);
  }

  function normalizeProductIdentifiers({
    companyId,
    passportType = "battery",
    rawProductId,
    uniqueProductIdentifier = null,
    granularity = "item",
  }) {
    const productIdInput = normalizeRawProductId(rawProductId);
    const explicitUniqueIdentifier = normalizeRawProductId(uniqueProductIdentifier);
    const productIdentifierDid = explicitUniqueIdentifier
      ? explicitUniqueIdentifier
      : buildCanonicalProductDid({
      companyId,
      passportType,
      rawProductId: productIdInput,
      granularity,
    }) || null;

    return {
      productIdInput,
      productIdentifierDid,
    };
  }

  function buildLookupCandidates({
    companyId = null,
    passportType = "battery",
    productId,
    granularity = "item",
  }) {
    const normalized = normalizeRawProductId(productId);
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
      uniqueProductIdentifierField: "product_identifier_did",
      localProductIdField: "product_id",
      dppRecordIdentifierField: "dpp_id",
      lineageIdentifierField: "lineage_id",
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
        linkageField: "lineage_id",
        note: "Granularity changes must mint a new identifier linked through the shared lineage_id rather than reassigning an existing identifier in place.",
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
      companyId: row.company_id ?? null,
      company_id: row.company_id ?? null,
      lineageId: row.lineage_id ?? null,
      lineage_id: row.lineage_id ?? null,
      previousDppId: row.previous_passport_dpp_id ?? null,
      previous_passport_dpp_id: row.previous_passport_dpp_id ?? null,
      replacementDppId: row.replacement_passport_dpp_id ?? null,
      replacement_passport_dpp_id: row.replacement_passport_dpp_id ?? null,
      previousIdentifier: row.previous_identifier ?? null,
      previous_identifier: row.previous_identifier ?? null,
      replacementIdentifier: row.replacement_identifier ?? null,
      replacement_identifier: row.replacement_identifier ?? null,
      previousLocalProductId: row.previous_local_product_id ?? null,
      previous_local_product_id: row.previous_local_product_id ?? null,
      replacementLocalProductId: row.replacement_local_product_id ?? null,
      replacement_local_product_id: row.replacement_local_product_id ?? null,
      previousGranularity: row.previous_granularity ?? null,
      previous_granularity: row.previous_granularity ?? null,
      replacementGranularity: row.replacement_granularity ?? null,
      replacement_granularity: row.replacement_granularity ?? null,
      transitionReason: row.transition_reason ?? null,
      transition_reason: row.transition_reason ?? null,
      createdBy: row.created_by ?? null,
      created_by: row.created_by ?? null,
      createdAt: row.created_at ?? null,
      created_at: row.created_at ?? null,
    };
  }

  async function recordGranularityTransition({
    companyId,
    lineageId,
    previousPassportDppId,
    replacementPassportDppId,
    previousIdentifier,
    replacementIdentifier,
    previousLocalProductId = null,
    replacementLocalProductId = null,
    previousGranularity,
    replacementGranularity,
    transitionReason = null,
    createdBy = null,
    client = pool,
  }) {
    if (!client) throw new Error("A database client is required to record identifier lineage");

    const result = await client.query(
      `INSERT INTO product_identifier_lineage
         (company_id, lineage_id, previous_passport_dpp_id, replacement_passport_dpp_id,
          previous_identifier, replacement_identifier, previous_local_product_id,
          replacement_local_product_id, previous_granularity, replacement_granularity,
          transition_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        companyId,
        lineageId,
        previousPassportDppId,
        replacementPassportDppId,
        previousIdentifier,
        replacementIdentifier,
        previousLocalProductId,
        replacementLocalProductId,
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
      filters.push(`company_id = $${params.length}`);
    }
    if (lineageId) {
      params.push(String(lineageId));
      filters.push(`lineage_id = $${params.length}`);
    }
    if (dppId) {
      params.push(String(dppId));
      filters.push(`(previous_passport_dpp_id = $${params.length} OR replacement_passport_dpp_id = $${params.length})`);
    }
    if (identifier) {
      params.push(String(identifier));
      filters.push(`(previous_identifier = $${params.length} OR replacement_identifier = $${params.length})`);
    }
    if (!filters.length) return [];

    const result = await client.query(
      `SELECT *
       FROM product_identifier_lineage
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at ASC, id ASC`,
      params
    );
    return result.rows.map(normalizeIdentifierLineageRow);
  }

  return {
    normalizeRawProductId,
    isDidIdentifier,
    buildStableProductId,
    normalizeGranularity,
    buildCanonicalProductDid,
    normalizeProductIdentifiers,
    buildLookupCandidates,
    getIdentifierPersistencePolicy,
    recordGranularityTransition,
    listIdentifierLineage,
  };
}

module.exports = createProductIdentifierService;
