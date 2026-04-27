"use strict";

const crypto = require("crypto");

const PASSWORD_MIN_LENGTH = Math.max(10, Number.parseInt(process.env.PASSWORD_MIN_LENGTH || "12", 10) || 12);
const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "welcome123",
  "admin123",
  "letmein123",
]);

function validatePasswordPolicy(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (/\s/.test(value)) {
    return "Password must not contain whitespace";
  }
  if (!/[a-z]/.test(value)) {
    return "Password must include at least one lowercase letter";
  }
  if (!/[A-Z]/.test(value)) {
    return "Password must include at least one uppercase letter";
  }
  if (!/\d/.test(value)) {
    return "Password must include at least one number";
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one symbol";
  }
  if (COMMON_WEAK_PASSWORDS.has(value.toLowerCase())) {
    return "Password is too common. Choose a more unique password";
  }
  return null;
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest("hex");
}

function hashOtpCode(secret) {
  return crypto.createHash("sha256").update(String(secret || "").trim()).digest("hex");
}

function timingSafeEqualHex(left, right) {
  const leftHex = String(left || "");
  const rightHex = String(right || "");
  if (!leftHex || !rightHex || leftHex.length !== rightHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}

function buildSecretPrefix(secret) {
  return String(secret || "").slice(0, 12) || null;
}

function generateOpaqueSecret(prefix, size = 24) {
  const value = crypto.randomBytes(size).toString("base64url");
  return `${String(prefix || "")}${value}`;
}

function createAccessKeyMaterial() {
  const rawKey = generateOpaqueSecret("pak_", 24);
  return {
    rawKey,
    hash: hashSecret(rawKey),
    prefix: buildSecretPrefix(rawKey),
    rotatedAt: new Date().toISOString(),
  };
}

function createDeviceKeyMaterial() {
  const rawKey = generateOpaqueSecret("dpk_", 32);
  return {
    rawKey,
    hash: hashSecret(rawKey),
    prefix: buildSecretPrefix(rawKey),
    rotatedAt: new Date().toISOString(),
  };
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
  hashSecret,
  hashOtpCode,
  timingSafeEqualHex,
  createAccessKeyMaterial,
  createDeviceKeyMaterial,
};
