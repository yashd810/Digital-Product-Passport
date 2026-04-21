const LIGHT_REPORT_STYLES = `
  :root {
    --bg: #f4f8fb;
    --panel: #ffffff;
    --panel-alt: #f7fbfd;
    --text: #102c3a;
    --muted: #557185;
    --line: #d8e5ec;
    --accent: #14b8a6;
    --accent-strong: #0f766e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: Inter, "Segoe UI", Arial, sans-serif;
  }
  .report {
    padding: 28px;
  }
  .hero {
    background: linear-gradient(135deg, #e8f6f7 0%, #f6fafc 100%);
    border: 1px solid #d9ebef;
    border-radius: 24px;
    padding: 28px;
    margin-bottom: 24px;
  }
  .eyebrow {
    margin: 0 0 8px;
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0 0 10px;
    font-size: 30px;
    line-height: 1.1;
  }
  .subtitle {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .stat-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 18px 20px;
    break-inside: avoid;
  }
  .stat-label {
    margin: 0 0 10px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .stat-value {
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    line-height: 1;
  }
  .tone-default { color: var(--accent); }
  .tone-draft { color: #9a6500; }
  .tone-review { color: #be185d; }
  .tone-released { color: #0f8a63; }
  .tone-revised { color: #0f7496; }
  .tone-obsolete { color: #6b7280; }
  .tone-archived { color: #7c3a10; }
  .tone-scans { color: #0ea5e9; }
  .section {
    margin-top: 24px;
    break-inside: avoid;
  }
  .section-title {
    margin: 0 0 14px;
    font-size: 22px;
  }
  .chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }
  .chart-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 20px;
    break-inside: avoid;
  }
  .chart-title {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .chart-svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-top: 12px;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    flex: 0 0 auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 20px;
    overflow: hidden;
  }
  thead {
    background: #eef6f8;
  }
  th, td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
    font-size: 13px;
  }
  th {
    color: var(--accent-strong);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  .empty {
    padding: 18px;
    border: 1px dashed var(--line);
    border-radius: 16px;
    color: var(--muted);
    background: var(--panel-alt);
    font-size: 14px;
  }
  @page {
    size: A4 portrait;
    margin: 14mm;
  }
  @media print {
    body { background: #ffffff; }
    .report { padding: 0; }
  }
`;

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const renderLegend = (items = []) => {
  if (!items.length) return "";
  return `
    <div class="legend">
      ${items.map((item) => `
        <div class="legend-item">
          <span class="swatch" style="background:${escapeHtml(item.color)}"></span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join("")}
    </div>
  `;
};

const polarToCartesian = (cx, cy, radius, angle) => {
  const radians = (angle - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
};

export function renderPieChartSvg(items = []) {
  if (!items.length) return "";
  const W = 360;
  const H = 220;
  const cx = 110;
  const cy = 110;
  const radius = 70;
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  let currentAngle = 0;

  const slices = items.map((item) => {
    const angle = (Number(item.value || 0) / total) * 360;
    const start = polarToCartesian(cx, cy, radius, currentAngle);
    const end = polarToCartesian(cx, cy, radius, currentAngle + angle);
    const largeArcFlag = angle > 180 ? 1 : 0;
    const path = [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
      "Z",
    ].join(" ");
    currentAngle += angle;
    return `<path d="${path}" fill="${escapeHtml(item.color)}" stroke="#ffffff" stroke-width="2"></path>`;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${slices}
    </svg>
  `;
}

export function renderBarChartSvg(data = [], { height = 180 } = {}) {
  if (!data.length) return "";
  const gap = 18;
  const barW = 34;
  const leftPad = 18;
  const rightPad = 18;
  const bottomPad = 34;
  const topPad = 18;
  const chartH = height;
  const totalW = Math.max(360, leftPad + rightPad + data.length * (barW + gap));
  const max = Math.max(...data.map((item) => Number(item.value || 0)), 1);
  const svgH = chartH + topPad + bottomPad;

  const bars = data.map((item, index) => {
    const value = Number(item.value || 0);
    const barHeight = Math.max(4, (value / max) * chartH);
    const x = leftPad + index * (barW + gap);
    const y = topPad + chartH - barHeight;
    const label = item.label.length > 10 ? `${item.label.slice(0, 8)}...` : item.label;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${barHeight}" rx="5" fill="${escapeHtml(item.color)}"></rect>
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="#17304a">${escapeHtml(value)}</text>
        <text x="${x + barW / 2}" y="${svgH - 10}" text-anchor="middle" font-size="10" font-weight="600" fill="#557185">${escapeHtml(label)}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${bars}
    </svg>
  `;
}

export function renderClusteredBarChartSvg(data = [], series = [], { height = 200 } = {}) {
  if (!data.length || !series.length) return "";
  const leftPad = 24;
  const rightPad = 18;
  const topPad = 18;
  const bottomPad = 38;
  const groupGap = 18;
  const barGap = 4;
  const groupWidth = 54;
  const totalW = Math.max(420, leftPad + rightPad + data.length * groupWidth + Math.max(0, data.length - 1) * groupGap);
  const totalH = height + topPad + bottomPad;
  const max = Math.max(...data.flatMap((row) => series.map((item) => Number(row[item.key] || 0))), 1);
  const barWidth = (groupWidth - barGap * (series.length - 1)) / series.length;

  const groups = data.map((row, groupIndex) => {
    const groupX = leftPad + groupIndex * (groupWidth + groupGap);
    const label = row.label.length > 10 ? `${row.label.slice(0, 8)}...` : row.label;
    const bars = series.map((item, seriesIndex) => {
      const value = Number(row[item.key] || 0);
      const barHeight = Math.max(4, (value / max) * height);
      const x = groupX + seriesIndex * (barWidth + barGap);
      const y = topPad + height - barHeight;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${escapeHtml(item.color)}"></rect>
          <text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-size="9" font-weight="700" fill="#17304a">${escapeHtml(value)}</text>
        </g>
      `;
    }).join("");
    return `
      <g>
        ${bars}
        <text x="${groupX + groupWidth / 2}" y="${totalH - 10}" text-anchor="middle" font-size="10" font-weight="600" fill="#557185">${escapeHtml(label)}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${groups}
    </svg>
  `;
}

export function renderLineChartSvg(labels = [], series = [], { width = 420, height = 220 } = {}) {
  if (!labels.length || !series.length) return "";
  const leftPad = 36;
  const rightPad = 16;
  const topPad = 16;
  const bottomPad = 34;
  const innerW = width - leftPad - rightPad;
  const innerH = height - topPad - bottomPad;
  const allValues = series.flatMap((item) => item.values || []);
  const rawMax = Math.max(...allValues, 1);
  const ticks = 4;
  const step = Math.ceil(rawMax / ticks);
  const niceMax = Math.max(step * ticks, 1);
  const getX = (index) => labels.length === 1
    ? leftPad + innerW / 2
    : leftPad + (index / (labels.length - 1)) * innerW;
  const getY = (value) => topPad + innerH - (Number(value || 0) / niceMax) * innerH;

  const grid = Array.from({ length: ticks + 1 }, (_, index) => {
    const value = step * index;
    const y = getY(value);
    return `
      <g>
        <line x1="${leftPad}" y1="${y}" x2="${width - rightPad}" y2="${y}" stroke="#d8e5ec" stroke-width="1"></line>
        <text x="${leftPad - 6}" y="${y + 4}" text-anchor="end" font-size="9" font-weight="600" fill="#557185">${escapeHtml(value)}</text>
      </g>
    `;
  }).join("");

  const labelNodes = labels.map((label, index) => `
    <text x="${getX(index)}" y="${height - 10}" text-anchor="middle" font-size="9" font-weight="600" fill="#557185">${escapeHtml(label)}</text>
  `).join("");

  const lines = series.map((item) => {
    const points = (item.values || []).map((value, index) => `${getX(index)},${getY(value)}`).join(" ");
    const dots = (item.values || []).map((value, index) => `
      <circle cx="${getX(index)}" cy="${getY(value)}" r="3.5" fill="${escapeHtml(item.color)}" stroke="#ffffff" stroke-width="1.2"></circle>
    `).join("");
    return `
      <g>
        <polyline points="${points}" fill="none" stroke="${escapeHtml(item.color)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${dots}
      </g>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${grid}
      ${labelNodes}
      ${lines}
    </svg>
  `;
}

export function openAnalyticsPrintReport({
  title,
  subtitle,
  filename,
  stats = [],
  chartCards = [],
  sections = [],
}) {
  const win = window.open("", "_blank", "width=1240,height=860");
  if (!win) throw new Error("Popup blocked");

  const statsHtml = stats.length ? `
    <div class="stats-grid">
      ${stats.map((item) => `
        <div class="stat-card">
          <div class="stat-label">${escapeHtml(item.label)}</div>
          <div class="stat-value tone-${escapeHtml(item.tone || "default")}">${escapeHtml(item.value)}</div>
        </div>
      `).join("")}
    </div>
  ` : "";

  const chartCardsHtml = chartCards.length ? `
    <div class="section">
      <div class="chart-grid">
        ${chartCards.map((card) => `
          <div class="chart-card">
            <div class="chart-title">${escapeHtml(card.title)}</div>
            ${card.svg || `<div class="empty">${escapeHtml(card.emptyText || "No chart data yet")}</div>`}
            ${renderLegend(card.legendItems)}
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  const sectionsHtml = sections.map((section) => `
    <div class="section">
      <h2 class="section-title">${escapeHtml(section.title)}</h2>
      ${section.rows?.length ? `
        <table>
          <thead>
            <tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">${escapeHtml(section.emptyText || "No data yet")}</div>`}
    </div>
  `).join("");

  win.document.write(`<!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta charset="utf-8" />
        <style>${LIGHT_REPORT_STYLES}</style>
      </head>
      <body>
        <div class="report">
          <div class="hero">
            <div class="eyebrow">Digital Product Passport</div>
            <h1>${escapeHtml(title)}</h1>
            <p class="subtitle">${escapeHtml(subtitle || "")}</p>
          </div>
          ${statsHtml}
          ${chartCardsHtml}
          ${sectionsHtml}
        </div>
        <script>
          window.addEventListener("load", () => {
            document.title = ${JSON.stringify(filename || title)};
            setTimeout(() => window.print(), 350);
          });
        </script>
      </body>
    </html>`);
  win.document.close();
  win.focus();
}
