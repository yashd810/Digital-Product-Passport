import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";

function RedirectState({ message }) {
  return <div className="loading dashboard-loading-screen">{message}</div>;
}

export default function PublicPassportRedirectPage() {
  const navigate = useNavigate();
  const { internalAliasId, versionNumber } = useParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const encodedProductId = encodeURIComponent(internalAliasId || "");
    if (!encodedProductId) {
      setError("Public passport page not found.");
      return;
    }

    const endpoint = versionNumber
      ? `${API}/api/passports/by-product/${encodedProductId}?version=${encodeURIComponent(versionNumber)}`
      : `${API}/api/passports/by-product/${encodedProductId}`;

    let cancelled = false;
    setError("");

    fetchWithAuth(endpoint)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Passport not found")))
      .then((passport) => {
        if (cancelled) return;
        const targetPath = versionNumber ? passport?.inactivePath : passport?.publicPath;
        if (!targetPath) throw new Error("Passport not found");
        navigate(targetPath, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setError("Public passport page not found.");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, internalAliasId, versionNumber]);

  if (error) return <RedirectState message={error} />;
  return <RedirectState message="Opening passport…" />;
}
