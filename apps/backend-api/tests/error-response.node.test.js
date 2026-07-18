"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { handleRouteError } = require("../src/shared/http/error-response");
const { RequestValidationError } = require("../src/shared/validation/request-schema");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("route errors never disclose server exception details", () => {
  for (const statusCode of [undefined, 500, 503, 600]) {
    const response = createResponse();
    const error = Object.assign(
      new Error("connection failed for postgres://internal-user:secret@database.internal/dppSystem"),
      { statusCode, code: "internalDatabaseFailure" }
    );

    handleRouteError(response, error, "Passport operation failed");

    assert.equal(response.statusCode, statusCode === 600 ? 500 : (statusCode || 500));
    assert.deepEqual(response.body, {
      error: "Passport operation failed",
    });
    assert.doesNotMatch(JSON.stringify(response.body), /database\.internal|secret|internalDatabaseFailure/);
  }
});

test("route errors retain explicit client-error details", () => {
  const response = createResponse();
  const error = Object.assign(new Error("facility identifier is inactive"), {
    statusCode: 400,
    code: "facilityInactive",
  });

  handleRouteError(response, error, "Passport operation failed");

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: "facilityInactive",
    detail: "facility identifier is inactive",
  });
});

test("route errors expose only allowlisted operational codes for safe 5xx recovery", () => {
  const response = createResponse();
  const error = Object.assign(new Error("passport storage diagnostics: internal schema details"), {
    statusCode: 503,
    code: "passportTypeStorageNotReady",
  });

  handleRouteError(response, error, "Passport operation failed");

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: "passportTypeStorageNotReady" });
  assert.doesNotMatch(JSON.stringify(response.body), /internal schema details/);
});

test("route errors preserve structured validation feedback", () => {
  const response = createResponse();
  const error = new RequestValidationError([{ path: "body.name", message: "name is required" }]);

  handleRouteError(response, error, "Passport operation failed");

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: "validationError",
    detail: "name is required",
    issues: [{ path: "body.name", message: "name is required" }],
  });
});
