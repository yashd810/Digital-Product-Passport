import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart } from "../../passport-viewer/components/PieChart";
import { openAnalyticsPrintReport, renderClusteredBarChartSvg, renderPieChartSvg } from "../../shared/utils/analyticsPrintExport";
import { authHeaders } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";
import "../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const ADMIN_BAR_COLORS = ["#14b8a6", "#0f766e", "#0ea5e9", "#2563eb", "#22c55e", "#d69e2e", "#f97316", "#a855f7"];
const COMPANY_SERIES = [
  { key: "draft_count", label: "Draft", color: "#f59e0b" },
  { key: "released_count", label: "Released", color: "#34d399" },
  { key: "revised_count", label: "In Revision", color: "#f472b6" },
];

function BarChart({ data, height = 120 }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((item) => item.value), 1);
  const barW = 36;
  const gap = 16;
  const totalW = data.length * (barW + gap) + gap;

  return (
    <svg className="overview-bar-chart" width="100%" viewBox={`0 0 ${Math.max(totalW, 200)} ${height + 30}`}>
      {data.map((item, index) => {
        const barHeight = Math.max(4, (item.value / max) * height);
        const x = gap + index * (barW + gap);
        const y = height - barHeight + 10;
        return (
          <g key={item.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barHeight}
              rx={4}
              fill={item.color || ADMIN_BAR_COLORS[index % ADMIN_BAR_COLORS.length]}
              opacity="0.92"
            />
            <text x={x + barW / 2} y={height + 18} textAnchor="middle" className="overview-bar-chart-label">
              {item.label.length > 10 ? `${item.label.substring(0, 8)}...` : item.label}
            </text>
            {item.value > 0 && (
              <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="overview-bar-chart-value">
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

  const W = 480;
  const H = height + 54;
  const leftPad = 30;
  const rightPad = 12;
  const topPad = 18;
  const bottomPad = 40;
  const innerH = H - topPad - bottomPad;
  const groupGap = 18;
  const barGap = 5;
  const barsPerGroup = COMPANY_SERIES.length;
  const groupWidth = 54;
  const totalW = Math.max(
    W,
    leftPad + rightPad + data.length * groupWidth + Math.max(0, data.length - 1) * groupGap
  );
  const maxValue = Math.max(
    ...data.flatMap((item) => COMPANY_SERIES.map((series) => item[series.key] || 0)),
    1
  );

  const barWidth = (groupWidth - barGap * (barsPerGroup - 1)) / barsPerGroup;
  const getBarHeight = (value) => Math.max(4, (value / maxValue) * innerH);

  return (
    <div className="admin-cluster-chart">
      <svg className="overview-bar-chart" width="100%" viewBox={`0 0 ${totalW} ${H}`}>
        {data.map((item, groupIndex) => {
          const groupX = leftPad + groupIndex * (groupWidth + groupGap);
          return (
            <g key={item.label}>
              {COMPANY_SERIES.map((series, seriesIndex) => {
                const value = item[series.key] || 0;
                const barHeight = getBarHeight(value);
                const x = groupX + seriesIndex * (barWidth + barGap);
                const y = topPad + innerH - barHeight;
                return (
                  <g key={series.key}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={3}
                      fill={series.color}
                      opacity="0.95"
                    />
                    {value > 0 && (
                      <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="overview-bar-chart-value">
                        {value}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={groupX + groupWidth / 2}
                y={H - 12}
                textAnchor="middle"
                className="overview-bar-chart-label"
              >
                {item.label.length > 10 ? `${item.label.substring(0, 8)}...` : item.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="admin-cluster-legend">
        {COMPANY_SERIES.map((series) => (
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
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [companyFilter, setCompanyFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API}/api/admin/analytics`, {
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch analytics");
        setAnalytics(await response.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        { label: "Total Companies", value: analytics.overall.total_companies || 0, tone: "default" },
        { label: "Total Passports", value: analytics.overall.total_passports || 0, tone: "default" },
        { label: "Draft", value: analytics.overall.draft_count || 0, tone: "draft" },
        { label: "Released", value: analytics.overall.released_count || 0, tone: "released" },
        { label: "In Revision", value: analytics.overall.revised_count || 0, tone: "revised" },
      ];
      const productCategoryRows = (analytics.byUmbrella || []).map((item) => [
        item.umbrella_category || "Uncategorized",
        item.total || 0,
        item.draft || 0,
        item.released || 0,
        item.revised || 0,
      ]);
      const companyRows = (analytics.byCompany || []).map((item) => [
        item.company_name || `Company ${item.id}`,
        item.total_passports || 0,
        item.draft_count || 0,
        item.released_count || 0,
        item.revised_count || 0,
      ]);
      const productCategoryChartItems = (analytics.byUmbrella || [])
        .filter((item) => (item.total || 0) > 0)
        .map((item, index) => ({
          label: item.umbrella_category || "Uncategorized",
          value: item.total || 0,
          color: ADMIN_BAR_COLORS[index % ADMIN_BAR_COLORS.length],
        }));
      const companyChartData = (analytics.byCompany || [])
        .filter((item) => (item.total_passports || 0) > 0)
        .map((item) => ({
          label: item.company_name || `Company ${item.id}`,
          draft_count: item.draft_count || 0,
          released_count: item.released_count || 0,
          revised_count: item.revised_count || 0,
        }));

      openAnalyticsPrintReport({
        title: "System-Wide Analytics Report",
        subtitle: `Generated on ${now.toLocaleDateString()} with the light export theme for clearer printed PDFs.`,
        filename: `system_wide_analytics_${now.getTime()}`,
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
            svg: companyChartData.length ? renderClusteredBarChartSvg(companyChartData, COMPANY_SERIES, { height: 210 }) : "",
            legendItems: COMPANY_SERIES.map((item) => ({ label: item.label, color: item.color })),
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

  const productCategoryChartItems = (analytics.byUmbrella || [])
    .filter((item) => (item.total || 0) > 0)
    .map((item, index) => ({
      label: item.umbrella_category || "Uncategorized",
      value: item.total || 0,
      color: ADMIN_BAR_COLORS[index % ADMIN_BAR_COLORS.length],
    }));

  const companyChartData = (analytics.byCompany || [])
    .filter((item) => (item.total_passports || 0) > 0)
    .map((item, index) => ({
      label: item.company_name || `Company ${item.id}`,
      total: item.total_passports || 0,
      draft_count: item.draft_count || 0,
      released_count: item.released_count || 0,
      revised_count: item.revised_count || 0,
      color: ADMIN_BAR_COLORS[index % ADMIN_BAR_COLORS.length],
    }));
  const normalizedCompanyFilter = companyFilter.trim().toLowerCase();
  const filteredCompanies = (analytics.byCompany || []).filter((company) =>
    !normalizedCompanyFilter ||
    (company.company_name || "").toLowerCase().includes(normalizedCompanyFilter)
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

      <div className="stats-grid">
        <div className="stat-card aca-stat-card aca-stat-card-total">
          <div className="stat-label">Total Companies</div>
          <div className="stat-value">{analytics.overall.total_companies}</div>
        </div>
        <div className="stat-card aca-stat-card aca-stat-card-total">
          <div className="stat-label">Total Passports</div>
          <div className="stat-value">{analytics.overall.total_passports || 0}</div>
        </div>
        <div className="stat-card aca-stat-card aca-stat-card-draft">
          <div className="stat-label">Draft</div>
          <div className="stat-value">{analytics.overall.draft_count || 0}</div>
        </div>
        <div className="stat-card aca-stat-card aca-stat-card-released">
          <div className="stat-label">Released</div>
          <div className="stat-value">{analytics.overall.released_count || 0}</div>
        </div>
        <div className="stat-card aca-stat-card aca-stat-card-revised">
          <div className="stat-label">In Revision</div>
          <div className="stat-value">{analytics.overall.revised_count || 0}</div>
        </div>
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

      {analytics.byUmbrella && analytics.byUmbrella.length > 0 && (
        <div className="companies-stats admin-section-spaced">
          <h3>Passports by Category</h3>
          <p className="admin-section-copy">
            Grouped by product category. Click a row to expand type breakdown.
          </p>
          <table className="stats-table admin-analytics-table admin-analytics-table-umbrella">
            <thead>
              <tr>
                <th>Category</th>
                <th>Total</th>
                <th>Draft</th>
                <th>Released</th>
                <th>In Revision</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byUmbrella.map((productCategory) => (
                <React.Fragment key={productCategory.umbrella_category}>
                  <tr className="umbrella-row" onClick={() => toggleProductCategory(productCategory.umbrella_category)}>
                    <td>
                      <span className="admin-inline-icon">{productCategory.umbrella_icon}</span>
                      <strong>{productCategory.umbrella_category}</strong>
                      <span className="admin-inline-meta">
                        {expanded[productCategory.umbrella_category] ? "▲" : "▼"} {productCategory.types.length} type{productCategory.types.length !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td><strong>{productCategory.total || 0}</strong></td>
                    <td><span className="mini-badge draft">{productCategory.draft || 0}</span></td>
                    <td><span className="mini-badge released">{productCategory.released || 0}</span></td>
                    <td><span className="mini-badge revised">{productCategory.revised || 0}</span></td>
                  </tr>
                  {expanded[productCategory.umbrella_category] && productCategory.types.map((type) => (
                    <tr key={type.type_name} className="type-subrow">
                      <td className="admin-subrow-label">
                        └── {type.display_name}
                        <code className="admin-inline-code admin-inline-code-spaced">{type.type_name}</code>
                      </td>
                      <td>{type.total || 0}</td>
                      <td><span className="mini-badge draft">{type.draft || 0}</span></td>
                      <td><span className="mini-badge released">{type.released || 0}</span></td>
                      <td><span className="mini-badge revised">{type.revised || 0}</span></td>
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
              <th>Released</th>
              <th>In Revision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-analytics-empty-cell">No companies match that filter.</td>
              </tr>
            ) : filteredCompanies.map((company) => (
              <tr key={company.id}>
                <td className="company-name">{company.company_name}</td>
                <td>{company.total_passports || 0}</td>
                <td><span className="mini-badge draft">{company.draft_count || 0}</span></td>
                <td><span className="mini-badge released">{company.released_count || 0}</span></td>
                <td><span className="mini-badge revised">{company.revised_count || 0}</span></td>
                <td>
                  <button
                    className="manage-btn manage-btn-analytics"
                    onClick={() => navigate(`/admin/company/${company.id}/analytics`)}
                  >
                    📊 Analytics
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

export default AdminAnalytics;
