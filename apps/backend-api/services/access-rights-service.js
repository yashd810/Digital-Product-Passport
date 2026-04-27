"use strict";

const VALID_AUDIENCES = new Set([
  "public",
  "notified_bodies",
  "market_surveillance",
  "eu_commission",
  "legitimate_interest",
  "economic_operator",
  "delegated_operator",
]);

const VALID_CONFIDENTIALITY_LEVELS = new Set([
  "public",
  "restricted",
  "confidential",
  "trade_secret",
  "regulated",
]);

const VALID_UPDATE_AUTHORITIES = new Set([
  "economic_operator",
  "delegated_operator",
  "notified_bodies",
  "market_surveillance",
  "eu_commission",
  "system",
]);

function normalizeList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function flattenSchemaFields(typeDef) {
  return (typeDef?.fields_json?.sections || [])
    .flatMap((section) => section.fields || [])
    .filter((field) => field?.key);
}

function findFieldDefinition(typeDef, elementIdPath) {
  const normalizedElementIdPath = String(elementIdPath || "").trim();
  if (!normalizedElementIdPath) return null;

  return flattenSchemaFields(typeDef).find((field) =>
    field.key === normalizedElementIdPath
    || field.semanticId === normalizedElementIdPath
    || field.semantic_id === normalizedElementIdPath
    || field.elementId === normalizedElementIdPath
    || field.element_id === normalizedElementIdPath
  ) || null;
}

function defaultUpdateAuthority(fieldDef) {
  const access = normalizeList(fieldDef?.access);
  if (access.includes("public")) return ["economic_operator"];
  if (access.includes("notified_bodies")) return ["economic_operator", "notified_bodies"];
  if (access.includes("market_surveillance")) return ["economic_operator", "market_surveillance"];
  if (access.includes("eu_commission")) return ["economic_operator", "eu_commission"];
  return ["economic_operator"];
}

function buildFieldPolicy(typeDef, elementIdPath) {
  const fieldDef = findFieldDefinition(typeDef, elementIdPath);
  if (!fieldDef) {
    return {
      fieldDef: null,
      elementIdPath,
      access: ["public"],
      confidentiality: "public",
      updateAuthority: ["economic_operator"],
    };
  }

  const access = normalizeList(fieldDef.access);
  const confidentiality = String(fieldDef.confidentiality || "").trim() || (access.includes("public") ? "public" : "restricted");
  const updateAuthority = normalizeList(fieldDef.updateAuthority || fieldDef.update_authority);

  return {
    fieldDef,
    elementIdPath,
    access: access.length ? access : ["public"],
    confidentiality,
    updateAuthority: updateAuthority.length ? updateAuthority : defaultUpdateAuthority(fieldDef),
  };
}

function deriveRoleAudiences(user) {
  if (!user) return [];
  if (user.role === "super_admin") {
    return [
      "public",
      "legitimate_interest",
      "economic_operator",
      "delegated_operator",
      "notified_bodies",
      "market_surveillance",
      "eu_commission",
    ];
  }
  if (["company_admin", "editor", "viewer"].includes(String(user.role || ""))) {
    return ["public", "legitimate_interest", "economic_operator"];
  }
  return ["public"];
}

module.exports = function createAccessRightsService({ pool }) {
  async function loadUserAudiences(user) {
    if (!user?.userId) return deriveRoleAudiences(user);

    const roleAudiences = deriveRoleAudiences(user);
    const result = await pool.query(
      `SELECT audience
       FROM user_access_audiences
       WHERE user_id = $1
         AND is_active = true
         AND (company_id IS NULL OR company_id = $2)
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [user.userId, user.companyId ? Number.parseInt(user.companyId, 10) : null]
    ).catch(() => ({ rows: [] }));

    const grantedAudiences = result.rows
      .map((row) => String(row.audience || "").trim())
      .filter(Boolean);

    return [...new Set([...roleAudiences, ...grantedAudiences, ...normalizeList(user.accessAudiences)])];
  }

  async function loadPassportGrantAudiences({ passportGuid, userId }) {
    if (!passportGuid || !userId) return [];
    const result = await pool.query(
      `SELECT audience
       FROM passport_access_grants
       WHERE passport_guid = $1
         AND grantee_user_id = $2
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [passportGuid, userId]
    ).catch(() => ({ rows: [] }));

    return result.rows
      .map((row) => String(row.audience || "").trim())
      .filter(Boolean);
  }

  async function buildUserAccessContext({ user, passportGuid = null }) {
    const baseAudiences = await loadUserAudiences(user);
    const delegatedAudiences = passportGuid && user?.userId
      ? await loadPassportGrantAudiences({ passportGuid, userId: user.userId })
      : [];

    return {
      audiences: [...new Set([...baseAudiences, ...delegatedAudiences])],
    };
  }

  async function canReadElement({ passportGuid = null, typeDef, elementIdPath, user = null }) {
    const policy = buildFieldPolicy(typeDef, elementIdPath);
    const userContext = await buildUserAccessContext({ user, passportGuid });
    const matchedAudience = policy.access.find((audience) =>
      audience === "public" || userContext.audiences.includes(audience)
    ) || null;

    return {
      allowed: Boolean(matchedAudience),
      matchedAudience,
      audiences: policy.access,
      confidentiality: policy.confidentiality,
      updateAuthority: policy.updateAuthority,
      fieldDef: policy.fieldDef,
    };
  }

  async function canWriteElement({ passportGuid = null, typeDef, elementIdPath, user = null, passportCompanyId = null }) {
    const policy = buildFieldPolicy(typeDef, elementIdPath);
    if (!user?.userId) {
      return {
        allowed: false,
        reason: "AUTH_REQUIRED",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority,
      };
    }

    if (user.role === "super_admin") {
      return {
        allowed: true,
        matchedAuthority: "system",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority,
      };
    }

    const userContext = await buildUserAccessContext({ user, passportGuid });
    const sameCompany = passportCompanyId !== null && passportCompanyId !== undefined
      ? Number.parseInt(user.companyId, 10) === Number.parseInt(passportCompanyId, 10)
      : true;

    const matchedAuthority = policy.updateAuthority.find((authority) =>
      userContext.audiences.includes(authority)
    ) || null;

    if (!sameCompany && matchedAuthority !== "delegated_operator") {
      return {
        allowed: false,
        reason: "COMPANY_SCOPE_REQUIRED",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority,
      };
    }

    return {
      allowed: Boolean(matchedAuthority),
      matchedAuthority,
      audiences: policy.access,
      confidentiality: policy.confidentiality,
      updateAuthority: policy.updateAuthority,
    };
  }

  return {
    VALID_AUDIENCES,
    VALID_CONFIDENTIALITY_LEVELS,
    VALID_UPDATE_AUTHORITIES,
    buildFieldPolicy,
    findFieldDefinition,
    loadUserAudiences,
    buildUserAccessContext,
    canReadElement,
    canWriteElement,
  };
};
