"use strict";

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

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
  app.set("trust proxy", 1);
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

  app.use(express.json({
    limit: "10mb",
    type: ["application/json", "application/merge-patch+json"],
  }));

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

module.exports = {
  configureHttp,
};
