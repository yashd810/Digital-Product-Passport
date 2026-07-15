"use strict";

const crypto = require("crypto");

const passwordMinLength = Math.max(10, Number.parseInt(process.env.PASSWORD_MIN_LENGTH || "12", 10) || 12);
const commonWeakPasswords = new Set([
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
  if (value.length < passwordMinLength) {
    return `Password must be at least ${passwordMinLength} characters`;
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
  if (commonWeakPasswords.has(value.toLowerCase())) {
    return "Password is too common. Choose a more unique password";
  }
  return null;
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest("hex");
}

function hashOtpCode(secret) {
  const hmacSecret = String(process.env.OTP_HMAC_SECRET || "");
  if (hmacSecret.length < 32) {
    throw new Error("OTP_HMAC_SECRET must be configured with at least 32 characters");
  }
  return crypto
    .createHmac("sha256", hmacSecret)
    .update(`otp:${String(secret || "").trim()}`)
    .digest("hex");
}

function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function buildSecretPrefix(secret) {
  return String(secret || "").slice(0, 12) || null;
}

function generateOpaqueSecret(prefix, size = 24) {
  const value = crypto.randomBytes(size).toString("base64url");
  return `${String(prefix || "")}${value}`;
}

function createDeviceKeyMaterial() {
  const rawKey = generateOpaqueSecret("dpk", 32);
  return {
    rawKey,
    hash: hashSecret(rawKey),
    prefix: buildSecretPrefix(rawKey),
    rotatedAt: new Date().toISOString(),
  };
}

module.exports = {
  passwordMinLength,
  validatePasswordPolicy,
  hashSecret,
  hashOtpCode,
  generateOtpCode,
  createDeviceKeyMaterial,
};
