"use strict";

function defaultMiddleware(_req, _res, next) {
  next();
}

function isSafeModelKey(value) {
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(String(value || ""));
}

function isSafePathSegment(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || ""));
}

function filterTerms(terms, { class: domainClass, search } = {}) {
  let results = Array.isArray(terms) ? terms : [];

  if (domainClass) {
    results = results.filter((term) =>
      term?.domain?.key === domainClass
      || term?.domain?.iri === domainClass
    );
  }

  if (search) {
    const q = String(search).toLowerCase();
    results = results.filter((term) =>
      String(term?.label || "").toLowerCase().includes(q)
      || String(term?.definition || "").toLowerCase().includes(q)
      || String(term?.slug || "").toLowerCase().includes(q)
      || String(term?.iri || "").toLowerCase().includes(q)
    );
  }

  return results;
}

function unknownSemanticModelSummary(modelKey, rows = []) {
  return {
    semanticModelKey: modelKey,
    key: modelKey,
    name: modelKey,
    description: "",
    registered: false,
    passportTypes: rows.map((row) => ({
      typeName: row.typeName,
      displayName: row.displayName,
      productCategory: row.productCategory,
    })).filter((row) => row.typeName),
  };
}

module.exports = function registerDictionaryRoutes(app, {
  pool = null,
  publicReadRateLimit = defaultMiddleware,
  authenticateToken = defaultMiddleware,
  checkCompanyAccess = defaultMiddleware,
  semanticModelRegistry,
}) {
  if (!semanticModelRegistry) {
    throw new Error("semanticModelRegistry is required for dictionary routes");
  }

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

  const getModelByKey = (req, res) => {
    const modelKey = String(req.params.modelKey || "").trim();
    if (!isSafeModelKey(modelKey)) {
      sendPrettyError(res, 400, { error: "Invalid semantic model key" });
      return null;
    }
    const model = semanticModelRegistry.getModel(modelKey);
    if (!model) {
      sendPrettyError(res, 404, { error: "Semantic model not found" });
      return null;
    }
    return model;
  };

  const getModelByPath = (req, res) => {
    const family = String(req.params.family || "").trim();
    const version = String(req.params.version || "").trim();
    if (!isSafePathSegment(family) || !isSafePathSegment(version)) {
      sendPrettyError(res, 400, { error: "Invalid dictionary path" });
      return null;
    }
    const model = semanticModelRegistry.getModelByPath(family, version);
    if (!model) {
      sendPrettyError(res, 404, { error: "Dictionary not found" });
      return null;
    }
    return model;
  };

  const sendArtifact = (req, res, model, artifact) => {
    if (!model) return null;
    if (artifact === "manifest") return sendPrettyJson(res, model.manifest);
    if (artifact === "context") return sendPrettyJson(res, model.context, "application/ld+json");
    if (artifact === "catalog") {
      if (!model.dcatCatalog) return sendPrettyError(res, 404, { error: "Catalog not found" });
      return sendPrettyJson(res, model.dcatCatalog, "application/ld+json");
    }
    if (artifact === "units") return sendPrettyJson(res, model.units);
    if (artifact === "classes") return sendPrettyJson(res, model.classes);
    if (artifact === "enums") return sendPrettyJson(res, model.enums);
    if (artifact === "ontology") {
      if (!model.ontology) return sendPrettyError(res, 404, { error: "Ontology not found" });
      return sendPrettyJson(res, model.ontology, "application/ld+json");
    }
    if (artifact === "shapes") {
      if (!model.shapes) return sendPrettyError(res, 404, { error: "SHACL shapes not found" });
      return sendPrettyJson(res, model.shapes, "application/ld+json");
    }
    if (artifact === "terms") return sendPrettyJson(res, filterTerms(model.terms, req.query));
    return sendPrettyError(res, 404, { error: "Dictionary artifact not found" });
  };

  const sendTerm = (req, res, model) => {
    if (!model) return null;
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return sendPrettyError(res, 400, { error: "Invalid slug" });
    }
    const term = semanticModelRegistry.getTermBySlug(model.semanticModelKey, slug);
    if (!term) return sendPrettyError(res, 404, { error: "Term not found" });
    return sendPrettyJson(res, term);
  };

  app.get("/api/semantic-models", publicReadRateLimit, (_req, res) => {
    sendPrettyJson(res, semanticModelRegistry.listModels());
  });

  app.get("/api/semantic-models/:modelKey", publicReadRateLimit, (req, res) => {
    const model = getModelByKey(req, res);
    if (!model) return null;
    return sendPrettyJson(res, {
      ...semanticModelRegistry.summarizeModel(model),
      manifest: model.manifest,
    });
  });

  for (const [suffix, artifact] of [
    ["manifest", "manifest"],
    ["context.jsonld", "context"],
    ["catalog.jsonld", "catalog"],
    ["units", "units"],
    ["classes", "classes"],
    ["enums", "enums"],
    ["ontology.jsonld", "ontology"],
    ["shapes.jsonld", "shapes"],
    ["terms", "terms"],
  ]) {
    app.get(`/api/semantic-models/:modelKey/${suffix}`, publicReadRateLimit, (req, res) => {
      sendArtifact(req, res, getModelByKey(req, res), artifact);
    });
  }

  app.get("/api/semantic-models/:modelKey/terms/:slug", publicReadRateLimit, (req, res) => {
    sendTerm(req, res, getModelByKey(req, res));
  });

  for (const [paths, artifact] of [
    [["/api/dictionary/:family/:version/context.jsonld", "/dictionary/:family/:version/context.jsonld"], "context"],
    [["/api/dictionary/:family/:version/catalog.jsonld", "/dictionary/:family/:version/catalog.jsonld"], "catalog"],
    [["/api/dictionary/:family/:version/manifest", "/dictionary/:family/:version/manifest.json"], "manifest"],
    [["/api/dictionary/:family/:version/units", "/dictionary/:family/:version/units"], "units"],
    [["/api/dictionary/:family/:version/classes", "/dictionary/:family/:version/classes"], "classes"],
    [["/api/dictionary/:family/:version/enums", "/dictionary/:family/:version/enums"], "enums"],
    [["/api/dictionary/:family/:version/ontology.jsonld", "/dictionary/:family/:version/ontology.jsonld"], "ontology"],
    [["/api/dictionary/:family/:version/shapes.jsonld", "/dictionary/:family/:version/shapes.jsonld"], "shapes"],
    [["/api/dictionary/:family/:version/terms", "/dictionary/:family/:version/terms"], "terms"],
  ]) {
    app.get(paths, publicReadRateLimit, (req, res) => {
      sendArtifact(req, res, getModelByPath(req, res), artifact);
    });
  }

  app.get(["/api/dictionary/:family/:version/terms/:slug", "/dictionary/:family/:version/terms/:slug"], publicReadRateLimit, (req, res) => {
    sendTerm(req, res, getModelByPath(req, res));
  });

  app.get("/api/companies/:companyId/semantic-models", authenticateToken, checkCompanyAccess, async (req, res) => {
    if (!pool) return res.status(503).json({ error: "Database is unavailable" });
    try {
      const result = await pool.query(
        `SELECT pt."semanticModelKey" AS "semanticModelKey",
                pt."typeName" AS "typeName",
                pt."displayName" AS "displayName",
                pt."productCategory" AS "productCategory"
           FROM "passportTypes" pt
           JOIN "companyPassportAccess" cpa ON cpa."passportTypeId" = pt.id
          WHERE cpa."companyId" = $1
            AND cpa."accessRevoked" = FALSE
            AND COALESCE(pt."semanticModelKey", '') <> ''
          ORDER BY pt."semanticModelKey", pt."displayName"`,
        [req.params.companyId]
      );

      const rowsByModelKey = new Map();
      for (const row of result.rows || []) {
        const modelKey = String(row.semanticModelKey || "").trim();
        if (!modelKey) continue;
        if (!rowsByModelKey.has(modelKey)) rowsByModelKey.set(modelKey, []);
        rowsByModelKey.get(modelKey).push(row);
      }

      const models = [...rowsByModelKey.entries()].map(([modelKey, rows]) => {
        const model = semanticModelRegistry.getModel(modelKey);
        if (!model) return unknownSemanticModelSummary(modelKey, rows);
        return {
          ...semanticModelRegistry.summarizeModel(model),
          passportTypes: rows.map((row) => ({
            typeName: row.typeName,
            displayName: row.displayName,
            productCategory: row.productCategory,
          })),
        };
      });

      res.json(models);
    } catch {
      res.status(500).json({ error: "Failed to fetch semantic models" });
    }
  });
};
