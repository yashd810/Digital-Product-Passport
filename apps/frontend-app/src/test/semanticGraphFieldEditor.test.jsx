import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import SemanticGraphFieldEditor from "../shared/passports/SemanticGraphFieldEditor";

describe("semantic graph data entry", () => {
  test("uses semantic structure for nested fields without exposing semantic metadata", () => {
    const markup = renderToStaticMarkup(
      <SemanticGraphFieldEditor
        hideRootLabel
        graph={{
          classes: [{
            key: "batteryDetails",
            label: "Battery details",
            semanticId: "https://claros-dpp.online/classes/battery-details",
            definition: "A semantic class definition that must stay out of data entry.",
            properties: [{
              key: "capacity",
              label: "Capacity",
              semanticId: "https://claros-dpp.online/terms/capacity",
              definition: "A semantic property definition that must stay out of data entry.",
              rangeKind: "scalar",
              dataType: "decimal",
              minCount: 1,
              maxCount: 1,
            }],
          }],
          enums: [],
        }}
        property={{
          key: "details",
          label: "Details",
          semanticId: "https://claros-dpp.online/terms/details",
          rangeKind: "class",
          rangeClassKey: "batteryDetails",
          relationshipType: "composition",
          minCount: 1,
          maxCount: 1,
        }}
        value={{ capacity: 120 }}
        disabled={false}
        onChange={() => {}}
      />
    );

    expect(markup).toContain("Capacity");
    expect(markup).toContain('value="120"');
    expect(markup).not.toContain("Class IRI");
    expect(markup).not.toContain("batteryDetails");
    expect(markup).not.toContain("semantic class definition");
    expect(markup).not.toContain("semantic property definition");
  });
});
