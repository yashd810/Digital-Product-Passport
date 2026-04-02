import React, { useState, useEffect } from "react";
import "./PassportViewer.css";

function PassportIntro({ passport, isLoggedIn, onBack, onPrint, theme }) {

  const primaryColor = theme?.primary || "#1C3738";
  const badgeColor   = theme?.badge   || "#d4e8e4";

  const [companyData, setCompanyData] = useState(null);
  useEffect(() => {
    if (!passport?.company_id) return;
    fetch(`${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/companies/${passport.company_id}/profile`)
      .then(r => r.ok ? r.json() : null).then(setCompanyData).catch(() => {});
  }, [passport?.company_id]);

  if (!passport) return null;
  const statusLabel = ["in_revision", "revised"].includes(passport.release_status)
    ? "In Revision"
    : String(passport.release_status || "").split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

  return (
    <>
      <div className="intro-content" style={{ "--intro-primary": primaryColor, "--intro-badge": badgeColor }}>
        <div className="intro-info">
          <h1>{passport.model_name}</h1>

          {/* Company Logo - positioned at bottom right */}
          {companyData?.company_logo && (
            <div className="intro-header-logo-box">
              <img src={companyData.company_logo} alt="Company Logo" className="intro-header-logo" />
            </div>
          )}

          <div className="intro-info-list">
            <p><strong>Product ID:</strong> <code className="pid-code">{passport.product_id || "—"}</code></p>
            <p><strong>Type:</strong>{" "}
              <span className="intro-type-badge">
                {passport.passport_type}
              </span>
            </p>
            <p><strong>GUID:</strong> <code>{passport.guid}</code></p>
            <p><strong>Version:</strong> v{passport.version_number}</p>
            <p><strong>Status:</strong>{" "}
              <span className={`intro-status-badge ${passport.release_status}`}>
                {statusLabel}
              </span>
            </p>
            <p><strong>Consumer page:</strong>{" "}
              <a href={`/p/${passport.guid}`} target="_blank" rel="noopener noreferrer"
                className="intro-consumer-link">
                /p/{passport.guid.substring(0,8)}…
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default PassportIntro;
