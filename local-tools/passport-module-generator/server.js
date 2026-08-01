"use strict";

/**
 * Stable command-line entrypoint for the Passport Module Generator.
 *
 * Run this file from the repository root. The implementation lives in
 * `server/application.js` so transport concerns are not mixed with the tool's
 * copyable output package or browser-neutral rules.
 */
const generatorApplication = require("./server/application");

if (require.main === module) {
  generatorApplication.startGeneratorServer();
}

module.exports = generatorApplication;
