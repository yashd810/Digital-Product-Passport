"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertAssetManagementEntitlement,
} = require("../src/shared/assets/asset-management-entitlement");

test("asset management is available to every active company without an entitlement toggle", () => {
  assert.throws(
    () => assertAssetManagementEntitlement(null),
    (error) => error.statusCode === 404 && error.code === "assetManagementCompanyNotFound"
  );
  assert.throws(
    () => assertAssetManagementEntitlement({ isActive: false, assetManagementEnabled: true }),
    (error) => error.statusCode === 403 && error.code === "assetManagementCompanyInactive"
  );
  const companyWithLegacyDisabledFlag = {
    id: 7,
    isActive: true,
    assetManagementEnabled: false,
    assetManagementRevokedAt: "2026-07-16T00:00:00.000Z",
  };
  assert.deepEqual(assertAssetManagementEntitlement(companyWithLegacyDisabledFlag), {
    ...companyWithLegacyDisabledFlag,
    assetManagementEnabled: true,
    assetManagementRevokedAt: null,
  });
});
