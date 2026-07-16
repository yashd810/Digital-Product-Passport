"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertAssetManagementEntitlement,
} = require("../src/shared/assets/asset-management-entitlement");

test("asset management entitlement fails closed unless the company is active and explicitly enabled", () => {
  assert.throws(
    () => assertAssetManagementEntitlement(null),
    (error) => error.statusCode === 404 && error.code === "assetManagementCompanyNotFound"
  );
  assert.throws(
    () => assertAssetManagementEntitlement({ isActive: false, assetManagementEnabled: true }),
    (error) => error.statusCode === 403 && error.code === "assetManagementCompanyInactive"
  );
  assert.throws(
    () => assertAssetManagementEntitlement({ isActive: true, assetManagementEnabled: false }),
    (error) => error.statusCode === 403 && error.code === "assetManagementDisabled"
  );
  const enabledCompany = { id: 7, isActive: true, assetManagementEnabled: true };
  assert.strictEqual(assertAssetManagementEntitlement(enabledCompany), enabledCompany);
});
