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
            placeholder="e.g. EV Battery Passport"
            className={`acpt-input${hasInvalid("displayName") ? " acpt-input-error" : ""}`}
            required
          />
          <span className="acpt-hint">Shown to companies in their dashboard sidebar</span>
        </div>

        <div className="acpt-field-group acpt-span2">
          <label>Product Category *</label>
          {productCategoryOptions.length === 0 ? (
            <div className="acpt-hint acpt-hint-error">
              No product categories yet.{" "}
              <a href="/admin/passport-types" className="acpt-hint-link">
                Go back and add one first.
              </a>
            </div>
          ) : (
            <select
              value={productCategory}
              onChange={e => {
                const selected = productCategoryOptions.find(o => o.name === e.target.value);
                setProductCategory(e.target.value);
                setError("");
                setInvalidFields([]);
                if (selected) setProductIcon(selected.icon);
              }}
              className={`acpt-input${hasInvalid("productCategory") ? " acpt-input-error" : ""}`}
              required
            >
              <option value="">— Select a category —</option>
              {productCategoryOptions.map(o => (
                <option key={o.id} value={o.name}>{o.icon} {o.name}</option>
              ))}
            </select>
          )}
          <span className="acpt-hint">Group label for analytics and sidebar hierarchy. Manage categories in the Passport Types page.</span>
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
          <label>Internal Type Name (slug) *</label>
          <input
            type="text"
            value={typeName}
            onChange={e => { if (!editMode) { setTypeName(e.target.value.toLowerCase()); setTypeNameManual(true); } }}
            placeholder="e.g. ev_battery"
            readOnly={editMode}
            className={`acpt-input acpt-mono${editMode ? " acpt-input-locked" : ""}${(!editMode && (!/^[a-z][a-z0-9_]{1,29}$/.test(typeName) && typeName)) || hasInvalid("typeName") ? " acpt-input-error" : ""}`}
            pattern={editMode ? undefined : "^[a-z][a-z0-9_]{1,29}$"}
          />
          <span className="acpt-hint">
            {editMode
              ? "Type name is locked — it maps to database tables and cannot change."
              : "Used in database table names. Auto-generated from display name. Must be 2–30 chars: lowercase letters, numbers, underscores."}
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
