"use strict";

const crypto = require("crypto");
const logger = require("../../platform/observability/logger");

const envInt = (name, fallback) => {
  const environmentName = String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
  const raw = process.env[name] ?? process.env[environmentName];
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

const hashRateLimitIdentity = (value) => crypto
  .createHash("sha256")
  .update(String(value || ""))
  .digest("base64url");

const routeBucketName = (req) => {
  const routePath = req?.route?.path;
  if (typeof routePath === "string" && routePath) return routePath.slice(0, 160);
  if (routePath instanceof RegExp) return routePath.toString().slice(0, 160);
  // Route middleware normally receives Express's stable route template. If a
  // future call site invokes a limiter before route matching, fail closed into
  // one shared bucket rather than persist an attacker-controlled URL/ID.
  return "unmatched";
};

const composeRateLimiters = (...middleware) => (req, res, next) => {
  let index = 0;
  const runNext = (error) => {
    if (error) return next(error);
    const current = middleware[index];
    index += 1;
    return current ? current(req, res, runNext) : next();
  };
  return runNext();
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

  const authIpRateLimit = rateLimit({
    key: (req) => `auth-ip:${req.ip}:${routeBucketName(req)}`,
    limit: envInt("rateLimitAuthIpMax", 30),
    windowMs: envInt("rateLimitAuthWindowMs", 15 * 60 * 1000),
    message: "Too many attempts. Please wait a few minutes and try again."
  });
  const authIdentityRateLimit = rateLimit({
    key: (req) => {
      const identity = String(req.body?.email || req.body?.token || "").trim().toLowerCase();
      // Keep the account budget independent of the network budget. Including
      // req.ip here would let a distributed password-spraying attempt reset
      // the supposedly identity-scoped counter on every new source address.
      return `auth-identity:${routeBucketName(req)}:${hashRateLimitIdentity(identity || "anonymous")}`;
    },
    limit: envInt("rateLimitAuthMax", 8),
    windowMs: envInt("rateLimitAuthWindowMs", 15 * 60 * 1000),
    message: "Too many attempts. Please wait a few minutes and try again."
  });

  const otpIpRateLimit = rateLimit({
    key: (req) => `otp-ip:${req.ip}:${routeBucketName(req)}`,
    limit: envInt("rateLimitOtpIpMax", 20),
    windowMs: envInt("rateLimitOtpWindowMs", 15 * 60 * 1000),
    message: "Too many verification attempts. Please log in again in a few minutes."
  });
  const otpTokenRateLimit = rateLimit({
    key: (req) => `otp-token:${routeBucketName(req)}:${hashRateLimitIdentity(req.body?.preAuthToken || "anonymous")}`,
    limit: envInt("rateLimitOtpMax", 8),
    windowMs: envInt("rateLimitOtpWindowMs", 15 * 60 * 1000),
    message: "Too many verification attempts. Please log in again in a few minutes."
  });

  const passwordResetIpRateLimit = rateLimit({
    key: (req) => `reset-ip:${req.ip}:${routeBucketName(req)}`,
    limit: envInt("rateLimitPasswordResetIpMax", 15),
    windowMs: envInt("rateLimitPasswordResetWindowMs", 15 * 60 * 1000),
    message: "Too many password reset attempts. Please wait a few minutes and try again."
  });
  const passwordResetIdentityRateLimit = rateLimit({
    key: (req) => {
      const identity = String(req.body?.email || req.body?.token || "anonymous").trim().toLowerCase();
      return `reset-identity:${routeBucketName(req)}:${hashRateLimitIdentity(identity)}`;
    },
    limit: envInt("rateLimitPasswordResetMax", 5),
    windowMs: envInt("rateLimitPasswordResetWindowMs", 15 * 60 * 1000),
    message: "Too many password reset attempts. Please wait a few minutes and try again."
  });

  return {
    authRateLimit: composeRateLimiters(authIpRateLimit, authIdentityRateLimit),

    otpRateLimit: composeRateLimiters(otpIpRateLimit, otpTokenRateLimit),

    passwordResetRateLimit: composeRateLimiters(
      passwordResetIpRateLimit,
      passwordResetIdentityRateLimit
    ),

    // Contact submissions can cause email delivery, so they have their own
    // limits rather than sharing the comparatively permissive public-read
    // budget. Sender and configured-recipient identities are hashed before
    // persistence to avoid retaining mailbox addresses in rate-limit rows.
    contactIpRateLimit: rateLimit({
      key: (req) => `contact-ip:${String(req.ip || "unknown")}`,
      limit: envInt("rateLimitContactIpMax", 3),
      windowMs: envInt("rateLimitContactIpWindowMs", 15 * 60 * 1000),
      message: "Too many contact requests. Please wait before trying again."
    }),

    contactEmailRateLimit: rateLimit({
      key: (req) => {
        const email = String(req.contactSubmission?.email || "").trim().toLowerCase();
        return email ? `contact-email:${hashRateLimitIdentity(email)}` : "";
      },
      limit: envInt("rateLimitContactEmailMax", 2),
      windowMs: envInt("rateLimitContactEmailWindowMs", 60 * 60 * 1000),
      message: "Too many contact requests for this email address. Please try again later."
    }),

    contactRecipientRateLimit: rateLimit({
      key: () => {
        const recipient = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        return recipient ? `contact-recipient:${hashRateLimitIdentity(recipient)}` : "";
      },
      limit: envInt("rateLimitContactRecipientMax", 30),
      windowMs: envInt("rateLimitContactRecipientWindowMs", 60 * 60 * 1000),
      message: "The contact form is temporarily busy. Please try again later."
    }),

    publicReadRateLimit: rateLimit({
      key: (req) => `public-read:${req.ip}:${routeBucketName(req)}`,
      limit: envInt("rateLimitPublicReadMax", 120),
      windowMs: envInt("rateLimitPublicReadWindowMs", 60 * 1000),
      message: "Too many public requests. Please slow down and try again shortly."
    }),

    publicHeavyRateLimit: rateLimit({
      key: (req) => `public-heavy:${req.ip}:${routeBucketName(req)}`,
      limit: envInt("rateLimitPublicHeavyMax", 20),
      windowMs: envInt("rateLimitPublicHeavyWindowMs", 5 * 60 * 1000),
      message: "Too many export requests. Please try again in a few minutes."
    }),

    publicUnlockRateLimit: rateLimit({
      key: (req) => `public-unlock:${req.ip}:${routeBucketName(req)}`,
      limit: envInt("rateLimitPublicUnlockMax", 10),
      windowMs: envInt("rateLimitPublicUnlockWindowMs", 15 * 60 * 1000),
      message: "Too many unlock attempts. Please wait before trying again."
    }),

    integrationWriteRateLimit: rateLimit({
      key: (req) => `integration-write:${req.ip}:${req.user?.userId || ""}:${routeBucketName(req)}`,
      limit: envInt("rateLimitIntegrationWriteMax", 180),
      windowMs: envInt("rateLimitIntegrationWriteWindowMs", 60 * 1000),
      message: "Too many integration write requests. Please slow down and try again shortly."
    }),

    publicScanRateLimit: rateLimit({
      key: (req) => `public-scan:${req.ip}:${routeBucketName(req)}`,
      limit: envInt("rateLimitPublicScanMax", 30),
      windowMs: envInt("rateLimitPublicScanWindowMs", 60 * 1000),
      message: "Too many scan requests. Please try again shortly."
    }),

    assetWriteRateLimit: rateLimit({
      key: (req) => `asset-write:${req.ip}:${req.assetContext?.companyId || ""}:${req.assetContext?.userId || ""}:${routeBucketName(req)}`,
      limit: envInt("rateLimitAssetWriteMax", 90),
      windowMs: envInt("rateLimitAssetWriteWindowMs", 60 * 1000),
      message: "Too many Passport Data Management requests. Please slow down and try again shortly."
    }),

    assetSourceFetchRateLimit: rateLimit({
      key: (req) => `asset-source:${req.ip}:${req.assetContext?.companyId || ""}:${req.assetContext?.userId || ""}`,
      limit: envInt("rateLimitAssetSourceFetchMax", 20),
      windowMs: envInt("rateLimitAssetSourceFetchWindowMs", 5 * 60 * 1000),
      message: "Too many ERP/API fetch requests. Please wait a few minutes and try again."
    }),

    sensitiveActionRateLimit: composeRateLimiters(
      rateLimit({
        key: (req) => `sensitive-action-ip:${req.ip}:${routeBucketName(req)}`,
        limit: envInt("rateLimitSensitiveActionIpMax", 20),
        windowMs: envInt("rateLimitSensitiveActionWindowMs", 15 * 60 * 1000),
        message: "Too many sensitive account changes. Please wait before trying again."
      }),
      rateLimit({
        // Sensitive account changes need a per-user budget as well as a
        // source-IP budget. Otherwise a stolen session could toggle MFA or
        // exhaust recovery attempts from a rotating botnet.
        key: (req) => `sensitive-action-user:${routeBucketName(req)}:${hashRateLimitIdentity(req.user?.userId || "anonymous")}`,
        limit: envInt("rateLimitSensitiveActionMax", 8),
        windowMs: envInt("rateLimitSensitiveActionWindowMs", 15 * 60 * 1000),
        message: "Too many sensitive account changes. Please wait before trying again."
      })
    )
  };
};

module.exports = {
  envInt,
  createRateLimiters,
  hashRateLimitIdentity,
  startRateLimitMaintenance
};
