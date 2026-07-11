"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPublicSymbolContentType,
  isPublicStorageKey,
} = require("../src/bootstrap/support-routes");

test("direct storage access allows only generated global symbol assets", () => {
  assert.equal(isPublicStorageKey("uploads/symbols/symbol123-a1b2c3.png"), true);
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.png"), "image/png");
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.jpg"), "image/jpeg");
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.webp"), "image/webp");
  assert.equal(isPublicStorageKey("backup-provider/company-7/passport-1/v1/releasedCurrent.json"), false);
  assert.equal(isPublicStorageKey("backup-provider/company-7/security-events/event.json"), false);
  assert.equal(isPublicStorageKey("healthchecks/storage/probe.json"), false);
  assert.equal(isPublicStorageKey("passport-files/dpp-1/document.pdf"), false);
  assert.equal(isPublicStorageKey("repository-files/7/document.pdf"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/../../backup-provider/private.json"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/nested/symbol.png"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/symbol123-a1b2c3.svg"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/other-image.png"), false);
});
