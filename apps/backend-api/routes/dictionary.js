"use strict";

module.exports = function registerDictionaryRoutes(app, {
  publicReadRateLimit,
  batteryDictionaryService,
}) {
  const svc = batteryDictionaryService;

  const setCache = (res, contentType = "application/json") => {
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
  };

  const sendPrettyJson = (res, payload, contentType = "application/json") => {
    setCache(res, contentType);
    res.send(`${JSON.stringify(payload, null, 2)}\n`);
  };

  const sendPrettyError = (res, statusCode, payload) => {
    res.status(statusCode);
    res.setHeader("Content-Type", "application/json");
    res.send(`${JSON.stringify(payload, null, 2)}\n`);
  };

  // ─── JSON-LD CONTEXT (served at canonical dictionary URL) ─────────────────
  app.get(["/dictionary/battery/v1/context.jsonld", "/api/dictionary/battery/v1/context.jsonld"], publicReadRateLimit, (_req, res) => {
    sendPrettyJson(res, svc.getContext(), "application/ld+json");
  });

  // ─── MANIFEST ─────────────────────────────────────────────────────────────
  app.get(["/api/dictionary/battery/v1/manifest", "/dictionary/battery/v1/manifest.json"],
    publicReadRateLimit, (_req, res) => {
      sendPrettyJson(res, svc.getManifest());
    });

  // ─── CATEGORIES ───────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/categories", publicReadRateLimit, (_req, res) => {
    sendPrettyJson(res, svc.getCategories());
  });

  // ─── UNITS ────────────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/units", publicReadRateLimit, (_req, res) => {
    sendPrettyJson(res, svc.getUnits());
  });

  // ─── FIELD MAP ────────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/field-map", publicReadRateLimit, (_req, res) => {
    sendPrettyJson(res, svc.getFieldMap());
  });

  // ─── CATEGORY RULES / APPLICABILITY ──────────────────────────────────────
  app.get(["/api/dictionary/battery/v1/category-rules", "/dictionary/battery/v1/category-rules.json"],
    publicReadRateLimit, (_req, res) => {
      sendPrettyJson(res, svc.getCategoryRules());
    });

  // ─── TERMS (all, or filtered by category) ────────────────────────────────
  app.get("/api/dictionary/battery/v1/terms", publicReadRateLimit, (req, res) => {
    const { category, search } = req.query;
    let results = svc.getTerms();

    if (category) {
      results = results.filter(t => t.category === category);
    }

    if (search) {
      const q = String(search).toLowerCase();
      results = results.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q) ||
        t.slug.includes(q) ||
        (t.appFieldKeys || []).some(k => k.includes(q))
      );
    }

    sendPrettyJson(res, results);
  });

  // ─── SINGLE TERM ──────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/terms/:slug", publicReadRateLimit, (req, res) => {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return sendPrettyError(res, 400, { error: "Invalid slug" });
    }
    const term = svc.getTermBySlug(slug);
    if (!term) return sendPrettyError(res, 404, { error: "Term not found" });
    sendPrettyJson(res, term);
  });
};
