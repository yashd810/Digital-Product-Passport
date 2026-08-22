"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { serializeHostOnlyCookie } = require("../src/shared/security/host-only-cookie");

test("host-only session cookie serialization enforces the browser __Host- contract", () => {
  const value = serializeHostOnlyCookie("__Host-dppSession", "signed.token", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  assert.match(value, /^__Host-dppSession=signed\.token;/);
  assert.match(value, /Path=\//);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=lax/);
  assert.doesNotMatch(value, /(?:^|;)\s*Domain=/);
});

test("host-only cookie serialization rejects an attempt to set Domain", () => {
  assert.throws(
    () => serializeHostOnlyCookie("__Host-dppSession", "signed.token", { domain: "example.test" }),
    /Domain-scoped cookies are not supported/
  );
});

test("__Host- cookie serialization fails closed when its browser contract is incomplete", () => {
  assert.throws(
    () => serializeHostOnlyCookie("__Host-dppSession", "signed.token", { secure: false, path: "/" }),
    /__Host- cookies require Secure and Path=\//
  );
  assert.throws(
    () => serializeHostOnlyCookie("__Host-dppSession", "signed.token", { secure: true, path: "/api" }),
    /__Host- cookies require Secure and Path=\//
  );
});
