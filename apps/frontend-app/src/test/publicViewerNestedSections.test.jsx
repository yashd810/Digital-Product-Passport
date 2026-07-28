import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import PublicPassportPortal, {
  DataNestedSection,
} from "../passport-viewer/components/PublicPassportPortal";

const nestedSections = [{
  key: "root",
  label: "Root section",
  fields: [{ key: "rootField", label: "Root field", type: "text", confidentiality: "public" }],
  sections: [{
    key: "subsection",
    label: "Subsection",
    fields: [{ key: "subField", label: "Sub field", type: "text", confidentiality: "public" }],
    sections: [{
      key: "subSubsection",
      label: "Sub-subsection",
      fields: [{ key: "deepField", label: "Deep field", type: "text", confidentiality: "public" }],
      sections: [{
        key: "levelFour",
        label: "Level four",
        fields: [{ key: "levelFourField", label: "Level four field", type: "text", confidentiality: "public" }],
      }],
    }],
  }],
}];

describe("public viewer nested data sections", () => {
  test("shows Data as the only viewer tab and does not render a separate header tab", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport", rootField: "Root value" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{ fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );

    expect(markup.match(/role="tab"/g)).toHaveLength(1);
    expect(markup).toContain(">Data<");
    expect(markup).not.toContain(">Header<");
    expect(markup).not.toContain("Passport Header");
  });

  test("renders a composition chart for every configured field", () => {
    const compositionFields = [
      {
        key: "materialComposition",
        label: "Material composition",
        type: "table",
        semanticId: "https://example.test/terms/material-composition",
        rangeKind: "class",
        rangeClassKey: "materialEntry",
        relationshipType: "composition",
        minCount: 0,
        maxCount: null,
        confidentiality: "public",
        composition: true,
        compositionLabelColumnKey: "material",
        compositionValueColumnKey: "share",
        columns: [
          { key: "material", label: "Material", dataType: "string" },
          { key: "share", label: "Share", dataType: "decimal" },
        ],
      },
      {
        key: "recycledComposition",
        label: "Recycled composition",
        type: "table",
        semanticId: "https://example.test/terms/recycled-composition",
        rangeKind: "class",
        rangeClassKey: "recycledEntry",
        relationshipType: "composition",
        minCount: 0,
        maxCount: null,
        confidentiality: "public",
        composition: true,
        compositionLabelColumnKey: "source",
        compositionValueColumnKey: "percentage",
        columns: [
          { key: "source", label: "Source", dataType: "string" },
          { key: "percentage", label: "Percentage", dataType: "decimal" },
        ],
      },
    ];
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          materialComposition: [
            { material: "Steel", share: 60 },
            { material: "Aluminium", share: 40 },
          ],
          recycledComposition: [
            { source: "Post-consumer", percentage: 70 },
            { source: "Pre-consumer", percentage: 30 },
          ],
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          displayName: "Example Passport",
          fieldsJson: {
            sections: [{ key: "composition", label: "Composition", fields: compositionFields }],
            semanticGraph: {
              rootClassKey: "examplePassport",
              classes: [
                {
                  key: "examplePassport",
                  properties: compositionFields,
                },
                {
                  key: "materialEntry",
                  label: "Material entry",
                  properties: [
                    { key: "material", label: "Material", rangeKind: "scalar", dataType: "string" },
                    { key: "share", label: "Share", rangeKind: "scalar", dataType: "decimal" },
                  ],
                },
                {
                  key: "recycledEntry",
                  label: "Recycled entry",
                  properties: [
                    { key: "source", label: "Source", rangeKind: "scalar", dataType: "string" },
                    { key: "percentage", label: "Percentage", rangeKind: "scalar", dataType: "decimal" },
                  ],
                },
              ],
              enums: [],
            },
          },
        }}
        lang="en"
      />
    );

    expect(markup.match(/class="pie-container"/g)).toHaveLength(2);
    expect(markup.match(/class="inline-table"/g)).toHaveLength(2);
    expect(markup).not.toContain("semantic-value-list");
    expect(markup).toContain("Steel");
    expect(markup).toContain("Post-consumer");
  });

  test("keeps root sections in side navigation and renders every nested level as a dropdown", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          releaseStatus: "published",
          rootField: "Root value",
          subField: "Sub value",
          deepField: "Deep value",
          levelFourField: "Level four value",
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          displayName: "Example Passport",
          fieldsJson: { sections: nestedSections },
        }}
        lang="en"
      />
    );

    expect(markup.match(/<aside class="data-section-nav"/g)).toHaveLength(1);
    expect(markup.match(/<details class="category data-section-dropdown data-nested-section/g)).toHaveLength(3);
    expect(markup).toContain('data-section-depth="1"');
    expect(markup).toContain('data-section-depth="2"');
    expect(markup).toContain('data-section-depth="3"');
    expect(markup).not.toContain('data-section-depth="0"');
    expect(markup).toContain("Subsection");
    expect(markup).toContain("Sub-subsection");
    expect(markup).toContain("Level four");
  });

  test("connects each native dropdown summary to its content and exposes its state", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport" }}
        companyData={{}}
        typeDef={{ fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );
    const summaries = markup.match(/<summary[^>]*>/g) || [];
    const controlledContentIds = summaries.map((summary) => (
      summary.match(/aria-controls="([^"]+)"/)?.[1]
    ));

    expect(summaries).toHaveLength(3);
    expect(summaries[0]).toContain('aria-expanded="true"');
    expect(summaries.slice(1).every((summary) => summary.includes('aria-expanded="false"'))).toBe(true);
    expect(controlledContentIds).toHaveLength(3);
    controlledContentIds.forEach((contentId) => {
      expect(contentId).toBeTruthy();
      expect(markup).toContain(`id="${contentId}"`);
    });
    expect(markup.indexOf("Sub field")).toBeGreaterThan(markup.indexOf("Subsection"));
    expect(markup.indexOf("Deep field")).toBeGreaterThan(markup.indexOf("Sub-subsection"));
    expect(markup.indexOf("Level four field")).toBeGreaterThan(markup.indexOf("Level four"));
    expect(markup).toContain('role="heading" aria-level="4"');
    expect(markup).toContain('role="heading" aria-level="5"');
    expect(markup).toContain('role="heading" aria-level="6"');
  });

  test.each([
    [2, nestedSections[0].sections[0].sections[0], "Deep field"],
    [3, nestedSections[0].sections[0].sections[0].sections[0], "Level four field"],
  ])("renders a depth-%i section's fields inside its expanded control", (depth, section, fieldLabel) => {
    const markup = renderToStaticMarkup(
      <DataNestedSection
        section={section}
        depth={depth}
        defaultExpanded
        lang="en"
        passport={{
          deepField: "Deep value",
          levelFourField: "Level four value",
        }}
      />
    );

    expect(markup).toMatch(new RegExp(`<details[^>]+data-section-depth="${depth}"[^>]+open=""`));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(fieldLabel);
  });
});
