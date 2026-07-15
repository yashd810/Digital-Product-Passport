"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { hashOtpCode } = require("../src/services/security-service");

test("OTP hashes are keyed and domain separated", () => {
  const previousSecret = process.env.OTP_HMAC_SECRET;
  process.env.OTP_HMAC_SECRET = "test-only-otp-secret-with-32-characters";
  try {
    const code = "123456";
    const unkeyedHash = crypto.createHash("sha256").update(code).digest("hex");
    assert.notEqual(hashOtpCode(code), unkeyedHash);
    assert.equal(hashOtpCode(code), hashOtpCode(` ${code} `));
  } finally {
    if (previousSecret === undefined) delete process.env.OTP_HMAC_SECRET;
    else process.env.OTP_HMAC_SECRET = previousSecret;
  }
});
