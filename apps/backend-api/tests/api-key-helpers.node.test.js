"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createApiKeyHelpers } = require("../src/modules/passports/api-key-helpers");

const helpers = createApiKeyHelpers({ crypto });

const typeDef = {
  fieldsJson: {
    sections: [
      {
        fields: [
          { key: "serialNumber", confidentiality: "public" },
          { key: "supplierCost", confidentiality: "restricted" },
          { key: "privateDocument", confidentiality: "restricted" },
        ],
      },
    ],
  },
};

test("security group API keys apply only to their configured passport type", () => {
  const apiKey = {
    passportType: "battery",
    scopeType: "passportType",
    fieldKeys: ["supplierCost"],
  };

  assert.equal(helpers.apiKeyAppliesToPassport(apiKey, { dppId: "DPP-1", passportType: "battery" }), true);
  assert.equal(helpers.apiKeyAppliesToPassport(apiKey, { dppId: "DPP-1", passportType: "textile" }), false);
});

test("unique-passport security groups apply only to selected DPP IDs", () => {
  const apiKey = {
    passportType: "battery",
    scopeType: "passports",
    passportDppIds: ["DPP-1"],
    fieldKeys: ["supplierCost"],
  };

  assert.equal(helpers.apiKeyAppliesToPassport(apiKey, { dppId: "DPP-1", passportType: "battery" }), true);
  assert.equal(helpers.apiKeyAppliesToPassport(apiKey, { dppId: "DPP-2", passportType: "battery" }), false);
});

test("security group API key hash matching uses prefix candidates and HMAC verification", () => {
  const rawKey = "dppSg_test_key_123";
  const keyRecord = helpers.buildApiKeyHashRecord(rawKey);
  const matched = helpers.findMatchingApiKeyRecord(rawKey, [
    { ...keyRecord, id: 1, hashAlgorithm: "hmacSha256" },
  ]);

  assert.equal(matched.id, 1);
  assert.equal(helpers.findMatchingApiKeyRecord("wrong-key", [{ ...keyRecord, hashAlgorithm: "hmacSha256" }]), null);
});

test("security group request headers and database resolution use the shared key verifier", async () => {
  const rawKey = "dppSg_shared_key_123";
  const keyRecord = {
    ...helpers.buildApiKeyHashRecord(rawKey),
    id: 9,
    companyId: 7,
    passportType: "battery",
    scopeType: "passportType",
    fieldKeys: ["supplierCost"],
    passportDppIds: [],
  };
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [keyRecord] };
    },
  };

  assert.equal(helpers.getSecurityGroupKeyFromRequest({
    headers: { "x-api-key": rawKey },
  }), rawKey);
  assert.equal(helpers.getSecurityGroupKeyFromRequest({
    headers: { "x-security-group-key": [rawKey, "ignored"] },
  }), rawKey);

  const resolved = await helpers.resolveSecurityGroupApiKey(pool, rawKey);
  assert.equal(resolved.id, 9);
  assert.deepEqual(queries[0].params, [rawKey.slice(0, 16)]);

  await assert.rejects(
    helpers.resolveSecurityGroupApiKey(pool, "wrong-key"),
    (error) => error.statusCode === 401 && error.message === "Invalid or revoked API key"
  );
});

test("security group access check enforces company, type, and selected-passport scope", () => {
  const apiKey = {
    companyId: 7,
    passportType: "battery",
    scopeType: "passports",
    passportDppIds: ["DPP-1"],
  };

  assert.equal(helpers.checkSecurityGroupApiKeyAccess(apiKey, {
    companyId: 7,
    dppId: "DPP-1",
    passportType: "battery",
  }).allowed, true);
  assert.equal(helpers.checkSecurityGroupApiKeyAccess(apiKey, {
    companyId: 8,
    dppId: "DPP-1",
    passportType: "battery",
  }).statusCode, 403);
  assert.equal(helpers.checkSecurityGroupApiKeyAccess(apiKey, {
    companyId: 7,
    dppId: "DPP-1",
    passportType: "textile",
  }).error, "API key is not valid for this passport type");
  assert.equal(helpers.checkSecurityGroupApiKeyAccess(apiKey, {
    companyId: 7,
    dppId: "DPP-2",
    passportType: "battery",
  }).error, "API key is not valid for this passport");
});

test("restricted unlock payload returns only selected restricted fields plus identity fields", async () => {
  const passport = {
    dppId: "DPP-1",
    passportType: "battery",
    serialNumber: "SN-1",
    supplierCost: "42",
    privateDocument: "hidden.pdf",
  };
  const apiKey = {
    passportType: "battery",
    scopeType: "passportType",
    fieldKeys: ["privateDocument"],
  };

  assert.deepEqual(await helpers.buildRestrictedUnlockPassportPayload({
    passport,
    typeDef,
    apiKey,
  }), {
    passport: {
      dppId: "DPP-1",
      passportType: "battery",
      privateDocument: "hidden.pdf",
    },
    unlockedFieldKeys: ["privateDocument"],
  });
});

test("archived restricted unlock payload can skip latest dynamic values", async () => {
  let dynamicQueryCount = 0;
  const archiveTypeDef = {
    fieldsJson: {
      sections: [
        {
          fields: [
            { key: "liveTemperature", confidentiality: "restricted", dynamic: true },
          ],
        },
      ],
    },
  };
  const passport = {
    dppId: "DPP-1",
    passportType: "battery",
    liveTemperature: "archived-value",
  };
  const apiKey = {
    passportType: "battery",
    scopeType: "passportType",
    fieldKeys: ["liveTemperature"],
  };

  const payload = await helpers.buildRestrictedUnlockPassportPayload({
    pool: {
      query: async () => {
        dynamicQueryCount += 1;
        return { rows: [{ fieldKey: "liveTemperature", value: "current-value" }] };
      },
    },
    passport,
    typeDef: archiveTypeDef,
    apiKey,
    includeDynamicLatest: false,
  });

  assert.equal(dynamicQueryCount, 0);
  assert.deepEqual(payload.passport, {
    dppId: "DPP-1",
    passportType: "battery",
    liveTemperature: "archived-value",
  });
});
