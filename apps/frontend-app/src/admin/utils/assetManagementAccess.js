import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";

export function getAssetManagementToggleState(company = {}) {
  const currentlyEnabled = company?.assetManagementEnabled === true;
  return {
    currentlyEnabled,
    nextEnabled: !currentlyEnabled,
    actionLabel: currentlyEnabled ? "Disable Asset Management" : "Enable Asset Management",
  };
}

export async function updateAssetManagementAccess({
  companyId,
  enabled,
  apiBase = "",
  request = fetchWithAuth,
}) {
  const normalizedCompanyId = Number(companyId);
  if (!Number.isSafeInteger(normalizedCompanyId) || normalizedCompanyId <= 0) {
    throw new TypeError("companyId must be a positive integer");
  }
  if (typeof enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }

  const response = await request(`${apiBase}/api/admin/companies/${normalizedCompanyId}/asset-management`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ enabled }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to update Asset Management access");
  }
  return data;
}
