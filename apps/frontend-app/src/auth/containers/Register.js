import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../styles/Landing.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function Register({ setToken, setUser, setCompanyId }) {
  const navigate  = useNavigate();
  const location  = useLocation();

  // Read token from URL: /register?token=abc123
  const queryParams   = new URLSearchParams(location.search);
  const inviteToken   = queryParams.get("token");

  // Token validation state
  const [tokenStatus,  setTokenStatus]  = useState("checking"); // checking | valid | invalid
  const [tokenData,    setTokenData]    = useState(null);        // { email, company_name, role_to_assign }
  const [tokenError,   setTokenError]   = useState("");

  // Form state
  const [firstName,    setFirstName]    = useState("");
  const [lastName,     setLastName]     = useState("");
  const [password,     setPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,        setError]        = useState("");
  const [isLoading,    setIsLoading]    = useState(false);

  // ── Validate token on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!inviteToken) {
      setTokenStatus("invalid");
      setTokenError("no_token");
      return;
    }

    (async () => {
      try {
        const r = await fetch(`${API}/api/invite/validate?token=${inviteToken}`);
        const data = await r.json();
        if (r.ok && data.valid) {
          setTokenData(data);
          setTokenStatus("valid");
        } else {
          setTokenStatus("invalid");
          setTokenError(data.error || "Invalid invitation");
        }
      } catch {
        setTokenStatus("invalid");
        setTokenError("Could not verify invitation. Please check your internet connection.");
      }
    })();
  }, [inviteToken]);

  // ── Submit registration ───────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!firstName || !lastName || !password || !confirmPassword) {
      setError("All fields are required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token:     inviteToken,
          firstName,
          lastName,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok)
        throw new Error(data.error || "Registration failed");

      localStorage.setItem("user",      JSON.stringify(data.user));
      localStorage.setItem("companyId", data.user.companyId || "");

      setToken(true);
      setUser(data.user);
      setCompanyId(data.user.companyId);

      navigate(data.user.role === "super_admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const AuthLogo = () => (
    <div className="auth-logo">
      <div className="auth-logo-mark">🌍</div>
      <div className="auth-logo-text">
        Digital Product Passport
        <span className="auth-logo-sub">Management Platform</span>
      </div>
    </div>
  );

  // ── Render: checking token ────────────────────────────────────────────────
  if (tokenStatus === "checking") {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <AuthLogo />
          <div className="loading" style={{ paddingTop: 10 }}>
            Verifying your invitation…
          </div>
        </div>
      </div>
    );
  }

  // ── Render: invalid / no token ────────────────────────────────────────────
  if (tokenStatus === "invalid") {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <AuthLogo />
          <h1>Invitation Required</h1>
          <p>This page requires a valid invitation link.</p>

          <div className="alert alert-error">
            {tokenError === "no_token"
              ? "No invitation token found. Please use the link from your email."
              : tokenError}
          </div>

          <div style={{ textAlign: "center", marginTop: 16, color: "var(--charcoal)", fontSize: 14, lineHeight: 1.7 }}>
            <p>To register, ask a team admin to send you an invite from their dashboard.</p>
          </div>

          <div className="auth-divider" />
          <p className="auth-link">
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </div>
      </div>
    );
  }

  // ── Render: valid token — show registration form ──────────────────────────
  return (
    <div className="auth-container">
      <div className="auth-card">
        <AuthLogo />
        <h1>Complete Registration</h1>

        {/* Invitation info banner */}
        <div className="invite-banner">
          <p className="invite-banner-label">You have been invited to join</p>
          <p className="invite-banner-company">
            {tokenData.company_name || (tokenData.role_to_assign === "super_admin" ? "Digital Product Passport" : "the platform")}
          </p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleRegister} className="auth-form">

          {/* Email — locked, pre-filled from token */}
          <div className="form-group">
            <label htmlFor="email">
              Email Address
              <span style={{
                marginLeft: 8, fontSize: 10, background: "#e0e0e0", color: "#777",
                padding: "2px 7px", borderRadius: 10, fontWeight: 600, textTransform: "uppercase",
              }}>
                locked
              </span>
            </label>
            <input
              id="email"
              type="email"
              value={tokenData.email}
              readOnly
              disabled
              style={{ background: "#f0f0f0", color: "#888", cursor: "not-allowed" }}
            />
          </div>

          {/* Name row */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName">First Name</label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="John"
                required
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="lastName">Last Name</label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Doe"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Password row */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <button type="submit" className="auth-btn" disabled={isLoading}>
            {isLoading && <span className="btn-spinner" />}
            {isLoading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div className="auth-divider" />
        <p className="auth-link">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}

export default Register;
