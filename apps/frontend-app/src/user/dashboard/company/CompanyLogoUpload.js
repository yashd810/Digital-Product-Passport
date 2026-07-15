import React, { useRef } from "react";
import { toSafeImageSrc } from "../../../shared/security/urlSafety";

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function CompanyLogoUpload({ logoPreview, onLogoChange }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large. Maximum size is 5 MB.");
      event.target.value = "";
      return;
    }
    if (!allowedImageTypes.has(file.type)) {
      alert("Use a PNG, JPEG, WebP, or GIF image.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const safeImage = toSafeImageSrc(reader.result);
      if (!safeImage) {
        alert("The selected image could not be used safely.");
        return;
      }
      onLogoChange(safeImage);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <div className="company-logo-upload-card">
      <h3 className="company-logo-upload-title">Company Logo</h3>

      <div className="company-logo-upload-grid">
        <div className="company-logo-upload-col">
          <p className="company-logo-upload-label">Company Logo</p>
          <div className="company-logo-upload-box">
            {toSafeImageSrc(logoPreview) ? (
              <img
                src={toSafeImageSrc(logoPreview)}
                alt="Company logo"
                className="company-logo-upload-img"
              />
            ) : (
              <div className="company-logo-upload-empty">
                <span className="company-logo-upload-icon">🖼</span>
                <span className="company-logo-upload-hint">No logo uploaded</span>
              </div>
            )}
          </div>

          <div className="company-logo-upload-actions">
            <button
              type="button"
              className="company-logo-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {logoPreview ? "↺ Change Logo" : "⬆ Upload Logo"}
            </button>

            {logoPreview ? (
              <button
                type="button"
                className="company-logo-remove-btn"
                onClick={() => onLogoChange(null)}
              >
                ✕ Remove
              </button>
            ) : null}
          </div>

          <p className="company-logo-upload-hint">PNG, JPG, WebP, or GIF — max 5 MB</p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            className="company-logo-upload-input"
          />
        </div>
      </div>
    </div>
  );
}

export default CompanyLogoUpload;
