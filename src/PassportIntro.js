import React from "react";
import "./PassportIntro.css";

function PassportIntro({ passport, isLoggedIn, onBack, onPrint, theme }) {

  if (!passport) return null;

  const primaryColor = theme?.primary || "#1C3738";
  const badgeColor   = theme?.badge   || "#d4e8e4";

  return (
    <>
      <div className="intro-content">
        <div className="intro-info">
          <h1>{passport.model_name}</h1>
          <div className="intro-info-list">
            <p><strong>Serial Number:</strong> <code className="pid-code">{passport.product_id || "—"}</code></p>
            <p><strong>Type:</strong>{" "}
              <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4,
                background:badgeColor, color:primaryColor,
                fontWeight:700, fontSize:13, textTransform:"capitalize" }}>
                {passport.passport_type}
              </span>
            </p>
            <p><strong>GUID:</strong> <code>{passport.guid}</code></p>
            <p><strong>Version:</strong> v{passport.version_number}</p>
            <p><strong>Status:</strong>{" "}
              <span className={`intro-status-badge ${passport.release_status}`}>
                {passport.release_status}
              </span>
            </p>
            <p><strong>Consumer page:</strong>{" "}
              <a href={`/p/${passport.guid}`} target="_blank" rel="noopener noreferrer"
                style={{ color:primaryColor, fontWeight:600, fontSize:13 }}>
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
