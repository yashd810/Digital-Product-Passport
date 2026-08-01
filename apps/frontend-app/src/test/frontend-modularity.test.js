import { readFileSync } from "node:fs";
import React from "react";
import { describe, expect, test } from "vitest";

import {
  buildProductCategoryOptions,
  resolveSystemHeaderEntries,
} from "../admin/passport-types/builderHelpers";
import {
  serializeCompositionMetadata,
} from "../admin/passport-types/AdminCreatePassportTypeHelpers";
import {
  buildNestedSchemaReview,
  getSectionTreeEntries,
  maxNestedSectionDepth,
} from "../admin/passport-types/nestedSchemaReview";
import {
  buildSemanticModelOptions,
  deriveSemanticTermDataType,
  formatSemanticModelLabel,
  getSemanticModelOption,
} from "../admin/passport-types/semanticTermCatalog";
import {
  getPassportSerialNumberForType,
} from "../user/dashboard/passports/utils/passportListHelpers";
import { buildPassportJsonLdExport } from "../shared/utils/semanticPassportExport";
import {
  buildInactivePassportPath,
  buildPreviewPassportPath,
  buildPublicPassportPath,
} from "../passports/utils/passportRoutes";
import {
  flattenSchemaFieldsFromSections,
  normalizeSchemaSections,
} from "../shared/passports/passportSchemaUtils";
import {
  getAppSelectOptions,
  getNextEnabledOptionIndex,
} from "../shared/components/AppSelect";

describe("frontend modularity helpers", () => {
  test("admin serialization keeps generated semantic composition mappings", () => {
    const generatedCompositionField = {
      key: "materialComposition",
      type: "objectList",
      composition: true,
      compositionLabelColumnKey: "materialName",
      compositionValueColumnKey: "massPercent",
    };

    expect(serializeCompositionMetadata(generatedCompositionField)).toEqual({
      composition: true,
      compositionLabelColumnKey: "materialName",
      compositionValueColumnKey: "massPercent",
    });
    expect(serializeCompositionMetadata({
      ...generatedCompositionField,
      type: "text",
    })).toEqual({ composition: true });
    expect(serializeCompositionMetadata({
      ...generatedCompositionField,
      composition: false,
    })).toEqual({});
  });

  test("nested schema review verifies exact module hierarchy and field paths", () => {
    const moduleSections = [{
      key: "identity",
      label: "Identity",
      fields: [{ key: "modelIdentifier", label: "Model identifier", type: "text" }],
      sections: [{
        key: "materials",
        label: "Materials",
        fields: [],
        sections: [{
          key: "recycledContent",
          label: "Recycled content",
          fields: [{ key: "recycledPercentage", label: "Recycled percentage", type: "text" }],
        }],
      }],
    }];
    const sections = [{
      ...moduleSections[0],
      localId: "identity",
      fields: [{ ...moduleSections[0].fields[0], localId: "model", sourceModuleFieldKey: "modelIdentifier" }],
      sections: [{
        ...moduleSections[0].sections[0],
        localId: "materials",
        sections: [{
          ...moduleSections[0].sections[0].sections[0],
          localId: "recycled",
          fields: [{
            ...moduleSections[0].sections[0].sections[0].fields[0],
            localId: "percentage",
            sourceModuleFieldKey: "recycledPercentage",
          }],
        }],
      }],
    }];

    const review = buildNestedSchemaReview({
      sections,
      moduleSections,
      sourceModuleKey: "batteryModuleV1",
      systemHeader: { fieldMappings: [{ slotKey: "model", sourceType: "field", fieldKey: "modelIdentifier" }] },
    });

    expect(review.valid).toBe(true);
    expect(review.sectionCount).toBe(3);
    expect(review.fieldEntries.map((entry) => entry.pathLabel)).toEqual([
      "Identity",
      "Identity › Materials › Recycled content",
    ]);

    const reparented = [{
      ...sections[0],
      sections: [],
    }, sections[0].sections[0]];
    const invalidReview = buildNestedSchemaReview({
      sections: reparented,
      moduleSections,
      sourceModuleKey: "batteryModuleV1",
    });
    expect(invalidReview.valid).toBe(false);
    expect(invalidReview.errors.map((entry) => entry.code)).toContain("moduleSectionCountMismatch");

    const changedType = JSON.parse(JSON.stringify(sections));
    changedType[0].fields[0].type = "boolean";
    const changedTypeReview = buildNestedSchemaReview({
      sections: changedType,
      moduleSections,
      sourceModuleKey: "batteryModuleV1",
    });
    expect(changedTypeReview.errors.map((entry) => entry.code)).toContain("moduleFieldTypeMismatch");
  });

  test("nested schema review bounds editor nesting to the server-supported depth", () => {
    const root = { key: "section1", label: "Section 1", fields: [], sections: [] };
    let current = root;
    for (let index = 2; index <= maxNestedSectionDepth + 1; index += 1) {
      const child = { key: `section${index}`, label: `Section ${index}`, fields: [], sections: [] };
      current.sections = [child];
      current = child;
    }
    current.fields = [{ key: "leafField", label: "Leaf field", type: "text" }];

    const review = buildNestedSchemaReview({ sections: [root] });
    expect(review.errors.map((entry) => entry.code)).toContain("sectionDepthExceeded");
  });

  test("passport type sections use family-aware hierarchical numbering", () => {
    const entries = getSectionTreeEntries([
      {
        key: "identity",
        label: "Identity",
        sections: [
          {
            key: "manufacturer",
            label: "Manufacturer",
            sections: [{ key: "address", label: "Address" }],
          },
          { key: "product", label: "Product" },
        ],
      },
      { key: "sustainability", label: "Sustainability" },
    ]);

    expect(entries.map((entry) => entry.number)).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
      "2",
    ]);
    expect(entries.map((entry) => entry.numberPath)).toEqual([
      [1],
      [1, 1],
      [1, 1, 1],
      [1, 2],
      [2],
    ]);
  });

  test("passport type back controls use the shared one-line admin button", () => {
    const createPageSource = readFileSync(
      new URL("../admin/passport-types/AdminCreatePassportTypePage.js", import.meta.url),
      "utf8",
    );
    const fieldsPageSource = readFileSync(
      new URL("../admin/passport-types/AdminPassportTypeFields.js", import.meta.url),
      "utf8",
    );
    const adminStyles = readFileSync(
      new URL("../admin/styles/AdminDashboard.css", import.meta.url),
      "utf8",
    );

    expect(createPageSource).toContain('className="back-link apt-passport-type-back"');
    expect(fieldsPageSource).toContain('className="back-link apt-passport-type-back"');
    expect(adminStyles).toMatch(/\.back-link\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(adminStyles).toMatch(/\.back-link\s*\{[^}]*flex:\s*0 0 auto;/s);
  });

  test("passport type editing keeps the compact field profile and removes the redundant bottom semantic review", () => {
    const createPageSource = readFileSync(
      new URL("../admin/passport-types/AdminCreatePassportTypePage.js", import.meta.url),
      "utf8",
    );
    const adminStyles = readFileSync(
      new URL("../admin/styles/AdminDashboard.css", import.meta.url),
      "utf8",
    );

    expect(createPageSource).toContain("<ModuleFieldProfile");
    expect(createPageSource).not.toContain("Passport Type Profile Review");
    expect(createPageSource).not.toContain("acpt-schema-review-card");
    expect(adminStyles).not.toContain(".acpt-schema-review-card");
  });

  test("system-header entries resolve configured schema fields", () => {
    const entries = resolveSystemHeaderEntries(
      [{
        key: "identification",
        label: "Identification",
        fields: [{ key: "serialNumber", label: "Serial number", type: "text", required: true }],
      }],
      { fieldMappings: [{ slotKey: "serial", sourceType: "field", fieldKey: "serialNumber" }] }
    );

    expect(entries.map((entry) => ({
      slotKey: entry.slotKey,
      fieldKey: entry.fieldKey,
      required: entry.required,
    }))).toEqual([{ slotKey: "serial", fieldKey: "serialNumber", required: true }]);
  });

  test("hides redundant and internal header entries", () => {
    const entries = resolveSystemHeaderEntries(
      [{
        key: "administration",
        label: "Administration",
        fields: [{ key: "digitalProductPassportId", label: "Digital Product Passport ID", type: "text" }],
      }],
      {
        fieldMappings: [
          { slotKey: "digitalProductPassportId", sourceType: "field", fieldKey: "digitalProductPassportId" },
          { slotKey: "internalAliasId", sourceType: "managed", managedKey: "internalManagedInternalAliasId" },
          { slotKey: "subjectDid", sourceType: "managed", managedKey: "internalManagedSubjectDid" },
          { slotKey: "dppDid", sourceType: "managed", managedKey: "internalManagedDppDid" },
        ],
      },
    );

    expect(entries.map((entry) => entry.slotKey)).toEqual(["dppDid"]);
  });

  test("dashboard retains only canonical CSV and public-viewer routes", () => {
    const appSource = readFileSync(
      new URL("../app/containers/App.js", import.meta.url),
      "utf8",
    );

    expect(appSource).not.toContain("PublicPassportRedirectPage");
    expect(appSource).not.toContain('path="/p/:dppId"');
    expect(appSource).not.toContain('path="/dpp/inactive');
    expect(appSource).not.toContain('path="/dpp/:manufacturerSlug');
    expect(appSource).not.toContain('path="messages"');
    expect(appSource).not.toContain('path="profile"                      element={<Navigate');
    expect(appSource).not.toContain('path="security"                     element={<Navigate');
    expect(appSource).not.toContain("update-csv");
    expect(appSource).not.toContain("update-json");
    expect(appSource).toContain('path="/dpp/preview/:manufacturerSlug/:modelSlug/:previewId"');
    expect(appSource).toContain('path="/csv-import/:passportType/create-csv"');
    expect(appSource).toContain('path="/csv-import/:passportType/create-json"');
  });

  test("passport table opens the viewer only from its explicit action", () => {
    const rowSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListRow.js", import.meta.url),
      "utf8",
    );
    const tableSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListTable.js", import.meta.url),
      "utf8",
    );
    const listStateSource = readFileSync(
      new URL("../user/dashboard/passports/hooks/usePassportListState.js", import.meta.url),
      "utf8",
    );

    expect(rowSource).toContain('className="passport-view-btn"');
    expect(rowSource).toContain("View passport");
    expect(rowSource).toContain("Preview passport");
    expect(rowSource).toContain('target="_blank"');
    expect(rowSource).toContain("onClick={selectionMode ? () =>");
    expect(rowSource).toContain('className="passport-model-cell"');
    expect(rowSource).toContain('className="passport-serial-cell"');
    expect(rowSource).not.toContain('className="model-link-btn"');
    expect(tableSource).toContain('className="passport-view-col" scope="col">Viewer</th>');
    expect(listStateSource).toContain("navigate(destination.path)");
    expect(listStateSource).toContain("window.location.assign(destination.url)");
  });

  test("standalone public viewer retains only canonical public passport routes", () => {
    const viewerSource = readFileSync(
      new URL("../../../public-passport-viewer/src/containers/PublicViewerApp.js", import.meta.url),
      "utf8",
    );

    expect(viewerSource).not.toContain("PublicPassportRedirectPage");
    expect(viewerSource).not.toContain('path="/p/:dppId"');
    expect(viewerSource).not.toContain('path="/p/inactive');
    expect(viewerSource).toContain('path="/dpp/:manufacturerSlug/:modelSlug/:dppId"');
  });

  test("passport preview exposes overview, data, trust, and documents pages", () => {
    const portalSource = readFileSync(
      new URL("../passport-viewer/components/PublicPassportPortal.js", import.meta.url),
      "utf8",
    );

    expect(portalSource).toContain('useState("overview")');
    expect(portalSource).toContain('{ key: "overview", label: "Overview" }');
    expect(portalSource).toContain('{ key: "data", label: "Data" }');
    expect(portalSource).toContain('{ key: "trustPage", label: "Trust" }');
    expect(portalSource).toContain('{ key: "documents", label: "Documents" }');
  });

  test("passport data apply submits raw rows for server-side validation", () => {
    const pageSource = readFileSync(
      new URL("../user/dashboard/passport-data/PassportDataManagementPage.js", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("passportType: selectedType");
    expect(pageSource).toContain("records: buildSerializableRows(rows)");
    expect(pageSource).not.toContain("generatedPayload: preview.generatedPayload, sourceKind");
  });

  test("schema nesting requires canonical sections", () => {
    const legacyGroupShape = [{
      key: "root",
      groups: [{
        key: "legacy-child",
        fields: [{ key: "ignoredLegacyField" }],
      }],
    }];

    expect(flattenSchemaFieldsFromSections(legacyGroupShape)).toEqual([]);
    expect(normalizeSchemaSections(legacyGroupShape)[0].sections).toEqual([]);
  });

  test("semantic model labels are generated from any model key", () => {
    expect(formatSemanticModelLabel("equipmentDictionaryV3")).toBe("Equipment Dictionary V3");
    expect(formatSemanticModelLabel("serviceAssetDictionaryV1")).toBe("Service Asset Dictionary V1");
  });

  test("semantic options preserve registered and selected external models", () => {
    const options = buildSemanticModelOptions([
      {
        semanticModelKey: "equipmentDictionaryV3",
        name: "Equipment Dictionary",
        family: "equipment",
        version: "v3",
      },
    ], "externalFutureDictionaryV3");

    expect(getSemanticModelOption(options, "equipmentDictionaryV3")).toMatchObject({
      key: "equipmentDictionaryV3",
      label: "Equipment Dictionary",
      registered: true,
    });
    expect(getSemanticModelOption(options, "externalFutureDictionaryV3")).toMatchObject({
      key: "externalFutureDictionaryV3",
      registered: false,
    });
  });

  test("semantic terms preserve canonical decimal and array data types", () => {
    expect(deriveSemanticTermDataType({
      dataType: { format: "Decimal", jsonType: "decimal", xsdType: "xsd:decimal" },
    })).toBe("decimal");
    expect(deriveSemanticTermDataType({
      dataType: { format: "Array", jsonType: "array", items: { jsonType: "object" } },
    })).toBe("array");
  });

  test("passport lists use module business identifier from explicit module metadata", () => {
    const typeDefinitions = [{
      typeName: "equipmentPassportV1",
      fieldsJson: {
        identity: {
          businessIdentifierField: "serialNumber",
        },
      },
    }];

    expect(getPassportSerialNumberForType({
      passportType: "equipmentPassportV1",
      serialNumber: "SN-001",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("SN-001");

    expect(getPassportSerialNumberForType({
      passportType: "manualPassportV1",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("");
  });

  test("public and preview routes require DPP IDs and never fall back to internal aliases", () => {
    expect(buildPublicPassportPath({
      companyName: "Example Company",
      modelName: "Model One",
      dppId: "dppId-public-1",
      internalAliasId: "PRIVATE-SKU",
    })).toBe("/dpp/example-company/model-one/dppId-public-1");

    expect(buildPublicPassportPath({
      companyName: "Example Company",
      internalAliasId: "PRIVATE-SKU",
    })).toBeNull();

    expect(buildInactivePassportPath({
      companyName: "Example Company",
      dppId: "dppId-public-1",
      versionNumber: 2,
    })).toBe("/dpp/inactive/example-company/dppid-public-1/dppId-public-1/2");

    expect(buildPreviewPassportPath({
      companyName: "Example Company",
      previewId: "dppId-preview-1",
      internalAliasId: "PRIVATE-SKU",
    })).toBe("/dpp/preview/example-company/dppid-preview-1/dppId-preview-1");
  });

  test("semantic JSON-LD export includes model context and typed array rows", () => {
    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-sensor-001",
        passportType: "equipmentPassportV3",
        serialNumber: "SN-001",
        materialComposition: [{ materialName: "Steel", percentage: "62.5" }],
      },
    ], "equipmentPassportV3", {
      semanticModel: {
        semanticModelKey: "equipmentDictionaryV3",
        contextUrl: "https://www.example.test/dictionary/equipment/v3/context.jsonld",
        family: "equipment",
        version: "v3",
      },
      typeDef: {
        fieldsJson: {
          semanticGraph: {
            schemaVersion: 1,
            rootClassKey: "equipmentPassport",
            classes: [
              {
                key: "equipmentPassport",
                label: "Equipment Passport",
                semanticId: "https://example.test/classes/EquipmentPassport",
                root: true,
                properties: [{
                  key: "materialComposition",
                  label: "Material Composition",
                  semanticId: "https://example.test/terms/material-composition",
                  domainClassKey: "equipmentPassport",
                  domainClassIri: "https://example.test/classes/EquipmentPassport",
                  rangeKind: "class",
                  rangeClassKey: "materialEntry",
                  relationshipType: "composition",
                  minCount: 0,
                  maxCount: null,
                }],
              },
              {
                key: "materialEntry",
                label: "Material Entry",
                semanticId: "https://example.test/classes/MaterialEntry",
                properties: [
                  {
                    key: "materialName",
                    label: "Material Name",
                    semanticId: "https://example.test/terms/material-entry/material-name",
                    domainClassKey: "materialEntry",
                    domainClassIri: "https://example.test/classes/MaterialEntry",
                    rangeKind: "scalar",
                    dataType: "string",
                    minCount: 0,
                    maxCount: 1,
                  },
                  {
                    key: "percentage",
                    label: "Percentage",
                    semanticId: "https://example.test/terms/material-entry/percentage",
                    domainClassKey: "materialEntry",
                    domainClassIri: "https://example.test/classes/MaterialEntry",
                    rangeKind: "scalar",
                    dataType: "decimal",
                    minCount: 0,
                    maxCount: 1,
                  },
                ],
              },
            ],
            enums: [],
          },
          sections: [{
            fields: [{
              key: "materialComposition",
              type: "objectList",
              dataType: "array",
              objectType: "DataElementCollection",
              valueDataType: "Array",
              semanticId: "https://example.test/terms/material-composition",
              domainClassKey: "equipmentPassport",
              domainClassIri: "https://example.test/classes/EquipmentPassport",
              rangeKind: "class",
              rangeClassKey: "materialEntry",
              rangeIri: "https://example.test/classes/MaterialEntry",
              relationshipType: "composition",
              minCount: 0,
              maxCount: null,
            }],
          }],
        },
      },
    });

    expect(exported["@context"]).toContain("https://www.example.test/dictionary/equipment/v3/context.jsonld");
    expect(exported.semanticModel).toMatchObject({
      semanticModelKey: "equipmentDictionaryV3",
      family: "equipment",
      version: "v3",
    });
    expect(exported["@graph"][0]).toMatchObject({
      passportType: "equipmentPassportV3",
      serialNumber: "SN-001",
      materialComposition: [{ materialName: "Steel", percentage: 62.5 }],
    });
    expect(exported["@context"]).toContainEqual({
      materialComposition: {
        "@id": "https://example.test/terms/material-composition",
        "@container": "@set",
        "@context": {
          materialName: {
            "@id": "https://example.test/terms/material-entry/material-name",
          },
          percentage: {
            "@id": "https://example.test/terms/material-entry/percentage",
            "@type": "http://www.w3.org/2001/XMLSchema#decimal",
          },
        },
      },
    });
  });

  test("semantic JSON-LD export uses nested schema-field ownership for flat passport values", () => {
    const fieldSemanticId = "https://example.test/terms/chemistry-details/chemistry";
    const exported = buildPassportJsonLdExport([{
      passportType: "batteryPassportV1",
      chemistry: "nmc811",
    }], "batteryPassportV1", {
      typeDef: {
        fieldsJson: {
          semanticGraph: {
            rootClassKey: "batteryPassport",
            classes: [
              {
                key: "batteryPassport",
                semanticId: "https://example.test/classes/BatteryPassport",
                properties: [
                  {
                    key: "generalInformation",
                    semanticId: "https://example.test/terms/general-information",
                    rangeKind: "class",
                    rangeClassKey: "generalInformation",
                    relationshipType: "composition",
                    minCount: 0,
                    maxCount: 1,
                  },
                  {
                    // A stale root-level copy must never override the actual
                    // owner-scoped field metadata attached to the schema.
                    key: "chemistry",
                    semanticId: "https://example.test/terms/stale-root-chemistry",
                    rangeKind: "scalar",
                    dataType: "decimal",
                    minCount: 0,
                    maxCount: 1,
                  },
                ],
              },
              {
                key: "generalInformation",
                semanticId: "https://example.test/classes/GeneralInformation",
                properties: [{
                  key: "chemistryDetails",
                  semanticId: "https://example.test/terms/chemistry-details",
                  rangeKind: "class",
                  rangeClassKey: "chemistryDetails",
                  relationshipType: "composition",
                  minCount: 0,
                  maxCount: 1,
                }],
              },
              {
                key: "chemistryDetails",
                semanticId: "https://example.test/classes/ChemistryDetails",
                properties: [{
                  key: "chemistry",
                  semanticId: fieldSemanticId,
                  rangeKind: "enum",
                  rangeEnumKey: "batteryChemistry",
                  minCount: 0,
                  maxCount: 1,
                }],
              },
            ],
            enums: [{
              key: "batteryChemistry",
              values: [{
                key: "nmc811",
                label: "NMC 811",
                semanticId: "https://example.test/concepts/nmc811",
              }],
            }],
          },
          sections: [{
            key: "generalInformation",
            fields: [],
            sections: [{
              key: "chemistryDetails",
              fields: [{
                key: "chemistry",
                label: "Chemistry",
                semanticId: fieldSemanticId,
                domainClassKey: "chemistryDetails",
                rangeKind: "enum",
                rangeEnumKey: "batteryChemistry",
                minCount: 0,
                maxCount: 1,
              }],
            }],
          }],
        },
      },
    });

    expect(exported["@graph"][0].chemistry).toEqual({
      "@id": "https://example.test/concepts/nmc811",
    });
    expect(exported["@context"]).toContainEqual(expect.objectContaining({
      chemistry: {
        "@id": fieldSemanticId,
        "@type": "@id",
      },
      generalInformation: expect.objectContaining({
        "@context": expect.objectContaining({
          chemistryDetails: expect.objectContaining({
            "@context": expect.objectContaining({
              chemistry: {
                "@id": fieldSemanticId,
                "@type": "@id",
              },
            }),
          }),
        }),
      }),
    }));
  });

  test("product category options merge saved and module-derived categories", () => {
    const options = buildProductCategoryOptions({
      savedCategories: [{ id: 7, name: "Equipment", icon: "EQ" }],
      passportTypes: [
        { productCategory: "Equipment", productIcon: "shouldNotOverride" },
        { productCategory: "Service Asset", productIcon: "SA" },
      ],
      draftType: { productCategory: "Construction Product", productIcon: "CP" },
    });

    expect(options.map((option) => option.name)).toEqual([
      "Construction Product",
      "Equipment",
      "Service Asset",
    ]);
    expect(options.find((option) => option.name === "Equipment")).toMatchObject({
      id: 7,
      icon: "EQ",
      managed: true,
    });
    expect(options.find((option) => option.name === "Service Asset")).toMatchObject({
      icon: "SA",
      managed: false,
    });
  });

  test("app-owned dropdowns replace native option popups with one themed control", () => {
    const appStyles = readFileSync(
      new URL("../app/styles/index.css", import.meta.url),
      "utf8",
    );
    const dashboardStyles = readFileSync(
      new URL("../shared/styles/Dashboard.css", import.meta.url),
      "utf8",
    );
    const createPassStyles = readFileSync(
      new URL("../shared/styles/CreatePass.css", import.meta.url),
      "utf8",
    );
    const auditStyles = readFileSync(
      new URL("../shared/audit/AuditLogExplorer.css", import.meta.url),
      "utf8",
    );
    const passportDataStyles = readFileSync(
      new URL("../user/dashboard/passport-data/PassportDataManagement.css", import.meta.url),
      "utf8",
    );
    const adminStyles = readFileSync(
      new URL("../admin/styles/AdminDashboard.css", import.meta.url),
      "utf8",
    );
    const appSelectSource = readFileSync(
      new URL("../shared/components/AppSelect.jsx", import.meta.url),
      "utf8",
    );

    expect(appStyles).toContain(".app-select__menu {");
    expect(appStyles).toContain("z-index: 12000;");
    expect(appStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appStyles).not.toMatch(/select:not\(\[multiple\]\)/);
    expect(appSelectSource).toContain("createPortal(menu, document.body)");
    expect(appSelectSource).toContain('role="listbox"');
    expect(appSelectSource).toContain('new Event("change", { bubbles: true })');

    const pageSelectStyles = [
      dashboardStyles,
      createPassStyles,
      auditStyles,
      passportDataStyles,
      adminStyles,
    ].join("\n");
    expect(pageSelectStyles).not.toMatch(/--select-(?:bg|hover)-layer/);
    expect(pageSelectStyles).not.toMatch(/background-image:\s*var\(--select-arrow-icon\)/);
    expect(adminStyles).not.toMatch(/\.admin-select-(?:trigger|menu)/);
    expect(adminStyles).not.toMatch(/\.acpt-select-menu\s*\{\s*min-width:\s*100%/);
  });

  test("app-owned dropdown helpers retain option values and skip disabled choices", () => {
    const options = getAppSelectOptions(
      React.createElement(React.Fragment, null,
        React.createElement("option", { value: "" }, "All statuses"),
        React.createElement("option", { value: "draft" }, "Draft"),
        React.createElement("option", { value: "released", disabled: true }, "Released"),
        React.createElement("option", { value: "obsolete" }, "Obsolete"),
      ),
    );

    expect(options.map((option) => option.value)).toEqual([
      "",
      "draft",
      "released",
      "obsolete",
    ]);
    expect(getNextEnabledOptionIndex(options, 1, 1)).toBe(3);
    expect(getNextEnabledOptionIndex(options, 0, -1)).toBe(3);
  });
});
