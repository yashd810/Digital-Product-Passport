// ============================================================
// THEME SYSTEM
// Only two themes: dark (default) and light (inverted)
// Public passport surfaces now use the shared navy palette
// ============================================================

const SHARED_DARK = {
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

const SHARED_LIGHT = {
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

export const THEMES = {
  dark: {
    name: "Dark",
    emoji: "🌙",
    ...SHARED_DARK,
  },
  light: {
    name: "Light",
    emoji: "☀️",
    ...SHARED_LIGHT,
  },
};

export const PASSPORT_VIEWER_THEME = {
  primary: "#132840",
  secondary: "#17304a",
  accent: "#eef6ff",
  highlight: "#dce8f0",
  bg: "#f0f6fa",
  text: "#0b1826",
  badge: "#dce8f0",
};

export const DEFAULT_COMPANY_BRANDING = {
  primary_color: "#0db5b0",
  secondary_color: "#132840",
  accent_color: "#dce8f0",
  background_gradient: "linear-gradient(135deg, #0b1826 0%, #132840 52%, #17304a 100%)",
  viewer_variant: "classic",
  consumer_variant: "classic",
  public_page_title: "",
  public_tagline: "",
  company_website: "",
  footer_text: "",
  support_link: "",
};

const CONSUMER_BASE = {
  gradient: "linear-gradient(135deg, #0b1826 0%, #132840 52%, #17304a 100%)",
  cardBg: "rgba(220,232,240,0.2)",
  accentColor: "#0db5b0",
};

export const CONSUMER_PAGE_THEMES = {
  battery: {
    ...CONSUMER_BASE,
    icon: "⚡",
    headline: "Battery Product Passport",
    tagline: "Compliance-ready battery data from carbon footprint to circularity.",
    heroPattern: "battery",
  },
  textile: {
    ...CONSUMER_BASE,
    icon: "🧵",
    headline: "Textile Product Passport",
    tagline: "Trace fibres, care data, and recyclability in one verified passport.",
    heroPattern: "textile",
  },
  steel: {
    ...CONSUMER_BASE,
    icon: "🏗️",
    headline: "Construction Product Passport",
    tagline: "Structured performance, safety, and sustainability data for the built environment.",
    heroPattern: "steel",
  },
  toys: {
    ...CONSUMER_BASE,
    icon: "🧸",
    headline: "Toy Product Passport",
    tagline: "Safety, materials, and product transparency presented in a trusted public view.",
    heroPattern: "toys",
  },
  construction: {
    ...CONSUMER_BASE,
    icon: "🏢",
    headline: "Construction Product Passport",
    tagline: "Performance and circularity documentation in a regulator-ready format.",
    heroPattern: "construction",
  },
};

export function normalizeCompanyBranding(branding) {
  const src = branding && typeof branding === "object" ? branding : {};
  return { ...DEFAULT_COMPANY_BRANDING, ...src };
}

export function getViewerBrandTheme(branding) {
  const b = normalizeCompanyBranding(branding);
  return {
    variant: b.viewer_variant,
    title: b.public_page_title,
    companyWebsite: b.company_website,
    footerText: b.footer_text,
    supportLink: b.support_link,
    style: {
      "--brand-primary": b.primary_color,
      "--brand-secondary": b.secondary_color,
      "--brand-accent": b.accent_color,
      "--brand-gradient": b.background_gradient,
    },
  };
}

export function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.dark;
  const root = document.documentElement;

  Object.entries(theme).forEach(([key, val]) => {
    if (key.startsWith("--")) root.style.setProperty(key, val);
  });

  root.setAttribute("data-theme", themeKey);
}

export function getStoredTheme(userId) {
  return localStorage.getItem(`dpp_theme_${userId}`) || "dark";
}

export function setStoredTheme(userId, themeKey) {
  localStorage.setItem(`dpp_theme_${userId}`, themeKey);
}

export const getConsumerTheme = (passportType, branding) => {
  const base = CONSUMER_PAGE_THEMES[passportType] || CONSUMER_PAGE_THEMES.battery;
  const b = normalizeCompanyBranding(branding);
  return {
    ...base,
    accentColor: b.primary_color || base.accentColor,
    cardBg: "rgba(220,232,240,0.2)",
    gradient: b.background_gradient || base.gradient,
    headline: b.public_page_title || base.headline,
    tagline: b.public_tagline || base.tagline,
    companyWebsite: b.company_website,
    footerText: b.footer_text,
    supportLink: b.support_link,
    variant: b.consumer_variant,
    secondaryColor: b.secondary_color,
    accentSurface: b.accent_color,
  };
};
