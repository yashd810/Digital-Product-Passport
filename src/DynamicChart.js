import React from "react";
import "./PassportViewer.css";

// SVG canvas dimensions
const W   = 520;
const H   = 220;
const PAD = { top: 18, right: 18, bottom: 46, left: 52 };
const IW  = W - PAD.left - PAD.right;   // inner width
const IH  = H - PAD.top  - PAD.bottom;  // inner height

// ── Helpers ──────────────────────────────────────────────────────────────────

// Extract the first number from strings like "87%", "24.5 °C", "-12.3 V", "87"
function parseNum(s) {
  if (s === null || s === undefined || s === "") return NaN;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

// Human-readable time label depending on the span of data
function fmtTime(date, spanMins) {
  if (spanMins < 2)   return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (spanMins < 1440) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (spanMins < 43200) return date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Generate "nice" evenly spaced tick values for an axis
function niceTicks(lo, hi, count = 5) {
  const range = hi - lo;
  if (range === 0) return [lo];
  const step0  = range / (count - 1);
  const mag    = Math.pow(10, Math.floor(Math.log10(step0)));
  const nice   = [1, 2, 2.5, 5, 10].find(f => f * mag >= step0) * mag;
  const start  = Math.floor(lo / nice) * nice;
  const ticks  = [];
  for (let v = start; ticks.length < count + 2 && v <= hi + nice * 0.01; v = parseFloat((v + nice).toFixed(10))) {
    if (v >= lo - nice * 0.01) ticks.push(parseFloat(v.toFixed(10)));
  }
  return ticks;
}

function fmtNum(n) {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n % 1 === 0) return String(n);
  return n.toFixed(Math.abs(n) < 0.1 ? 3 : 1);
}

// ── Summary strip ─────────────────────────────────────────────────────────────
function Summary({ nums, count }) {
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return (
    <div className="dyn-summary">
      <span><span className="dyn-summary-label">Min</span> {fmtNum(min)}</span>
      <span><span className="dyn-summary-label">Max</span> {fmtNum(max)}</span>
      <span><span className="dyn-summary-label">Avg</span> {fmtNum(avg)}</span>
      <span><span className="dyn-summary-label">Points</span> {count}</span>
    </div>
  );
}

// ── Line Chart ────────────────────────────────────────────────────────────────
function LineChart({ points }) {
  const xMin     = points[0].ts;
  const xMax     = points[points.length - 1].ts;
  const spanMins = (xMax - xMin) / 60000;
  const nums     = points.map(p => p.num);
  const dataMin  = Math.min(...nums);
  const dataMax  = Math.max(...nums);
  const pad      = (dataMax - dataMin) * 0.12 || 1;
  const yLo      = dataMin - pad;
  const yHi      = dataMax + pad;

  const toX = t  => ((t - xMin) / (xMax - xMin || 1)) * IW + PAD.left;
  const toY = v  => IH - ((v - yLo) / (yHi - yLo)) * IH + PAD.top;

  const polyPts  = points.map(p => `${toX(p.ts)},${toY(p.num)}`).join(" ");
  const areaPts  = `${toX(xMin)},${PAD.top + IH} ${polyPts} ${toX(xMax)},${PAD.top + IH}`;

  const yTicks   = niceTicks(yLo, yHi, 5);
  const xCount   = Math.min(6, points.length);
  const xIdxs    = xCount <= 1
    ? [0]
    : Array.from({ length: xCount }, (_, i) =>
        Math.round(i * (points.length - 1) / (xCount - 1)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dyn-chart-svg">
      {/* Horizontal grid */}
      {yTicks.map((t, i) => (
        <line key={i}
          x1={PAD.left} x2={PAD.left + IW}
          y1={toY(t)} y2={toY(t)}
          stroke="#e8f2f0" strokeWidth="1" />
      ))}

      {/* Area fill */}
      <polygon points={areaPts} fill="rgba(28,55,56,0.07)" />

      {/* Line */}
      <polyline
        points={polyPts}
        fill="none" stroke="var(--jet)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots (only when sparse enough) */}
      {points.length <= 80 && points.map((p, i) => (
        <circle key={i}
          cx={toX(p.ts)} cy={toY(p.num)} r="3.5"
          fill="var(--jet)" stroke="white" strokeWidth="1.5" />
      ))}

      {/* Y axis */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
      {yTicks.map((t, i) => (
        <text key={i}
          x={PAD.left - 7} y={toY(t)}
          textAnchor="end" dominantBaseline="middle"
          className="dyn-axis-label">{fmtNum(t)}</text>
      ))}

      {/* X axis */}
      <line x1={PAD.left} y1={PAD.top + IH} x2={PAD.left + IW} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
      {xIdxs.map((idx, i) => {
        const p = points[idx];
        const x = toX(p.ts);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={PAD.top + IH} y2={PAD.top + IH + 4}
              stroke="#b0ccc8" strokeWidth="1" />
            <text x={x} y={PAD.top + IH + 16}
              textAnchor="middle" className="dyn-axis-label">
              {fmtTime(new Date(p.ts), spanMins)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Histogram ─────────────────────────────────────────────────────────────────
function NumericHistogram({ nums }) {
  const min     = Math.min(...nums);
  const max     = Math.max(...nums);
  const nBuckets = max === min ? 1 : Math.max(5, Math.min(15, Math.ceil(Math.sqrt(nums.length))));
  const bSize   = (max - min) / nBuckets || 1;

  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    lo:    min + i * bSize,
    hi:    min + (i + 1) * bSize,
    count: 0,
  }));
  nums.forEach(n => {
    let idx = Math.floor((n - min) / bSize);
    if (idx >= nBuckets) idx = nBuckets - 1;
    if (idx < 0)         idx = 0;
    buckets[idx].count++;
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const barW     = IW / nBuckets;
  const yTicks   = niceTicks(0, maxCount, 4).filter(t => t >= 0);
  const toY      = v => IH - (v / maxCount) * IH + PAD.top;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dyn-chart-svg">
      {/* Grid */}
      {yTicks.map((t, i) => (
        <line key={i}
          x1={PAD.left} x2={PAD.left + IW}
          y1={toY(t)} y2={toY(t)}
          stroke="#e8f2f0" strokeWidth="1" />
      ))}

      {/* Bars */}
      {buckets.map((b, i) => {
        const x    = PAD.left + i * barW;
        const barH = (b.count / maxCount) * IH;
        const y    = toY(b.count);
        return (
          <g key={i}>
            <rect x={x + 1.5} y={y} width={barW - 3} height={barH}
              fill="var(--jet)" opacity="0.78" rx="2" />
            {b.count > 0 && (
              <text x={x + barW / 2} y={y - 5}
                textAnchor="middle" className="dyn-axis-label dyn-bar-count">
                {b.count}
              </text>
            )}
            <text x={x + barW / 2} y={PAD.top + IH + 14}
              textAnchor="middle" className="dyn-axis-label">
              {fmtNum(b.lo)}
            </text>
          </g>
        );
      })}

      {/* Y axis */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
      {yTicks.map((t, i) => (
        <text key={i}
          x={PAD.left - 7} y={toY(t)}
          textAnchor="end" dominantBaseline="middle"
          className="dyn-axis-label">{fmtNum(t)}</text>
      ))}

      {/* X axis */}
      <line x1={PAD.left} y1={PAD.top + IH} x2={PAD.left + IW} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
      {/* X axis label */}
      <text x={PAD.left + IW / 2} y={PAD.top + IH + 36}
        textAnchor="middle" className="dyn-axis-label dyn-axis-title">
        Value buckets
      </text>
    </svg>
  );
}

function CategoryHistogram({ entries }) {
  const freq = {};
  entries.forEach(e => { freq[e.raw] = (freq[e.raw] || 0) + 1; });
  const cats     = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxCount = Math.max(...cats.map(c => c[1]), 1);
  const barW     = IW / cats.length;
  const toY      = v => IH - (v / maxCount) * IH + PAD.top;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dyn-chart-svg">
      {/* Bars */}
      {cats.map(([cat, count], i) => {
        const x    = PAD.left + i * barW;
        const barH = (count / maxCount) * IH;
        const y    = toY(count);
        return (
          <g key={i}>
            <rect x={x + 1.5} y={y} width={barW - 3} height={barH}
              fill="var(--jet)" opacity="0.78" rx="2" />
            <text x={x + barW / 2} y={y - 5}
              textAnchor="middle" className="dyn-axis-label dyn-bar-count">
              {count}
            </text>
            <text x={x + barW / 2} y={PAD.top + IH + 14}
              textAnchor="middle" className="dyn-axis-label"
              style={{ fontSize: Math.max(7, Math.min(10, 90 / cats.length)) }}>
              {cat.length > 9 ? cat.slice(0, 8) + "…" : cat}
            </text>
          </g>
        );
      })}

      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
      <line x1={PAD.left} y1={PAD.top + IH} x2={PAD.left + IW} y2={PAD.top + IH}
        stroke="#b0ccc8" strokeWidth="1.5" />
    </svg>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export function DynamicChart({ data, chartType }) {
  if (!data || data.length === 0) {
    return <div className="dyn-chart-empty">No data yet.</div>;
  }

  const entries = data.map(d => ({
    ts:  new Date(d.updatedAt).getTime(),
    raw: d.value,
    num: parseNum(d.value),
  })).filter(e => !isNaN(e.ts));

  const numericEntries = entries.filter(e => !isNaN(e.num));
  const isNumeric      = numericEntries.length >= 2;

  if (chartType === "line") {
    if (!isNumeric) {
      return (
        <div className="dyn-chart-empty">
          Line chart requires numeric values. Switch to Histogram.
        </div>
      );
    }
    const sorted = [...numericEntries].sort((a, b) => a.ts - b.ts);
    return (
      <>
        <LineChart points={sorted} />
        <Summary nums={sorted.map(p => p.num)} count={data.length} />
      </>
    );
  }

  if (chartType === "histogram") {
    if (isNumeric) {
      const nums = numericEntries.map(e => e.num);
      return (
        <>
          <NumericHistogram nums={nums} />
          <Summary nums={nums} count={data.length} />
        </>
      );
    }
    return (
      <>
        <CategoryHistogram entries={entries} />
        <div className="dyn-summary">
          <span><span className="dyn-summary-label">Points</span> {data.length}</span>
        </div>
      </>
    );
  }

  return null;
}
