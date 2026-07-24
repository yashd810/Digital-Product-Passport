import { describe, expect, test } from "vitest";

import {
  filterPassportDataEntrySections,
  getPassportDataEntryFieldKeys,
  isSemanticRelationshipsSection,
  selectPassportDataEntryValues,
} from "../shared/passports/passportSchemaVisibility";
import { flattenSchemaFieldsFromSections } from "../shared/passports/passportSchemaUtils";

describe("passport data-entry schema visibility", () => {
  test("removes generated semantic relationships while preserving nested data fields and annotations", () => {
    const ratedCapacity = {
      key: "ratedCapacity",
      label: "Rated capacity",
      dataType: "integer",
      semanticId: "https://claros-dpp.online/dictionary/battery/v1/terms/rated-capacity",
      rangeKind: "scalar",
      unit: "Ah",
    };
    const sections = [
      {
        key: "generalInformation",
        label: "General Information",
        fields: [{ key: "manufacturerName", label: "Manufacturer name", semanticSlug: "manufacturer-name" }],
      },
      {
        key: "performanceAndDurability",
        label: "Performance and Durability",
        fields: [],
        sections: [
          {
            key: "batteryRating",
            label: "Battery Rating",
            fields: [ratedCapacity],
            sections: [
              {
                key: "semanticRelationships",
                label: "Semantic Relationships",
                fields: [{ key: "hiddenNestedRelationship", rangeKind: "class" }],
              },
            ],
          },
        ],
      },
      {
        key: "semanticRelationships",
        label: "Semantic Relationships",
        fields: [
          {
            key: "generalInformation",
            label: "General Information",
            presentation: "semanticTree",
            relationshipType: "composition",
            rangeKind: "class",
          },
        ],
      },
    ];

    const visibleSections = filterPassportDataEntrySections(sections);
    const visibleFields = flattenSchemaFieldsFromSections(visibleSections);

    expect(visibleSections.map((section) => section.key)).toEqual([
      "generalInformation",
      "performanceAndDurability",
    ]);
    expect(visibleFields.map((field) => field.key)).toEqual([
      "manufacturerName",
      "ratedCapacity",
    ]);
    expect(visibleFields.find((field) => field.key === "ratedCapacity")).toMatchObject({
      semanticId: ratedCapacity.semanticId,
      rangeKind: "scalar",
      unit: "Ah",
    });
    expect(visibleSections[1].sections[0].sections).toEqual([]);
    expect(sections[2].fields[0].relationshipType).toBe("composition");

    const recordValues = selectPassportDataEntryValues({
      manufacturerName: "Claros Batteries",
      ratedCapacity: 120,
      generalInformation: { manufacturerName: "duplicate semantic wrapper" },
      hiddenNestedRelationship: { value: "not record data" },
    }, visibleSections);
    expect(recordValues).toEqual({
      manufacturerName: "Claros Batteries",
      ratedCapacity: 120,
    });
    expect([...getPassportDataEntryFieldKeys(visibleSections)]).toEqual([
      "manufacturerName",
      "ratedCapacity",
    ]);
  });

  test("uses the generated section key rather than hiding an ordinary section by label", () => {
    expect(isSemanticRelationshipsSection({ key: "semanticRelationships", label: "Anything" })).toBe(true);
    expect(isSemanticRelationshipsSection({ key: "customerNotes", label: "Semantic Relationships" })).toBe(false);
    expect(isSemanticRelationshipsSection({ key: "SemanticRelationships" })).toBe(false);
  });

  test("does not mutate an unchanged section tree", () => {
    const original = [{ key: "product", fields: [{ key: "name" }], sections: [] }];
    const filtered = filterPassportDataEntrySections(original);

    expect(filtered).not.toBe(original);
    expect(filtered[0]).toBe(original[0]);
    expect(filtered[0].fields).toBe(original[0].fields);
  });
});
