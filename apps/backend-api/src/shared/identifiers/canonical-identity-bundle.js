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
    return didService?.normalizePassportTypeSegment?.(value || "passport") || "passport";
  } catch {
    return "passport";
  }
}

function buildCanonicalIdentityBundle({
  passport = {},
  company = null,
  companyName = "",
  granularity = null,
  passportType = null,
  typeDef = null,
  didService = null,
  productIdentifierService = null,
} = {}) {
  const stableId = normalizeStableIdValue(
    didService,
    passport?.lineageId || passport?.dppId || passport?.guid || null
  );
  const resolvedGranularity = normalizeGranularityValue(
    didService,
    granularity || company?.defaultGranularity || passport?.granularity || "item"
  );

  const resolvedCompanyName = String(company?.companyName || companyName || "").trim() || null;
  const companySlug = normalizeCompanySlugValue(
    didService,
    company?.didSlug || resolvedCompanyName || null
  );
  const subjectNamespace = normalizePassportNamespace(
    didService,
    company?.didSlug || resolvedCompanyName || passportType || passport?.passportType || "passport"
  );

  let companyDid = null;
  let subjectDid = null;
  let dppDid = null;
  let uniqueProductIdentifier = null;
  const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}, typeDef) || "";

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

  if (businessIdentifier && productIdentifierService?.buildCanonicalProductDid) {
    try {
      uniqueProductIdentifier = productIdentifierService.buildCanonicalProductDid({
        companyId: passport.companyId ?? company?.id ?? null,
        companySlug,
        companyName: resolvedCompanyName,
        passportType: passportType || passport?.passportType || "passport",
        rawProductId: businessIdentifier,
        granularity: resolvedGranularity,
      }) || null;
    } catch {
      uniqueProductIdentifier = null;
    }
  }

  const digitalProductPassportId =
    dppDid
    || passport?.dppId
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
