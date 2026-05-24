import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";

const slugify = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
import { PieChart } from "../../passport-viewer/components/PieChart";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../shared/table/tableControls";
import { openAnalyticsPrintReport, renderBarChartSvg, renderLineChartSvg, renderPieChartSvg } from "../../shared/utils/analyticsPrintExport";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import { STATUS_COLORS } from "../../shared/utils/statusColors";
import "../styles/AdminDashboard.css";
import "../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";
const OVERVIEW_BAR_COLORS = ["#14b8a6", "#0f766e", "#0ea5e9", "#2563eb", "#22c55e", "#d69e2e"];
const OVERVIEW_LINE_COLORS = ["#14b8a6", "#38bdf8", "#f59e0b", "#f472b6", "#a78bfa", "#22c55e"];

const ROLES = [
  { key: "company_admin", label: "Admin" },
  { key: "editor", label: "Editor" },
  { key: "viewer", label: "Viewer" },
];

function normalizeAdminAnalyticsPayload(payload) {
  const analyticsRows = Array.isArray(payload?.analytics)
    ? payload.analytics.map((item) => ({
        ...item,
        passportType: item.passportType || "",
        displayName: item.displayName || "",
        draftCount: item.draftCount ?? 0,
        inReviewCount: item.inReviewCount ?? 0,
        releasedCount: item.releasedCount ?? 0,
        revisedCount: item.revisedCount ?? 0,
        obsoleteCount: item.obsoleteCount ?? 0,
      }))
    : [];

  const users = Array.isArray(payload?.users)
    ? payload.users.map((user) => ({
        ...user,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        lastLoginAt: user.lastLoginAt || "",
      }))
    : [];

  return {
    ...(payload || {}),
    analytics: analyticsRows,
    users,
  };
}

function RolePill({ role }) {
  const match = ROLES.find((item) => item.key === role) || { label: role };
  return (
    <span className={`aca-role-pill aca-role-pill-${role || "default"}`}>
      {match.label}
    </span>
  );
}

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
              fill={item.color || OVERVIEW_BAR_COLORS[index % OVERVIEW_BAR_COLORS.length]}
              opacity="0.9"
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

function LineChart({ labels, series }) {
  const [hoveredCol, setHoveredCol] = useState(null);

  if (!Array.isArray(labels) || !labels.length || !Array.isArray(series) || !series.length) {
    return null;
  }

  const W = 480;
  const H = 180;
  const leftPad = 40;
  const rightPad = 14;
  const topPad = 14;
  const bottomPad = 30;
  const innerW = W - leftPad - rightPad;
  const innerH = H - topPad - bottomPad;

  const allValues = series.flatMap((item) => item.values || []);
  const rawMax = Math.max(...allValues, 1);
  const yTicks = 4;
  const step = Math.ceil(rawMax / yTicks);
  const niceMax = step * yTicks;

  const getX = (index) => (
    labels.length === 1
      ? leftPad + innerW / 2
      : leftPad + (index / (labels.length - 1)) * innerW
  );
  const getY = (value) => topPad + innerH - (value / niceMax) * innerH;

  return (
    <div className="overview-line-chart-wrap" onMouseLeave={() => setHoveredCol(null)}>
      <svg className="overview-line-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {series.map((item, index) => {
            const color = item.color || OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length];
            return (
              <linearGradient key={index} id={`admin-ovlcg-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.15" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            );
          })}
        </defs>

        {Array.from({ length: yTicks + 1 }, (_, index) => {
          const value = step * index;
          const y = getY(value);
          const label = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
          return (
            <g key={index}>
              <line x1={leftPad} y1={y} x2={W - rightPad} y2={y} className="overview-line-chart-grid" />
              <text x={leftPad - 5} y={y + 4} textAnchor="end" className="overview-line-chart-tick">
                {label}
              </text>
            </g>
          );
        })}

        {labels.map((label, index) => (
          <text key={index} x={getX(index)} y={H - 8} textAnchor="middle" className="overview-line-chart-label">
            {label}
          </text>
        ))}

        {series.map((item, index) => {
          const values = item.values || [];
          if (!values.length) return null;
          const linePoints = values.map((value, pointIndex) => `${getX(pointIndex)},${getY(value)}`).join(" ");
          const bottomY = getY(0);
          const area = `${getX(0)},${bottomY} ${linePoints} ${getX(values.length - 1)},${bottomY}`;
          return <polygon key={index} points={area} fill={`url(#admin-ovlcg-${index})`} />;
        })}

        {series.map((item, index) => {
          const color = item.color || OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length];
          const values = item.values || [];
          if (!values.length) return null;
          const points = values.map((value, pointIndex) => `${getX(pointIndex)},${getY(value)}`).join(" ");
          return (
            <g key={index}>
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {values.map((value, pointIndex) => (
                <circle
                  key={pointIndex}
                  cx={getX(pointIndex)}
                  cy={getY(value)}
                  r={hoveredCol === pointIndex ? 5 : 3.5}
                  fill={color}
                  stroke="rgba(10,17,30,0.7)"
                  strokeWidth="1"
                  style={{ cursor: "crosshair" }}
                  onMouseEnter={() => setHoveredCol(pointIndex)}
                />
              ))}
            </g>
          );
        })}

        {hoveredCol !== null && (
          <line
            x1={getX(hoveredCol)}
            y1={topPad}
            x2={getX(hoveredCol)}
            y2={H - bottomPad}
            stroke="rgba(184,204,217,0.3)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hoveredCol !== null && (
        <div className="overview-line-tooltip">
          <div className="olt-label">{labels[hoveredCol]}</div>
          {series.map((item, index) => {
            const color = item.color || OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length];
            const value = (item.values || [])[hoveredCol] ?? 0;
            return (
              <div key={index} className="olt-row">
                <span className="olt-swatch" style={{ background: color }} />
                <span className="olt-name">
                  {item.productIcon ? `${item.productIcon} ` : ""}
                  {item.productCategory}
                </span>
                <span className="olt-val">{value}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="overview-line-legend">
        {series.map((item, index) => (
          <div key={index} className="overview-line-legend-item">
            <span
              className="overview-line-legend-swatch"
              style={{ backgroundColor: item.color || OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length] }}
            />
            <span className="overview-line-legend-name">
              {item.productIcon ? `${item.productIcon} ` : ""}
              {item.productCategory}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminCompanyAnalytics() {
  const { companySlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyId, setCompanyId] = useState(location.state?.companyId || null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editUserId, setEditUserId] = useState(null);
  const [editRole, setEditRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [analyticsSort, setAnalyticsSort] = useState({ key: "", direction: "" });
  const [analyticsFilters, setAnalyticsFilters] = useState({});
  const [usersSort, setUsersSort] = useState({ key: "", direction: "" });
  const [usersFilters, setUsersFilters] = useState({});
  const [showAnalyticsFilters, setShowAnalyticsFilters] = useState(false);
  const [showUsersFilters, setShowUsersFilters] = useState(false);

  useEffect(() => {
    if (companyId) {
      load(companyId);
    } else {
      // Resolve slug → ID via companies list (direct URL access)
      fetchWithAuth(`${API}/api/admin/companies`, { headers: authHeaders() })
        .then(r => r.json())
        .then(companies => {
          const found = companies.find(c => slugify(c.companyName) === companySlug);
          if (found) setCompanyId(found.id);
          else setError("Company not found");
        })
        .catch(() => setError("Failed to resolve company"));
    }
  }, [companySlug]);

  useEffect(() => {
    if (companyId) load(companyId);
  }, [companyId]);

  const load = async (id) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth(`${API}/api/admin/companies/${id}/analytics`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error("Failed to load");
      setData(normalizeAdminAnalyticsPayload(await response.json()));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const flash = (type, text, duration = 4000) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: "", text: "" }), duration);
  };

  const handleRoleChange = async (userId) => {
    setSaving(true);
    try {
      const response = await fetchWithAuth(`${API}/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ role: editRole }),
      });
      if (!response.ok) throw new Error("Failed");
      flash("success", "Role updated");
      setEditUserId(null);
      load();
    } catch (err) {
      flash("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const exportAnalyticsToPDF = async () => {
    if (!data) return;

    try {
      setExporting(true);
      setMsg({ type: "", text: "" });

      const now = new Date();
      const companyName = data.company?.companyName || `Company ${companyId}`;
      const sumField = (field) => data.analytics?.reduce((sum, item) => sum + parseInt(item[field] || 0, 10), 0) || 0;
      const totalDraft = sumField("draftCount");
      const totalReleased = sumField("releasedCount");
      const totalInRevision = sumField("revisedCount");
      const totalInReview = sumField("inReviewCount");
      const totalObsoletePdf = sumField("obsoleteCount");
      const summaryStats = [
        { label: "Total Passports", value: data.totalPassports || 0, tone: "default" },
        { label: "Draft", value: totalDraft, tone: "draft" },
        { label: "In Review", value: totalInReview, tone: "review" },
        { label: "Released", value: totalReleased, tone: "released" },
        { label: "In Revision", value: totalInRevision, tone: "revised" },
        { label: "Obsolete", value: totalObsoletePdf, tone: "obsolete" },
        { label: "Archived", value: data.archivedCount || 0, tone: "archived" },
        { label: "QR Scans", value: data.scanStats || 0, tone: "scans" },
      ];
      const statusChartItems = [
        { label: "Draft",       value: totalDraft,       color: STATUS_COLORS.draft },
        { label: "In Review",   value: totalInReview,    color: STATUS_COLORS.review },
        { label: "Released",    value: totalReleased,    color: STATUS_COLORS.released },
        { label: "In Revision", value: totalInRevision,  color: STATUS_COLORS.revised },
      ].filter((item) => item.value > 0);
      const typeChartData = (data.analytics || []).map((item, index) => ({
        label: item.displayName || item.passportType,
        value: parseInt(item.total || 0, 10),
        color: OVERVIEW_BAR_COLORS[index % OVERVIEW_BAR_COLORS.length],
      }));
      const trendSeries = (data.trend?.series || []).map((series, index) => ({
        ...series,
        color: OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length],
      }));

      const safeCompanyName = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      openAnalyticsPrintReport({
        title: `${companyName} Analytics Report`,
        subtitle: `Generated on ${now.toLocaleDateString()} for company-specific analytics in the light export theme.`,
        filename: `${safeCompanyName || "company"}_analytics_${now.getTime()}`,
        stats: summaryStats,
        chartCards: [
          {
            title: "Status breakdown",
            svg: statusChartItems.length ? renderPieChartSvg(statusChartItems) : "",
            legendItems: statusChartItems,
            emptyText: "No status data yet",
          },
          ...(typeChartData.length > 2 ? [{
            title: "Passports by type",
            svg: renderBarChartSvg(typeChartData, { height: 180 }),
            emptyText: "No type data yet",
          }] : []),
          {
            title: "Total passports over time by product category",
            svg: trendSeries.length && (data.trend?.labels || []).length
              ? renderLineChartSvg(data.trend.labels, trendSeries, { width: 420, height: 220 })
              : "",
            legendItems: trendSeries.map((item) => ({
              label: `${item.productIcon ? `${item.productIcon} ` : ""}${item.productCategory}`,
              color: item.color,
            })),
            emptyText: "No trend data yet",
          },
        ],
        sections: [
          {
            title: "Breakdown by Passport Type",
            headers: ["Passport Type", "Draft", "In Review", "Released", "In Revision"],
            rows: (data.analytics || []).map((stat) => [
              stat.displayName || stat.passportType,
              stat.draftCount || 0,
              stat.inReviewCount || 0,
              stat.releasedCount || 0,
              stat.revisedCount || 0,
            ]),
            emptyText: "No passport data yet.",
          },
        ],
      });
      flash("success", 'PDF export is ready. Choose "Save as PDF" in the print dialog.', 4000);
    } catch (err) {
      flash("error", "Failed to export PDF", 3000);
    } finally {
      setExporting(false);
    }
  };

  const analyticsRows = data?.analytics || [];
  const userRows = data?.users || [];

  const filteredUsers = userRows.filter((user) => (
    !search
      || user.email.toLowerCase().includes(search.toLowerCase())
      || `${user.firstName} ${user.lastName}`.toLowerCase().includes(search.toLowerCase())
  ));

  const analyticsColumns = useMemo(() => ([
    { key: "passportType", type: "string", getValue: (item) => item.passportType || "" },
    { key: "total", type: "number", getValue: (item) => parseInt(item.total || 0, 10) },
    { key: "draftCount", type: "number", getValue: (item) => parseInt(item.draftCount || 0, 10) },
    { key: "inReviewCount", type: "number", getValue: (item) => parseInt(item.inReviewCount || 0, 10) },
    { key: "releasedCount", type: "number", getValue: (item) => parseInt(item.releasedCount || 0, 10) },
    { key: "revisedCount", type: "number", getValue: (item) => parseInt(item.revisedCount || 0, 10) },
  ]), []);

  const userColumns = useMemo(() => ([
    { key: "name", type: "string", getValue: (user) => `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    { key: "email", type: "string", getValue: (user) => user.email || "" },
    { key: "id", type: "number", getValue: (user) => user.id },
    { key: "role", type: "string", getValue: (user) => user.role || "" },
    { key: "lastLoginAt", type: "date", getValue: (user) => user.lastLoginAt || "" },
  ]), []);

  const controlledAnalytics = useMemo(
    () => applyTableControls(analyticsRows, analyticsColumns, analyticsSort, analyticsFilters),
    [analyticsRows, analyticsColumns, analyticsSort, analyticsFilters]
  );
  const controlledUsers = useMemo(
    () => applyTableControls(filteredUsers, userColumns, usersSort, usersFilters),
    [filteredUsers, userColumns, usersSort, usersFilters]
  );

  const toggleAnalyticsSort = (key) => {
    const nextDirection = getNextSortDirection(analyticsSort, key);
    setAnalyticsSort(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };
  const toggleUsersSort = (key) => {
    const nextDirection = getNextSortDirection(usersSort, key);
    setUsersSort(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  if (loading) return <div className="loading admin-loading-screen">Loading…</div>;
  if (error) return <div className="alert alert-error admin-alert-page">{error}</div>;
  if (!data) return null;

  const sumField = (field) => data.analytics?.reduce((sum, item) => sum + parseInt(item[field] || 0, 10), 0) || 0;
  const totalDraft       = sumField("draftCount");
  const totalReleased    = sumField("releasedCount");
  const totalInRevision  = sumField("revisedCount");
  const totalInReview    = sumField("inReviewCount");
  const totalObsolete    = sumField("obsoleteCount");
  const totalScans       = data.scanStats || 0;
  const archivedCount    = data.archivedCount || 0;
  const statusChartItems = [
    { label: "Draft",       value: totalDraft,       color: STATUS_COLORS.draft },
    { label: "In Review",   value: totalInReview,    color: STATUS_COLORS.review },
    { label: "Released",    value: totalReleased,    color: STATUS_COLORS.released },
    { label: "In Revision", value: totalInRevision,  color: STATUS_COLORS.revised },
  ].filter((item) => item.value > 0);
  const typeChartData = (data.analytics || []).map((item, index) => ({
    label: item.displayName || item.passportType,
    value: parseInt(item.total || 0, 10),
    color: OVERVIEW_BAR_COLORS[index % OVERVIEW_BAR_COLORS.length],
  }));
  const trendChartData = (data.trend?.series || []).map((series, index) => ({
    ...series,
    color: OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length],
  }));

  return (
    <div className="aca-page">
      <div className="aca-header aca-header-stack">
        <button className="back-link" onClick={() => navigate("/admin/analytics")}>
          ← Back to Analytics
        </button>
        <div className="aca-header-main">
          <div>
            <h2 className="aca-title">📊 {data.company?.companyName || "Company"} Analytics</h2>
            <p className="aca-subtitle">Company-specific passport statistics, trends, and exportable reporting.</p>
          </div>
          <button
            className="export-pdf-btn aca-export-btn"
            onClick={exportAnalyticsToPDF}
            disabled={exporting || !data}
          >
            {exporting ? "⏳ Exporting..." : "📄 Export as PDF"}
          </button>
        </div>
      </div>

      {msg.text && (
        <div className={`alert alert-${msg.type === "success" ? "success" : "error"} admin-alert-bottom`}>
          {msg.text}
        </div>
      )}

      <div className="overview-stats-row aca-overview-stats">
        <div className="ov-stat"><div className="ov-stat-num">{data.totalPassports || 0}</div><div className="ov-stat-label">Total Passports</div></div>
        <div className="ov-stat stat-draft"><div className="ov-stat-num">{totalDraft}</div><div className="ov-stat-label">📋 Draft</div></div>
        <div className="ov-stat stat-review"><div className="ov-stat-num">{totalInReview}</div><div className="ov-stat-label">🔍 In Review</div></div>
        <div className="ov-stat stat-released"><div className="ov-stat-num">{totalReleased}</div><div className="ov-stat-label">✅ Released</div></div>
        <div className="ov-stat stat-revised"><div className="ov-stat-num">{totalInRevision}</div><div className="ov-stat-label">📝 In Revision</div></div>
        <div className="ov-stat stat-obsolete"><div className="ov-stat-num">{totalObsolete}</div><div className="ov-stat-label">⚪ Obsolete</div></div>
        <div className="ov-stat stat-archived"><div className="ov-stat-num">{archivedCount}</div><div className="ov-stat-label">📦 Archived</div></div>
        <div className="ov-stat stat-scans"><div className="ov-stat-num">{totalScans}</div><div className="ov-stat-label">📊 QR Scans</div></div>
      </div>

      <div className="aca-card admin-card-spaced">
        <div className="overview-grid overview-analytics-only">
          <div>
            <h3 className="overview-section-title">📊 Analytics</h3>
            {data.analytics?.length > 0 ? (
              <>
                <div className="chart-card">
                  <div className="chart-title">Status breakdown</div>
                  {statusChartItems.length > 0 ? (
                    <PieChart items={statusChartItems} displayMode="value" showTotalNote={false} />
                  ) : (
                    <div className="overview-empty-chart">No status data yet</div>
                  )}
                </div>
                <div className="overview-chart-row">
                  {typeChartData.length > 2 && (
                    <div className="chart-card chart-card-compact">
                      <div className="chart-title">Passports by type</div>
                      <BarChart data={typeChartData} height={70} />
                    </div>
                  )}
                  <div className="chart-card chart-card-wide">
                    <div className="chart-title">Total passports over time · by product category</div>
                    {trendChartData.length > 0 && (data.trend?.labels || []).length > 0 ? (
                      <LineChart labels={data.trend.labels} series={trendChartData} />
                    ) : (
                      <div className="overview-empty-chart">No trend data yet</div>
                    )}
                  </div>
                </div>
                <div className="analytics-cards">
                  {data.analytics.map((stat) => (
                    <div key={stat.passportType} className="type-stat-card">
                      <h4>{stat.displayName || stat.passportType}</h4>
                      <div className="type-stat-grid">
                        <div className="type-stat-item"><div className="type-stat-label">Draft</div><div className="type-stat-draft">{stat.draftCount || 0}</div></div>
                        <div className="type-stat-item"><div className="type-stat-label">In Review</div><div className="type-stat-review">{stat.inReviewCount || 0}</div></div>
                        <div className="type-stat-item"><div className="type-stat-label">Released</div><div className="type-stat-released">{stat.releasedCount || 0}</div></div>
                        <div className="type-stat-item"><div className="type-stat-label">In Revision</div><div className="type-stat-revised">{stat.revisedCount || 0}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="chart-card">
                <p className="overview-empty-copy">No passport data yet for this company.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {data.analytics?.length > 0 && (
        <div className="aca-card admin-card-spaced">
          <div className="table-tools-row">
            <h3 className="aca-card-title">Passports by Type</h3>
            <button
              type="button"
              className={`table-filter-toggle-btn${showAnalyticsFilters ? " active" : ""}`}
              onClick={() => setShowAnalyticsFilters((prev) => !prev)}
            >
              Filter
            </button>
          </div>
          <table className="aca-table">
            <thead>
              <tr>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("passportType")}>Type{sortIndicator(analyticsSort, "passportType") && ` ${sortIndicator(analyticsSort, "passportType")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("total")}>Total{sortIndicator(analyticsSort, "total") && ` ${sortIndicator(analyticsSort, "total")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("draftCount")}>Draft{sortIndicator(analyticsSort, "draftCount") && ` ${sortIndicator(analyticsSort, "draftCount")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("inReviewCount")}>In Review{sortIndicator(analyticsSort, "inReviewCount") && ` ${sortIndicator(analyticsSort, "inReviewCount")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("releasedCount")}>Released{sortIndicator(analyticsSort, "releasedCount") && ` ${sortIndicator(analyticsSort, "releasedCount")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleAnalyticsSort("revisedCount")}>In Revision{sortIndicator(analyticsSort, "revisedCount") && ` ${sortIndicator(analyticsSort, "revisedCount")}`}</button></th>
              </tr>
              {showAnalyticsFilters && (
                <tr className="table-filter-row">
                  <th><input className="table-filter-input" value={analyticsFilters.passportType || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, passportType: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={analyticsFilters.total || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, total: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={analyticsFilters.draftCount || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, draftCount: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={analyticsFilters.inReviewCount || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, inReviewCount: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={analyticsFilters.releasedCount || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, releasedCount: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={analyticsFilters.revisedCount || ""} onChange={(e) => setAnalyticsFilters((prev) => ({ ...prev, revisedCount: e.target.value }))} placeholder="Filter" /></th>
                </tr>
              )}
            </thead>
            <tbody>
              {controlledAnalytics.map((item) => (
                <tr key={item.passportType}>
                  <td><strong className="admin-text-capitalize">{item.displayName || item.passportType}</strong></td>
                  <td>{item.total || 0}</td>
                  <td><span className="mini-badge draft">{item.draftCount || 0}</span></td>
                  <td><span className="mini-badge review">{item.inReviewCount || 0}</span></td>
                  <td><span className="mini-badge released">{item.releasedCount || 0}</span></td>
                  <td><span className="mini-badge revised">{item.revisedCount || 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="aca-card">
        <div className="admin-toolbar-row">
          <h3 className="aca-card-title admin-title-reset">👥 Users ({data.users?.length || 0})</h3>
          <div className="admin-toolbar-row">
            <input
              type="text"
              placeholder="🔍 Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="aca-search"
            />
            <button
              type="button"
              className={`table-filter-toggle-btn${showUsersFilters ? " active" : ""}`}
              onClick={() => setShowUsersFilters((prev) => !prev)}
            >
              Filter
            </button>
          </div>
        </div>

        {filteredUsers.length === 0 ? (
          <p className="admin-muted-copy">No users found.</p>
        ) : (
          <table className="aca-table">
            <thead>
              <tr>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleUsersSort("name")}>Name{sortIndicator(usersSort, "name") && ` ${sortIndicator(usersSort, "name")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleUsersSort("email")}>Email{sortIndicator(usersSort, "email") && ` ${sortIndicator(usersSort, "email")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleUsersSort("id")}>User ID{sortIndicator(usersSort, "id") && ` ${sortIndicator(usersSort, "id")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleUsersSort("role")}>Role{sortIndicator(usersSort, "role") && ` ${sortIndicator(usersSort, "role")}`}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleUsersSort("lastLoginAt")}>Last Login{sortIndicator(usersSort, "lastLoginAt") && ` ${sortIndicator(usersSort, "lastLoginAt")}`}</button></th>
                <th>Actions</th>
              </tr>
              {showUsersFilters && (
                <tr className="table-filter-row">
                  <th><input className="table-filter-input" value={usersFilters.name || ""} onChange={(e) => setUsersFilters((prev) => ({ ...prev, name: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={usersFilters.email || ""} onChange={(e) => setUsersFilters((prev) => ({ ...prev, email: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={usersFilters.id || ""} onChange={(e) => setUsersFilters((prev) => ({ ...prev, id: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={usersFilters.role || ""} onChange={(e) => setUsersFilters((prev) => ({ ...prev, role: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={usersFilters.lastLoginAt || ""} onChange={(e) => setUsersFilters((prev) => ({ ...prev, lastLoginAt: e.target.value }))} placeholder="Filter" /></th>
                  <th></th>
                </tr>
              )}
            </thead>
            <tbody>
              {controlledUsers.map((user) => (
                <tr key={user.id}>
                  <td><div className="aca-user-name">{user.firstName} {user.lastName}</div></td>
                  <td className="aca-user-email">{user.email}</td>
                  <td className="aca-user-id">#{user.id}</td>
                  <td>
                    {editUserId === user.id ? (
                      <div className="aca-role-editor">
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="aca-role-select">
                          {ROLES.map((role) => (
                            <option key={role.key} value={role.key}>{role.label}</option>
                          ))}
                        </select>
                        <button onClick={() => handleRoleChange(user.id)} disabled={saving} className="aca-inline-btn aca-inline-btn-save">
                          {saving ? "…" : "✓"}
                        </button>
                        <button onClick={() => setEditUserId(null)} className="aca-inline-btn aca-inline-btn-cancel">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <RolePill role={user.role} />
                    )}
                  </td>
                  <td className="aca-last-login">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                  </td>
                  <td>
                    {editUserId !== user.id && (
                      <button
                        onClick={() => {
                          setEditUserId(user.id);
                          setEditRole(user.role);
                        }}
                        className="aca-edit-btn"
                      >
                        ✏️ Change Role
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default AdminCompanyAnalytics;
