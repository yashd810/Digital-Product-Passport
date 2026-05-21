"use strict";

function normalizeGranularityValue(didService, value) {
  const fallback = "item";
  try {
    return didService?.normalizeGranularity?.(String(value || fallback).trim().toLowerCase()) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeStableIdValue(didService, value) {
  if (!value) return null;
  try {
    return didService?.normalizeStableId?.(value) || null;
  } catch {
    return null;
  }
}

function normalizeCompanySlugValue(didService, value) {
  if (!value) return null;
  try {
    return didService?.normalizeCompanySlug?.(value) || null;
  } catch {
    return null;
  }
}

function normalizePassportNamespace(didService, value) {
  try {
    return didService?.normalizePassportTypeSegment?.(value || "battery") || "battery";
  } catch {
    return "battery";
  }
}

function buildCanonicalIdentityBundle({
  passport = {},
  company = null,
  companyName = "",
  granularity = null,
  passportType = null,
  didService = null,
  productIdentifierService = null,
} = {}) {
  const stableId = normalizeStableIdValue(
    didService,
    passport?.lineage_id || passport?.dppId || passport?.dpp_id || passport?.guid || null
  );
  const resolvedGranularity = normalizeGranularityValue(
    didService,
    granularity || company?.default_granularity || company?.dpp_granularity || passport?.granularity || "item"
  );

  const resolvedCompanyName = String(company?.company_name || companyName || "").trim() || null;
  const companySlug = normalizeCompanySlugValue(
    didService,
    company?.did_slug || resolvedCompanyName || null
  );
  const subjectNamespace = normalizePassportNamespace(
    didService,
    company?.did_slug || resolvedCompanyName || passportType || passport?.passport_type || "battery"
  );

  let companyDid = null;
  let subjectDid = null;
  let dppDid = null;
  let uniqueProductIdentifier = passport?.product_identifier_did || null;
  const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}) || "";

  try {
    companyDid = companySlug ? didService?.generateCompanyDid?.(companySlug) || null : null;
  } catch {
    companyDid = null;
  }

  if (stableId) {
    try {
      if (resolvedGranularity === "batch") {
        subjectDid = didService?.generateBatchDid?.(subjectNamespace, stableId) || null;
      } else if (resolvedGranularity === "item") {
        subjectDid = didService?.generateItemDid?.(subjectNamespace, stableId) || null;
      } else {
        subjectDid = didService?.generateModelDid?.(subjectNamespace, stableId) || null;
      }
    } catch {
      subjectDid = null;
    }

    try {
      dppDid = didService?.generateDppDid?.(resolvedGranularity, stableId) || null;
    } catch {
      dppDid = null;
    }
  }

  if ((businessIdentifier || (passport?.product_id && !productIdentifierService?.isGeneratedLocalPassportId?.(passport.product_id))) && productIdentifierService?.buildCanonicalProductDid) {
    try {
      uniqueProductIdentifier = productIdentifierService.buildCanonicalProductDid({
        companyId: passport.company_id ?? passport.companyId ?? company?.id ?? null,
        companySlug,
        companyName: resolvedCompanyName,
        passportType: passportType || passport?.passport_type || "battery",
        rawProductId: businessIdentifier || passport.product_id,
        granularity: resolvedGranularity,
      }) || uniqueProductIdentifier;
    } catch {
      // Keep any stored identifier fallback if canonical derivation fails.
    }
  }

  const digitalProductPassportId =
    dppDid
    || passport?.dppId
    || passport?.dpp_id
    || passport?.guid
    || null;

  return {
    stableId,
    resolvedGranularity,
    resolvedCompanyName,
    companySlug,
    subjectNamespace,
    digitalProductPassportId,
    uniqueProductIdentifier: uniqueProductIdentifier || null,
    subjectDid,
    dppDid,
    companyDid,
  };
}

module.exports = {
  buildCanonicalIdentityBundle,
};
