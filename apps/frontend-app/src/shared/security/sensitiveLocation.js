/** Remove a one-time secret from the current fragment without adding history. */
export function clearSensitiveHashParameter(
  parameterName,
  { location = globalThis.location, history = globalThis.history } = {}
) {
  const name = String(parameterName || "").trim();
  const hash = String(location?.hash || "").replace(/^#/, "");
  if (!name || !hash || typeof history?.replaceState !== "function") return false;

  const parameters = new URLSearchParams(hash);
  if (!parameters.has(name)) return false;
  parameters.delete(name);

  const nextHash = parameters.toString();
  const nextUrl = `${location?.pathname || "/"}${location?.search || ""}${nextHash ? `#${nextHash}` : ""}`;
  history.replaceState(history.state ?? null, "", nextUrl);
  return true;
}
