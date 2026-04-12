import React, { useState, useEffect, lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { authHeaders } from "./authHeaders";
import "./PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Add new product-specific pages here as you build them
const PAGE_MAP = {
  battery: lazy(() => import("./BatteryConsumerPage")),
};
const GenericConsumerPage = lazy(() => import("./GenericConsumerPage"));
const getViewerUserId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    const parsedUserId = Number.parseInt(user?.id, 10);
    return Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
  } catch {
    return null;
  }
};

function ConsumerPage({ previewMode = false, previewCompanyId = null }) {
  const { productId, versionNumber, previewId } = useParams();
  const [passport,      setPassport]      = useState(null);
  const [company,       setCompany]       = useState(null);
  const [typeDef,       setTypeDef]       = useState(null);
  const [dynamicValues, setDynamicValues] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");

  useEffect(() => {
    const encodedProductId = encodeURIComponent(productId || "");
    const encodedPreviewId = encodeURIComponent(previewId || "");
    const endpoint = previewMode
      ? `${API}/api/companies/${previewCompanyId}/passports/${encodedPreviewId}/preview`
      : versionNumber
        ? `${API}/api/passports/by-product/${encodedProductId}?version=${encodeURIComponent(versionNumber)}`
        : `${API}/api/passports/by-product/${encodedProductId}`;
    const requestInit = previewMode ? { headers: authHeaders() } : undefined;

    setLoading(true);
    setError("");
    fetch(endpoint, requestInit)
      .then(r => r.ok ? r.json() : Promise.reject("not found"))
      .then(async data => {
        setPassport(data);
        if (data?.guid && !previewMode) {
          const viewerUserId = getViewerUserId();
          fetch(`${API}/api/passports/${data.guid}/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: viewerUserId,
              referrer: document.referrer,
              userAgent: navigator.userAgent,
            }),
          }).catch(() => {});
        }
        const [companyRes, typeRes, dynamicRes] = await Promise.all([
          data.company_id   ? fetch(`${API}/api/companies/${data.company_id}/profile`)     : Promise.resolve(null),
          data.passport_type ? fetch(`${API}/api/passport-types/${data.passport_type}`)    : Promise.resolve(null),
          data.inactive_public_version || !data.guid
            ? Promise.resolve(null)
            : fetch(`${API}/api/passports/${data.guid}/dynamic-values`),
        ]);
        if (companyRes?.ok)  setCompany(await companyRes.json());
        if (typeRes?.ok)     setTypeDef(await typeRes.json());
        if (dynamicRes.ok) {
          const d = await dynamicRes.json();
          if (d?.values) setDynamicValues(d.values);
        }
      })
      .catch(() => setError("Passport not found"))
      .finally(() => setLoading(false));
  }, [previewCompanyId, previewId, previewMode, productId, versionNumber]);

  if (loading) return (
    <div className="cp-state-screen cp-state-screen-loading">Loading passport…</div>
  );

  if (error || !passport) return (
    <div className="cp-state-screen cp-state-screen-error">
      <div className="cp-state-icon">🔍</div>
      <h2>Passport not found</h2>
      <p className="cp-state-copy">This QR code may be invalid or the passport has been removed.</p>
    </div>
  );

  // Route by umbrella_category (product category set in AdminCreatePassportType)
  const umbrellaCategory = typeDef?.umbrella_category || "";
  let Page = null;
  if (/battery/i.test(umbrellaCategory)) Page = PAGE_MAP["battery"];
  // Add more category mappings here as new pages are built:
  // if (/textile/i.test(umbrellaCategory)) Page = PAGE_MAP["textile"];
  if (!Page) Page = GenericConsumerPage;

  return (
    <Suspense fallback={<div className="cp-state-screen cp-state-screen-loading">Loading…</div>}>
      <Page
        passport={passport}
        company={company}
        typeDef={typeDef}
        dynamicValues={dynamicValues}
      />
    </Suspense>
  );
}

export default ConsumerPage;
