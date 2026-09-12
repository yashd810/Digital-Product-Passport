"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerAuthRoutes = require("../src/http/routes/auth");

function createResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createHarness(query, options = {}) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
  }
  registerAuthRoutes(app, { pool: { query }, ...options });
  return routes;
}

test("profile updates reject malformed text and identifiers before any database access", async () => {
  const routes = createHarness(async () => assert.fail("malformed profile data must not reach SQL"));
  const handler = routes.get("patch /api/users/me");
  for (const body of [
    null, [], "text", { firstName: {} }, { firstName: "a".repeat(101) },
    { lastName: "a".repeat(101) }, { phone: "a".repeat(51) },
    { jobTitle: "a".repeat(121) }, { bio: "a".repeat(10_001) },
    { preferredLanguage: "a".repeat(13) }, { firstName: "null\u0000byte" },
    { defaultReviewerId: 2_147_483_648 }, { defaultApproverId: {} },
    { defaultReviewerId: "1 OR 1=1" }, { defaultReviewerId: false },
  ]) {
    const response = createResponse();
    await handler({ body, user: { userId: 7, companyId: 3 } }, response);
    assert.equal(response.statusCode, 400, JSON.stringify(body).slice(0, 100));
  }
});

test("profile defaults require active editors or admins in the current company", async () => {
  const queries = [];
  const routes = createHarness(async (sql, params) => {
    queries.push({ sql, params });
    if (/^SELECT id FROM users/.test(sql)) return { rows: [{ id: 8 }] };
    assert.fail("a foreign or ineligible assignee must prevent the profile update");
  });
  const response = createResponse();
  await routes.get("patch /api/users/me")({
    body: { defaultReviewerId: 8, defaultApproverId: 99, firstName: "Updated" },
    user: { userId: 7, companyId: 3 },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /"companyId" = \$1 AND "isActive" = true/);
  assert.match(queries[0].sql, /role IN \('companyAdmin', 'editor'\)/);
  assert.deepEqual(queries[0].params, [3, [8, 99]]);
});

test("profile updates normalize eligible defaults and allow clearing optional fields", async () => {
  const queries = [];
  const routes = createHarness(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.startsWith("SELECT") ? [{ id: 8 }] : [] };
  });
  const response = createResponse();
  await routes.get("patch /api/users/me")({
    body: { firstName: "Alice", phone: null, defaultReviewerId: "8", defaultApproverId: null },
    user: { userId: 7, companyId: 3 },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, [3, [8]]);
  assert.deepEqual(queries[1].params, ["Alice", null, 8, null, 7]);
});

test("missing or foreign company users do not produce successful role or deactivation audit events", async () => {
  const routes = createHarness(async () => ({ rows: [] }), {
    logAudit: async () => assert.fail("no audit mutation should be recorded for a missing target"),
    backupProviderService: {
      replicateAccessControlEvent: async () => assert.fail("no backup event should be emitted for a missing target"),
    },
  });
  for (const path of [
    "patch /api/companies/:companyId/users/:userId",
    "patch /api/companies/:companyId/users/:userId/deactivate",
  ]) {
    const response = createResponse();
    await routes.get(path)({
      params: { companyId: "3", userId: "99" },
      body: { role: "editor" },
      user: { userId: 7, companyId: 3, role: "companyAdmin" },
    }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "User not found" });
  }
});
