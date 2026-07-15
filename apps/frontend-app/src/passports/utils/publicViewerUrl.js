import { toSafeHttpOrigin, toSafeInternalPath } from "../../shared/security/urlSafety";

export function normalizePublicViewerOrigin(value) {
  const rawValue = String(value ?? "");
  if (!rawValue || rawValue.trim() !== rawValue) return null;
  return toSafeHttpOrigin(rawValue);
}

export function getPublicViewerOrigin() {
  const configured = normalizePublicViewerOrigin(import.meta.env.VITE_PUBLIC_VIEWER_URL);
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return normalizePublicViewerOrigin(window.location?.origin) || "";
  }
  return "";
}

export function buildPublicViewerUrl(path) {
  const origin = getPublicViewerOrigin();
  const safePath = toSafeInternalPath(path, { allowedPrefixes: ["/dpp"] });
  if (!origin || !safePath) return null;
  return `${origin}${safePath}`;
}
