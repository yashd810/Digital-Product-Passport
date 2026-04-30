import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { translateSchemaLabel } from "../../app/providers/i18n";
import { generateQRCodeBundle, saveQRCodeToDatabase } from "../utils/QRcode";
import { getViewerBrandTheme } from "../../app/providers/ThemeContext";
import { isObsoletePassportStatus, isReleasedPassportStatus } from "../../passports/utils/passportStatus";
import { authHeaders } from "../../shared/api/authHeaders";
import PassportHistoryModal from "../../passports/history/PassportHistoryModal";
import {
  buildInactivePassportPath,
  buildInactiveTechnicalPassportPath,
  buildPreviewPassportPath,
  buildPreviewTechnicalPassportPath,
  buildPublicPassportPath,
  buildTechnicalPassportPath,
} from "../../passports/utils/passportRoutes";
import { PassportIntro, Header, Footer, PassportTabRail, SignatureBadge, EmptySectionsState, SectionView, PrintView } from "../components/ViewerBlocks";
import "../styles/PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "";

function PassportViewer({ previewMode = false, previewCompanyId = null }) {
  const { productId, versionNumber, previewId } = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();
  const printRef   = useRef(null);
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
  const [showHistoryModal,  setShowHistoryModal]  = useState(false);
  const [activeSectionKey,  setActiveSectionKey]  = useState("");
  const [securityReportState, setSecurityReportState] = useState({ submitting: false, success: false, error: "" });
  const encodedProductId = encodeURIComponent(productId || "");
  const encodedPreviewId = encodeURIComponent(previewId || "");
  const isPreviewMode = !!previewMode && !!previewId;
  const isInactiveView = !!versionNumber;

  // Primary data loading
  useEffect(() => {
    if (isPreviewMode && (!previewId || !previewCompanyId)) return;
    if (!isPreviewMode && !productId) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        // 1. Fetch the passport record
        const endpoint = isPreviewMode
          ? `${API}/api/companies/${previewCompanyId}/passports/${encodedPreviewId}/preview`
          : versionNumber
            ? `${API}/api/passports/by-product/${encodedProductId}?version=${encodeURIComponent(versionNumber)}`
            : `${API}/api/passports/by-product/${encodedProductId}`;
        const r = await fetch(endpoint, isPreviewMode ? { headers: authHeaders() } : undefined);
        if (!r.ok) throw new Error("Passport not found");
        const data = await r.json();
        setPassport(data);

        // 2. Fetch company branding in parallel with type definition
        const [profileRes, typeRes] = await Promise.all([
          data.company_id
            ? fetch(`${API}/api/companies/${data.company_id}/profile`)
            : Promise.resolve(null),
          fetch(`${API}/api/passport-types/${data.passport_type}`),
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
  }, [encodedPreviewId, encodedProductId, isPreviewMode, previewCompanyId, previewId, productId, versionNumber]);

  useEffect(() => {
    fetch(`${API}/api/users/me`, {
      headers: authHeaders(),
    })
      .then(r => setIsLoggedIn(r.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Secondary data loading
  useEffect(() => {
    if (!passport?.dppId || !passport?.product_id) return;
    (async () => {
      setQrLoading(true);
      try {
        const generatedBundle = await generateQRCodeBundle({
          productId: passport.product_id,
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
              generatedBundle.qrCodeDataUrl,
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
  }, [companyData?.company_name, passport?.dppId, passport?.manufactured_by, passport?.manufacturer, passport?.model_name, passport?.passport_type, passport?.product_id]);

  // Fetch + poll dynamic field values every 30 s
  useEffect(() => {
    if (!passport?.dppId || isInactiveView) return;
    const fetchDynamic = () =>
      fetch(`${API}/api/passports/${passport.dppId}/dynamic-values`)
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
    fetch(`${API}/api/passports/${passport.dppId}/signature`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSigVerification(d); })
      .catch(() => {});
  }, [passport?.dppId, passport?.release_status]);

  // Fetch access-key metadata for logged-in company users.
  useEffect(() => {
    if (!isLoggedIn || !passport?.dppId || !passport?.company_id) return;
    fetch(`${API}/api/companies/${passport.company_id}/passports/${passport.dppId}/access-key`, {
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
      const r = await fetch(`${API}/api/companies/${passport.company_id}/passports/${passport.dppId}/access-key/regenerate`, {
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
      const r = await fetch(`${API}/api/passports/${passport.dppId}/unlock`, {
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
  const sections = typeDef?.fields_json?.sections || typeDef?.sections || [];
  const tabs = sections.map((section) => ({
    sectionKey: section.key,
    label: translateSchemaLabel(lang, section),
  }));
  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ||
    sections[0] ||
    null;
  const passportType = passport?.passport_type;
  const displayName  = typeDef?.display_name || passportType;
  const brandTheme = getViewerBrandTheme(companyData?.branding_json);
  const canonicalPublicPath = buildPublicPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
  });
  const canonicalTechnicalPath = buildTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
  });
  const canonicalInactivePath = buildInactivePassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
    versionNumber,
  });
  const canonicalInactiveTechnicalPath = buildInactiveTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
    versionNumber,
  });
  const canonicalPreviewPath = buildPreviewPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
    previewId: passport?.dppId,
  });
  const canonicalPreviewTechnicalPath = buildPreviewTechnicalPassportPath({
    companyName: companyData?.company_name,
    manufacturerName: passport?.manufacturer,
    manufacturedBy: passport?.manufactured_by,
    modelName: passport?.model_name,
    productId: passport?.product_id,
    previewId: passport?.dppId,
  });

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

  useEffect(() => {
    if (!sections.length) {
      setActiveSectionKey("");
      return;
    }
    if (!sections.some((section) => section.key === activeSectionKey)) {
      setActiveSectionKey(sections[0].key);
    }
  }, [activeSectionKey, sections]);

  if (loading) return <div className="loading">Loading passport…</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!passport) return null;

  const handleReportSuspiciousCarrier = async (report) => {
    if (!passport?.dppId) return;
    setSecurityReportState({ submitting: true, success: false, error: "" });
    try {
      const response = await fetch(`${API}/api/passports/${passport.dppId}/security-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to report suspicious carrier");
      }
      setSecurityReportState({ submitting: false, success: true, error: "" });
    } catch (error) {
      setSecurityReportState({ submitting: false, success: false, error: error.message || "Failed to report suspicious carrier" });
    }
  };

  return (
    <div
      data-theme="light"
      className={`viewer-brand-shell viewer-variant-${brandTheme.variant || "classic"}`}
      style={brandTheme.style}
    >
      <div className="no-print">
        <Header displayName={displayName} lang={lang} setLang={setLang} dppId={passport.dppId} companyData={companyData} brandTheme={brandTheme} />

        <main id="viewer-main-content" className="viewer-content">
          <div className="viewer-shell">
            <div className="viewer-topbar">
              <div className="viewer-title">
                <button
                  type="button"
                  className="pv-secondary-btn viewer-back-btn"
                  onClick={() => {
                    const landingPath = isPreviewMode
                      ? canonicalPreviewPath
                      : isInactiveView
                        ? canonicalInactivePath
                        : canonicalPublicPath;
                    if (landingPath) navigate(landingPath);
                  }}
                  disabled={!(isPreviewMode
                    ? canonicalPreviewPath
                    : isInactiveView
                      ? canonicalInactivePath
                      : canonicalPublicPath)}
                >
                  ← Back to landing page
                </button>
                <h2>{typeDef?.umbrella_icon || ""} {displayName}</h2>
                <p className="viewer-subtitle">{isPreviewMode ? "Draft preview of the public passport viewer" : "Public passport viewer"}</p>
              </div>
              <SignatureBadge verification={sigVerification} />
            </div>

            {isPreviewMode && (
              <div className="access-unlocked-bar preview-status-bar">
                <div className="preview-status-copy">
                  <strong>Preview mode</strong>
                  <span>Previewing how this passport will look in the public viewer before release.</span>
                </div>
                {canonicalPublicPath && (
                  <code className="preview-status-url" title={canonicalPublicPath}>
                    Future public URL: {canonicalPublicPath}
                  </code>
                )}
              </div>
            )}

            {/* Access key info bar — only visible to logged-in company users */}
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

            {/* Unlocked banner — shown after successful key entry */}
            {unlockedPassport && (
              <div className="access-unlocked-bar">
                ✅ Restricted fields are now visible. Access granted to authorised view.
                <button className="access-relock-btn" onClick={() => setUnlockedPassport(null)}>
                  🔒 Re-lock
                </button>
              </div>
            )}

            {isInactiveView && (
              <div className="access-unlocked-bar">
                Viewing inactive released snapshot v{passport.version_number}.
                <button className="access-relock-btn" onClick={() => { if (canonicalPublicPath) navigate(canonicalPublicPath); }}>
                  Open current passport
                </button>
              </div>
            )}

            {isObsoletePassportStatus(passport.release_status) && (
              <div className="pv-obsolete-banner">
                This is not the latest version of this passport. A newer version has been released.
              </div>
            )}

            <PassportIntro
              passport={passport}
              companyData={companyData}
              displayName={displayName}
              qrCode={qrCode}
              qrLoading={qrLoading}
              carrierAuthenticity={passport?.carrier_authenticity || carrierAuthenticity}
              onReportSuspiciousCarrier={handleReportSuspiciousCarrier}
              securityReportState={securityReportState}
              onOpenHistory={() => setShowHistoryModal(true)}
              onPrint={() => { setTimeout(() => window.print(), 300); }}
            />

            <div className="viewer-route-panel">
              {sections.length > 0 && (
                <PassportTabRail
                  tabs={tabs}
                  activeSectionKey={activeSection?.key || ""}
                  onSelect={setActiveSectionKey}
                />
              )}
              {sections.length === 0 && <EmptySectionsState />}
              {activeSection && (
                <SectionView
                  key={activeSection.key}
                  sectionId={`section-${activeSection.key}`}
                  sectionDef={activeSection}
                  passport={passport}
                  unlockedPassport={unlockedPassport}
                  onRequestUnlock={() => setShowAccessForm(true)}
                  dynamicValues={dynamicValues}
                  lang={lang}
                />
              )}
            </div>
          </div>
        </main>

        <Footer brandTheme={brandTheme} />
      </div>

      <div className="print-only" ref={printRef}>
        <PrintView passport={passport} companyData={companyData} sections={sections} />
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

      {showHistoryModal && (
        <PassportHistoryModal
          dppId={passport.dppId}
          productId={passport.product_id}
          passportType={passport.passport_type}
          companyId={isPreviewMode ? previewCompanyId : null}
          mode={isPreviewMode ? "company" : "public"}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
}

export default PassportViewer;
