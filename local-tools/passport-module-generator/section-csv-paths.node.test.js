"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSectionPathCells,
  convertRowsToNestedSections,
  maxSectionPathDepth,
  normalizeSectionPathRow,
} = require("./section-csv-paths");

function deriveSectionKey(label) {
  const words = String(label || "").match(/[A-Za-z0-9]+/g) || [];
  return words
    .map((word) => word.toLowerCase())
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function row({ rowNumber, sectionLabel, sectionPath, sectionKeyPath, fieldLabel }) {
  return {
    rowNumber,
    ...normalizeSectionPathRow({
      sectionLabel,
      sectionPath,
      sectionKeyPath,
      rowNumber,
      deriveSectionKey,
    }),
    field: { fieldLabel },
  };
}

test("nested section CSV paths round-trip with their labels and keys", () => {
  const rootPath = buildSectionPathCells({
    labels: ["Product Identity"],
    keys: ["productIdentity"],
    deriveSectionKey,
  });
  const nestedPath = buildSectionPathCells({
    labels: ["Product Identity", "Materials", "Recycled Content"],
    keys: ["productIdentity", "materials", "recycledContent"],
    deriveSectionKey,
  });
  const sections = convertRowsToNestedSections([
    row({
      rowNumber: 2,
      sectionLabel: "Product Identity",
      ...rootPath,
      fieldLabel: "Model Number",
    }),
    row({
      rowNumber: 3,
      sectionLabel: "Recycled Content",
      ...nestedPath,
      fieldLabel: "Recycled Material Percentage",
    }),
  ]);

  assert.deepEqual(sections, [
    {
      key: "productIdentity",
      label: "Product Identity",
      fields: [{ fieldLabel: "Model Number" }],
      sections: [
        {
          key: "materials",
          label: "Materials",
          fields: [],
          sections: [
            {
              key: "recycledContent",
              label: "Recycled Content",
              fields: [{ fieldLabel: "Recycled Material Percentage" }],
            },
          ],
        },
      ],
    },
  ]);
});

test("flat legacy CSV rows still import as top-level sections", () => {
  const sections = convertRowsToNestedSections([
    row({
      rowNumber: 2,
      sectionLabel: "Product Identity",
      fieldLabel: "Model Number",
    }),
    row({
      rowNumber: 3,
      sectionLabel: "Product Identity",
      fieldLabel: "Manufacturer Name",
    }),
  ]);

  assert.deepEqual(sections, [
    {
      key: "productIdentity",
      label: "Product Identity",
      fields: [
        { fieldLabel: "Model Number" },
        { fieldLabel: "Manufacturer Name" },
      ],
    },
  ]);
});

test("partial or malformed explicit paths are rejected before importing", () => {
  assert.throws(
    () => row({
      rowNumber: 2,
      sectionLabel: "Materials",
      sectionPath: JSON.stringify(["Product Identity", "Materials"]),
      fieldLabel: "Material",
    }),
    /Section path and Section key path must be provided together/
  );
  assert.throws(
    () => row({
      rowNumber: 2,
      sectionLabel: "Wrong label",
      sectionPath: JSON.stringify(["Product Identity", "Materials"]),
      sectionKeyPath: JSON.stringify(["productIdentity", "materials"]),
      fieldLabel: "Material",
    }),
    /must match the final Section path label/
  );
  assert.throws(
    () => row({
      rowNumber: 2,
      sectionLabel: "Materials",
      sectionPath: "Product Identity > Materials",
      sectionKeyPath: JSON.stringify(["productIdentity", "materials"]),
      fieldLabel: "Material",
    }),
    /must be a JSON array/
  );
});

test("section paths are capped at the backend-supported nesting depth", () => {
  const labels = Array.from({ length: maxSectionPathDepth + 1 }, (_, index) => `Section ${index + 1}`);
  const keys = Array.from({ length: maxSectionPathDepth + 1 }, (_, index) => `section${index + 1}`);

  assert.throws(
    () => row({
      rowNumber: 2,
      sectionLabel: labels.at(-1),
      sectionPath: JSON.stringify(labels),
      sectionKeyPath: JSON.stringify(keys),
      fieldLabel: "Too deeply nested",
    }),
    new RegExp(`at most ${maxSectionPathDepth} nested section levels`)
  );
  assert.throws(
    () => buildSectionPathCells({ labels, keys, deriveSectionKey }),
    new RegExp(`at most ${maxSectionPathDepth} nested section levels`)
  );
});

test("ambiguous hierarchy and reused keys are rejected", () => {
  assert.throws(
    () => convertRowsToNestedSections([
      row({
        rowNumber: 2,
        sectionLabel: "Materials",
        sectionPath: JSON.stringify(["Product Identity", "Materials"]),
        sectionKeyPath: JSON.stringify(["productIdentity", "materials"]),
        fieldLabel: "Material",
      }),
      row({
        rowNumber: 3,
        sectionLabel: "Materials",
        sectionPath: JSON.stringify(["Product Identity", "Materials"]),
        sectionKeyPath: JSON.stringify(["productIdentity", "materialDetails"]),
        fieldLabel: "Material Origin",
      }),
    ]),
    /same label path is paired with different section key paths/
  );
  assert.throws(
    () => convertRowsToNestedSections([
      row({
        rowNumber: 2,
        sectionLabel: "Materials",
        sectionPath: JSON.stringify(["Product Identity", "Materials"]),
        sectionKeyPath: JSON.stringify(["productIdentity", "materials"]),
        fieldLabel: "Material",
      }),
      row({
        rowNumber: 3,
        sectionLabel: "Materials",
        sectionPath: JSON.stringify(["Sustainability", "Materials"]),
        sectionKeyPath: JSON.stringify(["sustainability", "materials"]),
        fieldLabel: "Recycled Content",
      }),
    ]),
    /reuses section key "materials" at more than one path/
  );
});
