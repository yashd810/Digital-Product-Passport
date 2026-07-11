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
    archivedHistoryFilterSql,
  } = deps;

  const mapAuditLogRow = (row = {}) => ({
    id: row.id,
    companyId: row.companyId ?? null,
    userId: row.userId ?? null,
    action: row.action ?? null,
    actorIdentifier: row.actorIdentifier ?? null,
    audience: row.audience ?? null,
    previousEventHash: row.previousEventHash ?? null,
    eventHash: row.eventHash ?? null,
    hashVersion: row.hashVersion ?? null,
    userEmail: row.userEmail ?? null,
    userFirstName: row.userFirstName ?? null,
    userLastName: row.userLastName ?? null,
    createdAt: row.createdAt ?? null,
    tableName: row.tableName ?? null,
    recordId: row.recordId ?? null,
    oldValues: row.oldValues ?? null,
    newValues: row.newValues ?? null,
  });

  app.get("/api/companies/:companyId/analytics", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt."typeName" AS "typeName",
               pt."displayName" AS "displayName",
               pt."productCategory" AS "productCategory",
               pt."productIcon" AS "productIcon"
        FROM "companyPassportAccess" cpa
        JOIN "passportTypes" pt ON pt.id = cpa."passportTypeId"
        WHERE cpa."companyId" = $1
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

      for (const { typeName, displayName, productCategory, productIcon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(typeName, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({
            passportType: typeName,
            displayName,
            productCategory,
            productIcon,
            draftCount: stats.draft,
            releasedCount: stats.released,
            revisedCount: stats.revised,
            inReviewCount: stats.inReview,
            obsoleteCount: stats.obsolete,
          });

          const tableName = getTable(typeName);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName} WHERE "companyId" = $1 AND "deletedAt" IS NULL AND "createdAt" < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', "createdAt") AS "monthBucket", COUNT(*) AS count
             FROM ${tableName}
             WHERE "companyId" = $1 AND "deletedAt" IS NULL AND "createdAt" >= $2
             GROUP BY 1 ORDER BY 1`,
            [companyId, trendStart.toISOString()]
          );

          if (!trendSeriesMap[productCategory]) {
            trendSeriesMap[productCategory] = {
              productCategory,
              productIcon,
              baseline: 0,
              monthlyCounts: Object.fromEntries(trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])),
            };
          }
          trendSeriesMap[productCategory].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.monthBucket).toISOString().slice(0, 7);
            trendSeriesMap[productCategory].monthlyCounts[key] = (trendSeriesMap[productCategory].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (e) {
          logger.error(`Analytics error for ${companyId}/${typeName}:`, e.message);
        }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse."passportDppId", pse."viewerUserId")) FROM "passportScanEvents" pse
         JOIN "passportRegistry" pr ON pr."dppId" = pse."passportDppId"
         WHERE pr."companyId" = $1 AND pse."viewerUserId" IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0].count, 10) || 0;
      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT "dppId")
         FROM "passportArchives"
         WHERE "companyId" = $1
           AND ${archivedHistoryFilterSql}`,
        [companyId]
      );
      const archivedCount = parseInt(archivedRes.rows[0].count, 10) || 0;
      totalPassports += archivedCount;

      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            productCategory: series.productCategory,
            productIcon: series.productIcon,
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
        `SELECT al.id,
                al."companyId" AS "companyId",
                al."userId" AS "userId",
                al.action,
                al."actorIdentifier" AS "actorIdentifier",
                al.audience,
                al."previousEventHash" AS "previousEventHash",
                al."eventHash" AS "eventHash",
                al."hashVersion" AS "hashVersion",
                al."createdAt" AS "createdAt",
                al."tableName" AS "tableName",
                al."recordId" AS "recordId",
                al."oldValues" AS "oldValues",
                al."newValues" AS "newValues",
                u.email AS "userEmail",
                u."firstName" AS "userFirstName",
                u."lastName" AS "userLastName"
         FROM "auditLogs" al
         LEFT JOIN users u ON al."userId" = u.id
         WHERE al."companyId" = $1 ORDER BY al."createdAt" DESC LIMIT $2`,
        [req.params.companyId, limit]
      );
      res.json(r.rows.map(mapAuditLogRow));
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const r = await pool.query(
        `SELECT al.id,
                al."companyId" AS "companyId",
                al."userId" AS "userId",
                al.action,
                al."actorIdentifier" AS "actorIdentifier",
                al.audience,
                al."previousEventHash" AS "previousEventHash",
                al."eventHash" AS "eventHash",
                al."hashVersion" AS "hashVersion",
                al."createdAt" AS "createdAt",
                al."tableName" AS "tableName",
                al."recordId" AS "recordId",
                al."oldValues" AS "oldValues",
                al."newValues" AS "newValues",
                u.email AS "userEmail",
                u."firstName" AS "userFirstName",
                u."lastName" AS "userLastName"
         FROM "auditLogs" al
         LEFT JOIN users u ON al."userId" = u.id
         WHERE al."companyId" = $1 ORDER BY al."createdAt" DESC LIMIT $2 OFFSET $3`,
        [req.params.companyId, limit, offset]
      );
      res.json(r.rows.map(withAuditActorAliases).map(mapAuditLogRow));
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
      const anchorType = String(req.body?.anchorType || "internalRecord").trim() || "internalRecord";
      const anchorReference = req.body?.anchorReference ?? null;
      const notes = req.body?.notes ?? null;
      const metadata = req.body?.metadata ?? {};
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
      }).catch((error) => {
        logger.warn({ err: error, companyId, anchorId: anchored.anchor?.id || null }, "Failed to replicate audit anchor to backup");
      });
      res.status(201).json(anchored);
    } catch {
      res.status(500).json({ error: "Failed to anchor audit log root" });
    }
  });
}

module.exports = registerAuditAnalyticsRoutes;
