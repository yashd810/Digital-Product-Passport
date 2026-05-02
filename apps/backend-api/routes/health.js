module.exports = function registerHealthRoutes(app, pool) {
  app.get("/health", async (_req, res) => {
    try {
      // Check database connectivity
      await pool.query("SELECT 1");
      res.json({ 
        status: "OK", 
        architecture: "dynamic-per-company-tables",
        database: "connected"
      });
    } catch (err) {
      res.status(503).json({ 
        status: "UNAVAILABLE", 
        database: "disconnected",
        error: "Database connection failed"
      });
    }
  });
};
