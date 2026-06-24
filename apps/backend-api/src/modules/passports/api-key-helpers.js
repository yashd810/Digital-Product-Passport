function createApiKeyHelpers({ accessRightsService, crypto }) {
  const allowedApiKeyScopes = new Set(["dpp:read", "dpp:update", "dpp:history:read", "dpp:element:read", "*"]);
  const apiKeyPrefixLength = 16;
  const apiKeyAllowedOperatorTypes = new Set(
    [...accessRightsService.validAudiences].filter((audience) => audience !== "consumers" && audience !== "legitimateInterest")
  );
  const apiKeyAccessModes = new Set(["read", "update"]);
  const apiKeyConfidentialityLevels = ["public", "restricted", "confidential", "tradeSecret", "regulated"];
  const apiKeyConfidentialityRank = new Map(
    apiKeyConfidentialityLevels.map((level, index) => [level, index])
  );

  function parseApiKeyScopes(scopes) {
    const normalized = Array.isArray(scopes)
      ? scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
      : ["dpp:read"];
    const unique = [...new Set(normalized)];
    const invalid = unique.filter((scope) => !allowedApiKeyScopes.has(scope));
    if (invalid.length) {
      const error = new Error(`Invalid API key scope(s): ${invalid.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    return unique.length ? unique : ["dpp:read"];
  }

  function normalizeApiKeyOperatorType(value) {
    const normalized = String(value || "").trim();
    return normalized || "economicOperator";
  }

  function parseApiKeyOperatorType(value) {
    const operatorType = normalizeApiKeyOperatorType(value);
    if (!apiKeyAllowedOperatorTypes.has(operatorType)) {
      const error = new Error(`Invalid API key operator type "${operatorType}"`);
      error.statusCode = 400;
      throw error;
    }
    return operatorType;
  }

  function parseApiKeyAccessMode(value, scopes = []) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) {
      if (!apiKeyAccessModes.has(normalized)) {
        const error = new Error(`Invalid API key access mode "${normalized}"`);
        error.statusCode = 400;
        throw error;
      }
      return normalized;
    }
    return Array.isArray(scopes) && (scopes.includes("dpp:update") || scopes.includes("*")) ? "update" : "read";
  }

  function parseApiKeyMaxConfidentiality(value) {
    const normalized = String(value || "").trim().toLowerCase() || "regulated";
    if (!apiKeyConfidentialityRank.has(normalized)) {
      const error = new Error(`Invalid API key confidentiality level "${normalized}"`);
      error.statusCode = 400;
      throw error;
    }
    return normalized;
  }

  function buildApiKeyScopesForAccessMode(accessMode, requestedScopes = []) {
    const derived = new Set(parseApiKeyScopes(requestedScopes));
    derived.add("dpp:read");
    if (accessMode === "update") derived.add("dpp:update");
    return [...derived];
  }

function flattenTypeFields(typeDef) {
    return (typeDef?.fieldsJson?.sections || []).flatMap((section) => section.fields || []);
  }

  function getApiKeyAudiences(apiKey) {
    return new Set(accessRightsService.expandAudienceAssignments([apiKey?.operatorType || "economicOperator"]));
  }

  function isConfidentialityAllowedForApiKey(fieldConfidentiality, maxConfidentiality) {
    const normalizedField = String(fieldConfidentiality || "public").trim().toLowerCase() || "public";
    const normalizedMax = String(maxConfidentiality || "regulated").trim().toLowerCase() || "regulated";
    const fieldRank = apiKeyConfidentialityRank.get(normalizedField);
    const maxRank = apiKeyConfidentialityRank.get(normalizedMax);
    if (fieldRank === undefined || maxRank === undefined) return false;
    return fieldRank <= maxRank;
  }

  function buildApiKeyFieldReadDecision(field, apiKey) {
    const access = Array.isArray(field?.access) && field.access.length ? field.access : ["public"];
    const confidentiality = String(field?.confidentiality || (access.includes("public") ? "public" : "restricted")).trim().toLowerCase() || "public";
    const audiences = getApiKeyAudiences(apiKey);
    const matchedAudience = access.find((audience) => audience === "public" || audiences.has(audience)) || null;
    const confidentialityAllowed = isConfidentialityAllowedForApiKey(confidentiality, apiKey?.maxConfidentiality);
    return {
      allowed: Boolean(matchedAudience) && confidentialityAllowed,
      matchedAudience,
      confidentiality,
      audiences: access,
    };
  }

  function buildApiKeyFieldWriteDecision(field, apiKey) {
    const updateAuthority = Array.isArray(field?.updateAuthority) && field.updateAuthority.length
      ? field.updateAuthority
      : ["economicOperator"];
    const confidentiality = String(field?.confidentiality || "public").trim().toLowerCase() || "public";
    const audiences = getApiKeyAudiences(apiKey);
    const matchedAuthority = updateAuthority.find((audience) => audiences.has(audience)) || null;
    const confidentialityAllowed = isConfidentialityAllowedForApiKey(confidentiality, apiKey?.maxConfidentiality);
    return {
      allowed: apiKey?.accessMode === "update" && Boolean(matchedAuthority) && confidentialityAllowed,
      matchedAuthority,
      confidentiality,
      updateAuthority,
    };
  }

  function sanitizePassportForApiKey(passport, typeDef, apiKey) {
    if (!passport || !typeDef) return passport;
    const sanitized = { ...passport };
    for (const field of flattenTypeFields(typeDef)) {
      const decision = buildApiKeyFieldReadDecision(field, apiKey);
      if (!decision.allowed) {
        delete sanitized[field.key];
      }
    }
    return sanitized;
  }

  function buildApiKeyHashRecord(rawKey) {
    const keySalt = crypto.randomBytes(16).toString("hex");
    return {
      keyPrefix: String(rawKey || "").slice(0, apiKeyPrefixLength),
      keySalt,
      hashAlgorithm: "hmacSha256",
      keyHash: crypto.createHmac("sha256", keySalt).update(String(rawKey || "")).digest("hex"),
    };
  }

  return {
    buildApiKeyFieldWriteDecision,
    buildApiKeyHashRecord,
    buildApiKeyScopesForAccessMode,
    flattenTypeFields,
    parseApiKeyAccessMode,
    parseApiKeyMaxConfidentiality,
    parseApiKeyOperatorType,
    sanitizePassportForApiKey,
  };
}

module.exports = {
  createApiKeyHelpers,
};
