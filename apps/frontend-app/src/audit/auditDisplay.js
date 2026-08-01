// Converts backend audit events into consistent, user-readable display data.
const auditAcronyms = new Map([
  ["api", "API"],
  ["apis", "APIs"],
  ["csv", "CSV"],
  ["did", "DID"],
  ["dids", "DIDs"],
  ["dpp", "DPP"],
  ["eori", "EORI"],
  ["id", "ID"],
  ["ids", "IDs"],
  ["jsonld", "JSON-LD"],
  ["qr", "QR"],
  ["uri", "URI"],
  ["url", "URL"],
  ["vc", "VC"],
]);

const auditActionLabels = new Map([
  ["activatePassportType", "Activated passport type"],
  ["approveSuperAdminInvite", "Approved super-admin invitation"],
  ["archive", "Archived passport"],
  ["bulkHardDelete", "Permanently deleted passports in bulk"],
  ["bulkRevise", "Revised passports in bulk"],
  ["bulkUpdateAll", "Updated passports in bulk"],
  ["create", "Created passport"],
  ["createCompany", "Created company"],
  ["createPassportType", "Created passport type"],
  ["createProductCategory", "Created product category"],
  ["createSymbol", "Created symbol"],
  ["deactivatePassportType", "Deactivated passport type"],
  ["delete", "Deleted passport"],
  ["deleteCompany", "Deleted company"],
  ["deletePassportType", "Deleted passport type"],
  ["deleteProductCategory", "Deleted product category"],
  ["deleteSymbol", "Deleted symbol"],
  ["declineSuperAdminInvite", "Declined super-admin invitation"],
  ["grantPassportTypeAccess", "Granted passport type access"],
  ["hardDelete", "Permanently deleted passport"],
  ["release", "Released passport"],
  ["revise", "Revised passport"],
  ["restoreSuperAdminAccess", "Restored super-admin access"],
  ["revokePassportTypeAccess", "Revoked passport type access"],
  ["revokeSuperAdminAccess", "Revoked super-admin access"],
  ["requestSuperAdminInvite", "Requested super-admin invitation"],
  ["setAssetManagementEnabled", "Updated asset management access"],
  ["submitReview", "Submitted passport for review"],
  ["transitionGranularity", "Changed passport granularity"],
  ["unarchive", "Restored archived passport"],
  ["update", "Updated passport"],
  ["updateCompany", "Updated company"],
  ["updateCompanyDppPolicy", "Updated company DPP policy"],
  ["updateCompanyUserRole", "Updated company user role"],
  ["updateDynamicValues", "Updated dynamic values"],
  ["updatePassportTypeMetadata", "Updated passport type"],
  ["upload", "Uploaded file"],
]);

function identifierWords(value) {
  return String(value || "")
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[._\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function formatWord(value) {
  const normalized = String(value || "").toLowerCase();
  return auditAcronyms.get(normalized) || normalized;
}

function humanizeIdentifier(value, fallback) {
  const words = identifierWords(value).map(formatWord);
  if (!words.length) return fallback;

  const [first, ...rest] = words;
  const firstWord = auditAcronyms.has(first.toLowerCase())
    ? first
    : `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
  return [firstWord, ...rest].join(" ");
}

export function formatAuditAction(action) {
  const rawAction = String(action || "").trim();
  return auditActionLabels.get(rawAction) || humanizeIdentifier(rawAction, "Activity");
}

export function formatAuditEntity(tableName) {
  return humanizeIdentifier(tableName, "Record");
}

export function formatAuditActor(log = {}) {
  const firstName = log.userFirstName || log.actorFirstName || "";
  const lastName = log.userLastName || log.actorLastName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || log.userEmail || log.actorEmail || log.actorIdentifier || "System";
}

export function getAuditChangedFieldLabels(log = {}) {
  const keys = new Set([
    ...(Array.isArray(log.changedFields) ? log.changedFields : []),
    ...Object.keys(log.oldValues || {}),
    ...Object.keys(log.newValues || {}),
  ]);
  return [...keys]
    .map((key) => formatAuditEntity(key))
    .sort((left, right) => left.localeCompare(right));
}

export function getAuditActionKind(action) {
  const normalized = identifierWords(action).join("").toLowerCase();
  if (/delete|remove|revoke|disable|decline/.test(normalized)) return "delete";
  if (/release|publish/.test(normalized)) return "release";
  if (/revis/.test(normalized)) return "revise";
  if (/create|add|grant|enable|approve|invite/.test(normalized)) return "create";
  if (/update|edit|patch|set|change|submit|review/.test(normalized)) return "update";
  return "neutral";
}

export function getAuditActionOptions(logs) {
  const actions = [...new Set(
    (Array.isArray(logs) ? logs : [])
      .map((log) => String(log?.action || "").trim())
      .filter(Boolean),
  )];

  return actions
    .map((value) => ({ value, label: formatAuditAction(value) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function filterAuditLogs(logs, {
  user = "",
  action = "",
  dateFrom = "",
  dateTo = "",
  company = "",
} = {}) {
  const userQuery = String(user).trim().toLowerCase();
  const companyQuery = String(company).trim().toLowerCase();
  const fromTimestamp = dateFrom ? new Date(`${dateFrom}T00:00:00.000`).getTime() : null;
  const toTimestamp = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

  return (Array.isArray(logs) ? logs : []).filter((log) => {
    if (userQuery) {
      const actor = [
        formatAuditActor(log),
        log.userEmail,
        log.actorEmail,
        log.actorIdentifier,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!actor.includes(userQuery)) return false;
    }
    if (action && log.action !== action) return false;
    if (companyQuery && !String(log.companyName || "Platform-wide").toLowerCase().includes(companyQuery)) {
      return false;
    }

    if (fromTimestamp || toTimestamp) {
      const timestamp = new Date(log.createdAt).getTime();
      if (!Number.isFinite(timestamp)) return false;
      if (fromTimestamp && timestamp < fromTimestamp) return false;
      if (toTimestamp && timestamp > toTimestamp) return false;
    }
    return true;
  });
}

export function isCompanyDashboardAuditEvent(log = {}) {
  const audience = String(log.audience || "").trim().toLowerCase();
  if (audience === "superadmin") return false;
  const actorRole = String(log.actorRole || log.userRole || "").trim().toLowerCase();
  return actorRole !== "superadmin";
}

function escapeCsvValue(value) {
  const rawText = String(value ?? "");
  const text = /^\s*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildAuditCsv(
  logs,
  formatTimestamp = (value) => new Date(value).toLocaleString(),
  { includeCompany = false } = {},
) {
  const headers = ["Timestamp", "User", ...(includeCompany ? ["Company"] : []), "Action", "Entity", "Record ID"];
  const rows = (Array.isArray(logs) ? logs : []).map((log) => [
    formatTimestamp(log.createdAt),
    formatAuditActor(log),
    ...(includeCompany ? [log.companyName || "Platform-wide"] : []),
    formatAuditAction(log.action),
    formatAuditEntity(log.tableName),
    log.recordId || "",
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}
