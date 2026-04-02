// eslint-disable-next-line no-unused-vars
import React from "react";
import { useNavigate } from "react-router-dom";
import "./Landing.css";

function Landing({ token, user, onLogout }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await onLogout?.();
    window.location.href = "/";
  };

  return (
    <div className="lp-root">

      {/* ── HEADER ── */}
      <header className="lp-header">
        <div className="lp-header-inner">
          <a className="lp-logo" href="/">
            <svg viewBox="0 0 36 36" fill="none" width="32" height="32" aria-hidden="true">
              <rect x="2" y="6" width="22" height="22" rx="4" stroke="#0db5b0" strokeWidth="1.8"/>
              <rect x="10" y="2" width="22" height="22" rx="4" fill="rgba(13,181,176,0.1)"
                    stroke="#0db5b0" strokeWidth="1.6" strokeDasharray="3 2.5"/>
              <circle cx="13" cy="17" r="3.5" stroke="#0db5b0" strokeWidth="1.7"/>
              <path d="M17 17 h8" stroke="#0db5b0" strokeWidth="1.7" strokeLinecap="round"/>
              <path d="M7 13 h4" stroke="#0db5b0" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M7 21 h4" stroke="#0db5b0" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Claros<span className="lp-logo-accent">DPP</span>
          </a>

          <nav className="lp-nav" aria-label="App navigation">
            {token ? (
              <>
                <button onClick={() => navigate("/dashboard")} className="lp-nav-btn">
                  Dashboard
                </button>
                {user?.role === "super_admin" && (
                  <button onClick={() => navigate("/admin")} className="lp-nav-btn lp-nav-admin">
                    Admin Panel
                  </button>
                )}
                <button onClick={handleLogout} className="lp-nav-btn lp-nav-logout">
                  Logout
                </button>
              </>
            ) : (
              <>
                <button onClick={() => navigate("/login")} className="lp-nav-btn">
                  Sign In
                </button>
                <button onClick={() => navigate("/register")} className="lp-nav-btn lp-nav-cta">
                  Get Started
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="lp-hero" aria-label="Welcome">
        <div className="lp-hero-bg" aria-hidden="true" />
        <div className="lp-hero-grid" aria-hidden="true" />
        <div className="lp-hero-inner">
          <div className="lp-hero-eyebrow">EU ESPR · Battery Regulation · Circularity</div>
          <h1 className="lp-hero-title">
            Digital Product Passports,<br/>
            <span className="lp-hl">Built for Compliance.</span>
          </h1>
          <p className="lp-hero-lead">
            Issue, manage, and track regulation-ready product passports across your entire portfolio.
            ClarosDPP keeps you ahead of EU sustainability mandates — automatically.
          </p>
          {!token ? (
            <div className="lp-hero-btns">
              <button onClick={() => navigate("/login")} className="lp-btn lp-btn-primary">
                Sign In to Platform
              </button>
              <button onClick={() => navigate("/register")} className="lp-btn lp-btn-outline">
                Create Account
              </button>
            </div>
          ) : (
            <div className="lp-hero-btns">
              <button onClick={() => navigate("/dashboard")} className="lp-btn lp-btn-primary">
                Go to Dashboard →
              </button>
              {user?.role === "super_admin" && (
                <button onClick={() => navigate("/admin")} className="lp-btn lp-btn-outline">
                  Admin Panel
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section lp-section-alt" aria-labelledby="lp-features-title">
        <div className="lp-container">
          <span className="lp-eyebrow">Platform Capabilities</span>
          <h2 className="lp-section-title" id="lp-features-title">
            Everything you need for <span className="lp-hl">DPP compliance</span>
          </h2>
          <div className="lp-features-grid">
            {[
              { icon: "🔐", title: "Secure Authentication",   desc: "JWT-secured access with role-based permissions across your organization." },
              { icon: "🏢", title: "Multi-Tenant",            desc: "Complete data isolation — each company's passports stay private and secure." },
              { icon: "📊", title: "Real-Time Analytics",     desc: "Company and system-wide analytics dashboards for full visibility." },
              { icon: "🪪", title: "Custom Passport Types",   desc: "Battery, Textile, Steel, Toys, Construction — or build your own schema." },
              { icon: "📋", title: "Audit Logging",           desc: "Complete change history with user attribution and timestamps." },
              { icon: "🔄", title: "Version Control",         desc: "Draft → Release → Revise workflow for controlled passport updates." },
            ].map(f => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon" aria-hidden="true">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PASSPORT TYPES ── */}
      <section className="lp-section" aria-labelledby="lp-types-title">
        <div className="lp-container">
          <span className="lp-eyebrow">Supported Regulations</span>
          <h2 className="lp-section-title" id="lp-types-title">
            Passport types <span className="lp-hl">built for EU mandates</span>
          </h2>
          <div className="lp-types-grid">
            {[
              { icon: "⚡", title: "Battery",       reg: "EU Battery Regulation 2027" },
              { icon: "🧵", title: "Textile",       reg: "Textile DPP 2026" },
              { icon: "🏗️", title: "Steel",         reg: "ESPR — Industrial Materials" },
              { icon: "🎮", title: "Toys",          reg: "ESPR — Consumer Products" },
              { icon: "🏢", title: "Construction",  reg: "ESPR — Building Materials" },
            ].map(t => (
              <div key={t.title} className="lp-type-card">
                <div className="lp-type-icon" aria-hidden="true">{t.icon}</div>
                <h4>{t.title}</h4>
                <p>{t.reg}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer" role="contentinfo">
        <div className="lp-container">
          <p>© 2025 ClarosDPP. All rights reserved.</p>
          <p>Compliance intelligence for the circular economy.</p>
        </div>
      </footer>

    </div>
  );
}

export default Landing;
