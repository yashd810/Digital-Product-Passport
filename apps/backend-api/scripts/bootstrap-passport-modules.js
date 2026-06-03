"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${path.basename(scriptPath)} exited with status ${result.status}`);
    error.statusCode = result.status || 1;
    throw error;
  }
}

function parseBootstrapOptions(args = []) {
  const passthroughArgs = [];
  let skipMigrate = false;
  let migrateOnly = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--skip-migrate" || arg === "--seed-only") {
      skipMigrate = true;
      continue;
    }
    if (arg === "--migrate-only") {
      migrateOnly = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      passthroughArgs.push(arg);
      continue;
    }
    passthroughArgs.push(arg);
  }

  if (dryRun) skipMigrate = true;

  return {
    dryRun,
    migrateOnly,
    skipMigrate,
    seedArgs: passthroughArgs,
  };
}

function runBootstrap(args = process.argv.slice(2)) {
  const options = parseBootstrapOptions(args);
  const migrateScript = path.resolve(__dirname, "migrate-db.js");
  const seedScript = path.resolve(__dirname, "seed-passport-types.js");

  if (!options.skipMigrate) {
    console.log("[bootstrap-passport-modules] Running database migration...");
    runNodeScript(migrateScript);
  } else if (options.dryRun) {
    console.log("[bootstrap-passport-modules] Dry run: skipping database migration.");
  }

  if (options.migrateOnly) {
    console.log("[bootstrap-passport-modules] Migration complete; seed step skipped.");
    return;
  }

  console.log("[bootstrap-passport-modules] Seeding passport type modules...");
  runNodeScript(seedScript, options.seedArgs);
}

if (require.main === module) {
  try {
    runBootstrap();
  } catch (error) {
    console.error("[bootstrap-passport-modules] failed:", error.message);
    process.exitCode = error.statusCode || 1;
  }
}

module.exports = {
  parseBootstrapOptions,
  runBootstrap,
};
