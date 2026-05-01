import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import "../styles/Landing.css";

function Login({ setToken, setUser, setCompanyId }) {
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL || "";

  // Step 1: credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2: OTP
  const [step, setStep] = useState("credentials"); // "credentials" | "otp"
  const [preAuthToken, setPreAuthToken] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [ssoProviders, setSsoProviders] = useState([]);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  useEffect(() => {
    fetchWithAuth(`${API_BASE_URL}/api/auth/sso/providers`, { credentials: "include" })
      .then((response) => response.json())
      .then((data) => setSsoProviders(Array.isArray(data.providers) ? data.providers : []))
      .catch(() => setSsoProviders([]));
  }, [API_BASE_URL]);

  const startCooldown = () => {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const finishLogin = (data) => {
    // Save user info and company ID; authenticated browser requests use the httpOnly session cookie
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem("companyId", data.user.companyId || data.user.company_id || "");
    setToken(true);
    setUser(data.user);
    setCompanyId(data.user.companyId || data.user.company_id || "");
    if (data.user.role === "super_admin") navigate("/admin");
    else navigate("/dashboard");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invalid credentials");

      if (data.requires_2fa) {
        setPreAuthToken(data.pre_auth_token);
        setStep("otp");
        setOtp("");
        startCooldown();
      } else {
        finishLogin(data);
      }
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pre_auth_token: preAuthToken, otp }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invalid code");
      finishLogin(data);
    } catch (err) {
      setError(err.message || "Verification failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pre_auth_token: preAuthToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to resend");
      startCooldown();
    } catch (err) {
      setError(err.message);
    }
  };

  const startSso = (providerKey) => {
    const next = new URLSearchParams(window.location.search).get("next") || "";
    const target = `${API_BASE_URL}/api/auth/sso/${providerKey}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    window.location.assign(target);
  };

  if (step === "otp") {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-mark">🌍</div>
            <div className="auth-logo-text">
              Digital Product Passport
              <span className="auth-logo-sub">Verification required</span>
            </div>
          </div>

          <h1>Check your email</h1>
          <p>A 6-digit code was sent to <strong>{email}</strong></p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleVerifyOtp} className="auth-form">
            <div className="form-group">
              <label htmlFor="otp">Verification Code</label>
              <div className="otp-input-wrapper">
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  disabled={isLoading}
                  autoFocus
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn-submit" disabled={isLoading || otp.length !== 6}>
              {isLoading && <span className="btn-spinner" />}
              {isLoading ? "Verifying…" : "Verify & Sign In"}
            </button>
          </form>

          <div className="auth-footer">
            <p>
              Didn't receive a code?{" "}
              {resendCooldown > 0
                ? <span style={{ color: "var(--steel)" }}>Resend in {resendCooldown}s</span>
                : <button className="link-btn" onClick={handleResend}>Resend code</button>
              }
            </p>
            <p>
              <button className="link-btn" onClick={() => { setStep("credentials"); setError(""); }}>
                ← Back to login
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark">🌍</div>
          <div className="auth-logo-text">
            Digital Product Passport
            <span className="auth-logo-sub">Management Platform</span>
          </div>
        </div>

        <h1>Sign in</h1>
        <p>Welcome back — enter your credentials below</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              required
            />
            <div className="auth-forgot-row">
              <Link to="/forgot-password" className="auth-forgot-link">Forgot password?</Link>
            </div>
          </div>

          <button type="submit" className="btn-submit" disabled={isLoading}>
            {isLoading && <span className="btn-spinner" />}
            {isLoading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        {!!ssoProviders.length && (
          <>
            <div className="auth-divider" />
            <div className="auth-form">
              {ssoProviders.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  className="btn-submit"
                  onClick={() => startSso(provider.key)}
                >
                  Continue with {provider.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="auth-footer">
          <p>
            Don't have an account? Ask your team admin to send you an invite.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
