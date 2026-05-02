export function authHeaders(headers = {}) {
  return { ...headers };
}

/**
 * Fetch wrapper that automatically includes credentials for cookie-based auth
 * and redirects to login when the session expires (401/403).
 */
export async function fetchWithAuth(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include", // Always send cookies
    ...options,
  });

  // Handle authentication errors (but not on login page to prevent infinite loops)
  if ((response.status === 401 || response.status === 403) && !url.includes("/api/auth/")) {
    // Skip auto-logout for public auth endpoints (login, SSO, etc.)
    const isPublicAuthEndpoint = 
      url.includes("/api/auth/login") ||
      url.includes("/api/auth/sso/providers") ||
      url.includes("/api/auth/register");
    
    if (!isPublicAuthEndpoint && window.location.pathname !== "/login") {
      let errorMessage = "";

      try {
        const cloned = response.clone();
        const body = await cloned.json();
        errorMessage = body?.error || "";
      } catch {
        // Ignore non-JSON errors
      }

      // Determine if this is a session expiration vs other auth error
      const sessionExpired =
        response.status === 401 ||
        errorMessage.toLowerCase().includes("expired") ||
        errorMessage.toLowerCase().includes("invalid");

      if (sessionExpired) {
        console.warn("[Auth] Session expired, logging out...", errorMessage);
        
        try {
          // Call logout endpoint to clear server-side session
          await fetch(`${import.meta.env.VITE_API_URL}/api/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
        } catch (e) {
          console.warn("[Auth] Logout request failed:", e.message);
        }

        // Redirect to login page
        window.location.href = "/login?session=expired";
      }
    }
  }

  return response;
}
