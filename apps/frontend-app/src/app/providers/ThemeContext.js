// ============================================================
// THEME SYSTEM
// Only two themes: dark (default) and light (inverted)
// Public passport surfaces now use the shared navy palette
// ============================================================

const sharedDark = {
  "--onyx": "#07111f",
  "--jet": "#10243a",
  "--charcoal": "#27435e",
  "--mint": "#eef6ff",
  "--steel": "#89a5bf",
  "--white": "#ffffff",
  "--accent": "#0db5b0",
  "--accent-strong": "#06d6d0",
  "--highlight": "#dce8f0",
  "--gold": "#f0a500",
  "--success": "#10b981",
  "--warning": "#f0a500",
  "--danger": "#ef4444",
  "--bg-primary": "#0b1826",
  "--bg-secondary": "#102238",
  "--bg-tertiary": "#132840",
  "--bg-card": "#132840",
  "--text-primary": "#f0f6fa",
  "--text-secondary": "#b8ccd9",
  "--border": "rgba(184,204,217,0.18)",
  "--font": "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const sharedLight = {
  "--onyx": "#0b1826",
  "--jet": "#17304a",
  "--charcoal": "#36526c",
  "--mint": "#0b1826",
  "--steel": "#5f7991",
  "--white": "#ffffff",
  "--accent": "#0db5b0",
  "--accent-strong": "#0891b2",
  "--highlight": "#dce8f0",
  "--gold": "#c98300",
  "--success": "#0f9a6b",
  "--warning": "#c98300",
  "--danger": "#dc2626",
  "--bg-primary": "#f0f6fa",
  "--bg-secondary": "#dfeaf4",
  "--bg-tertiary": "#ffffff",
  "--bg-card": "#ffffff",
  "--text-primary": "#0b1826",
  "--text-secondary": "#456177",
  "--border": "rgba(23,48,74,0.12)",
  "--font": "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const themes = {
  dark: {
    name: "Dark",
    emoji: "🌙",
    ...sharedDark,
  },
  light: {
    name: "Light",
    emoji: "☀️",
    ...sharedLight,
  },
};

export const passportViewerTheme = {
  primary: "#132840",
  secondary: "#17304a",
  accent: "#eef6ff",
  highlight: "#dce8f0",
  bg: "#f0f6fa",
  text: "#0b1826",
  badge: "#dce8f0",
};

export const defaultCompanyBranding = {
  primaryColor: "#0db5b0",
  secondaryColor: "#132840",
  accentColor: "#dce8f0",
  backgroundGradient: "linear-gradient(135deg, #0b1826 0%, #132840 52%, #17304a 100%)",
  viewerVariant: "classic",
  consumerVariant: "classic",
  publicPageTitle: "",
  publicTagline: "",
  companyWebsite: "",
  footerText: "",
  supportLink: "",
};

export function normalizeCompanyBranding(branding) {
  const src = branding && typeof branding === "object" ? branding : {};
  return { ...defaultCompanyBranding, ...src };
}

export function getViewerBrandTheme(branding) {
  const b = normalizeCompanyBranding(branding);
  return {
    variant: b.viewerVariant,
    title: b.publicPageTitle,
    companyWebsite: b.companyWebsite,
    footerText: b.footerText,
    supportLink: b.supportLink,
    style: {
      "--brand-primary": b.primaryColor,
      "--brand-secondary": b.secondaryColor,
      "--brand-accent": b.accentColor,
      "--brand-gradient": b.backgroundGradient,
    },
  };
}

export function applyTheme(themeKey) {
  const theme = themes[themeKey] || themes.dark;
  const root = document.documentElement;

  Object.entries(theme).forEach(([key, val]) => {
    if (key.startsWith("--")) root.style.setProperty(key, val);
  });

  root.setAttribute("data-theme", themeKey);
}

export function getStoredTheme(userId) {
  return localStorage.getItem(`dppTheme:${userId}`) || "dark";
}
