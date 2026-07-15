"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkflowHelpers } = require("../src/modules/passports/workflow-helpers");

function createWorkflowHelper(pool) {
  return createWorkflowHelpers({
    pool,
    logger: { error() {} },
    createTransporter() { throw new Error("email must not be reached"); },
    brandedEmail() { return ""; },
    renderInfoTable() { return ""; },
    getTable() { return '"testPassports"'; },
    normalizePassportRow(value) { return value; },
    normalizeReleaseStatus(value) { return value; },
    inRevisionStatus: "inRevision",
    editableReleaseStatusesSql: "('draft', 'inRevision')",
    archivePassportSnapshot: async () => {},
    createNotification: async () => {},
    logAudit: async () => {},
  });
}

test("workflow submission rejects reviewers and approvers outside the submitting company before passport data is read", async () => {
  const queries = [];
  const helpers = createWorkflowHelper({
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM users")) return { rows: [{ id: 10 }] };
      throw new Error("passport queries must not run for an invalid assignee");
    },
  });

  await assert.rejects(
    helpers.submitPassportToWorkflow({
      companyId: 7,
      dppId: "DPP-1",
      passportType: "test",
      userId: 10,
      reviewerId: 10,
      approverId: 99,
    }),
    /active members of this company/
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /"companyId" = \$1/);
  assert.deepEqual(queries[0].values, [7, [10, 99]]);
});

test("workflow submission rejects malformed assignee IDs before any database query", async () => {
  const helpers = createWorkflowHelper({
    async query() {
      throw new Error("database must not be queried");
    },
  });

  await assert.rejects(
    helpers.submitPassportToWorkflow({
      companyId: 7,
      dppId: "DPP-1",
      passportType: "test",
      userId: 10,
      reviewerId: "10 OR 1=1",
    }),
    /reviewerId must be a valid user identifier/
  );
});
