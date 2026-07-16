"use strict";

const crypto = require("crypto");
const net = require("node:net");

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeIpAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function isLoopbackAddress(value) {
  const address = normalizeIpAddress(value);
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  return net.isIP(address) === 4 && address.startsWith("127.");
}

function isTrustedLoopbackRequest(req) {
  // `req.ip` honors Express's one trusted proxy hop. Checking it prevents a
  // public client forwarded by Caddy from being treated as local, while the
  // socket check prevents a forwarded loopback value from granting access to
  // a non-loopback peer.
  return isLoopbackAddress(req.ip) && isLoopbackAddress(req.socket?.remoteAddress);
}

module.exports = function registerHealthRoutes(app, { pool, storageService }) {
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "OK",
        database: "connected",
        storage: "notChecked",
      });
    } catch (_err) {
      res.status(503).json({
        status: "UNAVAILABLE",
        database: "disconnected",
        storage: "notChecked",
        error: "Database connection failed",
      });
    }
  });

  app.get("/health/storage", async (req, res) => {
    if (!isTrustedLoopbackRequest(req)) {
      return res.status(403).json({
        status: "FORBIDDEN",
        error: "Storage probe is restricted.",
      });
    }

    const provider = storageService?.provider || storageService?.name || "unknown";
    if (provider === "disabled") {
      return res.status(200).json({
        status: "OK",
        storage: "disabled",
      });
    }
    if (!storageService?.saveObject || !storageService?.fetchObject || !storageService?.deleteObject) {
      return res.status(503).json({
        status: "UNAVAILABLE",
        storage: "unavailable",
      });
    }

    const probeBody = Buffer.from(JSON.stringify({
      type: "storageProbe",
      timestamp: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    }), "utf8");
    const expectedHash = sha256Hex(probeBody);
    const probeKey = `healthchecks/storage/${Date.now()}-${crypto.randomUUID()}.json`;
    let stored = null;

    try {
      stored = await storageService.saveObject({
        key: probeKey,
        buffer: probeBody,
        contentType: "application/json",
        cacheControl: "private, max-age=0, no-store",
      });

      const fetched = await storageService.fetchObject(stored?.storageKey || probeKey);
      const fetchedBuffer = Buffer.from(await fetched.arrayBuffer());
      const actualHash = sha256Hex(fetchedBuffer);
      if (actualHash !== expectedHash) {
        throw new Error(`Storage probe hash mismatch: expected ${expectedHash}, received ${actualHash}`);
      }

      await storageService.deleteObject(stored?.storageKey || probeKey);
      return res.json({
        status: "OK",
        storage: "ok",
      });
    } catch {
      try {
        if (stored?.storageKey || probeKey) {
          await storageService.deleteObject(stored?.storageKey || probeKey);
        }
      } catch {
        // Best-effort cleanup only.
      }
      return res.status(503).json({
        status: "UNAVAILABLE",
        storage: "failed",
      });
    }
  });
};
