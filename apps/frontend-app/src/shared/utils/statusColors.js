// Canonical status colors — single source of truth for all JS charts and visualizations.
// These match the CSS variables defined in src/app/styles/index.css.
// Always import from here instead of hardcoding hex values.

export const statusColors = {
  draft:       "#fb923c",  // orange  — var(--status-draft-text)
  review:      "#f472b6",  // pink    — var(--status-review-text)
  released:    "#34d399",  // green   — var(--status-released-text)
  revised:     "#67d4ff",  // blue    — var(--status-revised-text)
  inRevision: "#67d4ff",  // blue    — alias for revised
  obsolete:    "#9ca3af",  // grey    — var(--status-obsolete-text)
  archived:    "#c4855c",  // brown   — var(--status-archived-text)
};

// Light-mode variants for PDF exports (printed on white backgrounds)
export const statusColorsLight = {
  draft:       "#c2440e",
  review:      "#be185d",
  released:    "#0f8a63",
  revised:     "#0f7496",
  inRevision: "#0f7496",
  obsolete:    "#6b7280",
  archived:    "#7c3a10",
};
