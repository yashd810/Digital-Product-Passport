import React, { useState, useEffect, lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import "./PassportViewer.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Add new product-specific pages here as you build them
const PAGE_MAP = {
  battery: lazy(() => import("./BatteryConsumerPage")),
};
const GenericConsumerPage = lazy(() => import("./GenericConsumerPage"));

function ConsumerPage() {
  const { guid } = useParams();
  const [passport,      setPassport]      = useState(null);
  const [company,       setCompany]       = useState(null);
  const [typeDef,       setTypeDef]       = useState(null);
  const [dynamicValues, setDynamicValues] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");

  useEffect(() => {
    fetch(`${API}/api/passports/${guid}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrer: document.referrer, userAgent: navigator.userAgent }),
    }).catch(() => {});

    fetch(`${API}/api/passports/${guid}`)
      .then(r => r.ok ? r.json() : Promise.reject("not found"))
      .then(async data => {
        setPassport(data);
        const [companyRes, typeRes, dynamicRes] = await Promise.all([
          data.company_id   ? fetch(`${API}/api/companies/${data.company_id}/profile`)     : Promise.resolve(null),
          data.passport_type ? fetch(`${API}/api/passport-types/${data.passport_type}`)    : Promise.resolve(null),
          fetch(`${API}/api/passports/${guid}/dynamic-values`),
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
  }, [guid]);

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
