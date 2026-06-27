"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createIntegrationCompanySlugResolver,
  normalizeCompanySlug,
} = require("../src/shared/http/integration-company-resolver");

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function runResolver({ companySlug, rows }) {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows };
    },
  };
  const req = { params: { companySlug } };
  const res = createResponse();
  let nextCalled = false;

  await createIntegrationCompanySlugResolver({
    pool,
    logger: { error() {} },
  })(req, res, () => {
    nextCalled = true;
  });

  return { calls, req, res, nextCalled };
}

test("integration company resolver normalizes company names to lowercase hyphen slugs", () => {
  assert.equal(normalizeCompanySlug("ACME Batteries GmbH"), "acme-batteries-gmbh");
  assert.equal(normalizeCompanySlug("Åland Energy  AB"), "aland-energy-ab");
});

test("integration company resolver maps company slug route to internal company id", async () => {
  const result = await runResolver({
    companySlug: "acme-batteries",
    rows: [{ id: 42, companyName: "ACME Batteries", didSlug: null }],
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.calls[0].values[0], "acme-batteries");
  assert.equal(result.req.params.companySlug, "acme-batteries");
  assert.equal(result.req.params.companyId, "42");
  assert.deepEqual(result.req.integrationCompany, {
    id: 42,
    companyName: "ACME Batteries",
    companySlug: "acme-batteries",
  });
});

test("integration company resolver rejects an empty company name slug", async () => {
  const result = await runResolver({
    companySlug: "  ",
    rows: [],
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.calls.length, 0);
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.res.payload.error, "A valid company name is required");
});

test("integration company resolver rejects ambiguous company name routes", async () => {
  const result = await runResolver({
    companySlug: "acme-batteries",
    rows: [
      { id: 1, companyName: "ACME Batteries", didSlug: null },
      { id: 2, companyName: "Acme Batteries", didSlug: null },
    ],
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 409);
  assert.equal(result.res.payload.error, "Company name route is ambiguous");
});
