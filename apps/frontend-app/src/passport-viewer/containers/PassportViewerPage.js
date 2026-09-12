import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { readLocalStorage } from "../../shared/utils/browserStorage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { generateQRCodeBundle, saveQRCodeToDatabase } from "../utils/QRcode";
import { getViewerBrandTheme } from "../../app/providers/ThemeContext";
import { isObsoletePassportStatus, isReleasedPassportStatus } from "../../passports/utils/passportStatus";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import {
  buildInactivePassportPath,
  buildInactiveTechnicalPassportPath,
  buildPreviewPassportPath,
  buildPreviewTechnicalPassportPath,
  buildPublicPassportPath,
  buildTechnicalPassportPath,
} from "../../passports/utils/passportRoutes";
import PublicPassportPortal from "../components/PublicPassportPortal";
import "../styles/PassportViewer.css";

const api = import.meta.env.VITE_API_URL || "";

function buildRestrictedPassportFromPublicResponse(response, passport) {
  const fieldKeys = Array.isArray(response?.restrictedAccess?.fieldKeys)
    ? response.restrictedAccess.fieldKeys
    : [];
  if (!fieldKeys.length) return null;

  const restrictedPassport = {
    dppId: response?.dppId || passport?.dppId || null,
    passportType: response?.passportType || passport?.passportType || null,
    versionNumber: response?.versionNumber ?? passport?.versionNumber ?? null,
  };
  for (const fieldKey of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(response?.fields || {}, fieldKey)) {
      restrictedPassport[fieldKey] = response.fields[fieldKey];
    } else if (Object.prototype.hasOwnProperty.call(response || {}, fieldKey)) {
      restrictedPassport[fieldKey] = response[fieldKey];
    }
  }
  return restrictedPassport;
}

function PassportViewer({ previewMode = false, previewCompanyId = null }) {
  const { dppId, versionNumber, previewId } = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();

  // Viewer state
  const [lang]             = useState(() => readLocalStorage("dppLang") || "en");
  const [passport,         setPassport]         = useState(null);
  const [loadedPassportEndpoint, setLoadedPassportEndpoint] = useState("");
  const [companyData,      setCompanyData]      = useState(null);
  const [typeDef,          setTypeDef]          = useState(null);
  const [publicHistoryPayload, setPublicHistoryPayload] = useState(null);
  const [qrCode,           setQrCode]           = useState(null);
  const [qrLoading,        setQrLoading]        = useState(true);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState("");

  // Dynamic field values — live data polled independently
  const [dynamicValues, setDynamicValues] = useState({});
  const [dynamicValuesDppId, setDynamicValuesDppId] = useState("");

  // Signature verification
  const [sigVerification, setSigVerification] = useState(null);
  const [verificationBundle, setVerificationBundle] = useState(null);

  // Restricted-field unlock state
  const [unlockedPassport,  setUnlockedPassport]  = useState(null);
  const [showRestrictedUnlockForm, setShowRestrictedUnlockForm] = useState(false);
  const [apiKeyInput,      setApiKeyInput]       = useState("");
  const [securityGroupApiKey, setSecurityGroupApiKey] = useState("");
  const [unlockError,      setUnlockError]       = useState("");
  const [unlocking,        setUnlocking]         = useState(false);
  const unlockDialogRef = useRef(null);
  const closeUnlockDialog = () => {
    setShowRestrictedUnlockForm(false);
    setUnlockError("");
    setApiKeyInput("");
  };
  useDialogFocus(showRestrictedUnlockForm, unlockDialogRef, closeUnlockDialog);
  const encodedDppId = encodeURIComponent(dppId || "");
  const encodedPreviewId = encodeURIComponent(previewId || "");
  const isPreviewMode = !!previewMode && !!previewId;
  const isInactiveView = !!versionNumber;
  const passportIdentityKey = passport
    ? [
        passport.dppId || "",
        passport.passportType || "",
        passport.versionNumber ?? "",
        isPreviewMode ? "preview" : (isInactiveView ? "inactive" : "public"),
      ].join(":")
    : "";

  const passportEndpoint = (
    isPreviewMode
      ? `${api}/api/companies/${previewCompanyId}/passports/${encodedPreviewId}/preview`
      : versionNumber
        ? `${api}/api/public/passports/${encodedDppId}?version=${encodeURIComponent(versionNumber)}`
        : `${api}/api/public/passports/${encodedDppId}`
  );

  const activeEndpointRef = useRef(passportEndpoint);
  activeEndpointRef.current = passportEndpoint;

  const fetchPassportRecord = useCallback(async ({ applyState = false, signal } = {}) => {
    const response = await fetchWithAuth(passportEndpoint, isPreviewMode
      ? { headers: authHeaders(), cache: "no-store", signal }
      : { cache: "no-store", signal });
    if (!response.ok) throw new Error("Could not refresh passport resources");
    const data = await response.json();
    if (applyState && !signal?.aborted && activeEndpointRef.current === passportEndpoint) {
      const resolvedCompanyId = data?.companyId || previewCompanyId || null;
      setPassport(data);
      setLoadedPassportEndpoint(passportEndpoint);
      setCompanyData(data?.companyProfile || null);
      if (isPreviewMode && resolvedCompanyId) {
        const profileRes = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/profile`, { cache: "no-store" });
        if (profileRes?.ok) {
          const profile = await profileRes.json();
          if (!signal?.aborted && activeEndpointRef.current === passportEndpoint) setCompanyData(profile);
        }
      }
    }
    return data;
  }, [isPreviewMode, passportEndpoint, previewCompanyId]);

  useEffect(() => {
    setUnlockedPassport(null);
    setShowRestrictedUnlockForm(false);
    setApiKeyInput("");
    setSecurityGroupApiKey("");
    setUnlockError("");
    setUnlocking(false);
    setDynamicValues({});
    setDynamicValuesDppId("");
    setSigVerification(null);
    setVerificationBundle(null);
  }, [passportIdentityKey]);

  const fetchPublicHistoryPayload = useCallback(async (passportData, apiKey = "") => {
    const endpoints = [
      passportData?.dppId
        ? `${api}/api/public/passports/${encodeURIComponent(passportData.dppId)}/history`
        : null,
    ].filter(Boolean);

    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithAuth(endpoint, apiKey
          ? { headers: { "X-API-Key": apiKey } }
          : undefined);
        const payload = await response.json().catch(() => null);
        if (response.ok && payload) return payload;
      } catch {
      }
    }

    return { history: [] };
  }, []);

  const refreshFieldUrl = useCallback(async (fieldKey) => {
    const refreshed = await fetchPassportRecord({ applyState: true });
    const nextValue = refreshed?.[fieldKey];
    return typeof nextValue === "string" && nextValue.trim() ? nextValue : "";
  }, [fetchPassportRecord]);

  // Primary data loading
  useEffect(() => {
    if (isPreviewMode && (!previewId || !previewCompanyId)) {
      setLoading(false);
      setError("Passport preview not found");
      return;
    }
    if (!isPreviewMode && !dppId) {
      setLoading(false);
      setError("Passport not found");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        // 1. Fetch the passport record
        const data = await fetchPassportRecord({ applyState: true, signal: controller.signal });
        if (cancelled) return;
        const embeddedViewerSchema = data?.viewerSchema || null;

        // 2. The record refresh already fetched branding; load schema and history.
        const [typeRes, historyPayload] = await Promise.all([
          embeddedViewerSchema
            ? Promise.resolve(null)
            : fetchWithAuth(`${api}/api/internal/passport-types/${data.passportType}`, { headers: authHeaders() }),
          fetchPublicHistoryPayload(data),
        ]);

        const fetchedType = typeRes?.ok ? await typeRes.json() : null;
        if (cancelled) return;
        if (embeddedViewerSchema) {
          setTypeDef(embeddedViewerSchema);
        } else if (fetchedType) {
          setTypeDef(fetchedType);
        } else {
          setTypeDef({ sections: [] });
        }
        setPublicHistoryPayload(historyPayload || { history: [] });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dppId, fetchPassportRecord, fetchPublicHistoryPayload, isPreviewMode, previewCompanyId, previewId]);

  // A company administrator commonly changes branding in another dashboard
  // tab, then returns to this viewer. Re-fetch the live payload on focus so
  // both the public and protected preview views immediately reflect it.
  useEffect(() => {
    const refreshBranding = () => {
      if (document.visibilityState === "hidden") return;
      fetchPassportRecord({ applyState: true }).catch(() => {});
    };
    window.addEventListener("focus", refreshBranding);
    document.addEventListener("visibilitychange", refreshBranding);
    return () => {
      window.removeEventListener("focus", refreshBranding);
      document.removeEventListener("visibilitychange", refreshBranding);
    };
  }, [fetchPassportRecord]);

  // Secondary data loading
  useEffect(() => {
    if (!passport?.dppId) return;
    let cancelled = false;
    setQrCode(null);
    (async () => {
      setQrLoading(true);
      try {
        const generatedBundle = await generateQRCodeBundle({
          dppId: passport.dppId,
          companyName: companyData?.companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          granularity: passport.granularity || "item",
        });
        if (cancelled) return;
        if (generatedBundle?.qrCodeDataUrl) {
          setQrCode(generatedBundle.qrCodeDataUrl);
          if (isPreviewMode && passport.companyId) {
            try {
              await saveQRCodeToDatabase(
                passport.companyId,
                passport.dppId,
                generatedBundle.publicUrl,
                passport.passportType,
                generatedBundle.carrierAuthenticity
              );
            } catch (error) {
              console.warn("Failed to save generated QR code", error);
            }
          }
        }
      } catch {
        if (!cancelled) setQrCode(null);
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyData?.companyName, isPreviewMode, passport?.companyId, passport?.dppId, passport?.granularity, passport?.manufacturedBy, passport?.manufacturer, passport?.modelName, passport?.passportType]);

  // Fetch + poll dynamic field values every 30 s
  useEffect(() => {
    if (!passport?.dppId || isInactiveView) return;
    let cancelled = false;
    const dynamicValuesEndpoint = isPreviewMode && passport.companyId
      ? `${api}/api/companies/${encodeURIComponent(passport.companyId)}/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`
      : `${api}/api/public/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`;
    const fetchDynamic = () =>
      fetchWithAuth(dynamicValuesEndpoint, !isPreviewMode && securityGroupApiKey
        ? { headers: { "X-API-Key": securityGroupApiKey } }
        : undefined)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!cancelled && d?.values) {
            setDynamicValues(d.values);
            setDynamicValuesDppId(passport.dppId);
          }
        })
        .catch((error) => console.warn("Ignored async error", error));
    fetchDynamic();
    const timer = setInterval(fetchDynamic, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isInactiveView, isPreviewMode, passport?.companyId, passport?.dppId, securityGroupApiKey]);

  // Fetch signature verification for released passports
  useEffect(() => {
    if (!passport?.dppId || !isReleasedPassportStatus(passport?.releaseStatus)) return;
    let cancelled = false;
    fetchWithAuth(`${api}/api/public/passports/${encodeURIComponent(passport.dppId)}/signature`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setSigVerification(d); })
      .catch((error) => console.warn("Ignored async error", error));
    return () => { cancelled = true; };
  }, [passport?.dppId, passport?.releaseStatus]);

  useEffect(() => {
    if (!passport?.dppId) return;
    if (!isReleasedPassportStatus(passport?.releaseStatus) && !isObsoletePassportStatus(passport?.releaseStatus)) return;
    const versionQuery = isInactiveView && passport?.versionNumber
      ? `?version=${encodeURIComponent(passport.versionNumber)}`
      : "";
    let cancelled = false;
    fetchWithAuth(`${api}/api/public/passports/${encodeURIComponent(passport.dppId)}/verification-bundle${versionQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setVerificationBundle(d); })
      .catch((error) => console.warn("Ignored async error", error));
    return () => { cancelled = true; };
  }, [isInactiveView, passport?.dppId, passport?.releaseStatus, passport?.versionNumber]);

  // UI event handlers
  const handleUnlock = async () => {
    if (unlocking || !apiKeyInput.trim()) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      if (isPreviewMode && !passport?.companyId) {
        throw new Error("Passport preview is missing company context");
      }
      const versionQuery = !isPreviewMode && isInactiveView && passport?.versionNumber
        ? `?version=${encodeURIComponent(passport.versionNumber)}`
        : "";
      const unlockEndpoint = isPreviewMode
        ? `${api}/api/companies/${encodeURIComponent(passport.companyId)}/passports/${encodeURIComponent(passport.dppId)}/preview-unlock`
        : `${api}/api/public/passports/${encodeURIComponent(passport.dppId)}${versionQuery}`;
      const r = await fetchWithAuth(unlockEndpoint, isPreviewMode ? {
        method: "GET",
        headers: { "X-API-Key": apiKeyInput.trim() },
        skipAuthRedirect: true,
      } : {
        method: "GET",
        headers: { "X-API-Key": apiKeyInput.trim() },
      });
      const d = await r.json();
      if (activeEndpointRef.current !== passportEndpoint) return;
      if (!r.ok) throw new Error(d.error || "Invalid API key");
      const restrictedPassport = isPreviewMode
        ? d.passport
        : buildRestrictedPassportFromPublicResponse(d, passport);
      if (!restrictedPassport) throw new Error("This security group does not grant access to restricted fields");
      setUnlockedPassport(restrictedPassport);
      setSecurityGroupApiKey(apiKeyInput.trim());
      if (!isPreviewMode) {
        const historyPayload = await fetchPublicHistoryPayload(passport, apiKeyInput.trim());
        if (activeEndpointRef.current !== passportEndpoint) return;
        setPublicHistoryPayload(historyPayload);
      }
      if (!isPreviewMode && d?.viewerSchema) setTypeDef(d.viewerSchema);
      setShowRestrictedUnlockForm(false);
      setApiKeyInput("");
    } catch (e) {
      if (activeEndpointRef.current === passportEndpoint) setUnlockError(e.message);
    } finally {
      if (activeEndpointRef.current === passportEndpoint) setUnlocking(false);
    }
  };

  const activeUnlockedPassport = useMemo(() => {
    if (!passport || !unlockedPassport) return null;
    if (String(unlockedPassport.dppId || "") !== String(passport.dppId || "")) return null;
    if (String(unlockedPassport.passportType || "") !== String(passport.passportType || "")) return null;
    const unlockedVersion = unlockedPassport.versionNumber;
    const passportVersion = passport.versionNumber;
    if (isInactiveView && Number(unlockedVersion) !== Number(passportVersion)) return null;
    if (unlockedVersion !== null && unlockedVersion !== undefined && passportVersion !== null && passportVersion !== undefined) {
      if (Number(unlockedVersion) !== Number(passportVersion)) return null;
    }
    return unlockedPassport;
  }, [isInactiveView, passport, unlockedPassport]);

  const activeDynamicValues = useMemo(() => {
    if (isInactiveView) return {};
    if (!passport?.dppId || dynamicValuesDppId !== passport.dppId) return {};
    return dynamicValues;
  }, [dynamicValues, dynamicValuesDppId, isInactiveView, passport?.dppId]);

  // Derived viewer data
  const brandTheme = getViewerBrandTheme();
  const canonicalPublicPath = buildPublicPassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    dppId: passport?.dppId,
  });
  const canonicalTechnicalPath = buildTechnicalPassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    dppId: passport?.dppId,
  });
  const canonicalInactivePath = buildInactivePassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    dppId: passport?.dppId,
    versionNumber,
  });
  const canonicalInactiveTechnicalPath = buildInactiveTechnicalPassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    dppId: passport?.dppId,
    versionNumber,
  });
  const canonicalPreviewPath = buildPreviewPassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    previewId: passport?.dppId,
  });
  const canonicalPreviewTechnicalPath = buildPreviewTechnicalPassportPath({
    companyName: companyData?.companyName,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufacturedBy,
    modelName: passport?.modelName,
    previewId: passport?.dppId,
  });
  const releasedAtTimestamp =
    verificationBundle?.releasedAt
    || sigVerification?.releasedAt
    || passport?.releasedAt
    || null;

  // Route normalization
  useEffect(() => {
    if (loadedPassportEndpoint !== passportEndpoint) return;
    const targetPath = isPreviewMode
      ? canonicalPreviewTechnicalPath
      : isInactiveView
        ? canonicalInactiveTechnicalPath
        : canonicalTechnicalPath;
    if (!targetPath) return;

    const currentPath = location.pathname.replace(/\/+$/, "");
    const normalizedTargetPath = targetPath.replace(/\/+$/, "");
    if (currentPath !== normalizedTargetPath) {
      navigate(normalizedTargetPath, { replace: true });
    }
  }, [canonicalInactiveTechnicalPath, canonicalPreviewTechnicalPath, canonicalTechnicalPath, isInactiveView, isPreviewMode, loadedPassportEndpoint, location.pathname, navigate, passportEndpoint]);

  if (loading || (!error && loadedPassportEndpoint !== passportEndpoint)) return <div className="loading">Loading passport…</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!passport) return null;

  return (
    <div
      data-theme="light"
      className={`viewer-brand-shell viewer-variant-${brandTheme.variant || "classic"}`}
      style={brandTheme.style}
    >
      <div className="no-print">
        <PublicPassportPortal
          passport={passport}
          companyData={companyData}
          typeDef={typeDef}
          publicHistoryPayload={publicHistoryPayload}
          qrCode={qrCode}
          qrLoading={qrLoading}
          unlockedPassport={activeUnlockedPassport}
          onRequestUnlock={() => setShowRestrictedUnlockForm(true)}
          dynamicValues={activeDynamicValues}
          dynamicHistoryBasePath={isPreviewMode && passport.companyId
            ? `/api/companies/${encodeURIComponent(passport.companyId)}/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`
            : `/api/public/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`}
          securityGroupApiKey={isPreviewMode ? "" : securityGroupApiKey}
          lang={lang}
          sigVerification={sigVerification}
          verificationBundle={verificationBundle}
          onRefreshFieldUrl={refreshFieldUrl}
          isPreviewMode={isPreviewMode}
          isInactiveView={isInactiveView}
          isObsolete={isObsoletePassportStatus(passport.releaseStatus)}
          canonicalPublicPath={canonicalPublicPath}
          lastUpdateAt={releasedAtTimestamp}
        />
      </div>

      {/* ── Restricted Fields Unlock Modal ── */}
      {showRestrictedUnlockForm && (
        <div className="restricted-unlock-overlay" onClick={e => { if (e.target === e.currentTarget) closeUnlockDialog(); }}>
          <div className="restricted-unlock-modal" ref={unlockDialogRef} role="dialog" aria-modal="true" aria-labelledby="restricted-unlock-title" aria-describedby="restricted-unlock-description" tabIndex={-1}>
            <button type="button" aria-label="Close restricted data dialog" className="restricted-unlock-close" onClick={closeUnlockDialog}>✕</button>
            <div className="restricted-unlock-icon">🔒</div>
            <h3 id="restricted-unlock-title" className="restricted-unlock-title">Restricted Data</h3>
            <p id="restricted-unlock-description" className="restricted-unlock-desc">
              Enter the security group API key provided by the company. Only the restricted fields selected for that group will become visible.
            </p>
            <input
              type="password"
              aria-label="Security group API key"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyInput}
              onChange={e => { setApiKeyInput(e.target.value); setUnlockError(""); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="Enter API key"
              className="restricted-unlock-input"
              data-dialog-initial-focus
            />
            {unlockError && <div className="restricted-unlock-error" role="alert">{unlockError}</div>}
            <div className="restricted-unlock-actions">
              <button className="restricted-unlock-btn cancel" onClick={closeUnlockDialog}>
                Cancel
              </button>
              <button className="restricted-unlock-btn submit" onClick={handleUnlock} disabled={unlocking || !apiKeyInput.trim()}>
                {unlocking ? "Verifying…" : "Access fields"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PassportViewer;
