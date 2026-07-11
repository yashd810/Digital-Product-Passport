"use strict";

const crypto = require("crypto");

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = function registerHealthRoutes(app, { pool, storageService }) {
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "OK",
        architecture: "dynamic-per-company-tables",
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

  app.get("/health/storage", async (_req, res) => {
    const provider = storageService?.provider || storageService?.name || "unknown";
    if (provider === "disabled") {
      return res.status(200).json({
        status: "OK",
        storage: "disabled",
        provider,
      });
    }
    if (!storageService?.saveObject || !storageService?.fetchObject || !storageService?.deleteObject) {
      return res.status(503).json({
        status: "UNAVAILABLE",
        storage: "unsupported",
        provider,
        error: "Storage probe requires save, fetch, and delete support.",
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
        provider,
        storageKey: stored?.storageKey || probeKey,
        sha256: expectedHash,
      });
    } catch (error) {
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
        provider,
        error: error.message || "Storage probe failed",
      });
    }
  });
};
