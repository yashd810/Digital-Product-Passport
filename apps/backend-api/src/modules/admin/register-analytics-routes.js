"use strict";

const logger = require("../../infrastructure/logging/logger");

module.exports = function registerAnalyticsRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    queryTableStats,
    getTable,
    ARCHIVED_HISTORY_FILTER_SQL,
  } = deps;

  app.get("/api/admin/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companiesRes = await pool.query("SELECT id, company_name FROM companies ORDER BY company_name");
      const accessRes = await pool.query(`
        SELECT cpa.company_id, pt.type_name, pt.display_name, pt.product_category, pt.product_icon
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
      `);

      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT dpp_id) FROM passport_archives WHERE ${ARCHIVED_HISTORY_FILTER_SQL}`
      );
      const archivedByCoRes = await pool.query(
        `SELECT company_id, COUNT(DISTINCT dpp_id) AS count
         FROM passport_archives
         WHERE ${ARCHIVED_HISTORY_FILTER_SQL}
         GROUP BY company_id`
      );
      const archivedByTypeRes = await pool.query(
        `SELECT company_id, passport_type, COUNT(DISTINCT dpp_id) AS count
         FROM passport_archives
         WHERE ${ARCHIVED_HISTORY_FILTER_SQL}
         GROUP BY company_id, passport_type`
      );
      const archivedByCompany = {};
      archivedByCoRes.rows.forEach((row) => { archivedByCompany[row.company_id] = parseInt(row.count, 10) || 0; });
      const archivedByType = {};
      archivedByTypeRes.rows.forEach((row) => {
        const key = `${row.company_id}:${row.passport_type}`;
        archivedByType[key] = parseInt(row.count, 10) || 0;
      });

      const overall = {
        total_companies: companiesRes.rows.length,
        total_passports: 0, draft_count: 0, in_review_count: 0, released_count: 0, revised_count: 0, obsolete_count: 0,
        archived_count: parseInt(archivedRes.rows[0].count, 10) || 0
      };
      const byCompany = [];
      const byType = [];
      const productCategoryMap = {};

      for (const company of companiesRes.rows) {
        const grantedTypes = accessRes.rows.filter((access) => access.company_id === company.id);

        const compStats = {
          id: company.id, company_name: company.company_name,
          total_passports: 0, draft_count: 0, in_review_count: 0, released_count: 0, revised_count: 0, obsolete_count: 0,
          archived_count: archivedByCompany[company.id] || 0
        };

        for (const typeAccess of grantedTypes) {
          try {
            const stats = await queryTableStats(typeAccess.type_name, company.id);
            if (stats.total === 0) continue;

            compStats.total_passports += stats.total;
            compStats.draft_count += stats.draft;
            compStats.in_review_count += stats.in_review;
            compStats.released_count += stats.released;
            compStats.revised_count += stats.revised;
            compStats.obsolete_count += stats.obsolete;

            overall.total_passports += stats.total;
            overall.draft_count += stats.draft;
            overall.in_review_count += stats.in_review;
            overall.released_count += stats.released;
            overall.revised_count += stats.revised;
            overall.obsolete_count += stats.obsolete;

            const category = typeAccess.product_category;
            const typeArchived = archivedByType[`${company.id}:${typeAccess.type_name}`] || 0;
            if (!productCategoryMap[category]) {
              productCategoryMap[category] = {
                product_category: category, product_icon: typeAccess.product_icon,
                total: 0, draft: 0, released: 0, revised: 0, obsolete: 0, archived: 0, types: {}
              };
            }
            productCategoryMap[category].total += stats.total;
            productCategoryMap[category].draft += stats.draft;
            productCategoryMap[category].released += stats.released;
            productCategoryMap[category].revised += stats.revised;
            productCategoryMap[category].obsolete += stats.obsolete;
            productCategoryMap[category].archived += typeArchived;

            const typeKey = typeAccess.type_name;
            if (!productCategoryMap[category].types[typeKey]) {
              productCategoryMap[category].types[typeKey] = {
                type_name: typeKey, display_name: typeAccess.display_name,
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
              company_name: company.company_name, passport_type: typeAccess.type_name,
              display_name: typeAccess.display_name, product_category: category,
              total_count: stats.total, draft_count: stats.draft,
              released_count: stats.released, revised_count: stats.revised
            });
          } catch (error) {
            logger.error(`Analytics error for ${company.id}/${typeAccess.type_name}:`, error.message);
          }
        }

        byCompany.push(compStats);
      }

      const byProductCategory = Object.values(productCategoryMap).map((entry) => ({
        ...entry, types: Object.values(entry.types)
      }));

      overall.total_passports += overall.archived_count;
      byCompany.forEach((company) => { company.total_passports += company.archived_count; });

      res.json({ overall, byCompany, byType, byProductCategory });
    } catch (error) {
      logger.error("Admin analytics error:", error.message);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  app.get("/api/admin/companies/:companyId/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt.type_name, pt.display_name, pt.product_category, pt.product_icon, cpa.granted_at
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
        .map((row) => row.granted_at ? new Date(row.granted_at) : null)
        .filter((value) => value && !Number.isNaN(value.getTime()))
        .sort((a, b) => a - b)[0];
      const trendStart = firstGrantedAt
        ? new Date(firstGrantedAt.getFullYear(), firstGrantedAt.getMonth(), 1)
        : new Date(currentMonthStart);

      for (let month = new Date(trendStart); month <= currentMonthStart; month.setMonth(month.getMonth() + 1)) {
        trendMonths.push(new Date(month));
      }
      const trendSeriesMap = {};

      for (const { type_name, display_name, product_category, product_icon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(type_name, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({
            passport_type: type_name, display_name, product_category, product_icon,
            total: stats.total, draft_count: stats.draft, released_count: stats.released,
            revised_count: stats.revised, in_review_count: stats.in_review, obsolete_count: stats.obsolete
          });

          const tableName = getTable(type_name);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
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
              product_category, product_icon, baseline: 0,
              monthlyCounts: Object.fromEntries(
                trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])
              )
            };
          }

          trendSeriesMap[product_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[product_category].monthlyCounts[key] =
              (trendSeriesMap[product_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (error) {
          logger.error(`Per-company analytics error for ${companyId}/${type_name}:`, error.message);
        }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse.passport_dpp_id, pse.viewer_user_id)) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr.dpp_id = pse.passport_dpp_id
         WHERE pr.company_id = $1 AND pse.viewer_user_id IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0]?.count || 0, 10) || 0;
      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT dpp_id)
         FROM passport_archives
         WHERE company_id = $1
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
            product_category: series.product_category,
            product_icon: series.product_icon,
            values: trendMonths.map((month) => {
              const key = month.toISOString().slice(0, 7);
              running += series.monthlyCounts[key] || 0;
              return running;
            })
          };
        })
      };

      const users = await pool.query(
        `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login_at
         FROM users WHERE company_id = $1 AND role != 'super_admin' ORDER BY role, first_name`,
        [companyId]
      );
      const company = await pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]);

      res.json({ totalPassports, analytics, scanStats, archivedCount, trend, users: users.rows, company: company.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
