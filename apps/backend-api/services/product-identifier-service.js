"use strict";

const crypto = require("crypto");

function createProductIdentifierService({ didService }) {
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
    if (value === "batch") return "item";
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
    granularity = "item",
  }) {
    const productIdInput = normalizeRawProductId(rawProductId);
    const productIdentifierDid = buildCanonicalProductDid({
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

  return {
    normalizeRawProductId,
    isDidIdentifier,
    buildStableProductId,
    buildCanonicalProductDid,
    normalizeProductIdentifiers,
    buildLookupCandidates,
  };
}

module.exports = createProductIdentifierService;
