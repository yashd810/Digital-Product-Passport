import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { PieChart } from "../../passport-viewer/components/PieChart";
import { openAnalyticsPrintReport, renderClusteredBarChartSvg, renderPieChartSvg } from "../../shared/utils/analyticsPrintExport";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { statusColors } from "../../shared/utils/statusColors";
import { buildCompanyAnalyticsPath } from "../utils/companyRoutes";
import "../styles/AdminDashboard.css";
import "../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";
const adminBarColors = ["#14b8a6", "#0f766e", "#0ea5e9", "#2563eb", "#22c55e", "#d69e2e", "#f97316", "#a855f7"];
const companySeries = [
  { key: "draftCount",      label: "Draft",       color: statusColors.draft },
  { key: "inReviewCount",   label: "In Review",   color: statusColors.review },
  { key: "releasedCount",   label: "Released",    color: statusColors.released },
  { key: "revisedCount",    label: "In Revision", color: statusColors.revised },
  { key: "obsoleteCount",   label: "Obsolete",    color: statusColors.obsolete },
  { key: "archivedCount",   label: "Archived",    color: statusColors.archived },
];

function BarChart({ data, height = 120 }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((item) => item.value), 1);
  const chartW = 420;
  const barW = Math.min(64, Math.max(36, chartW / Math.max(data.length * 2.8, 5)));
  const groupW = chartW / data.length;
  const topPad = 18;
  const labelY = topPad + height + 26;
  const totalH = labelY + 18;

  return (
    <svg className="overview-bar-chart admin-type-bar-chart" width="100%" viewBox={`0 0 ${chartW} ${totalH}`}>
      {data.map((item, index) => {
        const barHeight = Math.max(4, (item.value / max) * height);
        const groupCenter = groupW * index + groupW / 2;
        const x = groupCenter - barW / 2;
        const y = topPad + height - barHeight;
        return (
          <g key={item.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barHeight}
              rx={4}
              fill={item.color || adminBarColors[index % adminBarColors.length]}
              opacity="0.92"
            />
            <text x={groupCenter} y={labelY} textAnchor="middle" className="overview-bar-chart-label">
              {item.label.length > 13 ? `${item.label.substring(0, 11)}...` : item.label}
            </text>
            {item.value > 0 && (
              <text x={groupCenter} y={y - 6} textAnchor="middle" className="overview-bar-chart-value">
                {item.value}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ClusteredCompanyChart({ data, height = 180 }) {
  if (!data?.length) return null;

  const barsPerGroup = companySeries.length;
  const barGap = 3;
  const barWidth = 8;
  const groupWidth = barsPerGroup * barWidth + (barsPerGroup - 1) * barGap;
  const groupGap = 20;
  const leftPad = 8;
  const rightPad = 8;
  const topPad = 18;
  const bottomPad = 36;
  const innerH = height;
  const h = innerH + topPad + bottomPad;
  const totalW = Math.max(
    400,
    leftPad + rightPad + data.length * groupWidth + Math.max(0, data.length - 1) * groupGap
  );
  const maxValue = Math.max(
    ...data.flatMap((item) => companySeries.map((series) => item[series.key] || 0)),
    1
  );
  const getBarHeight = (value) => Math.max(3, (value / maxValue) * innerH);

  return (
    <div className="admin-cluster-chart">
      <svg className="overview-bar-chart" width="100%" viewBox={`0 0 ${totalW} ${h}`}>
        {data.map((item, groupIndex) => {
          const groupX = leftPad + groupIndex * (groupWidth + groupGap);
          return (
            <g key={item.label}>
              {companySeries.map((series, seriesIndex) => {
                const value = item[series.key] || 0;
                const bh = getBarHeight(value);
                const x = groupX + seriesIndex * (barWidth + barGap);
                const y = topPad + innerH - bh;
                return (
                  <g key={series.key}>
                    <rect x={x} y={y} width={barWidth} height={bh} rx={2} fill={series.color} opacity="0.95" />
                    {value > 0 && (
                      <text x={x + barWidth / 2} y={y - 3} textAnchor="middle" className="overview-bar-chart-value">
                        {value}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={groupX + groupWidth / 2}
                y={h - 8}
                textAnchor="middle"
                className="overview-bar-chart-label"
              >
                {item.label.length > 14 ? `${item.label.substring(0, 12)}…` : item.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="admin-cluster-legend">
        {companySeries.map((series) => (
          <div key={series.key} className="admin-cluster-legend-item">
            <span className="admin-cluster-legend-swatch" style={{ backgroundColor: series.color }} />
            <span className="admin-cluster-legend-label">{series.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [companyFilter, setCompanyFilter] = useState("");

  const loadAnalytics = async () => {
      try {
        setLoading(true);
        const response = await fetchWithAuth(`${api}/api/admin/analytics`, {
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch analytics");
        setAnalytics(await response.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: "", text: "" }), type === "success" ? 4000 : 3000);
  };

  if (loading) return <div className="loading">Loading analytics…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!analytics) return null;

  const toggleProductCategory = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const exportAnalyticsToPDF = async () => {
    try {
      setExporting(true);
      setMessage({ type: "", text: "" });

      const now = new Date();
      const summaryStats = [
        { label: "Total Companies", value: analytics.overall.totalCompanies || 0, tone: "default" },
        { label: "Total Passports", value: analytics.overall.totalPassports || 0, tone: "default" },
        { label: "Draft", value: analytics.overall.draftCount || 0, tone: "draft" },
        { label: "In Review", value: analytics.overall.inReviewCount || 0, tone: "review" },
        { label: "Released", value: analytics.overall.releasedCount || 0, tone: "released" },
        { label: "In Revision", value: analytics.overall.revisedCount || 0, tone: "revised" },
        { label: "Obsolete", value: analytics.overall.obsoleteCount || 0, tone: "obsolete" },
        { label: "Archived", value: analytics.overall.archivedCount || 0, tone: "archived" },
      ];
      const productCategoryRows = (analytics.byProductCategory || []).map((item) => [
        item.productCategory || "Uncategorized",
        item.total || 0,
        item.draft || 0,
        item.released || 0,
        item.revised || 0,
      ]);
      const companyRows = (analytics.byCompany || []).map((item) => [
        item.companyName || `Company ${item.id}`,
        item.totalPassports || 0,
        item.draftCount || 0,
        item.releasedCount || 0,
        item.revisedCount || 0,
      ]);
      const productCategoryChartItems = (analytics.byProductCategory || [])
        .filter((item) => (item.total || 0) > 0)
        .map((item, index) => ({
          label: item.productCategory || "Uncategorized",
          value: item.total || 0,
          color: adminBarColors[index % adminBarColors.length],
        }));
      const companyChartData = (analytics.byCompany || [])
        .filter((item) => (item.totalPassports || 0) > 0)
        .map((item) => ({
          label: item.companyName || `Company ${item.id}`,
          draftCount:     item.draftCount     || 0,
          inReviewCount:  item.inReviewCount  || 0,
          releasedCount:  item.releasedCount  || 0,
          revisedCount:   item.revisedCount   || 0,
          obsoleteCount:  item.obsoleteCount  || 0,
          archivedCount:  item.archivedCount  || 0,
        }));

      openAnalyticsPrintReport({
        title: "System-Wide Analytics Report",
        subtitle: `Generated on ${now.toLocaleDateString()} with the light export theme for clearer printed PDFs.`,
        filename: `systemWideAnalytics-${now.getTime()}`,
        stats: summaryStats,
        chartCards: [
          {
            title: "Passports by product category",
            svg: productCategoryChartItems.length ? renderPieChartSvg(productCategoryChartItems) : "",
            legendItems: productCategoryChartItems,
            emptyText: "No product category data yet",
          },
          {
            title: "Passport status by company",
            svg: companyChartData.length ? renderClusteredBarChartSvg(companyChartData, companySeries, { height: 210 }) : "",
            legendItems: companySeries.map((item) => ({ label: item.label, color: item.color })),
            emptyText: "No company totals yet",
          },
        ],
        sections: [
          {
            title: "Passports by Product Category",
            headers: ["Category", "Total", "Draft", "Released", "In Revision"],
            rows: productCategoryRows,
            emptyText: "No category data yet.",
          },
          {
            title: "Passports by Company",
            headers: ["Company", "Total", "Draft", "Released", "In Revision"],
            rows: companyRows,
            emptyText: "No company data yet.",
          },
        ],
      });
      setMessage({ type: 'success', text: 'PDF export is ready. Choose Save as PDF in the print dialog.' });
      setTimeout(() => setMessage({ type: "", text: "" }), 4000);
    } catch {
      setMessage({ type: "error", text: "Failed to export PDF" });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } finally {
      setExporting(false);
    }
  };

  const productCategoryChartItems = (analytics.byProductCategory || [])
    .filter((item) => (item.total || 0) > 0)
    .map((item, index) => ({
      label: item.productCategory || "Uncategorized",
      value: item.total || 0,
      color: adminBarColors[index % adminBarColors.length],
    }));

  const companyChartData = (analytics.byCompany || [])
    .filter((item) => (item.totalPassports || 0) > 0)
    .map((item, index) => ({
      label: item.companyName || `Company ${item.id}`,
      total: item.totalPassports || 0,
      draftCount:     item.draftCount     || 0,
      inReviewCount:  item.inReviewCount  || 0,
      releasedCount:  item.releasedCount  || 0,
      revisedCount:   item.revisedCount   || 0,
      obsoleteCount:  item.obsoleteCount  || 0,
      archivedCount:  item.archivedCount  || 0,
      color: adminBarColors[index % adminBarColors.length],
    }));
  const normalizedCompanyFilter = companyFilter.trim().toLowerCase();
  const filteredCompanies = (analytics.byCompany || []).filter((company) =>
    !normalizedCompanyFilter ||
    (company.companyName || "").toLowerCase().includes(normalizedCompanyFilter)
  );

  return (
    <div className="analytics-section">
      <div className="overview-header">
        <div>
          <h2>System-Wide Analytics</h2>
          <p>Combined analytics across all companies on the platform.</p>
        </div>
        <button
          className="export-pdf-btn aca-export-btn"
          onClick={exportAnalyticsToPDF}
          disabled={exporting || !analytics}
        >
          {exporting ? "⏳ Exporting..." : "📄 Export as PDF"}
        </button>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type === "success" ? "success" : "error"}`}>
          {message.text}
        </div>
      )}

      <div className="overview-stats-row">
        <div className="ov-stat"><div className="ov-stat-num">{analytics.overall.totalCompanies}</div><div className="ov-stat-label">🏢 Companies</div></div>
        <div className="ov-stat"><div className="ov-stat-num">{analytics.overall.totalPassports || 0}</div><div className="ov-stat-label">Total Passports</div></div>
        <div className="ov-stat stat-draft"><div className="ov-stat-num">{analytics.overall.draftCount || 0}</div><div className="ov-stat-label">📋 Draft</div></div>
        <div className="ov-stat stat-review"><div className="ov-stat-num">{analytics.overall.inReviewCount || 0}</div><div className="ov-stat-label">🔍 In Review</div></div>
        <div className="ov-stat stat-released"><div className="ov-stat-num">{analytics.overall.releasedCount || 0}</div><div className="ov-stat-label">✅ Released</div></div>
        <div className="ov-stat stat-revised"><div className="ov-stat-num">{analytics.overall.revisedCount || 0}</div><div className="ov-stat-label">📝 In Revision</div></div>
        <div className="ov-stat stat-obsolete"><div className="ov-stat-num">{analytics.overall.obsoleteCount || 0}</div><div className="ov-stat-label">⚪ Obsolete</div></div>
        <div className="ov-stat stat-archived"><div className="ov-stat-num">{analytics.overall.archivedCount || 0}</div><div className="ov-stat-label">📦 Archived</div></div>
      </div>

      <div className="aca-card admin-section-spaced">
          <h3 className="overview-section-title">Overall Analytics</h3>
          <div className="overview-chart-row">
            <div className="chart-card chart-card-compact admin-overall-chart-card">
            <div className="chart-title">Passports by product category</div>
            {productCategoryChartItems.length > 0 ? (
              <PieChart items={productCategoryChartItems} displayMode="value" showTotalNote={false} />
            ) : (
              <div className="overview-empty-chart">No product category data yet</div>
            )}
          </div>
          <div className="chart-card chart-card-wide admin-overall-chart-card">
            <div className="chart-title">Passport status by company</div>
            {companyChartData.length > 0 ? (
              <ClusteredCompanyChart data={companyChartData} height={180} />
            ) : (
              <div className="overview-empty-chart">No company totals yet</div>
            )}
          </div>
        </div>
      </div>

      {analytics.byProductCategory && analytics.byProductCategory.length > 0 && (
        <div className="companies-stats admin-section-spaced">
          <h3>Passports by Category</h3>
          <p className="admin-section-copy">
            Grouped by product category. Click a row to expand type breakdown.
          </p>
          <table className="stats-table admin-analytics-table admin-analytics-table-productCategory">
            <thead>
              <tr>
                <th>Category</th>
                <th>Total</th>
                <th>Draft</th>
                <th>Released</th>
                <th>In Revision</th>
                <th>Obsolete</th>
                <th>Archived</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byProductCategory.map((productCategory) => (
                <React.Fragment key={productCategory.productCategory}>
                  <tr className="productCategory-row" onClick={() => toggleProductCategory(productCategory.productCategory)}>
                    <td>
                      <span className="admin-inline-icon">{productCategory.productIcon}</span>
                      <strong>{productCategory.productCategory}</strong>
                      <span className="admin-inline-meta">
                        {expanded[productCategory.productCategory] ? "▲" : "▼"} {productCategory.types.length} type{productCategory.types.length !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td><strong>{productCategory.total || 0}</strong></td>
                    <td><span className="mini-badge draft">{productCategory.draft || 0}</span></td>
                    <td><span className="mini-badge released">{productCategory.released || 0}</span></td>
                    <td><span className="mini-badge revised">{productCategory.revised || 0}</span></td>
                    <td><span className="mini-badge obsolete">{productCategory.obsolete || 0}</span></td>
                    <td><span className="mini-badge archived">{productCategory.archived || 0}</span></td>
                  </tr>
                  {expanded[productCategory.productCategory] && productCategory.types.map((type) => (
                    <tr key={type.typeName} className="type-subrow">
                      <td className="admin-subrow-label">
                        └── {type.displayName}
                        <code className="admin-inline-code admin-inline-code-spaced">{type.typeName}</code>
                      </td>
                      <td>{type.total || 0}</td>
                      <td><span className="mini-badge draft">{type.draft || 0}</span></td>
                      <td><span className="mini-badge released">{type.released || 0}</span></td>
                      <td><span className="mini-badge revised">{type.revised || 0}</span></td>
                      <td><span className="mini-badge obsolete">{type.obsolete || 0}</span></td>
                      <td><span className="mini-badge archived">{type.archived || 0}</span></td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="companies-stats admin-section-spaced">
        <h3>Passports by Company</h3>
        <div className="admin-analytics-filter-row">
          <input
            type="text"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="admin-analytics-filter-input"
            placeholder="Filter by company name..."
          />
        </div>
        <table className="stats-table admin-analytics-table admin-analytics-table-company">
          <thead>
            <tr>
              <th>Company</th>
              <th>Total</th>
              <th>Draft</th>
              <th>In Review</th>
              <th>Released</th>
              <th>In Revision</th>
              <th>Obsolete</th>
              <th>Archived</th>
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-analytics-empty-cell">No companies match that filter.</td>
              </tr>
            ) : filteredCompanies.map((company) => (
              <tr key={company.id}>
                <td className="company-name">
                  <Link
                    to={buildCompanyAnalyticsPath(company)}
                    state={{ companyId: company.id }}
                    className="company-name-link"
                  >
                    {company.companyName}
                  </Link>
                </td>
                <td>{company.totalPassports || 0}</td>
                <td><span className="mini-badge draft">{company.draftCount || 0}</span></td>
                <td><span className="mini-badge review">{company.inReviewCount || 0}</span></td>
                <td><span className="mini-badge released">{company.releasedCount || 0}</span></td>
                <td><span className="mini-badge revised">{company.revisedCount || 0}</span></td>
                <td><span className="mini-badge obsolete">{company.obsoleteCount || 0}</span></td>
                <td><span className="mini-badge archived">{company.archivedCount || 0}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

export default AdminAnalytics;
