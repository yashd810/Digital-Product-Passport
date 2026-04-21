import React from "react";
import "../styles/PassportViewer.css";

// Color palette that complements the app's dark-green brand
const COLORS = [
  "#1C3738", // jet
  "#2E86AB", // cerulean
  "#F59E0B", // amber
  "#10B981", // emerald
  "#8B5CF6", // violet
  "#EF4444", // red
  "#F97316", // orange
  "#3B82F6", // blue
  "#EC4899", // pink
  "#14B8A6", // teal
  "#84CC16", // lime
  "#64748B", // slate
];

// ── Parsing helpers ───────────────────────────────────────────────────────────

function extractPct(s) {
  const m = String(s || "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/**
 * Parse a table JSON value (stored as "[["Material","60%"],...]") into
 * composition items. First column = label, second column = percentage.
 */
export function parseCompositionFromTable(jsonStr) {
  let rows;
  try { rows = JSON.parse(jsonStr); } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Auto-detect which column holds percentages by finding the one where
  // most cells contain a number (supports "80%", "80", "0.8" formats)
  const numCols = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)));
  if (numCols < 2) return null;

  let pctCol = -1;
  let bestScore = 0;
  for (let ci = 0; ci < numCols; ci++) {
    const hits = rows.filter(r => extractPct(r?.[ci]) > 0).length;
    if (hits > bestScore) { bestScore = hits; pctCol = ci; }
  }
  if (pctCol < 0 || bestScore < 2) return null;

  // Label column: first column that isn't the pct column
  const labelCol = pctCol === 0 ? 1 : 0;

  const items = rows
    .map(row => ({
      label: String(row?.[labelCol] ?? "").trim(),
      value: extractPct(row?.[pctCol]),
    }))
    .filter(item => item.label && item.value > 0);

  return items.length >= 2 ? items : null;
}

/**
 * Parse a free-text value into composition items.
 * Supports formats like:
 *   "Steel: 60%, Aluminium: 25%, Plastic 15%"
 *   "Steel (60%)\nAluminium (25%)"
 *   "60% Steel, 25% Aluminium"
 */
export function parseCompositionFromText(text) {
  if (!text) return null;
  const items = [];

  // Pattern 1: "Label: 60%" or "Label (60%)"
  const re1 = /([A-Za-z][A-Za-z0-9 \-\/\.]{0,40}?)\s*[:\(]\s*(\d+(?:\.\d+)?)\s*%/g;
  let m;
  while ((m = re1.exec(text)) !== null) {
    items.push({ label: m[1].trim(), value: parseFloat(m[2]) });
  }
  if (items.length >= 2) return items;
  items.length = 0;

  // Pattern 2: segment by comma/newline/semicolon then try each piece
  const segments = text.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    // "Label 60%"
    const a = seg.match(/^([A-Za-z][A-Za-z0-9 \-\/\.]*?)\s+(\d+(?:\.\d+)?)\s*%/);
    // "60% Label"
    const b = seg.match(/^(\d+(?:\.\d+)?)\s*%\s+([A-Za-z][A-Za-z0-9 \-\/\.]*)/);
    if (a) items.push({ label: a[1].trim(), value: parseFloat(a[2]) });
    else if (b) items.push({ label: b[2].trim(), value: parseFloat(b[1]) });
  }

  return items.length >= 2 ? items : null;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function polarToXY(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function slicePath(cx, cy, r, startDeg, endDeg) {
  // Guard: almost-full circle needs a tiny gap to render as arc, not a point
  const sweep = endDeg - startDeg;
  const clampedEnd = sweep >= 359.9 ? startDeg + 359.9 : endDeg;
  const p1 = polarToXY(cx, cy, r, startDeg);
  const p2 = polarToXY(cx, cy, r, clampedEnd);
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`;
}

function getTextColorForFill(fill) {
  if (!fill || typeof fill !== "string" || !fill.startsWith("#")) return "#ffffff";
  const hex = fill.slice(1);
  const normalized = hex.length === 3
    ? hex.split("").map(ch => ch + ch).join("")
    : hex;

  if (normalized.length !== 6) return "#ffffff";

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 186 ? "#0b1826" : "#ffffff";
}

function formatDisplayValue(value) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PieChart({ items, title, displayMode = "percentage", showTotalNote = true }) {
  if (!items || items.length === 0) return null;

  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return null;

  // Normalise to percentages and build slice angles
  const cx = 90, cy = 90, r = 82;
  let cursor = 0;
  const slices = items.map((item, i) => {
    const pct      = (item.value / total) * 100;
    const startDeg = cursor;
    cursor += (pct / 100) * 360;
    const midDeg   = startDeg + (cursor - startDeg) / 2;
    const labelPt  = polarToXY(cx, cy, r * 0.62, midDeg);
    return {
      key:      i,
      label:    item.label,
      pct,
      startDeg,
      endDeg:   cursor,
      midDeg,
      labelPt,
      color:    item.color || COLORS[i % COLORS.length],
      value:    item.value,
    };
  });

  return (
    <div className="pie-container">
      {title && <div className="pie-title">{title}</div>}
    <div className="pie-wrap">
      {/* SVG disc */}
      <div className="pie-disc-col">
        <svg viewBox="0 0 180 180" className="pie-svg">
          {slices.map(s => (
            <path
              key={s.key}
              className="pie-slice"
              d={slicePath(cx, cy, r, s.startDeg, s.endDeg)}
              fill={s.color}
              strokeWidth="1.5"
            >
              <title>
                {s.label}: {displayMode === "value" ? formatDisplayValue(s.value) : `${s.pct.toFixed(1)}%`}
              </title>
            </path>
          ))}
          {/* Labels for slices large enough to fit text */}
          {slices.filter(s => s.pct >= 7).map(s => (
            <text
              key={s.key}
              x={s.labelPt.x}
              y={s.labelPt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="pie-slice-label"
              fill={getTextColorForFill(s.color)}
            >
              {displayMode === "value"
                ? formatDisplayValue(s.value)
                : `${s.pct.toFixed(s.pct < 10 ? 1 : 0)}%`}
            </text>
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="pie-legend">
        {slices.map(s => (
          <div key={s.key} className="pie-legend-row">
            <span className="pie-legend-dot" style={{ background: s.color }} />
            <span className="pie-legend-name">{s.label}</span>
            <span className="pie-legend-pct">
              {displayMode === "value" ? formatDisplayValue(s.value) : `${s.pct.toFixed(1)}%`}
            </span>
          </div>
        ))}
        {showTotalNote && Math.abs(total - 100) > 0.5 && (
          <div className="pie-legend-note">
            Total declared: {total.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
