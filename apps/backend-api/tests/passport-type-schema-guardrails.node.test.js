"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  findReservedPassportHeaderFieldConflicts,
  passportTypeSchemaLimits,
  validatePassportTypeSections,
} = require("../src/modules/admin/passport-type-schema-guardrails");

function field(key, label = key) {
  return { key, label, type: "text" };
}

test("reserved passport header fields are rejected at any nested section depth", () => {
  const sections = [{
    key: "product",
    label: "Product",
    fields: [field("productName", "Product name")],
    sections: [{
      key: "identifiers",
      label: "Identifiers",
      fields: [{
        ...field("externalDppId", "External DPP ID"),
        semanticId: "dpp:digitalProductPassportId",
      }, {
        ...field("dppId", "Duplicate Registry ID"),
      }],
    }],
  }];

  const conflicts = findReservedPassportHeaderFieldConflicts(sections);

  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts.map((conflict) => conflict.sectionPath), [
    ["product", "identifiers"],
    ["product", "identifiers"],
  ]);
  assert.deepEqual(conflicts.map((conflict) => conflict.conflictType), ["semanticId", "key"]);
});

test("nested section validation accepts canonical nested schemas", () => {
  const sections = [{
    key: "product",
    label: "Product",
    fields: [field("productName", "Product name")],
    sections: [{
      key: "materials",
      label: "Materials",
      fields: [field("materialName", "Material name")],
    }],
  }];

  assert.equal(validatePassportTypeSections(sections), null);
});

test("nested section validation bounds depth without recursive stack exhaustion", () => {
  const root = {
    key: "section1",
    label: "Section 1",
    fields: [],
  };
  let current = root;
  for (let depth = 2; depth <= passportTypeSchemaLimits.maxDepth + 1; depth += 1) {
    const child = {
      key: `section${depth}`,
      label: `Section ${depth}`,
      fields: [],
    };
    current.sections = [child];
    current = child;
  }

  assert.equal(
    validatePassportTypeSections([root]),
    `Passport type schemas support at most ${passportTypeSchemaLimits.maxDepth} nested section levels.`
  );
});

test("nested section validation rejects malformed nodes before traversal", () => {
  const sections = [{
    key: "product",
    label: "Product",
    fields: [],
    sections: [null],
  }];

  assert.equal(validatePassportTypeSections(sections), "Each section must be an object");
});
