function registerAuditAnalyticsRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    queryTableStats,
    getTable,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    withAuditActorAliases,
    replicateAuditAnchorToBackup,
    ARCHIVED_HISTORY_FILTER_SQL,
  } = deps;

  app.get("/api/companies/:companyId/analytics", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt.type_name, pt.display_name, pt.product_category, pt.product_icon
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
      `, [companyId]);

      let totalPassports = 0;
      const analytics = [];
      const trendMonths = [];
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const trendStart = new Date(currentYear, 0, 1);

      for (let monthIndex = 0; monthIndex <= currentMonthIndex; monthIndex += 1) {
        trendMonths.push(new Date(currentYear, monthIndex, 1));
      }
      const trendSeriesMap = {};

      for (const { type_name, display_name, product_category, product_icon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(type_name, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({
            passport_type: type_name,
            display_name,
            product_category,
            product_icon,
            draft_count: stats.draft,
            released_count: stats.released,
            revised_count: stats.revised,
            in_review_count: stats.in_review,
            obsolete_count: stats.obsolete,
          });

          const tableName = getTable(type_name);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
             FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
             GROUP BY 1 ORDER BY 1`,
            [companyId, trendStart.toISOString()]
          );

          if (!trendSeriesMap[product_category]) {
            trendSeriesMap[product_category] = {
              product_category,
              product_icon,
              baseline: 0,
              monthlyCounts: Object.fromEntries(trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])),
            };
          }
          trendSeriesMap[product_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[product_category].monthlyCounts[key] = (trendSeriesMap[product_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (e) {
          logger.error(`Analytics error for ${companyId}/${type_name}:`, e.message);
        }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse.passport_dpp_id, pse.viewer_user_id)) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr.dpp_id = pse.passport_dpp_id
         WHERE pr.company_id = $1 AND pse.viewer_user_id IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0].count, 10) || 0;
      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT dpp_id)
         FROM passport_archives
         WHERE company_id = $1
           AND ${ARCHIVED_HISTORY_FILTER_SQL}`,
        [companyId]
      );
      const archivedCount = parseInt(archivedRes.rows[0].count, 10) || 0;
      totalPassports += archivedCount;

      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            product_category: series.product_category,
            product_icon: series.product_icon,
            values: trendMonths.map((month) => {
              const key = month.toISOString().slice(0, 7);
              running += series.monthlyCounts[key] || 0;
              return running;
            }),
          };
        }),
      };

      res.json({ totalPassports, analytics, scanStats, archivedCount, trend });
    } catch {
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  app.get("/api/companies/:companyId/activity", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
        [req.params.companyId, limit]
      );
      res.json(r.rows);
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.companyId, limit, offset]
      );
      res.json(r.rows.map(withAuditActorAliases));
    } catch {
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs/integrity", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const report = await verifyAuditLogChain(Number.parseInt(req.params.companyId, 10));
      res.json(report);
    } catch {
      res.status(500).json({ error: "Failed to verify audit log integrity" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs/root", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const summary = await buildAuditLogRootSummary(Number.parseInt(req.params.companyId, 10));
      res.json(summary);
    } catch {
      res.status(500).json({ error: "Failed to build audit log root summary" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs/anchors", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId, 10);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const anchors = await listAuditLogAnchors(companyId);
      res.json({
        companyId,
        anchors: anchors.slice(0, limit),
      });
    } catch {
      res.status(500).json({ error: "Failed to list audit log anchors" });
    }
  });

  app.post("/api/companies/:companyId/audit-logs/anchors", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId, 10);
      const anchorType = String(req.body?.anchorType || req.body?.anchor_type || "internal_record").trim() || "internal_record";
      const anchorReference = req.body?.anchorReference ?? req.body?.anchor_reference ?? null;
      const notes = req.body?.notes ?? null;
      const metadata = req.body?.metadata ?? req.body?.metadata_json ?? {};
      const anchored = await anchorAuditLogRoot({
        companyId,
        anchoredBy: req.user?.userId || null,
        anchorType,
        anchorReference: anchorReference == null ? null : String(anchorReference),
        notes: notes == null ? null : String(notes),
        metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
      });
      await replicateAuditAnchorToBackup({
        companyId,
        anchoredBy: req.user?.userId || null,
        actorIdentifier: req.user?.actorIdentifier || req.user?.globallyUniqueOperatorId || req.user?.email || `user:${req.user?.userId}`,
        anchor: anchored.anchor,
        summary: anchored.summary,
      }).catch(() => {});
      res.status(201).json(anchored);
    } catch {
      res.status(500).json({ error: "Failed to anchor audit log root" });
    }
  });
}

module.exports = registerAuditAnalyticsRoutes;
