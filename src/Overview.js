import React, { useState, useEffect } from "react";
import { PieChart } from "./PieChart";
import { openAnalyticsPrintReport, renderBarChartSvg, renderLineChartSvg, renderPieChartSvg } from "./analyticsPrintExport";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const OVERVIEW_BAR_COLORS = ["#14b8a6", "#0f766e", "#0ea5e9", "#2563eb", "#22c55e", "#d69e2e"];
const OVERVIEW_LINE_COLORS = ["#14b8a6", "#38bdf8", "#f59e0b", "#f472b6", "#a78bfa", "#22c55e"];

function BarChart({ data, height = 120 }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = 36; const gap = 16;
  const totalW = data.length * (barW + gap) + gap;
  return (
    <svg className="overview-bar-chart" width="100%" viewBox={`0 0 ${Math.max(totalW,200)} ${height+30}`}>
      {data.map((d,i) => {
        const bh = Math.max(4,(d.value/max)*height);
        const x  = gap + i*(barW+gap); const y = height-bh+10;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={4} fill={d.color || OVERVIEW_BAR_COLORS[i % OVERVIEW_BAR_COLORS.length]} opacity="0.9"/>
            <text
              x={x+barW/2}
              y={height+18}
              textAnchor="middle"
              className="overview-bar-chart-label"
            >
              {d.label.length>10?d.label.substring(0,8)+"…":d.label}
            </text>
            {d.value>0&&(
              <text
                x={x+barW/2}
                y={y-5}
                textAnchor="middle"
                className="overview-bar-chart-value"
              >
                {d.value}
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

  // Fixed layout constants (SVG coordinate space)
  const W          = 480;
  const H          = 180;
  const leftPad    = 40;
  const rightPad   = 14;
  const topPad     = 14;
  const bottomPad  = 30;
  const innerW     = W - leftPad - rightPad;
  const innerH     = H - topPad - bottomPad;

  // Y-axis: nice integer max
  const allValues = series.flatMap(s => s.values || []);
  const rawMax    = Math.max(...allValues, 1);
  const yTicks    = 4;
  const step      = Math.ceil(rawMax / yTicks);
  const niceMax   = step * yTicks;

  const getX = (i) => labels.length === 1
    ? leftPad + innerW / 2
    : leftPad + (i / (labels.length - 1)) * innerW;
  const getY = (v) => topPad + innerH - (v / niceMax) * innerH;

  // Gradient defs collected at SVG root (avoids in-g issues)
  const gradientDefs = series.map((item, idx) => {
    const color = item.color || OVERVIEW_LINE_COLORS[idx % OVERVIEW_LINE_COLORS.length];
    return (
      <linearGradient key={idx} id={`ovlcg-${idx}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor={color} stopOpacity="0.15" />
        <stop offset="100%" stopColor={color} stopOpacity="0"    />
      </linearGradient>
    );
  });

  return (
    <div className="overview-line-chart-wrap" onMouseLeave={() => setHoveredCol(null)}>
      <svg
        className="overview-line-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>{gradientDefs}</defs>

        {/* Horizontal grid + Y-axis labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = step * i;
          const y = getY(v);
          const lbl = v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;
          return (
            <g key={i}>
              <line x1={leftPad} y1={y} x2={W - rightPad} y2={y} className="overview-line-chart-grid" />
              <text x={leftPad - 5} y={y + 4} textAnchor="end" className="overview-line-chart-tick">{lbl}</text>
            </g>
          );
        })}

        {/* X-axis month labels */}
        {labels.map((lbl, i) => (
          <text key={i} x={getX(i)} y={H - 8} textAnchor="middle" className="overview-line-chart-label">
            {lbl}
          </text>
        ))}

        {/* Area fills — rendered first so lines sit on top */}
        {series.map((item, idx) => {
          const values = item.values || [];
          if (!values.length) return null;
          const linePts = values.map((v, i) => `${getX(i)},${getY(v)}`).join(" ");
          const yBot    = getY(0);
          const area    = `${getX(0)},${yBot} ${linePts} ${getX(values.length - 1)},${yBot}`;
          return (
            <polygon key={idx} points={area} fill={`url(#ovlcg-${idx})`} />
          );
        })}

        {/* Lines + dots */}
        {series.map((item, idx) => {
          const color  = item.color || OVERVIEW_LINE_COLORS[idx % OVERVIEW_LINE_COLORS.length];
          const values = item.values || [];
          if (!values.length) return null;
          const pts = values.map((v, i) => `${getX(i)},${getY(v)}`).join(" ");
          return (
            <g key={idx}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {values.map((v, i) => (
                <circle
                  key={i}
                  cx={getX(i)}
                  cy={getY(v)}
                  r={hoveredCol === i ? 5 : 3.5}
                  fill={color}
                  stroke="rgba(10,17,30,0.7)"
                  strokeWidth="1"
                  style={{ cursor: "crosshair" }}
                  onMouseEnter={() => setHoveredCol(i)}
                />
              ))}
            </g>
          );
        })}

        {/* Hover column rule */}
        {hoveredCol !== null && (
          <line
            x1={getX(hoveredCol)} y1={topPad}
            x2={getX(hoveredCol)} y2={H - bottomPad}
            stroke="rgba(184,204,217,0.3)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {/* Tooltip */}
      {hoveredCol !== null && (
        <div className="overview-line-tooltip">
          <div className="olt-label">{labels[hoveredCol]}</div>
          {series.map((item, idx) => {
            const color = item.color || OVERVIEW_LINE_COLORS[idx % OVERVIEW_LINE_COLORS.length];
            const val   = (item.values || [])[hoveredCol] ?? 0;
            return (
              <div key={idx} className="olt-row">
                <span className="olt-swatch" style={{ background: color }} />
                <span className="olt-name">
                  {item.umbrella_icon ? `${item.umbrella_icon} ` : ""}
                  {item.umbrella_category}
                </span>
                <span className="olt-val">{val}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="overview-line-legend">
        {series.map((item, idx) => (
          <div key={idx} className="overview-line-legend-item">
            <span
              className="overview-line-legend-swatch"
              style={{ backgroundColor: item.color || OVERVIEW_LINE_COLORS[idx % OVERVIEW_LINE_COLORS.length] }}
            />
            <span className="overview-line-legend-name">
              {item.umbrella_icon ? `${item.umbrella_icon} ` : ""}
              {item.umbrella_category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTION_ICONS = { create:"✨", update:"📝", delete:"🗑️", release:"🚀", revise:"🔄", SUBMIT_REVIEW:"📤", submit_review:"📤" };
function timeAgo(d) {
  const s=Math.floor((Date.now()-new Date(d))/1000);
  if(s<60)return"just now"; if(s<3600)return`${Math.floor(s/60)}m ago`;
  if(s<86400)return`${Math.floor(s/3600)}h ago`; return new Date(d).toLocaleDateString();
}

function Overview({ companyId }) {
  const resolvedCompanyId = companyId;
  const [analytics,    setAnalytics]    = useState(null);
  const [message,      setMessage]      = useState({ type:"",text:"" });
  const [activity,     setActivity]     = useState([]);
  const [exporting,    setExporting]    = useState(false);

  useEffect(() => { 
    fetchAnalytics(); 
    fetchActivity();
  }, [resolvedCompanyId]);

  const fetchAnalytics = async () => {
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/analytics`,{ headers:{ Authorization:"Bearer cookie-session" } });
      if(r.ok) setAnalytics(await r.json());
    } catch {}
  };
  const fetchActivity = async () => {
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/activity?limit=5`,{ headers:{ Authorization:"Bearer cookie-session" } });
      if(r.ok) {
        const data = await r.json();
        setActivity(Array.isArray(data) ? data.slice(0, 5) : []);
      }
    } catch {}
  };

  const exportAnalyticsToPDF = async () => {
    try {
      setExporting(true);
      setMessage({ type: "", text: "" });

      const now = new Date();
      const sumField = (field) =>
        analytics?.analytics?.reduce((s, x) => s + parseInt(x[field] || 0), 0) || 0;
      const totalDraft = sumField("draft_count");
      const totalReleased = sumField("released_count");
      const totalInRevision = sumField("revised_count");
      const totalInReview = sumField("in_review_count");
      const summaryStats = [
        { label: "Total Passports", value: analytics?.totalPassports || 0, tone: "default" },
        { label: "Draft", value: totalDraft, tone: "draft" },
        { label: "In Review", value: totalInReview, tone: "review" },
        { label: "Released", value: totalReleased, tone: "released" },
        { label: "In Revision", value: totalInRevision, tone: "revised" },
        { label: "QR Scans", value: analytics?.scanStats || 0, tone: "scans" },
      ];
      const statusChartItems = [
        { label: "Draft", value: totalDraft, color: "#f59e0b" },
        { label: "In Review", value: totalInReview, color: "#8b5cf6" },
        { label: "Released", value: totalReleased, color: "#14b8a6" },
        { label: "In Revision", value: totalInRevision, color: "#f472b6" },
      ].filter((item) => item.value > 0);
      const typeChartData = (analytics?.analytics || []).map((stat, index) => ({
        label: stat.passport_type.charAt(0).toUpperCase() + stat.passport_type.slice(1),
        value: parseInt(stat.draft_count || 0, 10) + parseInt(stat.released_count || 0, 10) + parseInt(stat.revised_count || 0, 10) + parseInt(stat.in_review_count || 0, 10),
        color: OVERVIEW_BAR_COLORS[index % OVERVIEW_BAR_COLORS.length],
      }));
      const trendSeries = (analytics?.trend?.series || []).map((series, index) => ({
        ...series,
        color: OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length],
      }));

      openAnalyticsPrintReport({
        title: "Company Analytics Report",
        subtitle: `Generated on ${now.toLocaleDateString()} for your company analytics overview.`,
        filename: `analytics_report_${now.getTime()}`,
        stats: summaryStats,
        chartCards: [
          {
            title: "Status breakdown",
            svg: statusChartItems.length ? renderPieChartSvg(statusChartItems) : "",
            legendItems: statusChartItems,
            emptyText: "No status data yet",
          },
          {
            title: "Passports by type",
            svg: typeChartData.length ? renderBarChartSvg(typeChartData, { height: 180 }) : "",
            emptyText: "No type data yet",
          },
          {
            title: "Total passports over time by product category",
            svg: trendSeries.length && (analytics?.trend?.labels || []).length
              ? renderLineChartSvg(analytics.trend.labels, trendSeries, { width: 420, height: 220 })
              : "",
            legendItems: trendSeries.map((item) => ({
              label: `${item.umbrella_icon ? `${item.umbrella_icon} ` : ""}${item.umbrella_category}`,
              color: item.color,
            })),
            emptyText: "No trend data yet",
          },
        ],
        sections: [
          {
            title: "Breakdown by Passport Type",
            headers: ["Passport Type", "Draft", "In Review", "Released", "In Revision"],
            rows: (analytics?.analytics || []).map((stat) => [
              stat.passport_type.charAt(0).toUpperCase() + stat.passport_type.slice(1),
              stat.draft_count || 0,
              stat.in_review_count || 0,
              stat.released_count || 0,
              stat.revised_count || 0,
            ]),
            emptyText: "No passport data yet.",
          },
        ],
      });
      setMessage({ type: 'success', text: 'PDF export is ready. Choose Save as PDF in the print dialog.' });
      setTimeout(() => setMessage({ type: "", text: "" }), 4000);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to export PDF" });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } finally {
      setExporting(false);
    }
  };

  if(!analytics) return <div className="loading dashboard-loading-panel">Loading overview...</div>;

  const sumField=(field)=>analytics?.analytics?.reduce((s,x)=>s+parseInt(x[field]||0),0)||0;
  const totalDraft    = sumField("draft_count");
  const totalReleased = sumField("released_count");
  const totalInRevision  = sumField("revised_count");
  const totalInReview = sumField("in_review_count");
  const scanStats     = analytics?.scanStats||0;

  const statusChartItems=[
    { label:"Draft",     value:totalDraft,    color:"#f59e0b" },
    { label:"In Review", value:totalInReview, color:"#f8fafc" },
    { label:"Released",  value:totalReleased, color:"#14b8a6" },
    { label:"In Revision",   value:totalInRevision,  color:"#3b82f6" },
  ].filter(s=>s.value>0);

  const typeChartData=analytics?.analytics?.map(s=>({
    label:s.passport_type.charAt(0).toUpperCase()+s.passport_type.slice(1),
    value:parseInt(s.draft_count||0)+parseInt(s.released_count||0)+parseInt(s.revised_count||0)+parseInt(s.in_review_count||0),
    color:OVERVIEW_BAR_COLORS[
      analytics.analytics.findIndex(item => item.passport_type === s.passport_type) % OVERVIEW_BAR_COLORS.length
    ],
  }))||[];
  const trendChartData = (analytics?.trend?.series || []).map((series, index) => ({
    ...series,
    color: OVERVIEW_LINE_COLORS[index % OVERVIEW_LINE_COLORS.length],
  }));

  return (
    <div className="overview-wrapper">
      <div className="overview-header">
        <div>
          <h2>📊 Analytics</h2>
          <p>Company passport statistics and activity</p>
        </div>
        <button
          className="export-pdf-btn"
          onClick={exportAnalyticsToPDF}
          disabled={exporting || !analytics}
        >
          {exporting ? "⏳ Exporting..." : "📄 Export as PDF"}
        </button>
      </div>
      {message.text && (
        <div className={`alert alert-${message.type === "success" ? "success" : "error"} dashboard-alert-spaced`}>
          {message.text}
        </div>
      )}

      {analytics&&(
        <div className="overview-stats-row">
          <div className="ov-stat"><div className="ov-stat-num">{analytics.totalPassports}</div><div className="ov-stat-label">Total Passports</div></div>
          <div className="ov-stat stat-draft"><div className="ov-stat-num">{totalDraft}</div><div className="ov-stat-label">📋 Draft</div></div>
          {totalInReview>0&&<div className="ov-stat stat-review"><div className="ov-stat-num">{totalInReview}</div><div className="ov-stat-label">🔍 In Review</div></div>}
          <div className="ov-stat stat-released"><div className="ov-stat-num">{totalReleased}</div><div className="ov-stat-label">✅ Released</div></div>
          <div className="ov-stat stat-revised"><div className="ov-stat-num">{totalInRevision}</div><div className="ov-stat-label">📝 In Revision</div></div>
          {scanStats>0&&<div className="ov-stat stat-scans"><div className="ov-stat-num">{scanStats}</div><div className="ov-stat-label">📊 QR Scans</div></div>}
        </div>
      )}

      <div className="overview-grid overview-analytics-only">
        <div>
          <h3 className="overview-section-title">
            <span className="overview-section-icon">📊</span>
            <span>Analytics</span>
          </h3>
          {analytics&&analytics.analytics?.length>0?(
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
                <div className="chart-card chart-card-compact">
                  <div className="chart-title">Passports by type</div>
                  {typeChartData.length > 0 ? (
                    <BarChart data={typeChartData} height={70}/>
                  ) : (
                    <div className="overview-empty-chart">No type data yet</div>
                  )}
                </div>
                <div className="chart-card chart-card-wide">
                  <div className="chart-title">Total passports over time · by product category</div>
                  {trendChartData.length > 0 && (analytics?.trend?.labels || []).length > 0 ? (
                    <LineChart labels={analytics.trend.labels} series={trendChartData} />
                  ) : (
                    <div className="overview-empty-chart">No trend data yet</div>
                  )}
                </div>
              </div>
              <div className="analytics-cards">
                {analytics.analytics.map(stat=>(
                  <div key={stat.passport_type} className="type-stat-card">
                    <h4>{stat.passport_type.charAt(0).toUpperCase()+stat.passport_type.slice(1)}</h4>
                    <div className="type-stat-grid">
                      <div className="type-stat-item"><div className="type-stat-label">Draft</div><div className="type-stat-draft">{stat.draft_count||0}</div></div>
                      <div className="type-stat-item"><div className="type-stat-label">In Review</div><div className="type-stat-review">{stat.in_review_count||0}</div></div>
                      <div className="type-stat-item"><div className="type-stat-label">Released</div><div className="type-stat-released">{stat.released_count||0}</div></div>
                      <div className="type-stat-item"><div className="type-stat-label">In Revision</div><div className="type-stat-revised">{stat.revised_count||0}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ):(
            <div className="chart-card"><p className="overview-empty-copy">No passport data yet. Create your first passport to see analytics.</p></div>
          )}
        </div>
      </div>

      {activity.length>0&&(
        <>
          <h3 className="overview-section-title">
            <span className="overview-section-icon">🕐</span>
            <span>Recent Activity</span>
          </h3>
          <div className="activity-full-row">
            <div className="activity-feed">
              {activity.map((a,i)=>(
                <div key={i} className="activity-item">
                  <span className={`activity-icon activity-icon-${(a.action || "").toLowerCase()}`}>
                    {ACTION_ICONS[a.action]||"📋"}
                  </span>
                  <div className="activity-body">
                    <div className="activity-row-top">
                      <span className="activity-user">{a.user_email?.split("@")[0]||"System"}</span>
                      <span className={`activity-badge ${(a.action||"").toLowerCase()}`}>{(a.action||"").replaceAll("_", " ")}</span>
                    </div>
                    <div className="activity-row-bottom">
                      <span className="activity-copy">passport activity recorded</span>
                      {a.passport_guid&&<span className="activity-pass">{a.passport_guid.substring(0,8)}…</span>}
                    </div>
                  </div>
                  <span className="activity-time">{timeAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Overview;
