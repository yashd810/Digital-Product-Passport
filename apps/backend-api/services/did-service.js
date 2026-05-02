"use strict";

function defaultDidDomain() {
  return String(process.env.DID_WEB_DOMAIN || "www.claros-dpp.online").trim() || "www.claros-dpp.online";
}

function defaultPublicOrigin() {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/g, "");
}

function defaultApiOrigin() {
  return String(process.env.SERVER_URL || "http://localhost:3001").replace(/\/+$/g, "");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function cleanPathValue(value) {
  return String(value || "").trim();
}

function hasTraversalSyntax(value) {
  const raw = String(value || "");
  if (!raw) return false;
  if (raw.includes("/") || raw.includes("\\")) return true;
  if (/\.\./.test(raw)) return true;
  if (/%2e/i.test(raw)) return true;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.includes("/") || decoded.includes("\\") || /\.\./.test(decoded);
  } catch {
    return true;
  }
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function assertSafeSegment(value, label, pattern) {
  const candidate = cleanPathValue(value);
  if (!candidate) throw new Error(`${label} is required`);
  if (hasTraversalSyntax(candidate)) throw new Error(`${label} contains an invalid path segment`);
  if (pattern && !pattern.test(candidate)) throw new Error(`${label} is invalid`);
  return candidate;
}

function normalizeCompanySlug(value) {
  const slug = slugify(value);
  return assertSafeSegment(slug, "companySlug", /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/);
}

function normalizeStableId(value) {
  const candidate = cleanPathValue(value);
  if (!candidate) {
    return assertSafeSegment(candidate, "stableId", /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/);
  }
  if (isUuidLike(candidate)) return candidate.toLowerCase();
  return assertSafeSegment(candidate, "stableId", /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/);
}

function normalizeFacilityStableId(value) {
  const candidate = cleanPathValue(value);
  if (isUuidLike(candidate)) return candidate.toLowerCase();
  return assertSafeSegment(candidate, "facilityStableId", /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/);
}

function normalizePassportTypeSegment(passportType) {
  const candidate = slugify(passportType || "battery");
  return candidate || "battery";
}

function normalizeGranularity(granularity) {
  return assertSafeSegment(String(granularity || "").toLowerCase(), "granularity", /^[a-z][a-z0-9_-]{0,31}$/);
}

function createDidService(options = {}) {
  const didDomain = cleanPathValue(options.didDomain) || defaultDidDomain();
  const publicOrigin = cleanPathValue(options.publicOrigin || defaultPublicOrigin()).replace(/\/+$/g, "");
  const apiOrigin = cleanPathValue(options.apiOrigin || defaultApiOrigin()).replace(/\/+$/g, "");
  const platformDid = `did:web:${didDomain}`;

  function generateCompanyDid(companySlug) {
    return `${platformDid}:did:company:${normalizeCompanySlug(companySlug)}`;
  }

  function generateModelDid(passportType, stableId) {
    return `${platformDid}:did:${normalizePassportTypeSegment(passportType)}:model:${normalizeStableId(stableId)}`;
  }

  function generateItemDid(passportType, stableId) {
    return `${platformDid}:did:${normalizePassportTypeSegment(passportType)}:item:${normalizeStableId(stableId)}`;
  }

  function generateBatchDid(passportType, stableId) {
    return `${platformDid}:did:${normalizePassportTypeSegment(passportType)}:batch:${normalizeStableId(stableId)}`;
  }

  function generateDppDid(granularity, stableId) {
    return `${platformDid}:did:dpp:${normalizeGranularity(granularity)}:${normalizeStableId(stableId)}`;
  }

  function generateFacilityDid(stableId) {
    return `${platformDid}:did:facility:${normalizeFacilityStableId(stableId)}`;
  }

  function parseDid(did) {
    const value = cleanPathValue(did);
    if (!value.startsWith("did:web:")) return null;

    const parts = value.split(":");
    if (parts.length < 3) return null;
    if (parts[0] !== "did" || parts[1] !== "web") return null;
    const domain = parts[2];
    if (!domain) return null;

    const path = parts.slice(3);
    const base = {
      method: "web",
      domain,
      path,
      entityType: "platform",
      stableId: null,
      passportType: null,
      granularity: null,
    };

    if (!path.length) return base;
    if (domain !== didDomain) return null;
    if (path[0] !== "did") return null;

    if (path[1] === "company" && path.length === 3) {
      try {
        const stableId = normalizeCompanySlug(path[2]);
        return { ...base, entityType: "company", stableId };
      } catch {
        return null;
      }
    }

    if (path[1] === "facility" && path.length === 3) {
      try {
        const stableId = normalizeFacilityStableId(path[2]);
        return { ...base, entityType: "facility", stableId };
      } catch {
        return null;
      }
    }

    if (path[1] === "dpp" && path.length === 4) {
      try {
        const granularity = normalizeGranularity(path[2]);
        const stableId = normalizeStableId(path[3]);
        return { ...base, entityType: "dpp", granularity, stableId };
      } catch {
        return null;
      }
    }

    if (path.length === 4 && (path[2] === "model" || path[2] === "batch" || path[2] === "item")) {
      try {
        const passportType = normalizePassportTypeSegment(path[1]);
        const stableId = normalizeStableId(path[3]);
        return {
          ...base,
          entityType: path[2],
          passportType,
          stableId,
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  function didToDocumentPath(did) {
    const parsed = parseDid(did);
    if (!parsed) return null;
    if (parsed.entityType === "platform") return "/.well-known/did.json";
    if (parsed.entityType === "company") return `/did/company/${parsed.stableId}/did.json`;
    if (parsed.entityType === "facility") return `/did/facility/${parsed.stableId}/did.json`;
    if (parsed.entityType === "dpp") return `/did/dpp/${parsed.granularity}/${parsed.stableId}/did.json`;
    if (parsed.entityType === "model" || parsed.entityType === "batch" || parsed.entityType === "item") {
      return `/did/${parsed.passportType}/${parsed.entityType}/${parsed.stableId}/did.json`;
    }
    return null;
  }

  function didToDocumentUrl(did) {
    const docPath = didToDocumentPath(did);
    return docPath ? `https://${didDomain}${docPath}` : null;
  }

  function publicUrlToSubjects(publicPath) {
    const candidate = String(publicPath || "").trim();
    if (!candidate) return [];

    let pathname = candidate;
    try {
      pathname = new URL(candidate, publicOrigin || "http://localhost").pathname || "";
    } catch {}

    if (pathname === "/.well-known/did.json") return [platformDid];

    const companyMatch = pathname.match(/^\/did\/company\/([a-z0-9-]+)\/did\.json$/i);
    if (companyMatch) return [generateCompanyDid(companyMatch[1])];

    const facilityMatch = pathname.match(/^\/did\/facility\/([a-z0-9-]+)\/did\.json$/i);
    if (facilityMatch) return [generateFacilityDid(facilityMatch[1])];

    const subjectMatch = pathname.match(/^\/did\/([a-z0-9_-]+)\/(model|batch|item)\/([a-z0-9._-]+)\/did\.json$/i);
    if (subjectMatch) {
      const [, passportType, entityType, stableId] = subjectMatch;
      if (entityType === "model") return [generateModelDid(passportType, stableId)];
      if (entityType === "batch") return [generateBatchDid(passportType, stableId)];
      return [generateItemDid(passportType, stableId)];
    }

    const dppMatch = pathname.match(/^\/did\/dpp\/([a-z0-9_-]+)\/([a-z0-9._-]+)\/did\.json$/i);
    if (dppMatch) {
      return [generateDppDid(dppMatch[1], dppMatch[2])];
    }

    return [];
  }

  function buildPublicPassportUrl(publicPath) {
    if (!publicPath) return null;
    return `${publicOrigin}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
  }

  function buildApiUrl(pathname) {
    return `${apiOrigin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  return {
    getDidDomain: () => didDomain,
    getPlatformDid: () => platformDid,
    getPublicOrigin: () => publicOrigin,
    getApiOrigin: () => apiOrigin,
    slugify,
    hasTraversalSyntax,
    isUuidLike,
    normalizeCompanySlug,
    normalizeFacilityStableId,
    normalizeStableId,
    normalizeGranularity,
    normalizePassportTypeSegment,
    generateCompanyDid,
    generateModelDid,
    generateBatchDid,
    generateItemDid,
    generateDppDid,
    generateFacilityDid,
    parseDid,
    didToDocumentPath,
    didToDocumentUrl,
    publicUrlToSubjects,
    buildPublicPassportUrl,
    buildApiUrl,
  };
}

module.exports = createDidService;
