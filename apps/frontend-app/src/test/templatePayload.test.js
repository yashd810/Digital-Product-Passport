import { describe, expect, test } from "vitest";

import { buildUserTemplateFields } from "../user/dashboard/templates/templatePayload";

describe("template payload fields", () => {
  test("contains only populated fields from visible nested sections", () => {
    const sections = [{
      key: "identity",
      fields: [
        { key: "modelName", label: "Model name" },
        { key: "notes", label: "Notes" },
        { key: "enabled", label: "Enabled", type: "boolean" },
      ],
      sections: [{
        key: "details",
        fields: [{ key: "mass", label: "Mass" }],
      }],
    }];
    const values = {
      modelName: "Battery A",
      notes: "   ",
      enabled: false,
      mass: "12",
      injectedSemanticOverride: "not allowed",
    };

    expect(buildUserTemplateFields(sections, values, new Set(["modelName", "enabled"]))).toEqual([
      { fieldKey: "modelName", fieldValue: "Battery A", isModelData: true },
      { fieldKey: "enabled", fieldValue: false, isModelData: true },
      { fieldKey: "mass", fieldValue: "12", isModelData: false },
    ]);
  });

  test("does not submit untouched fields or empty table rows", () => {
    const sections = [{
      key: "data",
      fields: [
        { key: "untouched", label: "Untouched" },
        { key: "composition", label: "Composition", type: "table" },
      ],
    }];

    expect(buildUserTemplateFields(
      sections,
      { composition: [{ material: "", percentage: "" }] },
      new Set()
    )).toEqual([]);
  });
});
