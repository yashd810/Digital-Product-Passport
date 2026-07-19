import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { flattenSchemaFieldsFromSections } from "../shared/passports/passportSchemaUtils";

const nestedSections = [
  {
    key: "product",
    label: "Product",
    fields: [{ key: "model", label: "Model" }],
    sections: [
      {
        key: "materials",
        label: "Materials",
        fields: [{ key: "mass", label: "Mass" }],
        sections: [
          {
            key: "recycled-content",
            label: "Recycled content",
            fields: [{ key: "recycledPercentage", label: "Recycled percentage" }],
          },
        ],
      },
    ],
  },
];

describe("nested schema consumers", () => {
  test("canonical flattening retains fields from every section depth", () => {
    const fields = flattenSchemaFieldsFromSections(nestedSections);

    expect(fields.map((field) => field.key)).toEqual([
      "model",
      "mass",
      "recycledPercentage",
    ]);
    expect(fields.find((field) => field.key === "recycledPercentage")?.sectionPath.map((entry) => entry.key)).toEqual([
      "product",
      "materials",
      "recycled-content",
    ]);
  });

  test("passport forms render direct fields and recurse into child sections", () => {
    const source = readFileSync(
      new URL("../passports/form/PassportFormPage.js", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const renderSchemaSectionTree");
    expect(source).toContain("const renderSchemaFields");
    expect(source).toContain("childSections.map((child, childIndex)");
    expect(source).not.toContain("flattenSchemaFieldsFromSections([section])");
  });

  test("template editing renders and saves fields from the full section tree", () => {
    const source = readFileSync(
      new URL("../user/dashboard/templates/TemplatesPage.js", import.meta.url),
      "utf8",
    );

    expect(source).toContain("setSections(normalizeSchemaSections(data.fieldsJson.sections))");
    expect(source).toContain("flattenSchemaFieldsFromSections(sections || [])");
    expect(source).toContain("const renderTemplateSection");
    expect(source).toContain("childSections.map((child, childIndex)");
  });
});
