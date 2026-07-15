const httpProtocols = new Set(["http:", "https:"]);
const identifierProtocols = new Set(["did:", "urn:"]);
const vettedResourceRoots = ["/public-files", "/repository-files", "/storage"];
const unsafeUrlCharacters = /[\u0000-\u001F\u007F\s\\]/;
const relativeBaseOrigin = "https://relative-path.invalid";
const maxInlineRasterImageBytes = 5 * 1024 * 1024;
const maxPathDecodePasses = 8;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isPrivateOrReservedIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => part > 255)) return false;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 88 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

function isLocalOrPrivateLiteralHostname(value) {
  const hostname = normalizeHostname(value);
  if (!hostname) return true;
  if (
    hostname === "localhost"
    || hostname === "localhost.localdomain"
    || hostname === "ip6-localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
  ) {
    return true;
  }
  if (isPrivateOrReservedIpv4(hostname)) return true;

  // Hostname labels do not contain colons. Direct IPv6 literals are not
  // needed for browser-rendered passport assets, and rejecting them avoids
  // local/link-local/reserved IPv6 bypasses without DNS lookups.
  return hostname.includes(":");
}

function parseAbsoluteHttpUrl(value) {
  const text = normalizeText(value);
  if (!text || unsafeUrlCharacters.test(text)) return null;

  try {
    const parsed = new URL(text);
    if (
      !httpProtocols.has(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || isLocalOrPrivateLiteralHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// The browser's own origin is a safe request destination even when it is a
// loopback address during local development. Keep that exception separate from
// external links, which must never turn passport data into an internal-network
// request.
function parseBrowserOrigin(value) {
  const text = normalizeText(value);
  if (!text || unsafeUrlCharacters.test(text)) return null;

  try {
    const parsed = new URL(text);
    if (
      !httpProtocols.has(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || (parsed.pathname && parsed.pathname !== "/")
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasUnsafePathTraversal(pathname) {
  let decoded = pathname;
  for (let index = 0; index < maxPathDecodePasses; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded.split("/").some((segment) => segment === "." || segment === "..")
          || /[\u0000-\u001F\u007F\\]/.test(decoded);
      }
      decoded = next;
    } catch {
      return true;
    }
  }

  return true;
}

function parseSafeRelativePath(value) {
  const text = normalizeText(value);
  if (
    !text
    || unsafeUrlCharacters.test(text)
    || !text.startsWith("/")
    || text.startsWith("//")
  ) {
    return null;
  }

  try {
    const parsed = new URL(text, relativeBaseOrigin);
    if (parsed.origin !== relativeBaseOrigin || hasUnsafePathTraversal(parsed.pathname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pathFromParsedUrl(parsed) {
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function currentOrigin() {
  const candidate = globalThis.window?.location?.origin;
  const parsed = parseBrowserOrigin(candidate);
  return parsed?.origin || null;
}

function configuredApiOrigin() {
  const configured = normalizeText(import.meta.env.VITE_API_URL);
  const parsed = parseAbsoluteHttpUrl(configured);
  return parsed?.origin || null;
}

export function toSafeExternalHref(value) {
  return parseAbsoluteHttpUrl(value)?.toString() || null;
}

export function toSafeHttpOrigin(value) {
  const parsed = parseAbsoluteHttpUrl(value);
  if (!parsed || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

export function toSafeNonNavigableIdentifier(value) {
  const text = normalizeText(value);
  if (!text || unsafeUrlCharacters.test(text)) return null;
  const schemeMatch = text.match(/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/);
  if (!schemeMatch) return null;
  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (!identifierProtocols.has(protocol) || !schemeMatch[2] || schemeMatch[2].startsWith("//")) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== protocol || parsed.username || parsed.password || parsed.host) return null;
  } catch {
    return null;
  }
  if (protocol === "did:" && !/^did:[a-z0-9]+:[^\s]+$/i.test(text)) return null;
  if (protocol === "urn:" && !/^urn:[a-z0-9][a-z0-9-]{1,31}:[^\s]+$/i.test(text)) return null;
  return text;
}

export function isSafeIdentifierUri(value) {
  return Boolean(toSafeExternalHref(value) || toSafeNonNavigableIdentifier(value));
}

export function toSafeResourceHref(value) {
  const external = toSafeExternalHref(value);
  if (external) return external;

  const relative = parseSafeRelativePath(value);
  if (!relative) return null;
  const hasVettedRoot = vettedResourceRoots.some((root) =>
    relative.pathname === root || relative.pathname.startsWith(`${root}/`)
  );
  return hasVettedRoot ? pathFromParsedUrl(relative) : null;
}

export function toSafeRasterImageDataUrl(value, { maxBytes = maxInlineRasterImageBytes } = {}) {
  const text = normalizeText(value);
  if (!text || unsafeUrlCharacters.test(text)) return null;
  const match = text.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[2].length % 4 !== 0) return null;
  const paddingBytes = match[2].endsWith("==") ? 2 : (match[2].endsWith("=") ? 1 : 0);
  const byteLength = (match[2].length / 4) * 3 - paddingBytes;
  return Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= maxBytes ? text : null;
}

export function toSafeImageSrc(value, { allowInlineRaster = true } = {}) {
  const resource = toSafeResourceHref(value);
  if (resource) return resource;
  return allowInlineRaster ? toSafeRasterImageDataUrl(value) : null;
}

export function toSafeInternalPath(value, { allowedPrefixes = [] } = {}) {
  const relative = parseSafeRelativePath(value);
  if (!relative) return null;
  if (allowedPrefixes.length && !allowedPrefixes.some((prefix) =>
    relative.pathname === prefix || relative.pathname.startsWith(`${prefix}/`)
  )) {
    return null;
  }
  return pathFromParsedUrl(relative);
}

export function toSafeHttpOrInternalHref(value) {
  return toSafeExternalHref(value) || toSafeInternalPath(value);
}

export function isTrustedApiRequestUrl(value) {
  const text = value instanceof URL ? value.toString() : normalizeText(value);
  if (!text || unsafeUrlCharacters.test(text)) return false;

  const sameOrigin = currentOrigin();
  const apiOrigin = configuredApiOrigin();
  const baseOrigin = sameOrigin || apiOrigin;
  if (!baseOrigin) return false;

  let parsed;
  try {
    parsed = new URL(text, baseOrigin);
  } catch {
    return false;
  }
  if (
    !httpProtocols.has(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    return false;
  }

  return [sameOrigin, apiOrigin].filter(Boolean).includes(parsed.origin);
}

export function safeWindowOpen(value, options = {}) {
  const href = options.resource === true ? toSafeResourceHref(value) : toSafeExternalHref(value);
  if (!href || typeof globalThis.window?.open !== "function") return null;
  return globalThis.window.open(href, options.target || "_blank", options.features || "noopener,noreferrer");
}

export const vettedResourcePathRoots = Object.freeze([...vettedResourceRoots]);
