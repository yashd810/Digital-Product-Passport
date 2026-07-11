"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const createPasswordService = require("../src/services/password-service");

test("password service accepts only Argon2id hashes", async () => {
  const service = createPasswordService({
    crypto,
    pepper: "test-pepper",
  });
  const password = "StrongPassword!42";
  const result = await service.hashPassword(password);

  assert.match(result.hash, /^\$argon2id\$/);
  assert.equal(await service.verifyPassword(password, result.hash), true);
  assert.equal(await service.verifyPassword("wrong", result.hash), false);
  assert.equal(await service.verifyPassword(password, "$2b$12$obsoleteBcryptHash"), false);
});
