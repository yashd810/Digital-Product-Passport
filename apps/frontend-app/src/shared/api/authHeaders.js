export function authHeaders(headers = {}) {
  return { ...headers };
}

/**
 * Fetch wrapper that automatically includes credentials for cookie-based auth.
 * Only redirects to login for protected endpoints when session expires.
 * Avoids infinite redirect loops on login page.
 */
export async function fetchWithAuth(url, options = {}) {
  const {
    skipAuthRedirect = false,
    ...fetchOptions
  } = options;
  const response = await fetch(url, {
    credentials: "include",
    ...fetchOptions,
  });

  const pathname = window.location.pathname;
  const isLoginPage = pathname.startsWith("/login");
  const urlString = String(url);
  const isPublicApiRequest =
    urlString.includes("/api/public/") ||
    urlString.includes("/.well-known/") ||
    urlString.includes("/did/") ||
    urlString.includes("/resolve") ||
    urlString.includes("/contexts/");

  // Don't redirect on auth bootstrap requests (login, logout, SSO, user check)
  const isAuthBootstrapRequest =
    urlString.includes("/api/auth/login") ||
    urlString.includes("/api/auth/logout") ||
    urlString.includes("/api/auth/sso/providers") ||
    urlString.includes("/api/auth/sso") ||
    urlString.includes("/api/users/me") ||
    urlString.includes("/api/users/me/token");

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
