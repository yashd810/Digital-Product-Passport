#!/usr/bin/env node
"use strict";

/**
 * Ensure one bootstrap super admin exists.
 *
 * Uses DB_* and PEPPER_V1 from the active environment or DOTENV_CONFIG_PATH.
 * Set ADMIN_EMAIL and optionally ADMIN_PASSWORD to override defaults.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const createPasswordService = require("../../src/services/password-service");

const DEFAULT_ADMIN_EMAIL = "digitalproductpass@gmail.com";

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

function findRepoEnvFile() {
  if (process.env.DOTENV_CONFIG_PATH) {
    return process.env.DOTENV_CONFIG_PATH;
  }

  let current = __dirname;
  while (current && current !== path.dirname(current)) {
    const candidate = path.join(current, "docker", ".env");
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  return null;
}

const loadedEnvFile = loadEnvFile(findRepoEnvFile());

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const pool = new Pool({
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: requireEnv("DB_NAME"),
});

function createTemporaryPassword() {
  return crypto.randomBytes(32).toString("base64url");
}

async function ensureSuperAdmin() {
  const adminEmail = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || createTemporaryPassword();
  const passwordService = createPasswordService({
    crypto,
    pepper: requireEnv("PEPPER_V1"),
    currentPepperVersion: Number.parseInt(process.env.CURRENT_PEPPER_VERSION || "1", 10),
  });
  const passwordHash = await passwordService.hashPassword(adminPassword);

  console.log(`Ensuring superAdmin user: ${adminEmail}`);
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
    [adminEmail, passwordHash.hash, "Digital Product", "Pass Admin", passwordHash.pepperVersion]
  );

  const admin = result.rows[0];
  console.log(`Super admin ready: ${admin.email} (id: ${admin.id}, active: ${admin.isActive})`);

  const countResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'superAdmin' AND \"isActive\" = true"
  );
  console.log(`Active superAdmin users: ${countResult.rows[0]?.count || 0}`);
}

ensureSuperAdmin()
  .catch((error) => {
    console.error("Error ensuring super admin:", error.message);
    process.exit(1);
  })
  .finally(() => pool.end());
