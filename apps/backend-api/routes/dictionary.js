"use strict";

module.exports = function registerDictionaryRoutes(app, {
  publicReadRateLimit,
  batteryDictionaryService,
}) {
  const svc = batteryDictionaryService;

  // ─── JSON-LD CONTEXT (served at canonical dictionary URL) ─────────────────
  app.get("/dictionary/battery/v1/context.jsonld", (_req, res) => {
    res.setHeader("Content-Type", "application/ld+json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json(svc.getContext());
  });

  // ─── MANIFEST ─────────────────────────────────────────────────────────────
  app.get(["/api/dictionary/battery/v1/manifest", "/dictionary/battery/v1/manifest.json"],
    publicReadRateLimit, (_req, res) => {
      res.json(svc.getManifest());
    });

  // ─── CATEGORIES ───────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/categories", publicReadRateLimit, (_req, res) => {
    res.json(svc.getCategories());
  });

  // ─── UNITS ────────────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/units", publicReadRateLimit, (_req, res) => {
    res.json(svc.getUnits());
  });

  // ─── FIELD MAP ────────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/field-map", publicReadRateLimit, (_req, res) => {
    res.json(svc.getFieldMap());
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

    res.json(results);
  });

  // ─── SINGLE TERM ──────────────────────────────────────────────────────────
  app.get("/api/dictionary/battery/v1/terms/:slug", publicReadRateLimit, (req, res) => {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    const term = svc.getTermBySlug(slug);
    if (!term) return res.status(404).json({ error: "Term not found" });
    res.json(term);
  });
};
