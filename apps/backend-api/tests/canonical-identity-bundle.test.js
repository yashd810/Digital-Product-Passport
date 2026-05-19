"use strict";

const createDidService = require("../services/did-service");
const createProductIdentifierService = require("../services/product-identifier-service");
const { buildCanonicalIdentityBundle } = require("../src/shared/identifiers/canonical-identity-bundle");

describe("buildCanonicalIdentityBundle", () => {
  test("derives company, subject, dpp, and product identifiers from company and passport data", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://app.claros-dpp.online",
      apiOrigin: "https://api.claros-dpp.online",
    });
    const productIdentifierService = createProductIdentifierService({ didService });

    const bundle = buildCanonicalIdentityBundle({
      passport: {
        dppId: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "trial_1_dbp",
        product_id: "123456789",
        granularity: "item",
      },
      company: {
        id: 5,
        company_name: "King Kong",
        did_slug: "king-kong",
        default_granularity: "item",
      },
      didService,
      productIdentifierService,
    });

    expect(bundle.companyDid).toBe("did:web:www.claros-dpp.online:did:company:king-kong");
    expect(bundle.subjectDid).toBe("did:web:www.claros-dpp.online:did:king-kong:item:72b99c83-952c-4179-96f6-54a513d39dbc");
    expect(bundle.dppDid).toBe("did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc");
    expect(bundle.uniqueProductIdentifier).toMatch(/^did:web:www\.claros-dpp\.online:did:king-kong:item:/);
  });
});
