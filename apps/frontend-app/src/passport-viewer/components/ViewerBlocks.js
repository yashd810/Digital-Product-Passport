import React, { useEffect, useId, useRef, useState } from "react";

import { normalizePublicViewerOrigin } from "../../passports/utils/publicViewerUrl";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import {
  isTrustedApiRequestUrl,
  safeWindowOpen,
  toSafeImageSrc,
  toSafeResourceHref,
} from "../../shared/security/urlSafety";

function getDomainIndicatorState() {
  if (typeof window === "undefined") {
    return { currentHost: "", expectedHost: "", trusted: true, label: "" };
  }

  const currentHost = window.location.host || "";
  let expectedHost = "";
  try {
    const configuredOrigin = normalizePublicViewerOrigin(import.meta.env.VITE_PUBLIC_VIEWER_URL);
    expectedHost = configuredOrigin ? new URL(configuredOrigin).host : "";
  } catch {
    expectedHost = "";
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const isLocal = localHosts.has(window.location.hostname);
  const trusted = !expectedHost || currentHost === expectedHost || isLocal;
  return {
    currentHost,
    expectedHost,
    trusted,
    label: trusted
      ? (isLocal ? `Local preview · ${currentHost}` : `Verified domain · ${currentHost}`)
      : `Check domain · expected ${expectedHost || "trusted viewer host"}`,
  };
}

export function ViewerDomainIndicator({ compact = false }) {
  const indicator = getDomainIndicatorState();
  if (!indicator.label) return null;

  return (
    <div className={`viewer-domain-indicator viewer-domain-indicator-${indicator.trusted ? "trusted" : "warning"}${compact ? " compact" : ""}`}>
      <span className="viewer-domain-indicator-label">{indicator.label}</span>
      <strong className="viewer-domain-indicator-host">{indicator.currentHost || indicator.expectedHost || "unknown-host"}</strong>
    </div>
  );
}

export function LockedFieldCell({ field }) {
  void field;
  return <span className="locked-field-btn locked-field-static">Restricted</span>;
}

export function LiveBadge({ updatedAt }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const calc = () => {
      if (!updatedAt) return "";
      const secs = Math.floor((Date.now() - new Date(updatedAt)) / 1000);
      if (secs < 60) return "just now";
      if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
      if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
      return `${Math.floor(secs / 86400)}d ago`;
    };
    setLabel(calc());
    const timer = setInterval(() => setLabel(calc()), 30000);
    return () => clearInterval(timer);
  }, [updatedAt]);
  return (
    <span className="live-badge">
      <span className="live-dot" />
      LIVE{label ? ` · ${label}` : ""}
    </span>
  );
}

export function FileCell({ url, label, onRefreshUrl = null }) {
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const previewId = useId();
  const safeInitialUrl = toSafeResourceHref(url);

  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const tryResolveUrl = async () => {
    if (typeof onRefreshUrl !== "function") return safeInitialUrl;
    const nextUrl = await onRefreshUrl(url);
    return toSafeResourceHref(nextUrl || url);
  };

  const handleToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (blobUrl) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let activeUrl = safeInitialUrl;
      if (!activeUrl || !isTrustedApiRequestUrl(activeUrl)) {
        throw new Error("Preview is available only for trusted platform files");
      }
      let response = await fetchWithAuth(activeUrl);
      if (!response.ok && [401, 403, 404, 410].includes(response.status)) {
        activeUrl = await tryResolveUrl();
        if (!activeUrl || !isTrustedApiRequestUrl(activeUrl)) {
          throw new Error("Preview is available only for trusted platform files");
        }
        response = await fetchWithAuth(activeUrl);
      }
      if (!response.ok) throw new Error(`Could not load PDF (${response.status})`);
      setBlobUrl(URL.createObjectURL(await response.blob()));
      setOpen(true);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const activeUrl = await tryResolveUrl();
      if (!safeWindowOpen(activeUrl, { resource: true })) {
        throw new Error("File link is unavailable");
      }
    } catch (caught) {
      setError(caught.message || "Could not open file");
    }
  };

  return (
    <div className="pdf-cell">
      {error && <div className="pdf-err" role="alert">{error}</div>}
      {open && blobUrl && <iframe id={previewId} src={blobUrl} title={label} className="pdf-iframe" />}
      <div className="pdf-cell-actions">
        {safeInitialUrl ? (
          <a href={safeInitialUrl} target="_blank" rel="noopener noreferrer" className="pdf-open-link" onClick={handleOpen}>
            Open
          </a>
        ) : <span className="pdf-err">File link unavailable</span>}
        <button
          type="button"
          className="pdf-preview-btn"
          onClick={handleToggle}
          disabled={loading}
          aria-expanded={open}
          aria-controls={previewId}
        >
          {loading ? "Loading…" : open ? "Hide preview" : "Show preview"}
        </button>
      </div>
    </div>
  );
}

export function RefreshableImage({ src, alt, className = "", onRefreshUrl = null }) {
  const [activeSrc, setActiveSrc] = useState(() => toSafeImageSrc(src));
  const [refreshing, setRefreshing] = useState(false);
  const attemptedSourcesRef = useRef(new Set());

  useEffect(() => {
    setActiveSrc(toSafeImageSrc(src));
    setRefreshing(false);
    attemptedSourcesRef.current = new Set();
  }, [src]);

  const handleError = async () => {
    const failedSrc = activeSrc || src;
    if (
      refreshing
      || typeof onRefreshUrl !== "function"
      || !src
      || !failedSrc
      || attemptedSourcesRef.current.has(failedSrc)
    ) return;
    attemptedSourcesRef.current.add(failedSrc);
    setRefreshing(true);
    try {
      const safeNextSrc = toSafeImageSrc(await onRefreshUrl(src));
      if (safeNextSrc && safeNextSrc !== failedSrc) setActiveSrc(safeNextSrc);
    } finally {
      setRefreshing(false);
    }
  };

  return activeSrc ? <img src={activeSrc} alt={alt} className={className} onError={handleError} /> : null;
}
