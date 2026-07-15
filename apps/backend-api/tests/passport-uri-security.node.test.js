"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSafePassportUri,
  normalizePassportUri,
  normalizeSafeImageReference,
} = require("../src/shared/passports/passport-uri");
const {
  coercePassportScalarValue,
  coerceSemanticGraphPropertyValue,
} = require("../src/shared/passports/passport-helpers");

test("passport URI values allow credential-free HTTP(S) and non-navigable DID/URN identifiers", () => {
  assert.equal(normalizePassportUri("https://example.test/evidence?id=7"), "https://example.test/evidence?id=7");
  assert.equal(normalizePassportUri("did:web:example.test:products:7"), "did:web:example.test:products:7");
  assert.equal(normalizePassportUri("urn:epc:id:sgtin:0614141.112345.400"), "urn:epc:id:sgtin:0614141.112345.400");
  assert.equal(isSafePassportUri("https://example.test/path"), true);
});

test("passport URI coercion rejects executable, local, and credential-bearing schemes", () => {
  const fieldDef = { key: "evidence", label: "Evidence", dataType: "uri", type: "url" };
  for (const value of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "https://user:password@example.test/private",
    "//attacker.example.test/collect",
    "http://localhost:3001/admin",
    "http://127.0.0.1/admin",
    "http://2130706433/admin",
    "http://[::1]/admin",
    "http://printer.local/status",
  ]) {
    assert.throws(() => coercePassportScalarValue(fieldDef, value), /Expected safe URI/);
  }
});

test("file, symbol, and URL resource fields accept only HTTP(S) or vetted local resource roots", () => {
  const fileField = { key: "attachment", label: "Attachment", dataType: "uri", type: "file" };

  assert.equal(
    coercePassportScalarValue(fileField, "/repository-files/company-7/manual.pdf?signature=ok"),
    "/repository-files/company-7/manual.pdf?signature=ok"
  );
  assert.equal(
    coercePassportScalarValue(fileField, "https://cdn.example.test/manual.pdf"),
    "https://cdn.example.test/manual.pdf"
  );

  for (const value of [
    "/api/private/company-7/manual.pdf",
    "/storage/%2e%2e/admin",
    "/storage/%2525252e%2525252e/admin",
    "//attacker.example.test/manual.pdf",
    "did:web:example.test:manual",
  ]) {
    assert.throws(() => coercePassportScalarValue(fileField, value), /Expected safe URI/);
  }
});

test("resource fields allow only vetted paths at the exact configured API origin", (t) => {
  const previousServerUrl = process.env.SERVER_URL;
  process.env.SERVER_URL = "http://localhost:3001";
  t.after(() => {
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
  });

  const fileField = { key: "attachment", label: "Attachment", dataType: "uri", type: "file" };
  assert.equal(
    coercePassportScalarValue(fileField, "http://localhost:3001/public-files/attachmentAbc123?download=1"),
    "http://localhost:3001/public-files/attachmentAbc123?download=1"
  );
  assert.equal(
    coercePassportScalarValue(fileField, "http://localhost:3001/repository-files/access/signed-token"),
    "http://localhost:3001/repository-files/access/signed-token"
  );
  assert.equal(
    coercePassportScalarValue(fileField, "http://localhost:3001/storage/public/manual.pdf"),
    "http://localhost:3001/storage/public/manual.pdf"
  );
  assert.equal(
    isSafePassportUri("http://localhost:3001/public-files/attachmentAbc123", { resource: true }),
    true
  );
  assert.equal(
    normalizeSafeImageReference("http://localhost:3001/public-files/attachmentAbc123"),
    "http://localhost:3001/public-files/attachmentAbc123"
  );

  for (const value of [
    "http://localhost:3001/api/private/company-7/manual.pdf",
    "http://localhost:3002/public-files/attachmentAbc123",
    "http://127.0.0.1:3001/public-files/attachmentAbc123",
    "http://localhost:3001/storage/%2525252e%2525252e/admin",
  ]) {
    assert.throws(() => coercePassportScalarValue(fileField, value), /Expected safe URI/);
    assert.equal(isSafePassportUri(value, { resource: true }), false);
  }
});

test("semantic URI coercion preserves a schema resource type when uiType is absent", (t) => {
  const previousServerUrl = process.env.SERVER_URL;
  process.env.SERVER_URL = "http://localhost:3001";
  t.after(() => {
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
  });

  const fileProperty = {
    key: "attachment",
    label: "Attachment",
    type: "file",
    dataType: "uri",
    rangeKind: "scalar",
    minCount: 0,
    maxCount: 1,
  };
  assert.equal(
    coerceSemanticGraphPropertyValue(
      fileProperty,
      "http://localhost:3001/public-files/attachmentAbc123",
      {},
      "Attachment"
    ),
    "http://localhost:3001/public-files/attachmentAbc123"
  );
  assert.throws(
    () => coerceSemanticGraphPropertyValue(fileProperty, "http://localhost:3001/api/private", {}, "Attachment"),
    /Expected safe URI/
  );
});

test("inline image references are limited to bounded raster data URLs", () => {
  const png = "data:image/png;base64,aGVsbG8=";
  assert.equal(normalizeSafeImageReference(png, { allowInlineRaster: true }), png);
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "javascript:alert(1)",
    "https://user:pass@example.test/logo.png",
    "http://127.0.0.1/logo.png",
    "http://[::1]/logo.png",
  ]) {
    assert.throws(() => normalizeSafeImageReference(value, { allowInlineRaster: true }));
  }
});
