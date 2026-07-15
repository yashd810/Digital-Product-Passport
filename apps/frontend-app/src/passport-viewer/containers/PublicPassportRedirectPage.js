import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { toSafeInternalPath } from "../../shared/security/urlSafety";

const api = import.meta.env.VITE_API_URL || "";

function RedirectState({ message }) {
  return <div className="loading dashboard-loading-screen">{message}</div>;
}

export default function PublicPassportRedirectPage() {
  const navigate = useNavigate();
  const { dppId, versionNumber } = useParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const encodedDppId = encodeURIComponent(dppId || "");
    if (!encodedDppId) {
      setError("Public passport page not found.");
      return;
    }

    const endpoint = versionNumber
      ? `${api}/api/public/passports/${encodedDppId}?version=${encodeURIComponent(versionNumber)}`
      : `${api}/api/public/passports/${encodedDppId}`;

    let cancelled = false;
    setError("");

    fetchWithAuth(endpoint)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Passport not found")))
      .then((passport) => {
        if (cancelled) return;
        const targetPath = toSafeInternalPath(
          versionNumber ? passport?.inactivePath : passport?.publicPath,
          { allowedPrefixes: ["/dpp"] }
        );
        if (!targetPath) throw new Error("Passport not found");
        navigate(targetPath, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setError("Public passport page not found.");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, dppId, versionNumber]);

  if (error) return <RedirectState message={error} />;
  return <RedirectState message="Opening passport…" />;
}
