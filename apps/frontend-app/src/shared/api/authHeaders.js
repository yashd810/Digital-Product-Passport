export function authHeaders(headers = {}) {
  return { ...headers };
}

/**
 * Fetch wrapper that automatically includes credentials for cookie-based auth
 */
export function fetchWithAuth(url, options = {}) {
  return fetch(url, {
    credentials: "include", // Always send cookies
    ...options,
  });
}
