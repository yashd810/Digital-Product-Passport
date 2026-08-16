"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isValidConfiguredOrigin,
  validateBuildOrigins,
} = require("./validate-build-origins");

const validEnvironment = {
  VITE_API_URL: "https://api.example.test",
  VITE_PUBLIC_VIEWER_URL: "https://viewer.example.test",
  VITE_MARKETING_URL: "https://www.example.test",
};

test("image build origins admit public HTTPS and explicit local loopback only", () => {
  for (const value of [
    "https://api.example.test",
    "https://[2606:4700:4700::1111]",
    "http://127.0.0.1:3001",
    "https://localhost:3000",
  ]) {
    assert.equal(isValidConfiguredOrigin(value), true, value);
  }
  for (const value of [
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://localhost.localdomain",
    "https://ip6-localhost",
    "https://[::ffff:127.0.0.1]",
    "https://[fc00::1]",
    "http://api.example.test",
    "https://user:pass@api.example.test",
    "https://api.example.test/path",
  ]) {
    assert.equal(isValidConfiguredOrigin(value), false, value);
  }
});

test("image build requires viewer and marketing origins while allowing an empty same-origin API", () => {
  assert.doesNotThrow(() => validateBuildOrigins(validEnvironment));
  assert.doesNotThrow(() => validateBuildOrigins({ ...validEnvironment, VITE_API_URL: "" }));
  assert.throws(
    () => validateBuildOrigins({ ...validEnvironment, VITE_MARKETING_URL: "https://10.0.0.1" }),
    /safe HTTP\(S\) origins/
  );
});
