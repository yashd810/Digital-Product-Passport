import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { buildUserDashboardHomePath } from "../../user/dashboard/utils/dashboardRoutes";

function OAuthCallback({ setToken, setUser, setCompanyId }) {
  const API_BASE_URL = import.meta.env.VITE_API_URL || "";
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const requestedNext = new URLSearchParams(location.search).get("next") || "";

  useEffect(() => {
    (async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/api/users/me`, {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "SSO session could not be established");

        localStorage.setItem("user", JSON.stringify(data));
        localStorage.setItem("companyId", data.companyId || "");
        setToken(true);
        setUser(data);
        setCompanyId(data.companyId || "");
        const next = requestedNext || (
          data.role === "super_admin"
            ? "/admin"
            : buildUserDashboardHomePath({ user: data, companyId: data.companyId || "" })
        );
        navigate(next, { replace: true });
      } catch (err) {
        setError(err.message || "SSO login failed");
      }
    })();
  }, [API_BASE_URL, navigate, requestedNext, setCompanyId, setToken, setUser]);

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
