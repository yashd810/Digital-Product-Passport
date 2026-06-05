"use strict";

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

function configureHttp(app, {
  allowedOriginSet,
  cspConnectSrc,
  globalSymbolsDir,
  isPlainRecord,
  isProduction,
  normalizeIncomingDppIdentifiers,
  normalizeOutgoingDppIdentifiers,
  port,
}) {
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  if (isProduction) app.set("env", "production");

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOriginSet.has(origin)) return cb(null, true);
      cb(new Error("Forbidden"));
    },
    credentials: true,
  }));

  app.use(helmet({
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
    crossOriginResourcePolicy: false,
  }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.setHeader("X-XSS-Protection", "1; mode=block");
    }
    next();
  });

  app.use((req, res, next) => {
    if (!isProduction) return next();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (req.headers["x-api-key"] || req.headers["x-asset-key"]) return next();
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
      req.body = normalizeIncomingDppIdentifiers(req.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(normalizeOutgoingDppIdentifiers(payload));
    next();
  });

  app.use("/uploads/symbols", express.static(globalSymbolsDir));
  return { port };
}

module.exports = {
  configureHttp,
};
