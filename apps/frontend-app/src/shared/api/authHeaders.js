import { isTrustedApiRequestUrl, toSafeConfiguredHttpOrigin } from "../security/urlSafety";

export function authHeaders(headers = {}) {
  return { ...headers };
}

function isPublicViewerRuntime() {
  const viewerOrigin = toSafeConfiguredHttpOrigin(import.meta.env.VITE_PUBLIC_VIEWER_URL);
  const currentOrigin = globalThis.window?.location?.origin;
  if (!viewerOrigin || !currentOrigin) return false;
  try {
    return new URL(viewerOrigin).origin === new URL(currentOrigin).origin;
  } catch {
    return false;
  }
}

function requestPathname(url) {
  try {
    const baseOrigin = globalThis.window?.location?.origin;
    return new URL(url instanceof URL ? url.toString() : String(url), baseOrigin).pathname;
  } catch {
    return "";
  }
}

function pathIs(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Fetch wrapper that automatically includes credentials for cookie-based auth.
 * Only redirects to login for protected endpoints when session expires.
 * Avoids infinite redirect loops on login page.
 */
export async function fetchWithAuth(url, options = {}) {
  const skipAuthRedirect = options.skipAuthRedirect === true;
  const fetchOptions = { ...options };
  delete fetchOptions.skipAuthRedirect;
  delete fetchOptions.credentials;
  delete fetchOptions.redirect;
  if (!isTrustedApiRequestUrl(url)) {
    throw new TypeError("Refusing to send an authenticated request to an untrusted origin");
  }
  const response = await fetch(url, {
    ...fetchOptions,
    // The dedicated public viewer shares renderer code with the dashboard, but
    // its API reads must not carry a same-site dashboard cookie.
    credentials: isPublicViewerRuntime() ? "omit" : "include",
    // API requests must not follow redirects. This prevents a compromised or
    // misconfigured trusted endpoint from forwarding request bodies or custom
    // headers to another origin.
    redirect: "error",
  });

  const pathname = window.location.pathname;
  const isLoginPage = pathname.startsWith("/login");
  const pathnameForRequest = requestPathname(url);
  const isPublicApiRequest =
    pathIs(pathnameForRequest, "/api/public") ||
    pathIs(pathnameForRequest, "/.well-known") ||
    pathIs(pathnameForRequest, "/did") ||
    pathIs(pathnameForRequest, "/resolve") ||
    pathIs(pathnameForRequest, "/contexts");

  // Don't redirect on auth bootstrap requests (login, logout, SSO, user check)
  const isAuthBootstrapRequest =
    pathIs(pathnameForRequest, "/api/auth/login") ||
    pathIs(pathnameForRequest, "/api/auth/logout") ||
    pathIs(pathnameForRequest, "/api/auth/sso/providers") ||
    pathIs(pathnameForRequest, "/api/auth/sso") ||
    pathIs(pathnameForRequest, "/api/users/me") ||
    pathIs(pathnameForRequest, "/api/users/me/token");

  // Redirect to login only when the server indicates the session is no longer valid.
  // Business-rule 403s should stay on the page and surface their actual error message.
  if (
    response.status === 401
    && !skipAuthRedirect
    && !isPublicApiRequest
    && !isLoginPage
    && !isAuthBootstrapRequest
  ) {
    window.location.replace("/login?session=expired");
  }

  return response;
}
