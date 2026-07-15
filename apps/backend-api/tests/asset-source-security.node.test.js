"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createAssetService = require("../src/services/asset-management");

test("asset source integrations fail closed without an allowlist", async () => {
  const service = createAssetService({ assetSourceAllowedHosts: new Set() });
  await assert.rejects(
    service.fetchAssetSourceRecords({ url: "https://erp.example.com/products" }),
    /disabled until ASSET_SOURCE_ALLOWED_HOSTS is configured/
  );
});

test("asset source integrations reject private, mapped, and reserved IP targets", async () => {
  for (const url of [
    "https://127.0.0.2/products",
    "https://10.0.0.1/products",
    "https://169.254.169.254/latest/meta-data",
    "https://224.0.0.1/products",
    "https://[::ffff:169.254.169.254]/latest/meta-data",
    "https://[ff02::1]/products",
  ]) {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    const service = createAssetService({ assetSourceAllowedHosts: new Set([hostname]) });
    await assert.rejects(service.fetchAssetSourceRecords({ url }), /Private ERP\/API IP addresses are not allowed/);
  }
});
