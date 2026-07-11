"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessWorkflowCompany } = require("../src/http/routes/workflow");

test("workflow mutations remain scoped to the authenticated company", () => {
  assert.equal(canAccessWorkflowCompany({ role: "companyAdmin", companyId: 7 }, 7), true);
  assert.equal(canAccessWorkflowCompany({ role: "user", companyId: "7" }, 7), true);
  assert.equal(canAccessWorkflowCompany({ role: "companyAdmin", companyId: 8 }, 7), false);
  assert.equal(canAccessWorkflowCompany({ role: "user", companyId: null }, 7), false);
});

test("super admins may operate workflows across company boundaries", () => {
  assert.equal(canAccessWorkflowCompany({ role: "superAdmin", companyId: null }, 7), true);
});
