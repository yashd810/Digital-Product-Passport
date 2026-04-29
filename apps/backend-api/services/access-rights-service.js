"use strict";

const VALID_AUDIENCES = new Set([
"public",
"consumers",
"notified_bodies",
"market_surveillance",
"customs_authority",
"eu_commission",
"legitimate_interest",
"economic_operator",
"delegated_operator",
"manufacturer",
"authorized_representative",
"importer",
"distributor",
"dealer",
"fulfilment_service_provider",
"professional_repairer",
"independent_operator",
"recycler",
"main_dpp_service_provider",
"backup_dpp_service_provider"]
);

const VALID_CONFIDENTIALITY_LEVELS = new Set([
"public",
"restricted",
"confidential",
"trade_secret",
"regulated"]
);

const VALID_UPDATE_AUTHORITIES = new Set([
"economic_operator",
"delegated_operator",
"manufacturer",
"authorized_representative",
"importer",
"distributor",
"dealer",
"fulfilment_service_provider",
"professional_repairer",
"independent_operator",
"recycler",
"notified_bodies",
"market_surveillance",
"customs_authority",
"eu_commission",
"main_dpp_service_provider",
"backup_dpp_service_provider",
"system"]
);

const AUDIENCE_IMPLICATIONS = new Map([
["public", ["consumers"]],
["economic_operator", [
  "manufacturer",
  "authorized_representative",
  "importer",
  "distributor",
  "dealer",
  "fulfilment_service_provider",
]],
]);

function normalizeList(values) {
  return Array.isArray(values) ?
  values.map((value) => String(value || "").trim()).filter(Boolean) :
  [];
}

function expandAudienceAssignments(values) {
  const queue = normalizeList(values);
  const expanded = new Set(queue);

  while (queue.length) {
    const current = queue.shift();
    for (const implied of AUDIENCE_IMPLICATIONS.get(current) || []) {
      if (expanded.has(implied)) continue;
      expanded.add(implied);
      queue.push(implied);
    }
  }

  return [...expanded];
}

function flattenSchemaFields(typeDef) {
  return (typeDef?.fields_json?.sections || []).
  flatMap((section) => section.fields || []).
  filter((field) => field?.key);
}

function extractRootElementIdPath(elementIdPath) {
  const raw = String(elementIdPath || "").trim();
  if (!raw) return "";

  let normalized = raw;
  if (normalized.startsWith("$")) {
    normalized = normalized.
    replace(/^\$\./, "").
    replace(/^\$/, "").
    replace(/\[['"]([^'"]+)['"]\]/g, ".$1").
    replace(/\[(\d+)\]/g, "").
    replace(/^\./, "");
    if (normalized.startsWith("fields.")) {
      normalized = normalized.slice("fields.".length);
    }
  }

  const match = normalized.match(/^[^.[\]]+/);
  return match ? match[0] : normalized;
}

function normalizeGrantElementIdPath(elementIdPath) {
  const raw = String(elementIdPath || "").trim();
  if (!raw) return null;

  let normalized = raw;
  if (normalized.startsWith("$")) {
    normalized = normalized.replace(/^\$/, "");
  }

  normalized = normalized.
  replace(/^\./, "").
  replace(/\[['"]([^'"]+)['"]\]/g, ".$1").
  replace(/^\./, "");

  if (normalized.startsWith("fields.")) {
    normalized = normalized.slice("fields.".length);
  }

  return normalized || null;
}

function grantPathAppliesToElementPath(grantPath, requestedPath) {
  const normalizedGrant = normalizeGrantElementIdPath(grantPath);
  if (!normalizedGrant) return true;

  const normalizedRequested = normalizeGrantElementIdPath(requestedPath);
  if (!normalizedRequested) return false;
  if (normalizedGrant === normalizedRequested) return true;
  return normalizedRequested.startsWith(`${normalizedGrant}.`) || normalizedRequested.startsWith(`${normalizedGrant}[`);
}

function findFieldDefinition(typeDef, elementIdPath) {
  const normalizedElementIdPath = String(elementIdPath || "").trim();
  if (!normalizedElementIdPath) return null;

  const rootElementIdPath = extractRootElementIdPath(normalizedElementIdPath);
  return flattenSchemaFields(typeDef).find((field) =>
  field.key === normalizedElementIdPath ||
  field.semanticId === normalizedElementIdPath ||
  field.semantic_id === normalizedElementIdPath ||
  field.elementId === normalizedElementIdPath ||
  field.element_id === normalizedElementIdPath ||
  (
    rootElementIdPath &&
    (
      field.key === rootElementIdPath ||
      field.semanticId === rootElementIdPath ||
      field.semantic_id === rootElementIdPath ||
      field.elementId === rootElementIdPath ||
      field.element_id === rootElementIdPath
    )
  )
  ) || null;
}

function defaultUpdateAuthority(fieldDef) {
  const access = normalizeList(fieldDef?.access);
  const authorities = new Set(["economic_operator"]);
  for (const audience of access) {
    if (audience === "public" || audience === "consumers" || audience === "legitimate_interest") continue;
    if (VALID_UPDATE_AUTHORITIES.has(audience)) authorities.add(audience);
  }
  return [...authorities];
}

function buildFieldPolicy(typeDef, elementIdPath) {
  const fieldDef = findFieldDefinition(typeDef, elementIdPath);
  if (!fieldDef) {
    return {
      fieldDef: null,
      elementIdPath,
      access: ["public"],
      confidentiality: "public",
      updateAuthority: ["economic_operator"]
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
    updateAuthority: updateAuthority.length ? updateAuthority : defaultUpdateAuthority(fieldDef)
  };
}

function deriveRoleAudiences(user) {
  if (!user) return expandAudienceAssignments(["public"]);
  if (user.role === "super_admin") {
    return expandAudienceAssignments([...VALID_AUDIENCES]);
  }
  if (["company_admin", "editor", "viewer"].includes(String(user.role || ""))) {
    return expandAudienceAssignments(["public", "legitimate_interest", "economic_operator"]);
  }
  return expandAudienceAssignments(["public"]);
}

function isAuthorizedDelegator(row, targetCompanyId = null) {
  if (!row) return false;
  const role = String(row.grantor_role || "").trim();
  if (!row.grantor_is_active) return false;
  if (role === "super_admin") return true;
  if (role !== "company_admin") return false;
  if (targetCompanyId === null || targetCompanyId === undefined) return true;
  return Number.parseInt(row.grantor_company_id, 10) === Number.parseInt(targetCompanyId, 10);
}

module.exports = function createAccessRightsService({ pool }) {
  async function loadUserAudiences(user) {
    if (!user?.userId) return deriveRoleAudiences(user);

    const roleAudiences = deriveRoleAudiences(user);
    const result = await pool.query(
      `SELECT uaa.audience,
              uaa.company_id,
              uaa.granted_by,
              grantor.role AS grantor_role,
              grantor.company_id AS grantor_company_id,
              COALESCE(grantor.is_active, false) AS grantor_is_active
       FROM user_access_audiences uaa
       LEFT JOIN users grantor ON grantor.id = uaa.granted_by
       WHERE user_id = $1
         AND is_active = true
         AND (company_id IS NULL OR company_id = $2)
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [user.userId, user.companyId ? Number.parseInt(user.companyId, 10) : null]
    ).catch(() => ({ rows: [] }));

    const grantedAudiences = result.rows.
    filter((row) => isAuthorizedDelegator(row, row.company_id ?? user.companyId)).
    map((row) => String(row.audience || "").trim()).
    filter(Boolean);

    return expandAudienceAssignments([...roleAudiences, ...grantedAudiences, ...normalizeList(user.accessAudiences)]);
  }

  async function loadPassportGrantAudiences({ passportDppId, userId, elementIdPath = null, passportCompanyId = null }) {
    if (!passportDppId || !userId) return [];
    const result = await pool.query(
      `SELECT pag.audience,
              pag.element_id_path,
              pag.company_id,
              pag.granted_by,
              grantor.role AS grantor_role,
              grantor.company_id AS grantor_company_id,
              COALESCE(grantor.is_active, false) AS grantor_is_active
       FROM passport_access_grants pag
       LEFT JOIN users grantor ON grantor.id = pag.granted_by
       WHERE pag.passport_dpp_id = $1
         AND pag.grantee_user_id = $2
         AND pag.is_active = true
         AND (pag.expires_at IS NULL OR pag.expires_at > NOW())`,
      [passportDppId, userId]
    ).catch(() => ({ rows: [] }));

    return result.rows.
    filter((row) => isAuthorizedDelegator(row, passportCompanyId ?? row.company_id)).
    filter((row) => grantPathAppliesToElementPath(row.element_id_path, elementIdPath)).
    map((row) => String(row.audience || "").trim()).
    filter(Boolean);
  }

  async function buildUserAccessContext({ user, passportDppId = null, elementIdPath = null, passportCompanyId = null }) {
    const baseAudiences = await loadUserAudiences(user);
    const delegatedAudiences = passportDppId && user?.userId ?
    await loadPassportGrantAudiences({
      passportDppId,
      userId: user.userId,
      elementIdPath,
      passportCompanyId,
    }) :
    [];

    return {
      audiences: expandAudienceAssignments([...baseAudiences, ...delegatedAudiences])
    };
  }

  async function canReadElement({ passportDppId = null, typeDef, elementIdPath, user = null }) {
    const policy = buildFieldPolicy(typeDef, elementIdPath);
    const userContext = await buildUserAccessContext({ user, passportDppId, elementIdPath });
    const matchedAudience = policy.access.find((audience) =>
    audience === "public" || userContext.audiences.includes(audience)
    ) || null;

    return {
      allowed: Boolean(matchedAudience),
      matchedAudience,
      audiences: policy.access,
      confidentiality: policy.confidentiality,
      updateAuthority: policy.updateAuthority,
      fieldDef: policy.fieldDef
    };
  }

  async function canWriteElement({ passportDppId = null, typeDef, elementIdPath, user = null, passportCompanyId = null }) {
    const policy = buildFieldPolicy(typeDef, elementIdPath);
    if (!user?.userId) {
      return {
        allowed: false,
        reason: "AUTH_REQUIRED",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority
      };
    }

    if (user.role === "super_admin") {
      return {
        allowed: true,
        matchedAuthority: "system",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority
      };
    }

    const userContext = await buildUserAccessContext({
      user,
      passportDppId,
      elementIdPath,
      passportCompanyId,
    });
    const sameCompany = passportCompanyId !== null && passportCompanyId !== undefined ?
    Number.parseInt(user.companyId, 10) === Number.parseInt(passportCompanyId, 10) :
    true;

    const matchedAuthority = policy.updateAuthority.find((authority) =>
    userContext.audiences.includes(authority)
    ) || null;

    if (!sameCompany && matchedAuthority !== "delegated_operator") {
      return {
        allowed: false,
        reason: "COMPANY_SCOPE_REQUIRED",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority
      };
    }

    return {
      allowed: Boolean(matchedAuthority),
      matchedAuthority,
      audiences: policy.access,
      confidentiality: policy.confidentiality,
      updateAuthority: policy.updateAuthority
    };
  }

  return {
    VALID_AUDIENCES,
    VALID_CONFIDENTIALITY_LEVELS,
    VALID_UPDATE_AUTHORITIES,
    expandAudienceAssignments,
    buildFieldPolicy,
    extractRootElementIdPath,
    grantPathAppliesToElementPath,
    normalizeGrantElementIdPath,
    findFieldDefinition,
    loadUserAudiences,
    buildUserAccessContext,
    canReadElement,
    canWriteElement
  };
};
