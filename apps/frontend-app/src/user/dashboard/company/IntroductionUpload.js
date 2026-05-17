import React, { useRef } from "react";
import "../../../passport-viewer/styles/PassportViewer.css";

/**
 * Fully controlled component — no internal state.
 * Props:
 *   logoPreview  : string|null   current logo base64 or null
 *   onLogoChange : (v) => void   called with base64 string or null
 */
function IntroductionUpload({ logoPreview, onLogoChange }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large. Maximum size is 5 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => onLogoChange(reader.result);
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-selecting same file
  };

  return (
    <div className="intro-upload-card">
      <h3 className="intro-upload-title">Company Logo</h3>

      <div className="intro-upload-grid">
        <div className="intro-col">
          <p className="intro-col-label">Company Logo</p>
          <div className="intro-logo-box">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Company logo"
                className="intro-logo-img"
              />
            ) : (
              <div className="intro-logo-empty">
                <span className="intro-logo-icon">🖼</span>
                <span className="intro-logo-hint">No logo uploaded</span>
              </div>
            )}
          </div>
          <div className="intro-logo-actions">
            <button
              type="button"
              className="intro-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {logoPreview ? "↺ Change Logo" : "⬆ Upload Logo"}
            </button>

            {logoPreview && (
              <button
                type="button"
                className="intro-remove-btn"
                onClick={() => onLogoChange(null)}
              >
                ✕ Remove
              </button>
            )}
          </div>

          <p className="intro-col-hint">JPG, PNG, SVG — max 5 MB</p>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="intro-upload-hidden-input"
          />
        </div>
      </div>
    </div>
  );
}

export default IntroductionUpload;
