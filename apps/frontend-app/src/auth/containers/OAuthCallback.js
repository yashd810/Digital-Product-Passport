import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function OAuthCallback({ setToken, setUser, setCompanyId }) {
  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const next = params.get("next") || "/dashboard";

    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/users/me`, {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "SSO session could not be established");

        localStorage.setItem("user", JSON.stringify(data));
        localStorage.setItem("companyId", data.company_id || "");
        setToken(true);
        setUser(data);
        setCompanyId(data.company_id || "");
        navigate(next, { replace: true });
      } catch (err) {
        setError(err.message || "SSO login failed");
      }
    })();
  }, [API_BASE_URL, location.search, navigate, setCompanyId, setToken, setUser]);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark">🌍</div>
          <div className="auth-logo-text">
            Digital Product Passport
            <span className="auth-logo-sub">Enterprise sign-in</span>
          </div>
        </div>

        <h1>Signing you in</h1>
        {error
          ? <p className="alert alert-error">{error}</p>
          : <p>Please wait while we finish your secure sign-in.</p>}
      </div>
    </div>
  );
}

export default OAuthCallback;
