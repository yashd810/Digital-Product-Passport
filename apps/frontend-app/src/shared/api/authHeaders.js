export function authHeaders(headers = {}) {
  return { ...headers };
}

/**
 * Fetch wrapper that automatically includes credentials for cookie-based auth.
 * Only redirects to login for protected endpoints when session expires.
 * Avoids infinite redirect loops on login page.
 */
export async function fetchWithAuth(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
  });

  const pathname = window.location.pathname;
  const isLoginPage = pathname.startsWith("/login");
  const urlString = String(url);
  
  // Don't redirect on auth bootstrap requests (login, logout, SSO, user check)
  const isAuthBootstrapRequest =
    urlString.includes("/api/auth/login") ||
    urlString.includes("/api/auth/logout") ||
    urlString.includes("/api/auth/sso/providers") ||
    urlString.includes("/api/auth/sso") ||
    urlString.includes("/api/users/me");

  // Redirect to login only for protected endpoints when already logged in but session expired
  if (
    (response.status === 401 || response.status === 403) &&
    !isLoginPage &&
    !isAuthBootstrapRequest
  ) {
    window.location.replace("/login?session=expired");
  }

  return response;
}
