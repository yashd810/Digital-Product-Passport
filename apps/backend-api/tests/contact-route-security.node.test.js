"use strict";

const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { configureHttp } = require("../src/bootstrap/http");
const { registerSupportRoutes } = require("../src/bootstrap/support-routes");
const { createRateLimiters } = require("../src/http/middleware/rate-limit");
const { normalizeContactSubmission } = require("../src/shared/http/contact-request");

const emailEnvironment = {
  ADMIN_EMAIL: "contact-inbox@example.test",
  EMAIL_HOST: "smtp.example.test",
  EMAIL_USER: "mailer@example.test",
  EMAIL_PASS: "test-only-password",
  EMAIL_FROM: "mailer@example.test",
  EMAIL_PORT: "587",
  EMAIL_SECURE: "false",
};

async function withEnvironment(values, run) {
  const original = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    return await run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createPassThroughRateLimiter(name, calls) {
  return (_req, _res, next) => {
    calls.push(name);
    next();
  };
}

async function withContactApp(run) {
  const app = express();
  configureHttp(app, {
    allowedOriginSet: new Set(["https://marketing.example.test"]),
    credentialedOriginSet: new Set(),
    cspConnectSrc: ["'self'", "https://marketing.example.test"],
    isPlainRecord: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
    isProduction: false,
    normalizeIncomingJsonValue: (value) => value,
    normalizeOutgoingJsonValue: (value) => value,
    port: 3001,
  });

  const rateLimitCalls = [];
  const sentMessages = [];
  registerSupportRoutes(app, {
    express,
    pool: { query: async () => ({ rows: [] }) },
    fs: {},
    path: {},
    logger: { error: () => {}, warn: () => {} },
    storageService: { isLocal: false },
    localStorageDir: "/tmp/contact-test-storage",
    filesBaseDir: "/tmp/contact-test-files",
    normalizeStorageRequestKey: (value) => value,
    isPassportStorageKey: () => false,
    publicReadRateLimit: createPassThroughRateLimiter("public", rateLimitCalls),
    contactIpRateLimit: createPassThroughRateLimiter("ip", rateLimitCalls),
    contactEmailRateLimit: createPassThroughRateLimiter("email", rateLimitCalls),
    contactRecipientRateLimit: createPassThroughRateLimiter("recipient", rateLimitCalls),
    createTransporter: () => ({
      sendMail: async (message) => {
        sentMessages.push(message);
      },
    }),
    brandedEmail: ({ preheader, bodyHtml }) => `${preheader}\n${bodyHtml}`,
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen(0, "127.0.0.1");
  });

  try {
    const { port } = server.address();
    await run({
      baseUrl: `http://127.0.0.1:${port}`,
      rateLimitCalls,
      sentMessages,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const validContact = () => ({
  firstName: "Ada",
  lastName: "Lovelace",
  email: "VISITOR@example.test",
  company: "Analytical Engines Ltd",
  sector: "Manufacturing",
  message: "Please contact me about a product passport consultation.",
  howFound: "Search",
});

async function postContact(baseUrl, body) {
  return fetch(`${baseUrl}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("contact form sends one administrator notification and never confirms arbitrary mailboxes", async () => {
  await withEnvironment(emailEnvironment, async () => {
    await withContactApp(async ({ baseUrl, rateLimitCalls, sentMessages }) => {
      const response = await postContact(baseUrl, validContact());
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.deepEqual(rateLimitCalls, ["ip", "email", "recipient"]);
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].to, emailEnvironment.ADMIN_EMAIL);
      assert.equal(sentMessages[0].replyTo, "visitor@example.test");
      assert.notEqual(sentMessages[0].to, sentMessages[0].replyTo);

      rateLimitCalls.length = 0;
      sentMessages.length = 0;
      const honeypotResponse = await postContact(baseUrl, { ...validContact(), _gotcha: "spam" });
      assert.equal(honeypotResponse.status, 200);
      assert.deepEqual(await honeypotResponse.json(), { ok: true });
      assert.deepEqual(rateLimitCalls, ["ip"]);
      assert.equal(sentMessages.length, 0);
    });
  });
});

test("contact form rejects oversized, malformed, and unsupported submissions before email delivery", async () => {
  await withEnvironment(emailEnvironment, async () => {
    await withContactApp(async ({ baseUrl, sentMessages }) => {
      const unsupportedField = await postContact(baseUrl, { ...validContact(), redirectTo: "https://evil.example.test" });
      assert.equal(unsupportedField.status, 400);
      assert.equal((await unsupportedField.json()).error, "Contact request contains an unsupported field");

      const multiByteMessage = await postContact(baseUrl, { ...validContact(), message: "界".repeat(4000) });
      assert.equal(multiByteMessage.status, 400);
      assert.equal((await multiByteMessage.json()).error, "message is too long");

      const oversizedBody = await postContact(baseUrl, { ...validContact(), message: "x".repeat(17 * 1024) });
      assert.equal(oversizedBody.status, 413);
      assert.equal((await oversizedBody.json()).error, "Contact request is too large");

      const malformedJson = await fetch(`${baseUrl}/api/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      assert.equal(malformedJson.status, 400);
      assert.equal((await malformedJson.json()).error, "Invalid JSON request body");
      assert.equal(sentMessages.length, 0);
    });
  });
});

test("contact form fails closed when its administrator recipient is not configured", async () => {
  await withEnvironment({ ...emailEnvironment, ADMIN_EMAIL: "" }, async () => {
    await withContactApp(async ({ baseUrl, sentMessages }) => {
      const response = await postContact(baseUrl, validContact());
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "Contact form is temporarily unavailable. Please email us directly.");
      assert.equal(sentMessages.length, 0);
    });
  });
});

test("contact request normalization enforces a small, string-only request schema", () => {
  const normalized = normalizeContactSubmission(validContact());
  assert.equal(normalized.email, "visitor@example.test");
  assert.equal(normalized._gotcha, "");
  assert.throws(
    () => normalizeContactSubmission({ ...validContact(), company: { name: "not text" } }),
    /company must be text/
  );
  assert.throws(
    () => normalizeContactSubmission([validContact()]),
    /Contact request must be a JSON object/
  );
});

function invokeMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const res = {
      status: () => res,
      json: (payload) => reject(new Error(`Rate limiter unexpectedly rejected: ${JSON.stringify(payload)}`)),
    };
    Promise.resolve(middleware(req, res, resolve)).catch(reject);
  });
}

test("contact rate limits isolate IP, sender, and configured recipient without storing mailbox text", async () => {
  await withEnvironment({ ADMIN_EMAIL: emailEnvironment.ADMIN_EMAIL }, async () => {
    const bucketKeys = [];
    const pool = {
      query: async (_sql, parameters) => {
        bucketKeys.push(parameters[0]);
        return { rows: [{ count: 1 }] };
      },
    };
    const limiters = createRateLimiters(pool);
    const request = { ip: "203.0.113.24", contactSubmission: { email: "visitor@example.test" } };
    await invokeMiddleware(limiters.contactIpRateLimit, request);
    await invokeMiddleware(limiters.contactEmailRateLimit, request);
    await invokeMiddleware(limiters.contactRecipientRateLimit, request);

    assert.equal(bucketKeys[0], "contact-ip:203.0.113.24");
    assert.match(bucketKeys[1], /^contact-email:[A-Za-z0-9_-]{43}$/);
    assert.match(bucketKeys[2], /^contact-recipient:[A-Za-z0-9_-]{43}$/);
    assert.equal(bucketKeys.some((key) => key.includes("visitor@example.test")), false);
    assert.equal(bucketKeys.some((key) => key.includes(emailEnvironment.ADMIN_EMAIL)), false);
  });
});
