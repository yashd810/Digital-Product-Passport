"use strict";

const path = require("node:path");

const networkAddressModule = process.env.DPP_NETWORK_ADDRESS_MODULE
  || path.resolve(__dirname, "../../backend-api/src/shared/security/network-address.js");
const {
  isPrivateOrReservedHostname,
  normalizeHostname,
} = require(networkAddressModule);

function isLoopbackConfigurationHostname(value) {
  const hostname = normalizeHostname(value);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

function isValidConfiguredOrigin(value) {
  const rawValue = String(value || "");
  try {
    const parsed = new URL(rawValue);
    const hostname = normalizeHostname(parsed.hostname);
    const isLoopback = isLoopbackConfigurationHostname(hostname);
    return rawValue.trim() === rawValue
      && !/[\u0000-\u001F\u007F\s\\]/.test(rawValue)
      && Boolean(hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === "/"
      && !parsed.search
      && !parsed.hash
      && ((parsed.protocol === "https:" && (!isPrivateOrReservedHostname(hostname) || isLoopback))
        || (parsed.protocol === "http:" && isLoopback));
  } catch {
    return false;
  }
}

function validateBuildOrigins(environment = process.env) {
  const apiOrigin = String(environment.VITE_API_URL || "");
  if (
    (apiOrigin && !isValidConfiguredOrigin(apiOrigin))
    || !isValidConfiguredOrigin(environment.VITE_PUBLIC_VIEWER_URL)
    || !isValidConfiguredOrigin(environment.VITE_MARKETING_URL)
  ) {
    throw new Error("VITE API, public viewer, and marketing URLs must be safe HTTP(S) origins");
  }
}

if (require.main === module) validateBuildOrigins();

module.exports = {
  isValidConfiguredOrigin,
  validateBuildOrigins,
};
