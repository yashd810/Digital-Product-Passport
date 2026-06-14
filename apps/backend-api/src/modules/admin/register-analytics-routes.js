"use strict";

const logger = require("../../services/logger");

module.exports = function registerAnalyticsRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    queryTableStats,
    getTable,
    ARCHIVED_HISTORY_FILTER_SQL,
  } = deps;

  const mapCompanyAnalyticsRow = (row = {}) => ({
    id: row.id,
    companyName: row.companyName ?? null,
    totalPassports: row.totalPassports ?? 0,
    draftCount: row.draftCount ?? 0,
    inReviewCount: row.inReviewCount ?? 0,
    releasedCount: row.releasedCount ?? 0,
    revisedCount: row.revisedCount ?? 0,
    obsoleteCount: row.obsoleteCount ?? 0,
    archivedCount: row.archivedCount ?? 0,
  });

  const mapTypeAnalyticsRow = (row = {}) => ({
    companyName: row.companyName ?? null,
    passportType: row.passportType ?? null,
    displayName: row.displayName ?? null,
    productCategory: row.productCategory ?? null,
    totalCount: row.totalCount ?? 0,
    draftCount: row.draftCount ?? 0,
    releasedCount: row.releasedCount ?? 0,
    revisedCount: row.revisedCount ?? 0,
  });

  const mapCategoryRow = (row = {}) => ({
    productCategory: row.productCategory ?? null,
    productIcon: row.productIcon ?? null,
    total: row.total ?? 0,
    draft: row.draft ?? 0,
    released: row.released ?? 0,
    revised: row.revised ?? 0,
    obsolete: row.obsolete ?? 0,
    archived: row.archived ?? 0,
    types: Array.isArray(row.types)
      ? row.types.map((type) => ({
          typeName: type.typeName ?? null,
          displayName: type.displayName ?? null,
          total: type.total ?? 0,
          draft: type.draft ?? 0,
          released: type.released ?? 0,
          revised: type.revised ?? 0,
          obsolete: type.obsolete ?? 0,
          archived: type.archived ?? 0,
        }))
      : [],
  });

  const mapOverallRow = (row = {}) => ({
    totalCompanies: row.totalCompanies ?? 0,
    totalPassports: row.totalPassports ?? 0,
    draftCount: row.draftCount ?? 0,
    inReviewCount: row.inReviewCount ?? 0,
    releasedCount: row.releasedCount ?? 0,
    revisedCount: row.revisedCount ?? 0,
    obsoleteCount: row.obsoleteCount ?? 0,
    archivedCount: row.archivedCount ?? 0,
  });

  const mapUserRow = (row = {}) => ({
    id: row.id,
    email: row.email ?? null,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    role: row.role ?? null,
    isActive: row.isActive ?? null,
    createdAt: row.createdAt ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
  });

  app.get("/api/admin/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companiesRes = await pool.query(
        `SELECT id, company_name AS "companyName"
         FROM companies
         ORDER BY company_name`
      );
      const accessRes = await pool.query(`
        SELECT cpa.company_id AS "companyId",
               pt."typeName" AS "typeName",
               pt."displayName" AS "displayName",
               pt."productCategory" AS "productCategory",
               pt."productIcon" AS "productIcon"
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
      `);

      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT "dppId") FROM passport_archives WHERE ${ARCHIVED_HISTORY_FILTER_SQL}`
      );
      const archivedByCoRes = await pool.query(
        `SELECT "companyId", COUNT(DISTINCT "dppId") AS count
         FROM passport_archives
         WHERE ${ARCHIVED_HISTORY_FILTER_SQL}
         GROUP BY "companyId"`
      );
      const archivedByTypeRes = await pool.query(
        `SELECT "companyId", "passportType", COUNT(DISTINCT "dppId") AS count
         FROM passport_archives
         WHERE ${ARCHIVED_HISTORY_FILTER_SQL}
         GROUP BY "companyId", "passportType"`
      );
      const archivedByCompany = {};
      archivedByCoRes.rows.forEach((row) => { archivedByCompany[row.companyId] = parseInt(row.count, 10) || 0; });
      const archivedByType = {};
      archivedByTypeRes.rows.forEach((row) => {
        const key = `${row.companyId}:${row.passportType}`;
        archivedByType[key] = parseInt(row.count, 10) || 0;
      });

      const overall = {
        totalCompanies: companiesRes.rows.length,
        totalPassports: 0,
        draftCount: 0,
        inReviewCount: 0,
        releasedCount: 0,
        revisedCount: 0,
        obsoleteCount: 0,
        archivedCount: parseInt(archivedRes.rows[0].count, 10) || 0
      };
      const byCompany = [];
      const byType = [];
      const productCategoryMap = {};

      for (const company of companiesRes.rows) {
        const grantedTypes = accessRes.rows.filter((access) => access.companyId === company.id);

        const compStats = {
          id: company.id,
          companyName: company.companyName,
          totalPassports: 0,
          draftCount: 0,
          inReviewCount: 0,
          releasedCount: 0,
          revisedCount: 0,
          obsoleteCount: 0,
          archivedCount: archivedByCompany[company.id] || 0
        };

        for (const typeAccess of grantedTypes) {
          try {
            const stats = await queryTableStats(typeAccess.typeName, company.id);
            if (stats.total === 0) continue;

            compStats.totalPassports += stats.total;
            compStats.draftCount += stats.draft;
            compStats.inReviewCount += stats.in_review;
            compStats.releasedCount += stats.released;
            compStats.revisedCount += stats.revised;
            compStats.obsoleteCount += stats.obsolete;

            overall.totalPassports += stats.total;
            overall.draftCount += stats.draft;
            overall.inReviewCount += stats.in_review;
            overall.releasedCount += stats.released;
            overall.revisedCount += stats.revised;
            overall.obsoleteCount += stats.obsolete;

            const category = typeAccess.productCategory;
            const typeArchived = archivedByType[`${company.id}:${typeAccess.typeName}`] || 0;
            if (!productCategoryMap[category]) {
              productCategoryMap[category] = {
                productCategory: category,
                productIcon: typeAccess.productIcon,
                total: 0, draft: 0, released: 0, revised: 0, obsolete: 0, archived: 0, types: {}
              };
            }
            productCategoryMap[category].total += stats.total;
            productCategoryMap[category].draft += stats.draft;
            productCategoryMap[category].released += stats.released;
            productCategoryMap[category].revised += stats.revised;
            productCategoryMap[category].obsolete += stats.obsolete;
            productCategoryMap[category].archived += typeArchived;

            const typeKey = typeAccess.typeName;
            if (!productCategoryMap[category].types[typeKey]) {
              productCategoryMap[category].types[typeKey] = {
                typeName: typeKey,
                displayName: typeAccess.displayName,
                total: 0, draft: 0, released: 0, revised: 0, obsolete: 0, archived: 0
              };
            }
            productCategoryMap[category].types[typeKey].total += stats.total;
            productCategoryMap[category].types[typeKey].draft += stats.draft;
            productCategoryMap[category].types[typeKey].released += stats.released;
            productCategoryMap[category].types[typeKey].revised += stats.revised;
            productCategoryMap[category].types[typeKey].obsolete += stats.obsolete;
            productCategoryMap[category].types[typeKey].archived += typeArchived;

            byType.push({
              companyName: company.companyName,
              passportType: typeAccess.typeName,
              displayName: typeAccess.displayName,
              productCategory: category,
              totalCount: stats.total,
              draftCount: stats.draft,
              releasedCount: stats.released,
              revisedCount: stats.revised
            });
          } catch (error) {
            logger.error(`Analytics error for ${company.id}/${typeAccess.typeName}:`, error.message);
          }
        }

        byCompany.push(compStats);
      }

      const byProductCategory = Object.values(productCategoryMap).map((entry) => ({
        ...entry, types: Object.values(entry.types)
      }));

      overall.totalPassports += overall.archivedCount;
      byCompany.forEach((company) => { company.totalPassports += company.archivedCount; });

      res.json({
        overall: mapOverallRow(overall),
        byCompany: byCompany.map(mapCompanyAnalyticsRow),
        byType: byType.map(mapTypeAnalyticsRow),
        byProductCategory: byProductCategory.map(mapCategoryRow),
      });
    } catch (error) {
      logger.error("Admin analytics error:", error.message);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  app.get("/api/admin/companies/:companyId/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt."typeName" AS "typeName",
               pt."displayName" AS "displayName",
               pt."productCategory" AS "productCategory",
               pt."productIcon" AS "productIcon",
               cpa.granted_at AS "grantedAt"
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
      `, [companyId]);

      let totalPassports = 0;
      const analytics = [];
      const trendMonths = [];
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstGrantedAt = accessRes.rows
        .map((row) => row.grantedAt ? new Date(row.grantedAt) : null)
        .filter((value) => value && !Number.isNaN(value.getTime()))
        .sort((a, b) => a - b)[0];
      const trendStart = firstGrantedAt
        ? new Date(firstGrantedAt.getFullYear(), firstGrantedAt.getMonth(), 1)
        : new Date(currentMonthStart);

      for (let month = new Date(trendStart); month <= currentMonthStart; month.setMonth(month.getMonth() + 1)) {
        trendMonths.push(new Date(month));
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
            total: stats.total,
            draftCount: stats.draft,
            releasedCount: stats.released,
            revisedCount: stats.revised,
            inReviewCount: stats.in_review,
            obsoleteCount: stats.obsolete
          });

          const tableName = getTable(typeName);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName}
             WHERE "companyId" = $1 AND "deletedAt" IS NULL AND "createdAt" < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', "createdAt") AS month_bucket, COUNT(*) AS count
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
              monthlyCounts: Object.fromEntries(
                trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])
              )
            };
          }

          trendSeriesMap[productCategory].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[productCategory].monthlyCounts[key] =
              (trendSeriesMap[productCategory].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (error) {
          logger.error(`Per-company analytics error for ${companyId}/${typeName}:`, error.message);
        }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse."passportDppId", pse."viewerUserId")) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr."dppId" = pse."passportDppId"
         WHERE pr."companyId" = $1 AND pse."viewerUserId" IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0]?.count || 0, 10) || 0;
      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT "dppId")
         FROM passport_archives
         WHERE "companyId" = $1
           AND ${ARCHIVED_HISTORY_FILTER_SQL}`,
        [companyId]
      );
      const archivedCount = parseInt(archivedRes.rows[0]?.count || 0, 10) || 0;
      totalPassports += archivedCount;
      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short", year: "2-digit" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            productCategory: series.productCategory,
            productIcon: series.productIcon,
            values: trendMonths.map((month) => {
              const key = month.toISOString().slice(0, 7);
              running += series.monthlyCounts[key] || 0;
              return running;
            })
          };
        })
      };

      const users = await pool.query(
        `SELECT id,
                email,
                "firstName" AS "firstName",
                "lastName" AS "lastName",
                role,
                "isActive" AS "isActive",
                "createdAt" AS "createdAt",
                "lastLoginAt" AS "lastLoginAt"
         FROM users
         WHERE "companyId" = $1 AND role != 'super_admin'
         ORDER BY role, "firstName"`,
        [companyId]
      );
      const company = await pool.query(
        `SELECT company_name AS "companyName"
         FROM companies
         WHERE id = $1`,
        [companyId]
      );

      res.json({
        totalPassports,
        analytics,
        scanStats,
        archivedCount,
        trend: {
          labels: trend.labels,
          series: trend.series || [],
        },
        users: users.rows.map(mapUserRow),
        company: { companyName: company.rows[0]?.companyName || `Company ${companyId}` },
      });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
