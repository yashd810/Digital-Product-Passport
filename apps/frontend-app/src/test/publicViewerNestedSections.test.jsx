import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import PublicPassportPortal, {
  DataFieldRows,
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
  test("uses a fixed passport title and the product category in the linked viewer header", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "batteryPassportV1", rootField: "Root value" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{ productCategory: "Battery", fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );

    expect(markup).toMatch(/<a class="brand" href="#portal-top"[^>]*>[\s\S]*?<strong>Digital Product Passport<\/strong>[\s\S]*?<span>Battery<\/span>[\s\S]*?<\/a>/);
    expect(markup).toContain('<div class="kicker">Battery</div>');
    expect(markup).not.toContain("Public digital product passport");
  });

  test("shows overview, data, trust, and documents without a separate header tab", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport", rootField: "Root value" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{ fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );

    expect(markup.match(/role="tab"/g)).toHaveLength(4);
    expect(markup).toContain(">Overview<");
    expect(markup).toContain(">Data<");
    expect(markup).toContain(">Trust<");
    expect(markup).toContain(">Documents<");
    expect(markup).not.toContain(">Header<");
    expect(markup).not.toContain("Passport Header");
  });

  test("shows the resolved product identifier and falls back to the configured serial number", () => {
    const typeDef = {
      fieldsJson: {
        identity: { businessIdentifierField: "batterySerialNumber" },
        sections: nestedSections,
      },
    };
    const resolvedMarkup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          batterySerialNumber: "BAT-SN-001",
          uniqueProductIdentifier: "did:web:example:products:bat-sn-001",
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={typeDef}
        lang="en"
      />
    );
    const fallbackMarkup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport", batterySerialNumber: "BAT-SN-001" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={typeDef}
        lang="en"
      />
    );

    expect(resolvedMarkup).toContain("did:web:example:products:bat-sn-001");
    expect(fallbackMarkup).toContain("BAT-SN-001");
  });

  test("keeps symbol fields out of the textual data rows", () => {
    const markup = renderToStaticMarkup(
      <DataFieldRows
        fields={[
          { key: "symbol", label: "Collection symbol", type: "symbol", confidentiality: "public" },
          { key: "text", label: "Battery category", type: "text", confidentiality: "public" },
        ]}
        passport={{ symbol: "/repository-files/collection.svg", text: "Industrial" }}
        lang="en"
      />
    );

    expect(markup).not.toContain("Collection symbol");
    expect(markup).toContain("Battery category");
  });

  test("renders URI data with a text UI type as the entered text", () => {
    const website = "https://example.test/battery-information";
    const markup = renderToStaticMarkup(
      <DataFieldRows
        fields={[{
          key: "website",
          label: "Website",
          type: "text",
          uiType: "text",
          dataType: "URI",
          rangeKind: "scalar",
          confidentiality: "public",
        }]}
        passport={{ website }}
        semanticGraph={{}}
        lang="en"
      />
    );

    expect(markup).toContain('class="field-value-uri-text"');
    expect(markup).toContain(website);
    expect(markup).not.toContain(`href="${website}"`);
  });

  test("shows the restricted marker without an access-explanation sentence", () => {
    const markup = renderToStaticMarkup(
      <DataFieldRows
        fields={[{
          key: "restrictedValue",
          label: "Restricted value",
          type: "text",
          confidentiality: "restricted",
        }]}
        passport={{ restrictedValue: "Not public" }}
        lang="en"
      />
    );

    expect(markup).toContain(">Restricted<");
    expect(markup).not.toContain("This value is available to authorised parties only.");
  });

  test("renders PDF document actions for preview and full opening", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport", declaration: "/repository-files/declaration.pdf" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          fieldsJson: {
            sections: [{
              key: "documents",
              label: "Documents",
              fields: [{ key: "declaration", label: "Declaration", type: "file", confidentiality: "public" }],
            }],
          },
        }}
        lang="en"
      />
    );

    expect(markup).toContain("Show preview");
    expect(markup).toContain("Open full PDF");
  });

  test("omits inferred PDF and link tags from public and restricted document cards", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          publicDocument: "/repository-files/public-document.pdf",
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          fieldsJson: {
            sections: [{
              key: "documents",
              label: "Documents",
              fields: [
                { key: "publicDocument", label: "Public document", type: "file", confidentiality: "public" },
                { key: "restrictedDocument", label: "Restricted document", type: "file", confidentiality: "restricted" },
              ],
            }],
          },
        }}
        lang="en"
      />
    );
    const documentsMarkup = markup.slice(markup.indexOf('id="documents"'));

    expect(documentsMarkup).toContain("Public document");
    expect(documentsMarkup).toContain("Restricted document");
    expect(documentsMarkup).toContain(">Restricted<");
    expect(documentsMarkup).not.toContain('class="doc-icon"');
    expect(documentsMarkup).not.toContain(">PDF<");
    expect(documentsMarkup).not.toContain(">LINK<");
  });

  test("documents tab includes only fields declared with the file UI type", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          declaration: "/repository-files/declaration.pdf",
          linkedPdf: "https://example.test/linked.pdf",
          restrictedNote: "Internal note",
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          fieldsJson: {
            sections: [{
              key: "documents",
              label: "Documents",
              fields: [
                { key: "declaration", label: "Declaration", type: "text", uiType: "file", confidentiality: "public" },
                { key: "linkedPdf", label: "Linked PDF", type: "text", uiType: "text", dataType: "uri", confidentiality: "public" },
                { key: "restrictedNote", label: "Restricted note", type: "text", confidentiality: "restricted" },
              ],
            }],
          },
        }}
        lang="en"
      />
    );
    const documentsMarkup = markup.slice(markup.indexOf('id="documents"'));

    expect(documentsMarkup).toContain("Declaration");
    expect(documentsMarkup).toContain("Show preview");
    expect(documentsMarkup).not.toContain("Linked PDF");
    expect(documentsMarkup).not.toContain("Restricted note");
  });

  test("keeps verification evidence only in the Trust tab", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{ fieldsJson: { sections: [] } }}
        verificationBundle={{
          verificationProofStatus: "valid",
          issuer: "did:web:issuer.example.test",
          signedAt: "2026-08-01T10:00:00.000Z",
          signingKeyId: "key-123",
          proofType: "JsonWebSignature2020",
          algorithm: "ES256",
          trustLevel: "basic",
          dppDataUnchanged: true,
          externalCompanyCertificate: "Not provided",
          canonicalDppJsonUrl: "https://api.example.test/api/public/passports/DPP-1",
        }}
        carrierAuthenticity={{
          counterfeitRiskLevel: "high",
          carrierSecurityStatus: "trustedPublicEntry",
          trustedViewerHost: "viewer.example.test",
        }}
        lang="en"
      />
    );
    const trustMarkup = markup.slice(markup.indexOf('id="trustPage"'), markup.indexOf('id="documents"'));

    expect(markup).not.toContain('class="verification-panel"');
    expect(trustMarkup).toContain("Verification result");
    expect(trustMarkup).toContain("Valid");
    expect(trustMarkup).toContain("Issuer");
    expect(trustMarkup).toContain("did:web:issuer.example.test");
    expect(trustMarkup).toContain("Signed at");
    expect(trustMarkup).toContain("Verification method");
    expect(trustMarkup).toContain("Signing key");
    expect(trustMarkup).not.toContain("Counterfeit risk level");
    expect(trustMarkup).not.toContain("Carrier security status");
    expect(trustMarkup).not.toContain("Company trust level");
    expect(trustMarkup).not.toContain("DPP data unchanged");
    expect(trustMarkup).not.toContain("External company certificate");
  });

  test("renders file fields as PDFs before semantic URI values", () => {
    const markup = renderToStaticMarkup(
      <DataFieldRows
        fields={[{
          key: "declaration",
          label: "Declaration",
          type: "file",
          dataType: "uri",
          rangeKind: "scalar",
          confidentiality: "public",
        }]}
        passport={{ declaration: "https://api.example.test/repository-files/access/signed-document" }}
        semanticGraph={{}}
        lang="en"
      />
    );

    expect(markup).toContain("Open full PDF");
    expect(markup).toContain('class="pdf-open-link"');
    expect(markup).toContain('class="pdf-preview-btn"');
  });

  test("renders DPP and battery statuses as ordinary field text instead of enum pills", () => {
    const markup = renderToStaticMarkup(
      <DataFieldRows
        fields={[
          {
            key: "dppStatus",
            label: "DPP Status",
            type: "text",
            rangeKind: "enum",
            rangeEnumKey: "dppStatus",
            confidentiality: "public",
          },
          {
            key: "batteryStatus",
            label: "Battery Status",
            type: "text",
            rangeKind: "enum",
            rangeEnumKey: "batteryStatus",
            confidentiality: "public",
          },
        ]}
        passport={{ dppStatus: "active", batteryStatus: "inUse" }}
        semanticGraph={{
          enums: [
            { key: "dppStatus", values: [{ key: "active", label: "Active" }] },
            { key: "batteryStatus", values: [{ key: "inUse", label: "In use" }] },
          ],
        }}
        lang="en"
      />
    );

    expect(markup).toContain('class="field-value-strong semantic-enum-value-plain"');
    expect(markup).not.toContain('class="semantic-enum-value"');
    expect(markup).toContain(">Active<");
    expect(markup).toContain(">In use<");
  });

  test("keeps PDF previews collapsed until the viewer chooses to show them", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../passport-viewer/components/PublicPassportPortal.js", import.meta.url),
      "utf8"
    ));
    const fileCellSource = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../passport-viewer/components/ViewerBlocks.js", import.meta.url),
      "utf8"
    ));

    expect(source).not.toContain("autoPreview");
    expect(fileCellSource).not.toContain("autoPreview");
    expect(fileCellSource).toContain('open ? "Hide preview" : "Show preview"');
  });

  test("shows only symbol UI fields in the overview labels and symbols card", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{
          passportType: "examplePassport",
          collectionSymbol: "https://api.example.test/repository-files/access/collection-symbol",
          meaningOfLabels: "https://api.example.test/repository-files/access/labels-document",
        }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{
          fieldsJson: {
            sections: [{
              key: "labels",
              label: "Labels & Conformity",
              fields: [
                { key: "collectionSymbol", label: "Collection symbol", type: "symbol", confidentiality: "public" },
                { key: "meaningOfLabels", label: "Meaning of labels and symbols", type: "file", confidentiality: "public" },
              ],
            }],
          },
        }}
        lang="en"
      />
    );
    const overviewMarkup = markup.slice(markup.indexOf('id="overview"'), markup.indexOf('id="data"'));

    expect(overviewMarkup).toContain("Collection symbol");
    expect(overviewMarkup).not.toContain("Meaning of labels and symbols");
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

  test("keeps root sections in side navigation and renders every nested level as an accordion", () => {
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
    expect(markup.match(/<section class="category data-section-dropdown data-nested-section/g)).toHaveLength(3);
    expect(markup.match(/class="data-section-trigger"/g)).toHaveLength(3);
    expect(markup).toContain('data-section-depth="1"');
    expect(markup).toContain('data-section-depth="2"');
    expect(markup).toContain('data-section-depth="3"');
    expect(markup).not.toContain('data-section-depth="0"');
    expect(markup).toContain("Subsection");
    expect(markup).toContain("Sub-subsection");
    expect(markup).toContain("Level four");
  });

  test("provides a native data-section selector for compact viewer layouts", async () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport", rootField: "Root value" }}
        companyData={{ companyName: "Example Company" }}
        typeDef={{ fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );
    const css = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../passport-viewer/styles/PassportViewer.css", import.meta.url),
      "utf8"
    ));

    expect(markup).toContain('class="data-section-picker"');
    expect(markup).toContain("Choose a passport data section");
    expect(markup).toContain('<select id=');
    expect(markup).toMatch(/<option value="root"(?: selected="")?>Root section<\/option>/);
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.passport-portal \.data-section-nav\s*\{\s*display: none;/);
    expect(css).toContain(".passport-portal .data-section-picker {");
    expect(css).toContain("@media (max-width: 640px)");
  });

  test("connects each accordion trigger to its content and exposes its state", () => {
    const markup = renderToStaticMarkup(
      <PublicPassportPortal
        passport={{ passportType: "examplePassport" }}
        companyData={{}}
        typeDef={{ fieldsJson: { sections: nestedSections } }}
        lang="en"
      />
    );
    const triggers = markup.match(/<button[^>]*class="data-section-trigger"[^>]*>/g) || [];
    const controlledContentIds = triggers.map((trigger) => (
      trigger.match(/aria-controls="([^"]+)"/)?.[1]
    ));

    expect(triggers).toHaveLength(3);
    expect(triggers[0]).toContain('aria-expanded="true"');
    expect(triggers.slice(1).every((trigger) => trigger.includes('aria-expanded="false"'))).toBe(true);
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
  ])("renders a depth-%i section's fields inside its expanded accordion", (depth, section, fieldLabel) => {
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

    expect(markup).toMatch(new RegExp(`<section[^>]*class="[^"]*is-expanded[^"]*"[^>]*data-section-depth="${depth}"`));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(fieldLabel);
  });
});
