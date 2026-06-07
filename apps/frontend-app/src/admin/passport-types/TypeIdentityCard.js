import React from "react";

export function TypeIdentityCard({
  displayName,
  setDisplayName,
  productCategory,
  setProductCategory,
  productIcon,
  setProductIcon,
  semanticModelKey,
  setSemanticModelKey,
  semanticModelOptions,
  productCategoryOptions,
  typeName,
  setTypeName,
  setTypeNameManual,
  editMode,
  hasInvalid,
  setError,
  setInvalidFields,
  iconPresets,
}) {
  return (
    <div className="acpt-card">
      <h3 className="acpt-card-title">Type Identity</h3>

      <div className="acpt-meta-grid">
        <div className="acpt-field-group acpt-span2">
          <label>Display Name *</label>
          <input
            type="text"
            value={displayName}
            onChange={e => { setDisplayName(e.target.value); setError(""); setInvalidFields([]); }}
            placeholder="e.g. Product Passport v1"
            className={`acpt-input${hasInvalid("displayName") ? " acpt-input-error" : ""}`}
            required
          />
          <span className="acpt-hint">Shown to companies in their dashboard sidebar</span>
        </div>

        <div className="acpt-field-group acpt-span2">
          <label>Product Category *</label>
          <input
            type="text"
            value={productCategory}
            onChange={e => {
              const selected = productCategoryOptions.find(o => o.name === e.target.value);
              setProductCategory(e.target.value);
              setError("");
              setInvalidFields([]);
              if (selected) setProductIcon(selected.icon);
            }}
            list="passport-product-category-options"
            placeholder="e.g. Appliance"
            className={`acpt-input${hasInvalid("productCategory") ? " acpt-input-error" : ""}`}
            required
          />
          <datalist id="passport-product-category-options">
            {productCategoryOptions.map(o => (
              <option key={o.id || o.name} value={o.name}>{o.icon} {o.name}</option>
            ))}
          </datalist>
          <span className="acpt-hint">
            Type a new product category or choose an existing one. New categories are saved when the passport type is created.
          </span>
        </div>

        <div className="acpt-field-group">
          <label>Category Icon</label>
          <div className="acpt-icon-row">
            <input
              type="text"
              value={productIcon}
              onChange={e => setProductIcon(e.target.value)}
              className="acpt-input acpt-icon-input"
              maxLength={4}
            />
            <div className="acpt-icon-presets">
              {iconPresets.map(ic => (
                <button key={ic} type="button" className={`acpt-icon-btn ${productIcon === ic ? "selected" : ""}`} onClick={() => setProductIcon(ic)}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <span className="acpt-hint">Emoji shown in the sidebar next to category name</span>
        </div>

        <div className="acpt-field-group">
          <label>Internal Type Name *</label>
          <input
            type="text"
            value={typeName}
            onChange={e => { if (!editMode) { setTypeName(e.target.value); setTypeNameManual(true); } }}
            placeholder="e.g. productPassportV1"
            readOnly={editMode}
            className={`acpt-input acpt-mono${editMode ? " acpt-input-locked" : ""}${(!editMode && (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName) && typeName)) || hasInvalid("typeName") ? " acpt-input-error" : ""}`}
            pattern={editMode ? undefined : "^[a-z][A-Za-z0-9]{1,99}$"}
          />
          <span className="acpt-hint">
            {editMode
              ? "Type name is locked because it is a stable API identifier."
              : "Stable API identifier. Use camelCase, 2-100 chars, starting with a lowercase letter. Database table names are derived safely in storage."}
          </span>
          {!editMode && (
            <div className="acpt-table-preview">
              Table will be: <code>{typeName || "…"}_passports</code>
            </div>
          )}
        </div>

        <div className="acpt-field-group acpt-span2">
          <label>Semantic Model</label>
          <select
            value={semanticModelKey}
            onChange={e => {
              setSemanticModelKey(e.target.value);
              setError("");
              setInvalidFields([]);
            }}
            className={`acpt-input${hasInvalid("semanticModelKey") ? " acpt-input-error" : ""}`}
          >
            {semanticModelOptions.map((option) => (
              <option
                key={option.key || "none"}
                value={option.key}
              >
                {option.label}
              </option>
            ))}
          </select>
          <span className="acpt-hint">
            {(semanticModelOptions.find((option) => option.key === semanticModelKey) || semanticModelOptions[0])?.description}
          </span>
        </div>
      </div>
    </div>
  );
}
