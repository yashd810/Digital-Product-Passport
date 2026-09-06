"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerWorkflowRoutes = require("../src/http/routes/workflow");
const { canAccessWorkflowCompany } = registerWorkflowRoutes;

const noop = () => {};

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "delete"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

test("workflow mutations remain scoped to the authenticated company", () => {
  assert.equal(canAccessWorkflowCompany({ role: "companyAdmin", companyId: 7 }, 7), true);
  assert.equal(canAccessWorkflowCompany({ role: "user", companyId: "7" }, 7), true);
  assert.equal(canAccessWorkflowCompany({ role: "companyAdmin", companyId: 8 }, 7), false);
  assert.equal(canAccessWorkflowCompany({ role: "user", companyId: null }, 7), false);
});

test("super admins may operate workflows across company boundaries", () => {
  assert.equal(canAccessWorkflowCompany({ role: "superAdmin", companyId: null }, 7), true);
});

test("workflow approval and removal require editor capability as well as authentication", () => {
  const { app, routes } = createRouteApp();
  const authenticateToken = noop;
  const requireEditor = noop;

  registerWorkflowRoutes(app, {
    pool: {},
    authenticateToken,
    checkCompanyAccess: noop,
    requireEditor,
    submitPassportToWorkflow: noop,
    getTable: noop,
    inRevisionStatus: "inRevision",
    signPassport: noop,
    markOlderVersionsObsolete: noop,
    logAudit: noop,
    buildCurrentPublicPassportPath: noop,
    createNotification: noop,
    complianceService: { loadPassportTypeDefinition: noop, evaluatePassport: noop },
    archivePassportSnapshot: noop,
  });

  for (const routePath of [
    "/api/passports/:dppId/workflow",
    "/api/passports/:dppId/workflow/:action",
  ]) {
    const route = routes.find((entry) => entry.routePath === routePath);
    assert.ok(route, `missing ${routePath}`);
    assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, requireEditor]);
  }
});
