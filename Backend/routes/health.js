module.exports = function registerHealthRoutes(app) {
  app.get("/health", (_req, res) => res.json({ status: "OK", architecture: "dynamic-per-company-tables" }));
};
