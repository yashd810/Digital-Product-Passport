"use strict";

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

function configureHttp(app, {
  allowedOriginSet,
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

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOriginSet.has(origin)) return cb(null, true);
      const error = new Error("Forbidden: origin not allowed");
      error.code = "corsOriginDenied";
      error.statusCode = 403;
      return cb(error);
    },
    credentials: true,
  }));

  app.use((err, req, res, next) => {
    if (err && err.code === "corsOriginDenied") {
      return res.status(403).json({ error: "Forbidden: origin not allowed" });
    }
    return next(err);
  });

  app.use((req, res, next) => {
    if (!isProduction) return next();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (/^Bearer\s+\S+$/i.test(String(req.headers.authorization || "").trim())) return next();
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return res.status(403).json({ error: "Forbidden: missing origin header" });
    try {
      const { origin: parsedOrigin } = new URL(origin);
      if (!allowedOriginSet.has(parsedOrigin)) {
        return res.status(403).json({ error: "Forbidden: origin not allowed" });
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
