import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
  const [lang,             setLang]             = useState(() => localStorage.getItem("dppLang") || "en");
  const [passport,         setPassport]         = useState(null);
  const [companyData,      setCompanyData]      = useState(null);
  const [typeDef,          setTypeDef]          = useState(null);
  const [publicHistoryPayload, setPublicHistoryPayload] = useState(null);
  const [qrCode,           setQrCode]           = useState(null);
  const [carrierAuthenticity, setCarrierAuthenticity] = useState(null);
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

  const fetchPassportRecord = useCallback(async ({ applyState = false } = {}) => {
    const response = await fetchWithAuth(passportEndpoint, isPreviewMode ? { headers: authHeaders() } : undefined);
    if (!response.ok) throw new Error("Could not refresh passport resources");
    const data = await response.json();
    if (applyState) {
      const resolvedCompanyId = data?.companyId || previewCompanyId || null;
      setPassport(data);
      if (data?.companyProfile) setCompanyData(data.companyProfile);
      if (isPreviewMode && resolvedCompanyId) {
        const profileRes = await fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/profile`);
        if (profileRes?.ok) setCompanyData(await profileRes.json());
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
    (async () => {
      setLoading(true);
      setError("");
      try {
        // 1. Fetch the passport record
        const data = await fetchPassportRecord({ applyState: true });
        const resolvedCompanyId = data?.companyId || previewCompanyId || null;

        const embeddedViewerSchema = data?.viewerSchema || null;

        // 2. Fetch company branding and type definition when needed
        const [profileRes, typeRes, historyPayload] = await Promise.all([
          isPreviewMode && resolvedCompanyId
            ? fetchWithAuth(`${api}/api/companies/${resolvedCompanyId}/profile`)
            : Promise.resolve(null),
          embeddedViewerSchema
            ? Promise.resolve(null)
            : fetchWithAuth(`${api}/api/internal/passport-types/${data.passportType}`, { headers: authHeaders() }),
          fetchPublicHistoryPayload(data),
        ]);

        if (profileRes?.ok) setCompanyData(await profileRes.json());
        if (embeddedViewerSchema) {
          setTypeDef(embeddedViewerSchema);
        } else if (typeRes?.ok) {
          setTypeDef(await typeRes.json());
        } else {
          setTypeDef({ sections: [] });
        }
        setPublicHistoryPayload(historyPayload || { history: [] });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [dppId, fetchPassportRecord, fetchPublicHistoryPayload, isPreviewMode, previewCompanyId, previewId]);

  useEffect(() => {
    if (!isPreviewMode || !previewCompanyId) return;
    fetchWithAuth(`${api}/api/companies/${previewCompanyId}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setCompanyData(d);
      })
      .catch((error) => console.warn("Ignored async error", error));
  }, [isPreviewMode, previewCompanyId]);

  // Secondary data loading
  useEffect(() => {
    if (!passport?.dppId) return;
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
        if (generatedBundle?.qrCodeDataUrl) {
          setQrCode(generatedBundle.qrCodeDataUrl);
          setCarrierAuthenticity(generatedBundle.carrierAuthenticity || null);
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
      } catch (e) {
        setQrCode(null);
        setCarrierAuthenticity(null);
      } finally {
        setQrLoading(false);
      }
    })();
  }, [companyData?.companyName, isPreviewMode, passport?.companyId, passport?.dppId, passport?.granularity, passport?.manufacturedBy, passport?.manufacturer, passport?.modelName, passport?.passportType]);

  // Fetch + poll dynamic field values every 30 s
  useEffect(() => {
    if (!passport?.dppId || isInactiveView) return;
    const dynamicValuesEndpoint = isPreviewMode && passport.companyId
      ? `${api}/api/companies/${encodeURIComponent(passport.companyId)}/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`
      : `${api}/api/public/passports/${encodeURIComponent(passport.dppId)}/dynamic-values`;
    const fetchDynamic = () =>
      fetchWithAuth(dynamicValuesEndpoint, !isPreviewMode && securityGroupApiKey
        ? { headers: { "X-API-Key": securityGroupApiKey } }
        : undefined)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.values) {
            setDynamicValues(d.values);
            setDynamicValuesDppId(passport.dppId);
          }
        })
        .catch((error) => console.warn("Ignored async error", error));
    fetchDynamic();
    const timer = setInterval(fetchDynamic, 30000);
    return () => clearInterval(timer);
  }, [isInactiveView, isPreviewMode, passport?.companyId, passport?.dppId, securityGroupApiKey]);

  // Fetch signature verification for released passports
  useEffect(() => {
    if (!passport?.dppId || !isReleasedPassportStatus(passport?.releaseStatus)) return;
    fetchWithAuth(`${api}/api/public/passports/${passport.dppId}/signature`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSigVerification(d); })
      .catch((error) => console.warn("Ignored async error", error));
  }, [passport?.dppId, passport?.releaseStatus]);

  useEffect(() => {
    if (!passport?.dppId) return;
    if (!isReleasedPassportStatus(passport?.releaseStatus) && !isObsoletePassportStatus(passport?.releaseStatus)) return;
    const versionQuery = isInactiveView && passport?.versionNumber
      ? `?version=${encodeURIComponent(passport.versionNumber)}`
      : "";
    fetchWithAuth(`${api}/api/public/passports/${passport.dppId}/verification-bundle${versionQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setVerificationBundle(d); })
      .catch((error) => console.warn("Ignored async error", error));
  }, [isInactiveView, passport?.dppId, passport?.releaseStatus, passport?.versionNumber]);

  // UI event handlers
  const handleUnlock = async () => {
    if (!apiKeyInput.trim()) return;
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
      if (!r.ok) throw new Error(d.error || "Invalid API key");
      const restrictedPassport = isPreviewMode
        ? d.passport
        : buildRestrictedPassportFromPublicResponse(d, passport);
      if (!restrictedPassport) throw new Error("This security group does not grant access to restricted fields");
      setUnlockedPassport(restrictedPassport);
      setSecurityGroupApiKey(apiKeyInput.trim());
      if (!isPreviewMode) {
        setPublicHistoryPayload(await fetchPublicHistoryPayload(passport, apiKeyInput.trim()));
      }
      if (!isPreviewMode && d?.viewerSchema) setTypeDef(d.viewerSchema);
      setShowRestrictedUnlockForm(false);
      setApiKeyInput("");
    } catch (e) {
      setUnlockError(e.message);
    } finally {
      setUnlocking(false);
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
  }, [canonicalInactiveTechnicalPath, canonicalPreviewTechnicalPath, canonicalTechnicalPath, isInactiveView, isPreviewMode, location.pathname, navigate]);

  if (loading) return <div className="loading">Loading passport…</div>;
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
          carrierAuthenticity={passport?.carrierAuthenticity || carrierAuthenticity}
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
        <div className="restricted-unlock-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRestrictedUnlockForm(false); }}>
          <div className="restricted-unlock-modal">
            <button className="restricted-unlock-close" onClick={() => { setShowRestrictedUnlockForm(false); setUnlockError(""); setApiKeyInput(""); }}>✕</button>
            <div className="restricted-unlock-icon">🔒</div>
            <h3 className="restricted-unlock-title">Restricted Data</h3>
            <p className="restricted-unlock-desc">
              Enter the security group API key provided by the company. Only the restricted fields selected for that group will become visible.
            </p>
            <input
              type="text"
              value={apiKeyInput}
              onChange={e => { setApiKeyInput(e.target.value); setUnlockError(""); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="Enter API key"
              className="restricted-unlock-input"
              autoFocus
            />
            {unlockError && <div className="restricted-unlock-error">{unlockError}</div>}
            <div className="restricted-unlock-actions">
              <button className="restricted-unlock-btn cancel" onClick={() => { setShowRestrictedUnlockForm(false); setUnlockError(""); setApiKeyInput(""); }}>
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
