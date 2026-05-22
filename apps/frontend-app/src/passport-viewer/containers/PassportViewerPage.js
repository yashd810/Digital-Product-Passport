import React, { useCallback, useEffect, useState } from "react";
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

const API = import.meta.env.VITE_API_URL || "";

function PassportViewer({ previewMode = false, previewCompanyId = null }) {
  const { internalAliasId, versionNumber, previewId } = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Viewer state
  const [lang,             setLang]             = useState(() => localStorage.getItem("dpp_lang") || "en");
  const [passport,         setPassport]         = useState(null);
  const [companyData,      setCompanyData]      = useState(null);
  const [typeDef,          setTypeDef]          = useState(null);
  const [qrCode,           setQrCode]           = useState(null);
  const [carrierAuthenticity, setCarrierAuthenticity] = useState(null);
  const [qrLoading,        setQrLoading]        = useState(true);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState("");

  // Dynamic field values — live data polled independently
  const [dynamicValues, setDynamicValues] = useState({});

  // Signature verification
  const [sigVerification, setSigVerification] = useState(null);
  const [verificationBundle, setVerificationBundle] = useState(null);

  // Access-control state
  const [unlockedPassport,  setUnlockedPassport]  = useState(null);   // full data after valid key
  const [showAccessForm,    setShowAccessForm]    = useState(false);  // unlock modal visible?
  const [accessKeyInput,    setAccessKeyInput]    = useState("");
  const [accessError,       setAccessError]       = useState("");
  const [unlocking,         setUnlocking]         = useState(false);
  const [passportAccessKeyMeta, setPassportAccessKeyMeta] = useState(null);
  const [passportAccessKey, setPassportAccessKey] = useState(null);   // one-time reveal after rotation
  const [accessKeyBusy,     setAccessKeyBusy]     = useState(false);
  const [keyCopied,         setKeyCopied]         = useState(false);
  const encodedProductId = encodeURIComponent(internalAliasId || "");
  const encodedPreviewId = encodeURIComponent(previewId || "");
  const isPreviewMode = !!previewMode && !!previewId;
  const isInactiveView = !!versionNumber;

  const passportEndpoint = (
    isPreviewMode
      ? `${API}/api/companies/${previewCompanyId}/passports/${encodedPreviewId}/preview`
      : versionNumber
        ? `${API}/api/passports/by-product/${encodedProductId}?version=${encodeURIComponent(versionNumber)}`
        : `${API}/api/passports/by-product/${encodedProductId}`
  );

  const fetchPassportRecord = useCallback(async ({ applyState = false } = {}) => {
    const response = await fetchWithAuth(passportEndpoint, isPreviewMode ? { headers: authHeaders() } : undefined);
    if (!response.ok) throw new Error("Could not refresh passport resources");
    const data = await response.json();
    if (applyState) {
      const resolvedCompanyId = data?.company_id || data?.companyId || previewCompanyId || null;
      setPassport(data);
      if (data?.company_profile) setCompanyData(data.company_profile);
      if (isPreviewMode && resolvedCompanyId) {
        const profileRes = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/profile`);
        if (profileRes?.ok) setCompanyData(await profileRes.json());
      }
    }
    return data;
  }, [isPreviewMode, passportEndpoint, previewCompanyId]);

  const refreshFieldUrl = useCallback(async (fieldKey, fallbackUrl) => {
    const refreshed = await fetchPassportRecord({ applyState: true });
    const nextValue = refreshed?.[fieldKey];
    return typeof nextValue === "string" && nextValue.trim() ? nextValue : fallbackUrl;
  }, [fetchPassportRecord]);

  // Primary data loading
  useEffect(() => {
    if (isPreviewMode && (!previewId || !previewCompanyId)) {
      setLoading(false);
      setError("Passport preview not found");
      return;
    }
    if (!isPreviewMode && !internalAliasId) {
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
        const resolvedCompanyId = data?.company_id || data?.companyId || previewCompanyId || null;

        // 2. Fetch company branding in parallel with type definition
        const [profileRes, typeRes] = await Promise.all([
          isPreviewMode && resolvedCompanyId
            ? fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/profile`)
            : Promise.resolve(null),
          fetchWithAuth(`${API}/api/passport-types/${data.passport_type}`),
        ]);

        if (profileRes?.ok) setCompanyData(await profileRes.json());
        if (typeRes.ok) {
          setTypeDef(await typeRes.json());
        } else {
          // Graceful fallback: empty sections
          setTypeDef({ sections: [] });
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [encodedPreviewId, encodedProductId, fetchPassportRecord, isPreviewMode, previewCompanyId, previewId, internalAliasId, versionNumber]);

  useEffect(() => {
    if (!isPreviewMode || !previewCompanyId) return;
    fetchWithAuth(`${API}/api/companies/${previewCompanyId}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setCompanyData(d);
      })
      .catch(() => {});
  }, [isPreviewMode, previewCompanyId]);

  useEffect(() => {
    fetchWithAuth(`${API}/api/users/me`, {
      headers: authHeaders(),
    })
      .then(r => setIsLoggedIn(r.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Secondary data loading
  useEffect(() => {
    if (!passport?.dppId || !passport?.internal_alias_id) return;
    (async () => {
      setQrLoading(true);
      try {
        const generatedBundle = await generateQRCodeBundle({
          internalAliasId: passport.internal_alias_id,
          companyName: companyData?.company_name,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufactured_by,
          modelName: passport.model_name,
          granularity: passport.granularity || "item",
        });
        if (generatedBundle?.qrCodeDataUrl) {
          setQrCode(generatedBundle.qrCodeDataUrl);
          setCarrierAuthenticity(generatedBundle.carrierAuthenticity || null);
          try {
            await saveQRCodeToDatabase(
              passport.dppId,
              generatedBundle.publicUrl,
              passport.passport_type,
              generatedBundle.carrierAuthenticity
            );
          } catch {}
        }
      } catch (e) {
        setQrCode(null);
        setCarrierAuthenticity(null);
      } finally {
        setQrLoading(false);
      }
    })();
  }, [companyData?.company_name, passport?.dppId, passport?.manufactured_by, passport?.manufacturer, passport?.model_name, passport?.passport_type, passport?.internal_alias_id]);

  // Fetch + poll dynamic field values every 30 s
  useEffect(() => {
    if (!passport?.dppId || isInactiveView) return;
    const fetchDynamic = () =>
      fetchWithAuth(`${API}/api/passports/${passport.dppId}/dynamic-values`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.values) setDynamicValues(d.values); })
        .catch(() => {});
    fetchDynamic();
    const timer = setInterval(fetchDynamic, 30000);
    return () => clearInterval(timer);
  }, [passport?.dppId, isInactiveView]);

  // Fetch signature verification for released passports
  useEffect(() => {
    if (!passport?.dppId || !isReleasedPassportStatus(passport?.release_status)) return;
    fetchWithAuth(`${API}/api/passports/${passport.dppId}/signature`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSigVerification(d); })
      .catch(() => {});
  }, [passport?.dppId, passport?.release_status]);

  useEffect(() => {
    if (!passport?.dppId) return;
    if (!isReleasedPassportStatus(passport?.release_status) && !isObsoletePassportStatus(passport?.release_status)) return;
    fetchWithAuth(`${API}/api/public/dpp/${passport.dppId}/verification-bundle.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setVerificationBundle(d); })
      .catch(() => {});
  }, [passport?.dppId, passport?.release_status]);

  // Fetch access-key metadata for logged-in company users.
  useEffect(() => {
    if (!isLoggedIn || !passport?.dppId || !passport?.company_id) return;
    fetchWithAuth(`${API}/api/companies/${passport.company_id}/passports/${passport.dppId}/access-key`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : null)
      .then((d) => { if (d) setPassportAccessKeyMeta(d); })
      .catch(() => {});
  }, [passport?.dppId, passport?.company_id, isLoggedIn]);

  const handleRegenerateAccessKey = async () => {
    if (!passport?.dppId || !passport?.company_id) return;
    if (!window.confirm("Issue a new passport access key? The previous key will stop working immediately.")) return;
    setAccessKeyBusy(true);
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${passport.company_id}/passports/${passport.dppId}/access-key/regenerate`, {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to rotate access key");
      setPassportAccessKey(d.accessKey || null);
      setPassportAccessKeyMeta({
        hasAccessKey: true,
        keyPrefix: d.keyPrefix || null,
        lastRotatedAt: d.lastRotatedAt || new Date().toISOString(),
      });
      setKeyCopied(false);
    } catch (e) {
      setAccessError(e.message || "Failed to rotate access key");
    } finally {
      setAccessKeyBusy(false);
    }
  };

  // UI event handlers
  const handleUnlock = async () => {
    if (!accessKeyInput.trim()) return;
    setUnlocking(true);
    setAccessError("");
    try {
      const r = await fetchWithAuth(`${API}/api/passports/${passport.dppId}/unlock`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accessKey: accessKeyInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Invalid access key");
      setUnlockedPassport(d.passport);
      setShowAccessForm(false);
      setAccessKeyInput("");
    } catch (e) {
      setAccessError(e.message);
    } finally {
      setUnlocking(false);
    }
  };

  // Derived viewer data
  const brandTheme = getViewerBrandTheme();
  const canonicalPublicPath = buildPublicPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
  });
  const canonicalTechnicalPath = buildTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
  });
  const canonicalInactivePath = buildInactivePassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
    versionNumber,
  });
  const canonicalInactiveTechnicalPath = buildInactiveTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
    versionNumber,
  });
  const canonicalPreviewPath = buildPreviewPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
    previewId: passport?.dppId,
  });
  const canonicalPreviewTechnicalPath = buildPreviewTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    internalAliasId: passport?.internal_alias_id,
    previewId: passport?.dppId,
  });
  const releasedAtTimestamp =
    verificationBundle?.releasedAt
    || sigVerification?.releasedAt
    || passport?.releasedAt
    || passport?.released_at
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
        {isLoggedIn && (passportAccessKeyMeta || passportAccessKey) && (
          <div className="access-key-bar">
            <span className="access-key-bar-icon">🔑</span>
            <div className="access-key-bar-text">
              <strong>Passport Access Key</strong>
              <span className="access-key-bar-hint">
                Access keys are now write-only for security. Issue a new key when you need to share restricted-field access with an authorised party.
              </span>
            </div>
            <code className="access-key-bar-code">
              {passportAccessKey || passportAccessKeyMeta?.keyPrefix || "Not issued yet"}
            </code>
            {passportAccessKey ? (
              <button
                className="access-key-bar-copy"
                onClick={() => {
                  navigator.clipboard.writeText(passportAccessKey);
                  setKeyCopied(true);
                  setTimeout(() => setKeyCopied(false), 2000);
                }}
              >
                {keyCopied ? "✓ Copied" : "Copy"}
              </button>
            ) : (
              <button
                className="access-key-bar-copy"
                onClick={handleRegenerateAccessKey}
                disabled={accessKeyBusy}
              >
                {accessKeyBusy ? "Issuing…" : passportAccessKeyMeta?.hasAccessKey ? "Regenerate" : "Issue Key"}
              </button>
            )}
          </div>
        )}

        <PublicPassportPortal
          passport={passport}
          companyData={companyData}
          typeDef={typeDef}
          qrCode={qrCode}
          qrLoading={qrLoading}
          unlockedPassport={unlockedPassport}
          onRequestUnlock={() => setShowAccessForm(true)}
          dynamicValues={dynamicValues}
          lang={lang}
          sigVerification={sigVerification}
          verificationBundle={verificationBundle}
          carrierAuthenticity={passport?.carrier_authenticity || carrierAuthenticity}
          onRefreshFieldUrl={refreshFieldUrl}
          isPreviewMode={isPreviewMode}
          isInactiveView={isInactiveView}
          isObsolete={isObsoletePassportStatus(passport.release_status)}
          canonicalPublicPath={canonicalPublicPath}
          lastUpdateAt={releasedAtTimestamp}
        />
      </div>

      {/* ── Access Key Unlock Modal ── */}
      {showAccessForm && (
        <div className="access-unlock-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAccessForm(false); }}>
          <div className="access-unlock-modal">
            <button className="access-unlock-close" onClick={() => { setShowAccessForm(false); setAccessError(""); setAccessKeyInput(""); }}>✕</button>
            <div className="access-unlock-icon">🔒</div>
            <h3 className="access-unlock-title">Restricted Data</h3>
            <p className="access-unlock-desc">
              This field is restricted to authorised parties only. Enter the access key provided by the manufacturer to view it.
            </p>
            <input
              type="text"
              value={accessKeyInput}
              onChange={e => { setAccessKeyInput(e.target.value); setAccessError(""); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="Enter access key"
              className="access-unlock-input"
              autoFocus
            />
            {accessError && <div className="access-unlock-error">{accessError}</div>}
            <div className="access-unlock-actions">
              <button className="access-unlock-btn cancel" onClick={() => { setShowAccessForm(false); setAccessError(""); setAccessKeyInput(""); }}>
                Cancel
              </button>
              <button className="access-unlock-btn submit" onClick={handleUnlock} disabled={unlocking || !accessKeyInput.trim()}>
                {unlocking ? "Verifying…" : "Unlock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PassportViewer;
