export const defaultCompanyDppPolicy = Object.freeze({
  defaultGranularity: "item",
  allowGranularityOverride: false,
  mintModelDids: true,
  mintItemDids: true,
  mintFacilityDids: false,
  vcIssuanceEnabled: true,
  jsonldExportEnabled: true,
  semanticDictionaryEnabled: true,
});

export const companyDppPolicyBooleanFields = Object.freeze([
  ["allowGranularityOverride", "Allow granularity override"],
  ["mintModelDids", "Mint model DIDs"],
  ["mintItemDids", "Mint item DIDs"],
  ["mintFacilityDids", "Mint facility DIDs"],
  ["vcIssuanceEnabled", "Enable VC issuance"],
  ["jsonldExportEnabled", "Enable JSON-LD export"],
  ["semanticDictionaryEnabled", "Enable semantic dictionaries"],
]);

export function buildCompanyDppPolicyForm(payload = {}) {
  const policy = payload?.policy && typeof payload.policy === "object"
    ? payload.policy
    : payload;
  return {
    defaultGranularity: ["item", "batch", "model"].includes(policy?.defaultGranularity)
      ? policy.defaultGranularity
      : defaultCompanyDppPolicy.defaultGranularity,
    ...Object.fromEntries(companyDppPolicyBooleanFields.map(([field]) => [
      field,
      policy?.[field] === undefined
        ? defaultCompanyDppPolicy[field]
        : policy[field] === true,
    ])),
  };
}
