"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCompanyDppPolicyUpdateQuery,
  validateCompanyDppPolicyInput,
} = require("../src/services/company-dpp-policy");

test("company DPP policy updates quote and allowlist every schema column", () => {
  const updates = validateCompanyDppPolicyInput({
    defaultGranularity: "batch",
    mintModelDids: false,
  });
  const query = buildCompanyDppPolicyUpdateQuery(42, updates);

  assert.match(query.sql, /"defaultGranularity" = \$1/);
  assert.match(query.sql, /"mintModelDids" = \$2/);
  assert.match(query.sql, /"updatedAt" = NOW\(\)/);
  assert.match(query.sql, /WHERE "companyId" = \$3/);
  assert.deepEqual(query.params, ["batch", false, 42]);
});

test("company DPP policy query builder rejects fields outside the validated schema", () => {
  assert.throws(
    () => buildCompanyDppPolicyUpdateQuery(42, { updatedAt: "unsafe" }),
    /Unsupported company DPP policy field: updatedAt/
  );
});
