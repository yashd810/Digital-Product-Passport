"use strict";

const argon2 = require("argon2");

function createPasswordService({ crypto, pepper, currentPepperVersion = 1 }) {
  function applyPepper(password) {
    return crypto.createHmac("sha256", pepper).update(String(password || "")).digest("hex");
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
    if (!hash.startsWith("$argon2id$")) return false;
    return argon2.verify(hash, applyPepper(password));
  }

  return {
    applyPepper,
    hashPassword,
    verifyPassword,
  };
}

module.exports = createPasswordService;
