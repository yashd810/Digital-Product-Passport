import React, { useRef } from "react";
import "../../../passport-viewer/styles/PassportViewer.css";

/**
 * Fully controlled component — no internal state.
 * Props:
 *   logoPreview  : string|null   current logo base64 or null
 *   introText    : string        current intro text
 *   onLogoChange : (v) => void   called with base64 string or null
 *   onTextChange : (v) => void   called with new text string
 */
function IntroductionUpload({ logoPreview, introText, onLogoChange, onTextChange }) {
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
      <h3 className="intro-upload-title">Company Profile</h3>

      <div className="intro-upload-grid">

        {/* ── Logo column ── */}
        <div className="intro-col">
          <p className="intro-col-label">Company Logo</p>

          {/* Preview box — fixed height so both columns stay equal */}
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

          {/* Buttons always sit below the preview box */}
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

        {/* ── Text column ── */}
        <div className="intro-col">
          <p className="intro-col-label">Introduction Text</p>

          {/* Textarea fills the same fixed height as the logo box */}
          <textarea
            className="intro-textarea"
            value={introText}
            onChange={e => onTextChange(e.target.value)}
            placeholder="Write a compelling introduction about your company and products. Highlight key features, certifications, and sustainability commitments..."
          />

          <p className="intro-col-hint">
            {introText.length} characters · Recommended: 300–800
          </p>
        </div>

      </div>
    </div>
  );
}

export default IntroductionUpload;
