// Run this ONCE from your backend directory to create the super admin:
// node create_super_admin.js

require("dotenv").config();
const { Pool } = require("pg");
const crypto   = require("crypto");
const bcrypt   = require("bcryptjs");

const pool = new Pool({
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

// ── Edit these before running ─────────────────────────────────────────────────
const SUPER_ADMIN_EMAIL    = "admin@dpp.com";
const SUPER_ADMIN_PASSWORD = "admin123";
// ─────────────────────────────────────────────────────────────────────────────

const PEPPER = process.env.PEPPER_V1 || "change-this-pepper-in-production";

async function main() {
  try {
    const peppered = crypto
      .createHmac("sha256", PEPPER)
      .update(SUPER_ADMIN_PASSWORD)
      .digest("hex");

    const hash = await bcrypt.hash(peppered, 12);

    // Check if already exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1", [SUPER_ADMIN_EMAIL]
    );

    if (existing.rows.length) {
      // Update existing
      await pool.query(
        "UPDATE users SET password_hash=$1, pepper_version=1, role='super_admin', is_active=true WHERE email=$2",
        [hash, SUPER_ADMIN_EMAIL]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO users (email, password_hash, role, pepper_version, is_active)
         VALUES ($1, $2, 'super_admin', 1, true)`,
        [SUPER_ADMIN_EMAIL, hash]
      );
    }

  } catch (e) {
  } finally {
    await pool.end();
  }
}

main();