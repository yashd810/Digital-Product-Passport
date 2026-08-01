// Product-image control: validates resource links and delegates selection/state to its parent.
import React from "react";
import { toSafeImageSrc, toSafeResourceHref } from "../../../shared/security/urlSafety";

/**
 * Product-image input for the passport editor.
 *
 * The parent owns draft state and picker visibility. This component contains
 * only the repository-link UI and validates pasted URLs before returning them.
 */
function PassportProductImagePicker({ value, disabled, onChange, onOpenPicker }) {
  const linkedUrl = toSafeImageSrc(value);

  const commitPastedUrl = (input) => {
    const safeUrl = toSafeResourceHref(input);
    if (safeUrl) onChange(safeUrl);
    return Boolean(safeUrl);
  };

  return (
    <div className="passport-field-group passport-product-image-group">
      <label>Product Image</label>
      <div className="file-upload-widget">
        {linkedUrl ? (
          <div className="file-existing image-existing">
            <img src={linkedUrl} alt="Product" className="pf-product-image-thumb" />
            <span className="file-existing-link">Repository image linked</span>
            <button
              type="button"
              className="file-clear-btn"
              disabled={disabled}
              onClick={() => onChange("")}
            >
              ✕ Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="file-upload-label"
            disabled={disabled}
            onClick={onOpenPicker}
          >
            <span className="file-placeholder">🖼 Link Product Image from Symbols</span>
          </button>
        )}
        {linkedUrl && (
          <button
            type="button"
            className="file-upload-label file-replace-label"
            disabled={disabled}
            onClick={onOpenPicker}
          >
            <span className="file-placeholder">↺ Change</span>
          </button>
        )}
        <div className="file-link-paste">
          <input
            type="text"
            className="file-link-input"
            placeholder="Or paste a repository image link here…"
            disabled={disabled}
            data-field-key="productImage"
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").trim();
              if (commitPastedUrl(pasted)) event.preventDefault();
            }}
            onBlur={(event) => {
              if (commitPastedUrl(event.target.value.trim())) event.target.value = "";
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && commitPastedUrl(event.target.value.trim())) {
                event.target.value = "";
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default PassportProductImagePicker;
