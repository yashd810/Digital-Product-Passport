function hexToRgb(hex) {
  const normalized = String(hex || "").replace("#", "").trim();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function luminanceChannel(channel) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const fgLum = (0.2126 * luminanceChannel(fg.r)) + (0.7152 * luminanceChannel(fg.g)) + (0.0722 * luminanceChannel(fg.b));
  const bgLum = (0.2126 * luminanceChannel(bg.r)) + (0.7152 * luminanceChannel(bg.g)) + (0.0722 * luminanceChannel(bg.b));
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

const checks = [
  { label: "Viewer body text", foreground: "#10243a", background: "#ffffff", minimum: 4.5 },
  { label: "Trusted entry secondary text", foreground: "#3f596d", background: "#ffffff", minimum: 4.5 },
  { label: "Trusted entry success text", foreground: "#17653c", background: "#ffffff", minimum: 4.5 },
  { label: "Trusted entry error text", foreground: "#8b1e1e", background: "#ffffff", minimum: 4.5 },
  { label: "Viewer footer text", foreground: "#dce8f0", background: "#0b1826", minimum: 4.5 },
  { label: "Light theme domain indicator text", foreground: "#17304a", background: "#dce8f0", minimum: 4.5 },
];

const failures = [];
for (const check of checks) {
  const ratio = contrastRatio(check.foreground, check.background);
  const rounded = Number(ratio.toFixed(2));
  if (ratio < check.minimum) {
    failures.push(`${check.label}: ${rounded} < ${check.minimum}`);
  } else {
    console.log(`${check.label}: ${rounded}`);
  }
}

if (failures.length) {
  console.error("Contrast check failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Contrast checks passed.");
