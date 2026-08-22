"use strict";

function serializeHostOnlyCookie(name, value, options = {}) {
  if (Object.hasOwn(options, "domain")) {
    throw new Error("Domain-scoped cookies are not supported");
  }
  if (String(name).startsWith("__Host-") && (!options.secure || (options.path !== undefined && options.path !== "/"))) {
    throw new Error("__Host- cookies require Secure and Path=/");
  }

  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

module.exports = { serializeHostOnlyCookie };
