function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/g, "");
}

export function getPublicViewerOrigin() {
  const configured = trimTrailingSlash(import.meta.env.VITE_PUBLIC_VIEWER_URL || "");
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:3000";
}

export function buildPublicViewerUrl(path) {
  if (!path) return null;
  return `${getPublicViewerOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
