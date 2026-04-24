// ForgotPassword.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Landing.css";

const API = import.meta.env.VITE_API_URL || "";
const PASSWORD_MIN_LENGTH = 12;

export function ForgotPassword() {
  const navigate = useNavigate();
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await fetch(`${API}/api/auth/forgot-password`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Request failed");
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📬</div>
          <h1>Check your inbox</h1>
          <p>
            If <strong>{email}</strong> is registered, a reset link has been sent.
            It expires in <strong>1 hour</strong>.
          </p>
          <p style={{ color: "var(--steel)", fontSize: 13 }}>
            Didn't receive it? Check your spam folder.
          </p>
          <div className="auth-divider" />
          <button className="auth-btn" onClick={() => navigate("/login")}>
            ← Back to Sign In
          </button>
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
            <span className="auth-logo-sub">Password Recovery</span>
          </div>
        </div>
        <h1>Forgot your password?</h1>
        <p>Enter your email and we'll send you a reset link.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email" type="email" value={email} required
              placeholder="you@company.com" disabled={loading}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="auth-btn" disabled={loading || !email.trim()}>
            {loading && <span className="btn-spinner" />}
            {loading ? "Sending…" : "Send Reset Link"}
          </button>
        </form>
        <div className="auth-divider" />
        <div className="auth-footer">
          <p>
            <button className="link-btn" onClick={() => navigate("/login")}>
              ← Back to sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ResetPassword.js
// ─────────────────────────────────────────────────────────────────
export function ResetPassword() {
  const navigate  = useNavigate();
  const params    = new URLSearchParams(window.location.search);
  const token     = params.get("token");

  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState("");
  const [tokenOk,   setTokenOk]   = useState(true);

  React.useEffect(() => {
    if (!token) { setTokenOk(false); return; }
    fetch(`${API}/api/auth/validate-reset-token?token=${token}`)
      .then(r => r.json())
      .then(d => { if (!d.valid) setTokenOk(false); })
      .catch(() => setTokenOk(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      return;
    }
    if (password !== confirm)  { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/auth/reset-password`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, newPassword: password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Reset failed");
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const strength = (p) => {
    if (!p) return null;
    if (p.length < PASSWORD_MIN_LENGTH) return { label:"Too short", color:"#e53e3e", pct:20 };
    if (p.length < PASSWORD_MIN_LENGTH + 2) return { label:"Weak", color:"#dd6b20", pct:40 };
    const has = (re) => re.test(p);
    const score = [has(/[A-Z]/),has(/[0-9]/),has(/[^A-Za-z0-9]/)].filter(Boolean).length;
    if (score === 0) return { label:"Fair",   color:"#d69e2e", pct:55 };
    if (score === 1) return { label:"Good",   color:"#38a169", pct:75 };
    return               { label:"Strong",  color:"#2f855a", pct:100 };
  };
  const str = strength(password);

  if (!tokenOk) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign:"center" }}>
          <div style={{ fontSize:44, marginBottom:12 }}>⏰</div>
          <h1>Link expired</h1>
          <p>This reset link has expired or already been used.</p>
          <div className="auth-divider" />
          <button className="auth-btn" onClick={() => navigate("/forgot-password")}>
            Request a new link
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign:"center" }}>
          <div style={{ fontSize:44, marginBottom:12 }}>✅</div>
          <h1>Password updated</h1>
          <p>Your password has been reset successfully. You can now sign in.</p>
          <div className="auth-divider" />
          <button className="auth-btn" onClick={() => navigate("/login")}>
            Go to Sign In
          </button>
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
            <span className="auth-logo-sub">Password Reset</span>
          </div>
        </div>
        <h1>Set a new password</h1>
        <p>Choose a strong password for your account.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="newpw">New Password</label>
            <input
              id="newpw" type="password" value={password} required
              placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`} disabled={loading}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            {str && (
              <div style={{ marginTop:6 }}>
                <div style={{ height:4, borderRadius:2, background:"#e2e8f0", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${str.pct}%`, background:str.color, transition:"width .3s ease" }} />
                </div>
                <span style={{ fontSize:11, color:str.color, fontWeight:600 }}>{str.label}</span>
              </div>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="confirmpw">Confirm Password</label>
            <input
              id="confirmpw" type="password" value={confirm} required
              placeholder="Repeat new password" disabled={loading}
              onChange={e => setConfirm(e.target.value)}
              style={{ borderColor: confirm && confirm !== password ? "#e53e3e" : undefined }}
            />
            {confirm && confirm !== password && (
              <span style={{ fontSize:11, color:"#e53e3e", marginTop:4 }}>Passwords do not match</span>
            )}
          </div>
          <button type="submit" className="auth-btn" disabled={loading || !password || !confirm}>
            {loading && <span className="btn-spinner" />}
            {loading ? "Saving…" : "Reset Password"}
          </button>
        </form>
        <div className="auth-divider" />
        <div className="auth-footer">
          <p>
            <button className="link-btn" onClick={() => navigate("/login")}>
              ← Back to sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
