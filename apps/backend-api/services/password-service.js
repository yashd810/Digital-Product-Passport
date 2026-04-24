"use strict";

const argon2 = require("argon2");
const bcrypt = require("bcrypt");

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

  function detectHashAlgorithm(hash) {
    const candidate = String(hash || "");
    if (candidate.startsWith("$argon2")) return "argon2id";
    if (/^\$2[aby]\$/.test(candidate)) return "bcrypt";
    return "unknown";
  }

  async function verifyPassword(password, passwordHash) {
    const algorithm = detectHashAlgorithm(passwordHash);
    if (algorithm === "argon2id") {
      return argon2.verify(String(passwordHash || ""), applyPepper(password));
    }
    if (algorithm === "bcrypt") {
      return bcrypt.compare(applyPepper(password), String(passwordHash || ""));
    }
    return false;
  }

  async function verifyPasswordAndUpgrade(password, user) {
    const passwordHash = user?.password_hash || "";
    const algorithm = detectHashAlgorithm(passwordHash);
    const valid = await verifyPassword(password, passwordHash);
    if (!valid) {
      return { valid: false, algorithm, needsUpgrade: false };
    }

    if (algorithm === "bcrypt") {
      const upgraded = await hashPassword(password);
      return {
        valid: true,
        algorithm,
        needsUpgrade: true,
        nextHash: upgraded.hash,
        pepperVersion: upgraded.pepperVersion,
      };
    }

    return { valid: true, algorithm, needsUpgrade: false };
  }

  return {
    applyPepper,
    hashPassword,
    verifyPassword,
    verifyPasswordAndUpgrade,
    detectHashAlgorithm,
  };
}

module.exports = createPasswordService;
