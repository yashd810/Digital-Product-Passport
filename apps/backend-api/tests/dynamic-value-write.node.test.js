"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDynamicValueEntries,
} = require("../src/modules/passports/register-carrier-security-routes");

test("dynamic writes accept only schema-declared dynamic camelCase fields", () => {
  const entries = normalizeDynamicValueEntries(
    {
      publicDynamic: 42,
      restrictedDynamic: { state: "ok" },
    },
    new Set(["publicDynamic", "restrictedDynamic"])
  );

  assert.deepEqual(entries, [
    ["publicDynamic", "42"],
    ["restrictedDynamic", JSON.stringify({ state: "ok" })],
  ]);
});

test("dynamic writes reject unknown, non-dynamic, and malformed fields", () => {
  const allowed = new Set(["publicDynamic"]);
  assert.throws(
    () => normalizeDynamicValueEntries({ staticField: "value" }, allowed),
    /not configured as dynamic/
  );
  assert.throws(
    () => normalizeDynamicValueEntries({ invalid_field: "value" }, allowed),
    /Invalid dynamic field/
  );
  assert.throws(
    () => normalizeDynamicValueEntries({}, allowed),
    /At least one dynamic field/
  );
});
