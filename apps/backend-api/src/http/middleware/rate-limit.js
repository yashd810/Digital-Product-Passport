"use strict";

const logger = require("../../services/logger");

const envInt = (name, fallback) => {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Factory: returns an Express middleware that rate-limits by a per-request bucket key.
 * Bucket counts are persisted in the requestRateLimits table.
 */
const createRateLimiter = (pool, state) => ({ key, limit, windowMs, message }) =>
async (req, res, next) => {
  const now = Date.now();
  const bucketKey = String(key(req) || "").slice(0, 255);
  if (!bucketKey) return next();
  if (now < state.dbUnavailableUntil) {
    return res.status(503).json({ error: "Rate limiting is temporarily unavailable. Please retry shortly." });
  }

  const resetAt = new Date(now + windowMs);
  const nowDate = new Date(now);

  try {
    const result = await pool.query(
      `INSERT INTO "requestRateLimits" ("bucketKey", count, "resetAt", "updatedAt")
         VALUES ($1, 1, $2, NOW())
         ON CONFLICT ("bucketKey") DO UPDATE
         SET count = CASE
               WHEN "requestRateLimits"."resetAt" <= $3 THEN 1
               ELSE "requestRateLimits".count + 1
             END,
             "resetAt" = CASE
               WHEN "requestRateLimits"."resetAt" <= $3 THEN $2
               ELSE "requestRateLimits"."resetAt"
             END,
             "updatedAt" = NOW()
         RETURNING count, "resetAt"`,
      [bucketKey, resetAt, nowDate]
    );

    const row = result.rows[0];
    state.consecutiveDbFailures = 0;
    state.dbUnavailableUntil = 0;
    if ((row?.count || 0) > limit) {
      return res.status(429).json({ error: message });
    }
    next();
  } catch (err) {
    state.consecutiveDbFailures += 1;
    const threshold = state.failureThreshold;
    if (state.consecutiveDbFailures >= threshold) {
      state.dbUnavailableUntil = now + state.cooldownMs;
    }
    logger.error({
      err,
      consecutiveDbFailures: state.consecutiveDbFailures,
      threshold,
      cooldownMs: state.cooldownMs
    }, "[rateLimit] rejecting request after DB error");
    return res.status(503).json({ error: "Rate limiting is temporarily unavailable. Please retry shortly." });
  }
};

async function cleanupExpiredRateLimits(pool) {
  const result = await pool.query(
    `DELETE FROM "requestRateLimits"
     WHERE "resetAt" <= NOW()`
  );
  return Number(result.rowCount || 0);
}

function startRateLimitMaintenance(pool) {
  const intervalMs = envInt("rateLimitCleanupIntervalMs", 5 * 60 * 1000);
  const timer = setInterval(async () => {
    try {
      const deleted = await cleanupExpiredRateLimits(pool);
      if (deleted > 0) {
        logger.info({ deleted }, "[rateLimit] cleaned expired buckets");
      }
    } catch (err) {
      logger.error({ err }, "[rateLimit] cleanup failed");
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

/**
 * Creates all application rate-limiter middleware instances.
 * Call once with the pool and destructure the returned object.
 */
const createRateLimiters = (pool) => {
  const state = {
    consecutiveDbFailures: 0,
    dbUnavailableUntil: 0,
    failureThreshold: envInt("rateLimitDbFailureThreshold", 3),
    cooldownMs: envInt("rateLimitDbFailureCooldownMs", 60 * 1000)
  };
  const rateLimit = createRateLimiter(pool, state);

  return {
    authRateLimit: rateLimit({
      key: (req) => `auth:${req.ip}:${req.path}:${String(req.body?.email || "").trim().toLowerCase()}`,
      limit: envInt("rateLimitAuthMax", 8),
      windowMs: envInt("rateLimitAuthWindowMs", 15 * 60 * 1000),
      message: "Too many attempts. Please wait a few minutes and try again."
    }),

    otpRateLimit: rateLimit({
      key: (req) => `otp:${req.ip}:${req.path}:${String(req.body?.preAuthToken || "").slice(0, 32)}`,
      limit: envInt("rateLimitOtpMax", 8),
      windowMs: envInt("rateLimitOtpWindowMs", 15 * 60 * 1000),
      message: "Too many verification attempts. Please log in again in a few minutes."
    }),

    passwordResetRateLimit: rateLimit({
      key: (req) => `reset:${req.ip}:${req.path}:${String(req.body?.email || req.body?.token || "").slice(0, 64)}`,
      limit: envInt("rateLimitPasswordResetMax", 5),
      windowMs: envInt("rateLimitPasswordResetWindowMs", 15 * 60 * 1000),
      message: "Too many password reset attempts. Please wait a few minutes and try again."
    }),

    publicReadRateLimit: rateLimit({
      key: (req) => `public-read:${req.ip}:${req.path}:${String(req.params?.dppId || req.params?.companyId || req.params?.typeName || "")}`,
      limit: envInt("rateLimitPublicReadMax", 120),
      windowMs: envInt("rateLimitPublicReadWindowMs", 60 * 1000),
      message: "Too many public requests. Please slow down and try again shortly."
    }),

    publicHeavyRateLimit: rateLimit({
      key: (req) => `public-heavy:${req.ip}:${req.path}:${String(req.params?.dppId || "")}`,
      limit: envInt("rateLimitPublicHeavyMax", 20),
      windowMs: envInt("rateLimitPublicHeavyWindowMs", 5 * 60 * 1000),
      message: "Too many export requests. Please try again in a few minutes."
    }),

    publicUnlockRateLimit: rateLimit({
      key: (req) => `public-unlock:${req.ip}:${req.path}:${String(req.params?.dppId || "")}`,
      limit: envInt("rateLimitPublicUnlockMax", 10),
      windowMs: envInt("rateLimitPublicUnlockWindowMs", 15 * 60 * 1000),
      message: "Too many unlock attempts. Please wait before trying again."
    }),

    publicScanRateLimit: rateLimit({
      key: (req) => `public-scan:${req.ip}:${String(req.params?.dppId || "")}`,
      limit: envInt("rateLimitPublicScanMax", 30),
      windowMs: envInt("rateLimitPublicScanWindowMs", 60 * 1000),
      message: "Too many scan requests. Please try again shortly."
    }),

    devicePushRateLimit: rateLimit({
      key: (req) => `device-push:${req.ip}:${String(req.params?.dppId || "")}`,
      limit: envInt("rateLimitDevicePushMax", 120),
      windowMs: envInt("rateLimitDevicePushWindowMs", 60 * 1000),
      message: "Too many device updates. Please slow down and try again shortly."
    }),

    apiKeyReadRateLimit: rateLimit({
      key: (req) => `api-key:${req.apiKey?.keyId || req.ip}:${req.path}`,
      limit: envInt("rateLimitApiKeyReadMax", 300),
      windowMs: envInt("rateLimitApiKeyReadWindowMs", 60 * 1000),
      message: "API rate limit exceeded. Please reduce request frequency."
    }),

    assetWriteRateLimit: rateLimit({
      key: (req) => `asset-write:${req.ip}:${req.assetContext?.companyId || ""}:${req.assetContext?.userId || ""}:${req.path}`,
      limit: envInt("rateLimitAssetWriteMax", 90),
      windowMs: envInt("rateLimitAssetWriteWindowMs", 60 * 1000),
      message: "Too many Passport Data Management requests. Please slow down and try again shortly."
    }),

    assetSourceFetchRateLimit: rateLimit({
      key: (req) => `asset-source:${req.ip}:${req.assetContext?.companyId || ""}:${req.assetContext?.userId || ""}`,
      limit: envInt("rateLimitAssetSourceFetchMax", 20),
      windowMs: envInt("rateLimitAssetSourceFetchWindowMs", 5 * 60 * 1000),
      message: "Too many ERP/API fetch requests. Please wait a few minutes and try again."
    })
  };
};

module.exports = {
  envInt,
  createRateLimiters,
  cleanupExpiredRateLimits,
  startRateLimitMaintenance
};
