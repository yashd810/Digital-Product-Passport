import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompanyDppPolicyFields from "../admin/components/CompanyDppPolicyFields";
import {
  buildCompanyDppPolicyForm,
  defaultCompanyDppPolicy,
} from "../admin/utils/companyDppPolicy";

describe("company DPP policy forms", () => {
  it("uses the backend policy defaults for company creation", () => {
    expect(buildCompanyDppPolicyForm()).toEqual(defaultCompanyDppPolicy);
  });

  it("keeps the saved selections when the API wraps its response in policy", () => {
    expect(buildCompanyDppPolicyForm({
      success: true,
      policy: {
        defaultGranularity: "batch",
        allowGranularityOverride: true,
        mintModelDids: false,
        mintItemDids: true,
        mintFacilityDids: true,
        vcIssuanceEnabled: false,
        jsonldExportEnabled: true,
        semanticDictionaryEnabled: false,
      },
    })).toEqual({
      defaultGranularity: "batch",
      allowGranularityOverride: true,
      mintModelDids: false,
      mintItemDids: true,
      mintFacilityDids: true,
      vcIssuanceEnabled: false,
      jsonldExportEnabled: true,
      semanticDictionaryEnabled: false,
    });
  });

  it("renders every policy choice on the company form", () => {
    const markup = renderToStaticMarkup(React.createElement(CompanyDppPolicyFields, {
      policy: buildCompanyDppPolicyForm(),
      onChange: () => {},
      idPrefix: "testPolicy",
    }));

    expect(markup).toContain("Default Granularity");
    expect(markup).toContain("Allow granularity override");
    expect(markup).toContain("Mint model DIDs");
    expect(markup).toContain("Mint item DIDs");
    expect(markup).toContain("Mint facility DIDs");
    expect(markup).toContain("Enable VC issuance");
    expect(markup).toContain("Enable JSON-LD export");
    expect(markup).toContain("Enable semantic dictionaries");
  });
});
