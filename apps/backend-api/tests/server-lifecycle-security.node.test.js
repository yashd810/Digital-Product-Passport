"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { configureHttpServerLimits } = require("../src/bootstrap/server-lifecycle");

test("HTTP servers bound header, request, keep-alive, socket, and reuse resources", () => {
  let inactiveTimeout = null;
  const server = {
    keepAliveTimeoutBuffer: 0,
    setTimeout(value) {
      inactiveTimeout = value;
    },
  };

  const configured = configureHttpServerLimits(server);

  assert.equal(server.requestTimeout, 300_000);
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.keepAliveTimeoutBuffer, 1_000);
  assert.equal(server.maxHeadersCount, 100);
  assert.equal(server.maxRequestsPerSocket, 100);
  assert.equal(inactiveTimeout, 120_000);
  assert.deepEqual(configured, {
    headersTimeoutMs: 15_000,
    inactiveSocketTimeoutMs: 120_000,
    requestTimeoutMs: 300_000,
  });
});
