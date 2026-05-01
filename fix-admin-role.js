#!/usr/bin/env node
/**
 * Fix Script: Grant super_admin role to admin email
 * This script updates the user role to super_admin based on the ADMIN_EMAIL
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function fixAdminRole() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || "yashd810@gmail.com";
    
    console.log(`🔧 Fixing admin role for: ${adminEmail}`);

    // Check if user exists
    const checkUser = await pool.query(
      "SELECT id, email, role FROM users WHERE email = $1",
      [adminEmail]
    );

    if (!checkUser.rows.length) {
      console.log(`⚠️  User not found: ${adminEmail}`);
      console.log("Please create the user first by registering via the application.");
      await pool.end();
      return;
    }

    const user = checkUser.rows[0];
    console.log(`📝 Found user: ${user.email} (current role: ${user.role})`);

    if (user.role === "super_admin") {
      console.log(`✅ User already has super_admin role`);
      await pool.end();
      return;
    }

    // Update role to super_admin
    const updateResult = await pool.query(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE email = $2 RETURNING id, email, role",
      ["super_admin", adminEmail]
    );

    const updatedUser = updateResult.rows[0];
    console.log(`✅ Successfully updated role to: ${updatedUser.role}`);
    console.log(`📌 User ${updatedUser.email} now has admin access`);

    // Also list all super_admin users
    const allAdmins = await pool.query(
      "SELECT id, email, company_id FROM users WHERE role = $1 ORDER BY created_at DESC",
      ["super_admin"]
    );

    console.log(`\n👥 All super_admin users (${allAdmins.rows.length}):`);
    allAdmins.rows.forEach((admin) => {
      console.log(`   - ${admin.email} (ID: ${admin.id})`);
    });

    await pool.end();
  } catch (error) {
    console.error("❌ Error fixing admin role:", error.message);
    process.exit(1);
  }
}

fixAdminRole();
