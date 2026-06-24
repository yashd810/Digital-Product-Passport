"use strict";

const validAudiences = new Set([
"public",
"consumers",
"notifiedBodies",
"marketSurveillance",
"customsAuthority",
"euCommission",
"legitimateInterest",
"economicOperator",
"delegatedOperator",
"manufacturer",
"authorizedRepresentative",
"importer",
"distributor",
"dealer",
"fulfilmentServiceProvider",
"professionalRepairer",
"independentOperator",
"recycler",
"mainDppServiceProvider",
"backupDppServiceProvider"]
);

const validConfidentialityLevels = new Set([
"public",
"restricted",
"confidential",
"tradeSecret",
"regulated"]
);

const validUpdateAuthorities = new Set([
"economicOperator",
"delegatedOperator",
"manufacturer",
"authorizedRepresentative",
"importer",
"distributor",
"dealer",
"fulfilmentServiceProvider",
"professionalRepairer",
"independentOperator",
"recycler",
"notifiedBodies",
"marketSurveillance",
"customsAuthority",
"euCommission",
"mainDppServiceProvider",
"backupDppServiceProvider",
"system"]
);

const audienceImplications = new Map([
["public", ["consumers"]],
["economicOperator", [
  "manufacturer",
  "authorizedRepresentative",
  "importer",
  "distributor",
  "dealer",
  "fulfilmentServiceProvider",
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
    for (const implied of audienceImplications.get(current) || []) {
      if (expanded.has(implied)) continue;
      expanded.add(implied);
      queue.push(implied);
    }
  }

  return [...expanded];
}

function flattenSchemaFields(typeDef) {
  return (typeDef?.fieldsJson?.sections || []).
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
    field.elementIdPath === normalizedElementIdPath ||
    field.elementIdPath === rootElementIdPath
  ) || null;
}

function defaultUpdateAuthority(fieldDef) {
  const access = normalizeList(fieldDef?.access);
  const authorities = new Set(["economicOperator"]);
  for (const audience of access) {
    if (audience === "public" || audience === "consumers" || audience === "legitimateInterest") continue;
    if (validUpdateAuthorities.has(audience)) authorities.add(audience);
  }
  return [...authorities];
}

function buildFieldPolicy(typeDef, elementIdPath) {
  const fieldDef = findFieldDefinition(typeDef, elementIdPath);
  if (!fieldDef) {
    return {
      fieldDef: null,
      elementIdPath,
      access: [],
      confidentiality: "unknown",
      updateAuthority: [],
      unknown: true
    };
  }

  const access = normalizeList(fieldDef.access);
  const confidentiality = String(fieldDef.confidentiality || "").trim() || (access.includes("public") ? "public" : "restricted");
  const updateAuthority = normalizeList(fieldDef.updateAuthority);

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
  if (user.role === "superAdmin") {
    return expandAudienceAssignments([...validAudiences]);
  }
  if (["companyAdmin", "editor", "viewer"].includes(String(user.role || ""))) {
    return expandAudienceAssignments(["public", "legitimateInterest", "economicOperator"]);
  }
  return expandAudienceAssignments(["public"]);
}

function isAuthorizedDelegator(row, targetCompanyId = null) {
  if (!row) return false;
  const role = String(row.grantorRole || "").trim();
  if (!row.grantorIsActive) return false;
  if (role === "superAdmin") return true;
  if (role !== "companyAdmin") return false;
  if (targetCompanyId === null || targetCompanyId === undefined) return true;
  return Number.parseInt(row.grantorCompanyId, 10) === Number.parseInt(targetCompanyId, 10);
}

module.exports = function createAccessRightsService({ pool }) {
  async function loadUserAudiences(user) {
    if (!user?.userId) return deriveRoleAudiences(user);

    const roleAudiences = deriveRoleAudiences(user);
    const result = await pool.query(
      `SELECT uaa.audience,
              uaa."companyId" AS "companyId",
              uaa."grantedBy" AS "grantedBy",
              grantor.role AS "grantorRole",
              grantor."companyId" AS "grantorCompanyId",
              COALESCE(grantor."isActive", false) AS "grantorIsActive"
       FROM "userAccessAudiences" uaa
       LEFT JOIN users grantor ON grantor.id = uaa."grantedBy"
       WHERE "userId" = $1
         AND "isActive" = true
         AND ("companyId" IS NULL OR "companyId" = $2)
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
      [user.userId, user.companyId ? Number.parseInt(user.companyId, 10) : null]
    ).catch(() => ({ rows: [] }));

    const grantedAudiences = result.rows.
    filter((row) => isAuthorizedDelegator(row, row.companyId ?? user.companyId)).
    map((row) => String(row.audience || "").trim()).
    filter(Boolean);

    return expandAudienceAssignments([...roleAudiences, ...grantedAudiences, ...normalizeList(user.accessAudiences)]);
  }

  async function loadPassportGrantAudiences({ passportDppId, userId, elementIdPath = null, passportCompanyId = null }) {
    if (!passportDppId || !userId) return [];
    const result = await pool.query(
      `SELECT pag.audience,
              pag."elementIdPath" AS "elementIdPath",
              pag."companyId" AS "companyId",
              pag."grantedBy" AS "grantedBy",
              grantor.role AS "grantorRole",
              grantor."companyId" AS "grantorCompanyId",
              COALESCE(grantor."isActive", false) AS "grantorIsActive"
       FROM "passportAccessGrants" pag
       LEFT JOIN users grantor ON grantor.id = pag."grantedBy"
       WHERE pag."passportDppId" = $1
         AND pag."granteeUserId" = $2
         AND pag."isActive" = true
         AND (pag."expiresAt" IS NULL OR pag."expiresAt" > NOW())`,
      [passportDppId, userId]
    ).catch(() => ({ rows: [] }));

    return result.rows.
    filter((row) => isAuthorizedDelegator(row, passportCompanyId ?? row.companyId)).
    filter((row) => grantPathAppliesToElementPath(row.elementIdPath, elementIdPath)).
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
    if (policy.unknown) {
      return {
        allowed: false,
        reason: "unknownElementPath",
        audiences: [],
        confidentiality: "unknown",
        updateAuthority: [],
        fieldDef: null,
      };
    }
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
    if (policy.unknown) {
      return {
        allowed: false,
        reason: "unknownElementPath",
        audiences: [],
        confidentiality: "unknown",
        updateAuthority: [],
      };
    }
    if (!user?.userId) {
      return {
        allowed: false,
        reason: "authRequired",
        audiences: policy.access,
        confidentiality: policy.confidentiality,
        updateAuthority: policy.updateAuthority
      };
    }

    if (user.role === "superAdmin") {
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

    if (!sameCompany && matchedAuthority !== "delegatedOperator") {
      return {
        allowed: false,
        reason: "companyScopeRequired",
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
    validAudiences,
    validConfidentialityLevels,
    validUpdateAuthorities,
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
