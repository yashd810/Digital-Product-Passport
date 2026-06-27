function createApiKeyHelpers({ crypto }) {
  const allowedApiKeyScopes = new Set(["dpp:read", "dpp:restricted:read", "*"]);
  const apiKeyPrefixLength = 16;

  function parseApiKeyScopes(scopes) {
    const normalized = Array.isArray(scopes)
      ? scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
      : ["dpp:read", "dpp:restricted:read"];
    const unique = [...new Set(normalized)];
    const invalid = unique.filter((scope) => !allowedApiKeyScopes.has(scope));
    if (invalid.length) {
      const error = new Error(`Invalid API key scope(s): ${invalid.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    return unique.length ? unique : ["dpp:read", "dpp:restricted:read"];
  }

  function buildSecurityGroupApiKeyScopes(requestedScopes = []) {
    const derived = new Set(parseApiKeyScopes(requestedScopes));
    derived.add("dpp:read");
    derived.add("dpp:restricted:read");
    return [...derived];
  }

  function flattenTypeFields(typeDef) {
    return (typeDef?.fieldsJson?.sections || []).flatMap((section) => section.fields || []);
  }

  function isRestrictedField(field) {
    return String(field?.confidentiality || "public").trim().toLowerCase() === "restricted";
  }

  function normalizeApiKeyFieldKeys(apiKey) {
    return new Set(
      (Array.isArray(apiKey?.fieldKeys) ? apiKey.fieldKeys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
    );
  }

  function normalizeApiKeyPassportDppIds(apiKey) {
    return new Set(
      (Array.isArray(apiKey?.passportDppIds) ? apiKey.passportDppIds : [])
        .map((dppId) => String(dppId || "").trim())
        .filter(Boolean)
    );
  }

  function idsMatch(left, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    const leftNumber = Number.parseInt(left, 10);
    const rightNumber = Number.parseInt(right, 10);
    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber === rightNumber;
    return String(left) === String(right);
  }

  function apiKeyAppliesToPassport(apiKey, passport) {
    if (!apiKey || !passport) return false;
    const passportType = String(passport.passportType || "").trim();
    if (String(apiKey.passportType || "").trim() !== passportType) return false;
    const scopeType = String(apiKey.scopeType || "passportType").trim();
    if (scopeType !== "passports") return true;
    return normalizeApiKeyPassportDppIds(apiKey).has(String(passport.dppId || ""));
  }

  function sanitizePassportForApiKey(passport, typeDef, apiKey) {
    if (!passport || !typeDef) return passport;
    const sanitized = { ...passport };
    delete sanitized.companyId;
    delete sanitized.internalAliasId;
    delete sanitized.internalAliasIds;
    const selectedFieldKeys = normalizeApiKeyFieldKeys(apiKey);
    const appliesToPassport = apiKeyAppliesToPassport(apiKey, passport);
    for (const field of flattenTypeFields(typeDef)) {
      if (!isRestrictedField(field)) continue;
      if (!appliesToPassport || !selectedFieldKeys.has(field.key)) {
        delete sanitized[field.key];
      }
    }
    return sanitized;
  }

  function verifyApiKeyHashRecord(rawKey, record) {
    if (!record || record.hashAlgorithm !== "hmacSha256" || !record.keySalt) return false;
    const storedHash = String(record.keyHash || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
    const computed = crypto.createHmac("sha256", String(record.keySalt)).update(String(rawKey || "")).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(computed, "hex"));
  }

  function findMatchingApiKeyRecord(rawKey, records = []) {
    return records.find((record) => verifyApiKeyHashRecord(rawKey, record)) || null;
  }

  function getSecurityGroupKeyFromRequest(req) {
    const headerValue = req?.headers?.["x-security-group-key"] || req?.headers?.["x-api-key"];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return String(raw || "").trim();
  }

  async function resolveSecurityGroupApiKey(pool, rawApiKey) {
    const keyPrefix = String(rawApiKey || "").slice(0, apiKeyPrefixLength);
    if (!keyPrefix) {
      const error = new Error("API key is required");
      error.statusCode = 400;
      throw error;
    }
    const keyRows = await pool.query(
      `SELECT id,
              "companyId" AS "companyId",
              name,
              "keyHash" AS "keyHash",
              "keySalt" AS "keySalt",
              "hashAlgorithm" AS "hashAlgorithm",
              "passportType" AS "passportType",
              "scopeType" AS "scopeType",
              "fieldKeys" AS "fieldKeys",
              "passportDppIds" AS "passportDppIds"
       FROM "apiKeys"
       WHERE "keyPrefix" = $1
         AND "isActive" = true
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
      [keyPrefix]
    );
    const matchedKey = findMatchingApiKeyRecord(rawApiKey, keyRows.rows);
    if (!matchedKey) {
      const error = new Error("Invalid or revoked API key");
      error.statusCode = 401;
      throw error;
    }
    return matchedKey;
  }

  function checkSecurityGroupApiKeyAccess(apiKey, passport) {
    if (!apiKey) return { allowed: false, statusCode: 401, error: "Invalid or revoked API key" };
    if (!idsMatch(apiKey.companyId, passport?.companyId)) {
      return { allowed: false, statusCode: 403, error: "API key is not valid for this company" };
    }
    if (String(apiKey.passportType || "") !== String(passport?.passportType || "")) {
      return { allowed: false, statusCode: 403, error: "API key is not valid for this passport type" };
    }
    if (!apiKeyAppliesToPassport(apiKey, passport)) {
      return { allowed: false, statusCode: 403, error: "API key is not valid for this passport" };
    }
    return { allowed: true, statusCode: 200, error: "" };
  }

  async function buildRestrictedUnlockPassportPayload({
    pool,
    passport,
    typeDef,
    apiKey,
    includeDynamicLatest = true,
    normalizePassportRow = (row) => row,
  }) {
    const selectedFieldKeys = normalizeApiKeyFieldKeys(apiKey);
    const allowedRestrictedFields = flattenTypeFields(typeDef)
      .filter((field) => field?.key && isRestrictedField(field) && selectedFieldKeys.has(field.key));
    const normalizedPassport = {
      ...normalizePassportRow(passport, typeDef),
      passportType: passport?.passportType || typeDef?.typeName || null,
    };
    const unlockedPassport = {
      dppId: normalizedPassport.dppId || passport?.dppId || null,
      passportType: normalizedPassport.passportType,
    };
    if (normalizedPassport.versionNumber !== null && normalizedPassport.versionNumber !== undefined) {
      unlockedPassport.versionNumber = normalizedPassport.versionNumber;
    }

    for (const field of allowedRestrictedFields) {
      if (Object.prototype.hasOwnProperty.call(normalizedPassport, field.key)) {
        unlockedPassport[field.key] = normalizedPassport[field.key];
      }
    }

    const passportDppId = String(unlockedPassport.dppId || "").trim();
    const dynamicFieldKeys = allowedRestrictedFields
      .filter((field) => field.dynamic)
      .map((field) => field.key);
    if (includeDynamicLatest && pool && passportDppId && dynamicFieldKeys.length) {
      const dynamicRows = await pool.query(
        `SELECT DISTINCT ON ("fieldKey") "fieldKey", value
         FROM "passportDynamicValues"
         WHERE "passportDppId" = $1
           AND "fieldKey" = ANY($2::text[])
         ORDER BY "fieldKey", "updatedAt" DESC`,
        [passportDppId, dynamicFieldKeys]
      );
      for (const dynamicRow of dynamicRows.rows) {
        unlockedPassport[dynamicRow.fieldKey] = dynamicRow.value;
      }
    }

    return {
      passport: unlockedPassport,
      unlockedFieldKeys: allowedRestrictedFields.map((field) => field.key),
    };
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
    apiKeyAppliesToPassport,
    buildApiKeyHashRecord,
    buildRestrictedUnlockPassportPayload,
    buildSecurityGroupApiKeyScopes,
    checkSecurityGroupApiKeyAccess,
    findMatchingApiKeyRecord,
    flattenTypeFields,
    getSecurityGroupKeyFromRequest,
    isRestrictedField,
    normalizeApiKeyFieldKeys,
    normalizeApiKeyPassportDppIds,
    sanitizePassportForApiKey,
    resolveSecurityGroupApiKey,
    verifyApiKeyHashRecord,
  };
}

module.exports = {
  createApiKeyHelpers,
};
