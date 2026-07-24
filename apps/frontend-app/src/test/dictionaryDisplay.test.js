import { describe, expect, it } from "vitest";

import {
  getLocalSemanticLabel,
  getSemanticReferenceDisplay,
} from "../shared/dictionary/DictionaryBrowserPage";

describe("dictionary semantic reference display", () => {
  it("uses the local human label instead of a section breadcrumb", () => {
    expect(getLocalSemanticLabel(
      "Performance and Durability > Abuse Events and Incident History > Electrical Abuse Events"
    )).toBe("Electrical Abuse Events");

    expect(getSemanticReferenceDisplay({
      label: "Performance and Durability > Abuse Events and Incident History > Electrical Abuse Events",
      curie: "battery:electricalAbuseEvents",
      key: "electricalAbuseEvents",
    })).toEqual({
      primary: "Electrical Abuse Events",
      secondary: "battery:electricalAbuseEvents",
    });
  });

  it("shows a human datatype first and keeps a clean CURIE as secondary context", () => {
    expect(getSemanticReferenceDisplay({
      label: "Integer",
      curie: "xsd:integer",
    })).toEqual({
      primary: "Integer",
      secondary: "xsd:integer",
    });
  });

  it("does not expose URLs or malformed identifiers as secondary CURIEs", () => {
    expect(getSemanticReferenceDisplay({
      label: "Battery Passport",
      curie: "https://claros-dpp.online/dictionary/battery/v1/classes/BatteryPassportV1",
    })).toEqual({
      primary: "Battery Passport",
      secondary: "",
    });
  });

  it("falls back to a readable key or datatype label", () => {
    expect(getSemanticReferenceDisplay({ key: "abuseEventsAndIncidentHistory" })).toEqual({
      primary: "Abuse events and incident history",
      secondary: "",
    });
    expect(getSemanticReferenceDisplay({}, "decimal").primary).toBe("Decimal");
  });
});
