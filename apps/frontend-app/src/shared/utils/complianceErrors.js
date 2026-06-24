function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

const companyDashboardHiddenCodes = new Set([
  "fieldAccessMissing",
  "fieldAccessInvalid",
  "fieldConfidentialityMissing",
  "fieldConfidentialityInvalid",
  "fieldUpdateAuthorityMissing",
  "fieldUpdateAuthorityInvalid",
  "controlledAccessLayerMissing",
]);

function dedupeBySignature(items) {
  const seen = new Set();
  return items.filter((item) => {
    const signature = JSON.stringify([
      item?.code || "",
      item?.key || "",
      item?.label || "",
      item?.message || "",
      item?.section || "",
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function getComplianceBlockingIssues(compliance) {
  return dedupeBySignature(
    normalizeList(compliance?.blockingIssues).filter((issue) => !companyDashboardHiddenCodes.has(issue?.code))
  );
}

export function getComplianceMissingFields(compliance) {
  return dedupeBySignature(
    normalizeList(compliance?.completeness?.missingFields).map((field) => ({
      code: field?.mandatory ? "requiredFieldMissing" : "optionalFieldMissing",
      key: field?.key || null,
      label: field?.label || field?.key || "Field",
      section: field?.section || null,
      message: `Field "${field?.label || field?.key || "Field"}" is still missing.`,
      mandatory: Boolean(field?.mandatory),
    }))
  );
}

export function extractComplianceError(payload = {}, fallbackMessage = "Request failed") {
  const compliance = payload?.compliance || null;
  return {
    message: payload?.error || payload?.message || fallbackMessage,
    code: payload?.code || null,
    compliance,
    blockingIssues: getComplianceBlockingIssues(compliance),
    missingFields: getComplianceMissingFields(compliance),
    workflowRequired: Boolean(compliance?.workflowRequired),
  };
}

export function formatComplianceIssueSummary(issue) {
  if (!issue) return "";
  const parts = [];
  if (issue.label || issue.key) parts.push(issue.label || issue.key);
  if (issue.section) parts.push(issue.section);
  const prefix = parts.length ? `${parts.join(" • ")}: ` : "";
  return `${prefix}${issue.message || "Compliance issue detected."}`;
}

export function buildComplianceErrorMessage(payload = {}, options = {}) {
  const {
    maxIssues = 3,
    includeMissingFields = true,
  } = options;
  const error = extractComplianceError(payload, payload?.error || "Request failed");
  const segments = [error.message];
  const issues = error.blockingIssues.slice(0, maxIssues).map(formatComplianceIssueSummary).filter(Boolean);

  if (issues.length) {
    segments.push(`Reasons: ${issues.join(" | ")}`);
    if (error.blockingIssues.length > maxIssues) {
      segments.push(`Plus ${error.blockingIssues.length - maxIssues} more issue${error.blockingIssues.length - maxIssues === 1 ? "" : "s"}.`);
    }
  } else if (includeMissingFields && error.missingFields.length) {
    const missing = error.missingFields
      .filter((field) => field?.mandatory)
      .slice(0, maxIssues)
      .map((field) => field.label || field.key)
      .filter(Boolean);
    if (missing.length) {
      segments.push(`Missing fields: ${missing.join(", ")}.`);
    }
  }

  return segments.filter(Boolean).join(" ");
}
