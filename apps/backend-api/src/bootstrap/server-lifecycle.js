"use strict";

/**
 * Process lifecycle for the API composition root.
 *
 * Starts HTTP only after startup checks complete and closes HTTP, scheduled
 * work, and PostgreSQL in a deterministic order when the process stops.
 */
function configureServerLifecycle({
  app,
  startup,
  port,
  logger,
  pool,
  rateLimitMaintenanceTimer,
  stopAssetManagementScheduler,
  shutdownTimeoutMs,
}) {
  let httpServer = null;
  let isShuttingDown = false;

  startup.then(() => {
    httpServer = app.listen(port, () => {
      logger.info(`[Server] Listening on port ${port}`);
    });
  });

  async function closeHttpServer() {
    if (!httpServer) return;
    httpServer.closeIdleConnections?.();
    await new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      timeout = setTimeout(() => {
        logger.warn({ timeoutMs: shutdownTimeoutMs }, "Forcing HTTP connections closed during shutdown");
        httpServer.closeAllConnections?.();
        finish();
      }, shutdownTimeoutMs);
      timeout.unref?.();
      httpServer.close(finish);
    }).finally(() => {
      httpServer.closeIdleConnections?.();
    });
  }

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`${signal} received: starting graceful shutdown`);
    if (rateLimitMaintenanceTimer) clearInterval(rateLimitMaintenanceTimer);
    stopAssetManagementScheduler?.();
    try {
      await closeHttpServer();
      logger.info("HTTP server closed");
      await pool.end();
      logger.info("Database pool closed");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Graceful shutdown failed");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
    process.exit(1);
  });

  return { shutdown };
}

module.exports = {
  configureServerLifecycle,
};
