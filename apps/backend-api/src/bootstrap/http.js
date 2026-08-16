"use strict";

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const helmet = require("helmet");
const net = require("net");
const { contactRequestMaxBytes } = require("../shared/http/contact-request");
const { isPrivateOrReservedIpAddress } = require("../shared/security/network-address");

const maxJsonNestingDepth = 64;
const maxJsonNodeCount = 100_000;
const maxJsonRequestBytes = 10 * 1024 * 1024;

function normalizeProxyAddress(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/%[a-z0-9._-]+$/i, "");
  return net.isIP(normalized) > 0 ? normalized : null;
}

function isLoopbackProxyAddress(address) {
  const normalized = normalizeProxyAddress(address);
  return normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized || "")
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized || "");
}

function parseDockerDefaultGatewayAddresses(routeTable, isDocker = fs.existsSync("/.dockerenv")) {
  if (!isDocker) return [];

  const addresses = new Set();
  for (const line of String(routeTable || "").split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3 || columns[1] !== "00000000" || !/^[a-f0-9]{8}$/i.test(columns[2])) continue;
    const address = columns[2]
      .match(/../g)
      .reverse()
      .map((octet) => Number.parseInt(octet, 16))
      .join(".");
    if (address !== "0.0.0.0" && isPrivateOrReservedIpAddress(address)) addresses.add(address);
  }
  return [...addresses];
}

function readDockerDefaultGatewayAddresses() {
  try {
    return parseDockerDefaultGatewayAddresses(fs.readFileSync("/proc/net/route", "utf8"));
  } catch {
    // An unavailable procfs is not a reason to trust a broad private range.
    return [];
  }
}

function createTrustedProxyAddressChecker(
  rawValue = process.env.TRUSTED_PROXY_IPS,
  { dockerGatewayAddresses = readDockerDefaultGatewayAddresses() } = {}
) {
  const configuredValues = String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const trustedAddresses = new Set();

  if (configuredValues.length === 0) {
    trustedAddresses.add("127.0.0.1");
    trustedAddresses.add("::1");
    trustedAddresses.add("::ffff:127.0.0.1");
    for (const value of dockerGatewayAddresses) {
      const address = normalizeProxyAddress(value);
      if (address && isPrivateOrReservedIpAddress(address)) trustedAddresses.add(address);
    }
  } else {
    for (const value of configuredValues) {
      const address = normalizeProxyAddress(value);
      if (!address || !isPrivateOrReservedIpAddress(address)) {
        throw new Error("TRUSTED_PROXY_IPS must contain only exact private or loopback IP literals");
      }
      trustedAddresses.add(address);
    }
  }

  return (address) => {
    const normalized = normalizeProxyAddress(address);
    return Boolean(normalized && trustedAddresses.has(normalized));
  };
}

function assertJsonStructureWithinLimits(_req, _res, buffer) {
  let depth = 0;
  let nodes = 0;
  let insideString = false;
  let escaped = false;
  let insideScalar = false;

  const countNode = () => {
    nodes += 1;
    if (nodes > maxJsonNodeCount) {
      const error = new Error("JSON request body is too complex");
      error.status = 413;
      error.statusCode = 413;
      error.type = "entity.too.complex";
      throw error;
    }
  };
  const isWhitespace = (byte) => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

  for (const byte of buffer) {
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        escaped = true;
      } else if (byte === 0x22) {
        insideString = false;
        countNode();
      }
      continue;
    }

    if (byte === 0x22) {
      insideString = true;
      insideScalar = false;
      continue;
    }
    if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      countNode();
      insideScalar = false;
      if (depth > maxJsonNestingDepth) {
        const error = new Error("JSON request body is too complex");
        error.status = 413;
        error.statusCode = 413;
        error.type = "entity.too.complex";
        throw error;
      }
      continue;
    }
    if (byte === 0x7d || byte === 0x5d) {
      depth = Math.max(0, depth - 1);
      insideScalar = false;
      continue;
    }
    if (byte === 0x3a || byte === 0x2c || isWhitespace(byte)) {
      insideScalar = false;
      continue;
    }
    if (!insideScalar) {
      countNode();
      insideScalar = true;
    }
  }
}

function createEarlyJsonBodyGuard({
  windowMs = 60 * 1000,
  maxRequests = 120,
  largeBodyThresholdBytes = 1024 * 1024,
  maxLargeRequests = 12,
  maxTrackedSources = 10_000,
} = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json" && contentType !== "application/merge-patch+json") return next();

    const contentEncoding = String(req.headers["content-encoding"] || "identity").trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      return res.status(415).json({ error: "Compressed JSON request bodies are not supported" });
    }

    const contentLengthHeader = String(req.headers["content-length"] || "").trim();
    if (contentLengthHeader && !/^\d+$/.test(contentLengthHeader)) {
      return res.status(400).json({ error: "Invalid Content-Length header" });
    }
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > maxJsonRequestBytes)) {
      return res.status(413).json({ error: "JSON request body is too large" });
    }

    const now = Date.now();
    const source = String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 128);
    let bucket = buckets.get(source);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= maxTrackedSources) {
        for (const [key, candidate] of buckets) {
          if (candidate.resetAt <= now) buckets.delete(key);
        }
      }
      if (!bucket && buckets.size >= maxTrackedSources) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({ error: "Too many request sources. Please retry shortly." });
      }
      bucket = { count: 0, largeCount: 0, resetAt: now + windowMs };
      buckets.set(source, bucket);
    }

    bucket.count += 1;
    if (contentLength !== null && contentLength >= largeBodyThresholdBytes) bucket.largeCount += 1;
    if (bucket.count > maxRequests || bucket.largeCount > maxLargeRequests) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: "Too many JSON request bodies. Please retry shortly." });
    }
    return next();
  };
}

function configureHttp(app, {
  allowedOriginSet,
  credentialedOriginSet = allowedOriginSet,
  cspConnectSrc,
  isPlainRecord,
  isProduction,
  normalizeIncomingJsonValue,
  normalizeOutgoingJsonValue,
  port,
}) {
  app.disable("x-powered-by");
  // Trust only exact, configured reverse-proxy source addresses. Trusting all
  // private peers would allow a compromised Docker peer to forge XFF and evade
  // every IP-based guard. The default recognizes host loopback and the exact
  // Docker gateway which receives host-local Caddy connections.
  app.set("trust proxy", createTrustedProxyAddressChecker());
  if (isProduction) app.set("env", "production");

  app.use(helmet({
    strictTransportSecurity: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https:"],
        styleSrcAttr: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:", "https:"],
        connectSrc: cspConnectSrc,
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use((req, res, next) => {
    const requestPath = String(req.path || "");
    const carriesAuthenticationMaterial = requestPath === "/api/invite/validate"
      || requestPath === "/api/users/me"
      || /^\/api\/users\/me\/(?:token|password|2fa)$/.test(requestPath)
      || /^\/api\/auth(?:\/|$)/.test(requestPath)
      || /^\/api\/companies\/[^/]+\/api-keys(?:\/|$)/.test(requestPath);
    if (carriesAuthenticationMaterial) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  app.use(cors((req, cb) => {
    const origin = req.headers.origin;
    if (!origin || allowedOriginSet.has(origin)) {
      return cb(null, {
        origin: true,
        credentials: Boolean(origin && credentialedOriginSet.has(origin)),
      });
    }
    const error = new Error("Forbidden: origin not allowed");
    error.code = "corsOriginDenied";
    error.statusCode = 403;
    return cb(error);
  }));

  app.use((err, req, res, next) => {
    if (err && err.code === "corsOriginDenied") {
      return res.status(403).json({ error: "Forbidden: origin not allowed" });
    }
    return next(err);
  });

  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const hasBearerAuthorization = /^Bearer\s+\S+$/i.test(String(req.headers.authorization || "").trim());
    const hasSessionCookie = Boolean(String(req.headers.cookie || "").trim());
    // Bearer requests require a non-simple Authorization header, so a hostile
    // browser origin cannot send them without passing the CORS preflight. Cookie
    // requests are origin-validated in every environment; production also
    // validates anonymous state-changing browser requests.
    if (hasBearerAuthorization || (!isProduction && !hasSessionCookie)) return next();
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return res.status(403).json({ error: "Forbidden: missing origin header" });
    try {
      const { origin: parsedOrigin } = new URL(origin);
      if (!allowedOriginSet.has(parsedOrigin)) {
        return res.status(403).json({ error: "Forbidden: origin not allowed" });
      }
      // Public origins may make anonymous or API-key requests, but a request
      // that carries a browser cookie is session-authenticated and must come
      // only from the dashboard origin. This blocks a compromised public
      // viewer from minting bearer tokens or mutating a dashboard session.
      if (String(req.headers.cookie || "").trim() && !credentialedOriginSet.has(parsedOrigin)) {
        return res.status(403).json({ error: "Forbidden: cookie-authenticated origin not allowed" });
      }
    } catch {
      return res.status(403).json({ error: "Forbidden: invalid origin header" });
    }
    next();
  });

  app.use(createEarlyJsonBodyGuard());

  const jsonContentTypes = ["application/json", "application/merge-patch+json"];
  const contactJsonParser = express.json({
    limit: contactRequestMaxBytes,
    type: jsonContentTypes,
    verify: assertJsonStructureWithinLimits,
  });
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/api/contact") {
      return contactJsonParser(req, res, next);
    }
    return next();
  });
  app.use((error, req, res, next) => {
    if (req.method === "POST" && req.path === "/api/contact") {
      if (error?.type === "entity.too.large") {
        return res.status(413).json({ error: "Contact request is too large" });
      }
      if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Invalid JSON request body" });
      }
      if (error?.type === "entity.too.complex") {
        return res.status(413).json({ error: "JSON request body is too complex" });
      }
    }
    return next(error);
  });

  app.use(express.json({
    limit: "10mb",
    type: jsonContentTypes,
    verify: assertJsonStructureWithinLimits,
  }));

  app.use((error, _req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "JSON request body is too large" });
    }
    if (error?.type === "entity.too.complex") {
      return res.status(413).json({ error: "JSON request body is too complex" });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON request body" });
    }
    return next(error);
  });

  app.use((req, res, next) => {
    if (req.body && (Array.isArray(req.body) || isPlainRecord(req.body))) {
      req.body = normalizeIncomingJsonValue(req.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(normalizeOutgoingJsonValue(payload));
    next();
  });
  return { port };
}

function configureHttpErrorHandling(app, { logger } = {}) {
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();

    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Uploaded file is too large" });
    }
    if (String(error?.code || "").startsWith("LIMIT_")) {
      return res.status(400).json({ error: "Invalid multipart request" });
    }
    if (error?.code === "jsonInputTooComplex") {
      return res.status(413).json({ error: "JSON request body is too complex" });
    }

    const candidateStatus = Number(error?.statusCode || error?.status);
    const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 500
      ? candidateStatus
      : 500;
    if (statusCode >= 500) logger?.error?.({ err: error }, "Unhandled HTTP request error");
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Internal server error" : "Invalid request",
    });
  });
}

module.exports = {
  assertJsonStructureWithinLimits,
  createTrustedProxyAddressChecker,
  configureHttp,
  configureHttpErrorHandling,
  createEarlyJsonBodyGuard,
  isLoopbackProxyAddress,
  normalizeProxyAddress,
  parseDockerDefaultGatewayAddresses,
};
