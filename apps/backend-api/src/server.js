"use strict";

/**
 * Backend process entrypoint.
 *
 * Keep this file intentionally tiny: deployment and local development both
 * start here, while all application composition lives in `bootstrap/`.
 */
require("./bootstrap/start-server");
