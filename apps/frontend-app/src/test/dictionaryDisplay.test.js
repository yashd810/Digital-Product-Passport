import { describe, expect, it } from "vitest";

import {
  getDictionaryValueConstraint,
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

  it("names RDF and SHACL value constraints by their semantic kind", () => {
    expect(getDictionaryValueConstraint({ rangeKind: "scalar", range: { label: "String" } }).label)
      .toBe("Value datatype");
    expect(getDictionaryValueConstraint({ rangeKind: "class", range: { label: "Postal address" } }).label)
      .toBe("Value class");
    expect(getDictionaryValueConstraint({ rangeKind: "enum", range: { label: "Battery status" } }).label)
      .toBe("Allowed values");
  });

  it("uses search without class-filter tags in the dictionary toolbar", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../shared/dictionary/DictionaryBrowserPage.js", import.meta.url),
      "utf8"
    ));

    expect(source).toContain('placeholder="Search terms, field keys, definitions..."');
    expect(source).not.toContain("dictionary-class-row");
    expect(source).not.toContain("setActiveClass");
  });
});
