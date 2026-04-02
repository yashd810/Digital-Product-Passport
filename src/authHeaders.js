export function authHeaders(headers = {}) {
  return {
    ...headers,
    Authorization: "Bearer cookie-session",
  };
}
