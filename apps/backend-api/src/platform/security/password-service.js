"use strict";

/**
 * Password hashing adapter using Argon2id and an application pepper.
 *
 * Authentication flows receive this narrow service instead of selecting crypto
 * algorithms or hashing parameters themselves.
 */

const argon2 = require("argon2");

const maxPasswordLength = 256;
const dummyPasswordHash = "$argon2id$v=19$m=19456,t=2,p=1$TwD6+YbYoe7L3/I3ZfBhmg$hfkLOXAgXO5Kg8ICMc2e/WRJqS0sh7aq0QYQfzvlcZQ";

function isBoundedPassword(value) {
  return typeof value === "string" && value.length <= maxPasswordLength;
}

function createPasswordService({ crypto, pepper, currentPepperVersion = 1 }) {
  function applyPepper(password) {
    if (!isBoundedPassword(password)) {
      const error = new Error("Password input is invalid");
      error.code = "invalidPasswordInput";
      throw error;
    }
    return crypto.createHmac("sha256", pepper).update(password).digest("hex");
  }

  async function hashPassword(password) {
    const hash = await argon2.hash(applyPepper(password), {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    return {
      hash,
      pepperVersion: currentPepperVersion,
      algorithm: "argon2id",
    };
  }

  async function verifyPassword(password, passwordHash) {
    const hash = String(passwordHash || "");
    const hasUsablePasswordHash = hash.startsWith("$argon2id$");
    const hasUsablePasswordInput = isBoundedPassword(password);
    const candidateHash = hasUsablePasswordHash ? hash : dummyPasswordHash;
    const pepperedPassword = hasUsablePasswordInput
      ? applyPepper(password)
      : "0".repeat(64);
    const verified = await argon2.verify(candidateHash, pepperedPassword);
    return hasUsablePasswordHash && hasUsablePasswordInput && verified;
  }

  return {
    applyPepper,
    hashPassword,
    verifyPassword,
  };
}

module.exports = createPasswordService;
