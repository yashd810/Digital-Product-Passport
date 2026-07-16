#!/usr/bin/env node
"use strict";

/**
 * Create or rotate the one explicitly configured bootstrap super admin.
 *
 * Uses DB_* and PEPPER_V1 from the active environment, DOTENV_CONFIG_PATH, or
 * DPP_ENV_FILE. The default local profile is outside the repository.
 * Set ADMIN_USERNAME (the email used to sign in) and ADMIN_PASSWORD explicitly.
 * ADMIN_EMAIL is intentionally independent: it receives public contact-form
 * notifications when that feature is configured.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const createPasswordService = require("../src/services/password-service");
const { validatePasswordPolicy } = require("../src/services/security-service");

function stripQuotes(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = stripQuotes(line.slice(index + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return filePath;
}

function findEnvironmentFile() {
  const explicitPath = process.env.DOTENV_CONFIG_PATH || process.env.DPP_ENV_FILE;
  if (explicitPath) return explicitPath;
  return path.resolve(__dirname, "../../../../../env/local-compose.env");
}

const loadedEnvFile = loadEnvFile(findEnvironmentFile());

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  return new Pool({
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: requireEnv("DB_NAME"),
  });
}

async function ensureSuperAdmin() {
  const adminUsername = String(requireEnv("ADMIN_USERNAME")).trim().toLowerCase();
  const adminPassword = requireEnv("ADMIN_PASSWORD");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminUsername)) {
    throw new Error("ADMIN_USERNAME must be a valid email address because email is the login identifier");
  }
  const passwordPolicyError = validatePasswordPolicy(adminPassword);
  if (passwordPolicyError) {
    throw new Error(`ADMIN_PASSWORD is invalid: ${passwordPolicyError}`);
  }
  const passwordService = createPasswordService({
    crypto,
    pepper: requireEnv("PEPPER_V1"),
    currentPepperVersion: Number.parseInt(process.env.CURRENT_PEPPER_VERSION || "1", 10),
  });
  const passwordHash = await passwordService.hashPassword(adminPassword);
  const pool = createPool();

  try {
    console.log(`Ensuring superAdmin user: ${adminUsername}`);
    if (loadedEnvFile) {
      console.log(`Loaded DB environment from: ${loadedEnvFile}`);
    }

    const result = await pool.query(
      `INSERT INTO users (
         email,
         "passwordHash",
         "firstName",
         "lastName",
         "companyId",
         role,
         "isActive",
         "pepperVersion",
         "authSource",
         "ssoOnly",
         "sessionVersion",
         "createdAt",
         "updatedAt"
       )
       VALUES ($1, $2, $3, $4, NULL, 'superAdmin', true, $5, 'local', false, 1, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
         SET "passwordHash" = EXCLUDED."passwordHash",
             "pepperVersion" = EXCLUDED."pepperVersion",
             role = 'superAdmin',
             "companyId" = NULL,
             "isActive" = true,
             "authSource" = 'local',
             "ssoOnly" = false,
             "sessionVersion" = COALESCE(users."sessionVersion", 1) + 1,
             "updatedAt" = NOW()
       RETURNING id, email, role, "isActive" AS "isActive", "companyId" AS "companyId"`,
      [adminUsername, passwordHash.hash, "Digital Product", "Pass Admin", passwordHash.pepperVersion]
    );

    const admin = result.rows[0];
    console.log(`Super admin ready: ${admin.email} (id: ${admin.id}, active: ${admin.isActive})`);

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'superAdmin' AND \"isActive\" = true"
    );
    console.log(`Active superAdmin users: ${countResult.rows[0]?.count || 0}`);
  } finally {
    await pool.end();
  }
}

ensureSuperAdmin()
  .catch((error) => {
    console.error("Error ensuring super admin:", error.message);
    process.exit(1);
  });
