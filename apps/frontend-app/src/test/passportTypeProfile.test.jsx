import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ModuleFieldProfile } from "../admin/passport-types/AdminCreatePassportTypePage";
import {
  applyProfileDependencies,
  buildPassportTypeProfile,
  buildProfileFieldDependencies,
  buildProfileSectionsFromModule,
  getPassportTypeProfileStats,
  getProfileSectionSelection,
  isProfileFieldIncluded,
  setProfileFieldIncluded,
  setProfileFieldRequired,
  setProfileSectionIncluded,
} from "../admin/passport-types/AdminCreatePassportTypeHelpers";
import { getSectionTreeEntries } from "../admin/passport-types/nestedSchemaReview";

const moduleSections = [{
  key: "generalInformation",
  label: "General information",
  fields: [{
    key: "modelIdentifier",
    label: "Model identifier",
    type: "text",
    semanticId: "https://example.test/terms/modelIdentifier",
    domainClassKey: "generalInformation",
    confidentiality: "public",
  }],
  sections: [{
    key: "manufacturer",
    label: "Manufacturer",
    fields: [{
      key: "manufacturerName",
      label: "Manufacturer name",
      type: "text",
      semanticId: "https://example.test/terms/manufacturerName",
      domainClassKey: "manufacturer",
      confidentiality: "public",
    }],
  }, {
    key: "composition",
    label: "Composition",
    fields: [{
      key: "materialComposition",
      label: "Material composition",
      type: "table",
      semanticId: "https://example.test/terms/materialComposition",
      domainClassKey: "composition",
      confidentiality: "public",
      composition: true,
      compositionLabelColumnKey: "material",
      compositionValueColumnKey: "share",
      tableColumns: [
        { key: "material", label: "Material", dataType: "string" },
        { key: "share", label: "Share", dataType: "decimal" },
      ],
    }],
  }],
}];

function fieldByKey(sections, key) {
  for (const section of sections) {
    const field = (section.fields || []).find((entry) => entry.key === key);
    if (field) return field;
    const nested = fieldByKey(section.sections || [], key);
    if (nested) return nested;
  }
  return null;
}

function sectionByKey(sections, key) {
  for (const section of sections) {
    if (section.key === key) return section;
    const nested = sectionByKey(section.sections || [], key);
    if (nested) return nested;
  }
  return null;
}

function buildEditableSections() {
  return buildProfileSectionsFromModule(moduleSections, moduleSections, "battery:v1");
}

describe("module-backed passport type field profiles", () => {
  test("section cascade keeps nested hierarchy and reports an indeterminate branch", () => {
    const initial = buildEditableSections();
    const manufacturer = sectionByKey(initial, "manufacturer");
    const cleared = setProfileSectionIncluded(initial, manufacturer.localId, false);

    expect(isProfileFieldIncluded(fieldByKey(cleared, "modelIdentifier"))).toBe(true);
    expect(isProfileFieldIncluded(fieldByKey(cleared, "manufacturerName"))).toBe(false);
    expect(isProfileFieldIncluded(fieldByKey(cleared, "materialComposition"))).toBe(true);
    expect(getProfileSectionSelection(cleared[0])).toMatchObject({
      total: 3,
      included: 2,
      checked: false,
      indeterminate: true,
    });

    const restored = setProfileSectionIncluded(cleared, manufacturer.localId, true);
    expect(getProfileSectionSelection(restored[0])).toMatchObject({
      total: 3,
      included: 3,
      checked: true,
      indeterminate: false,
    });
  });

  test("required automatically includes an excluded field", () => {
    const initial = buildEditableSections();
    const chart = fieldByKey(initial, "materialComposition");
    const excluded = setProfileFieldIncluded(initial, chart.localId, false);
    expect(isProfileFieldIncluded(fieldByKey(excluded, "materialComposition"))).toBe(false);

    const required = setProfileFieldRequired(excluded, chart.localId, true);
    expect(fieldByKey(required, "materialComposition")).toMatchObject({
      _included: true,
      required: true,
    });
  });

  test("business identifier and header fields stay included when their branch is cleared", () => {
    const initial = buildEditableSections();
    const dependencies = buildProfileFieldDependencies({
      identity: { businessIdentifierField: "modelIdentifier" },
      systemHeader: {
        fieldMappings: [{
          slotKey: "manufacturer",
          sourceType: "field",
          fieldKey: "manufacturerName",
        }],
      },
    });
    const locked = applyProfileDependencies(initial, dependencies);
    const cleared = setProfileSectionIncluded(locked, locked[0].localId, false, dependencies);

    expect(isProfileFieldIncluded(fieldByKey(cleared, "modelIdentifier"))).toBe(true);
    expect(isProfileFieldIncluded(fieldByKey(cleared, "manufacturerName"))).toBe(true);
    expect(isProfileFieldIncluded(fieldByKey(cleared, "materialComposition"))).toBe(false);
    expect(dependencies.modelIdentifier.reasons[0]).toContain("Business identifier");
    expect(dependencies.manufacturerName.reasons[0]).toContain("Passport header mapping");
  });

  test("module minCount invariants stay included and required", () => {
    const initial = buildEditableSections();
    const requiredModuleSections = structuredClone(moduleSections);
    requiredModuleSections[0].fields[0].minCount = 1;
    const dependencies = buildProfileFieldDependencies({ sections: requiredModuleSections });
    const locked = applyProfileDependencies(initial, dependencies);
    const modelField = fieldByKey(locked, "modelIdentifier");
    const cleared = setProfileSectionIncluded(locked, locked[0].localId, false, dependencies);
    const attemptedOptional = setProfileFieldRequired(cleared, modelField.localId, false, dependencies);

    expect(fieldByKey(attemptedOptional, "modelIdentifier")).toMatchObject({
      _included: true,
      required: true,
    });
    expect(dependencies.modelIdentifier).toMatchObject({ required: true });
    expect(dependencies.modelIdentifier.reasons[0]).toContain("minCount 1");
  });

  test("an excluded chart field is omitted instead of becoming a dependency or validation blocker", () => {
    const initial = buildEditableSections();
    const chart = fieldByKey(initial, "materialComposition");
    const excluded = setProfileFieldIncluded(initial, chart.localId, false);
    const profile = buildPassportTypeProfile({
      sections: excluded,
      identity: { businessIdentifierField: "modelIdentifier" },
      systemHeader: { fieldMappings: [] },
    });

    expect(profile.includedFields.map((field) => field.sourceModuleFieldKey)).toEqual([
      "modelIdentifier",
      "manufacturerName",
    ]);
    expect(profile.includedFields.some((field) => field.composition)).toBe(false);
    expect(getPassportTypeProfileStats(excluded)).toMatchObject({
      totalFields: 3,
      includedFields: 2,
      excludedFields: 1,
    });
  });

  test("nested section label translations serialize as canonical section overrides", () => {
    const sections = buildEditableSections();
    const manufacturer = sectionByKey(sections, "manufacturer");
    manufacturer.labelI18n = { sv: "Tillverkare", de: "" };

    const profile = buildPassportTypeProfile({ sections });
    expect(profile.sectionOverrides).toEqual([{
      sourceModuleSectionKey: "manufacturer",
      labelI18n: { sv: "Tillverkare" },
    }]);
  });

  test("compact profile UI exposes inclusion, required state, search, counts, and dependency explanations", () => {
    const sections = buildEditableSections();
    const dependencies = buildProfileFieldDependencies({
      identity: { businessIdentifierField: "modelIdentifier" },
      systemHeader: { fieldMappings: [] },
    });
    const markup = renderToStaticMarkup(
      <ModuleFieldProfile
        entries={getSectionTreeEntries(sections)}
        stats={getPassportTypeProfileStats(sections)}
        dependencies={dependencies}
        dependencyCount={1}
        search=""
        selectedOnly={false}
        notice="Profile updated"
        onSearch={() => {}}
        onSelectedOnly={() => {}}
        onSelectAll={() => {}}
        onClearOptional={() => {}}
        onToggleSection={() => {}}
        onToggleCollapse={() => {}}
        onUpdateSection={() => {}}
        onToggleField={() => {}}
        onToggleRequired={() => {}}
        onUpdateField={() => {}}
      />,
    );

    expect(markup).toContain("3 of 3 fields included");
    expect(markup).toContain("Search fields and sections");
    expect(markup).toContain("Included only");
    expect(markup).toContain("Clear optional");
    expect(markup).toContain("Business identifier for this passport type");
    expect(markup).toContain("Composition chart");
    expect(markup).toContain('data-testid="module-field-profile"');
  });

  test("the module-only workflow shows a clear empty state before a source is selected", () => {
    const markup = renderToStaticMarkup(
      <ModuleFieldProfile emptyState="Select a Passport Module Source above." />,
    );

    expect(markup).toContain("Select a Passport Module Source above.");
    expect(markup).toContain('data-testid="module-field-profile-empty"');
    expect(markup).not.toContain("Add Field");
  });
});
