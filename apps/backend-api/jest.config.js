"use strict";

module.exports = {
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/tests/dictionary.test.js",
    "<rootDir>/tests/compliance.test.js",
    "<rootDir>/tests/did.test.js",
    "<rootDir>/tests/product-identifier.test.js",
    "<rootDir>/tests/passport-representation.test.js",
    "<rootDir>/tests/dpp-api.test.js",
    "<rootDir>/tests/rate-limit.test.js",
    "<rootDir>/tests/security-service.test.js",
    "<rootDir>/tests/canonical-json.test.js",
    "<rootDir>/tests/signing.test.js",
  ],
};
