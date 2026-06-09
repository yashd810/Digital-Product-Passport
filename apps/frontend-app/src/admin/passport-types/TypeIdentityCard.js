import React, { useEffect, useMemo, useRef, useState } from "react";
import AdminSelectMenu from "../components/AdminSelectMenu";

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
  const categoryMenuRef = useRef(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);

  const filteredProductCategoryOptions = useMemo(() => {
    const normalizedQuery = String(productCategory || "").trim().toLowerCase();
    if (!normalizedQuery) return productCategoryOptions;
    return productCategoryOptions.filter((option) =>
      String(option.name || "").toLowerCase().includes(normalizedQuery)
    );
  }, [productCategory, productCategoryOptions]);

  useEffect(() => {
    if (!categoryMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target)) {
        setCategoryMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [categoryMenuOpen]);

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
          <div className="acpt-category-combobox" ref={categoryMenuRef}>
            <input
              type="text"
              value={productCategory}
              onFocus={() => setCategoryMenuOpen(true)}
              onChange={e => {
                const nextValue = e.target.value;
                const selected = productCategoryOptions.find(o => o.name === nextValue);
                setProductCategory(nextValue);
                setError("");
                setInvalidFields([]);
                if (selected) setProductIcon(selected.icon);
                setCategoryMenuOpen(true);
              }}
              placeholder="e.g. Appliance"
              className={`acpt-input${hasInvalid("productCategory") ? " acpt-input-error" : ""}`}
              required
              aria-expanded={categoryMenuOpen}
              aria-haspopup="listbox"
            />
            {categoryMenuOpen && filteredProductCategoryOptions.length > 0 && (
              <div className="acpt-category-menu" role="listbox">
                {filteredProductCategoryOptions.map((option) => {
                  const selected = option.name === productCategory;
                  return (
                    <button
                      key={option.id || option.name}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`acpt-category-option${selected ? " selected" : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setProductCategory(option.name);
                        setProductIcon(option.icon);
                        setError("");
                        setInvalidFields([]);
                        setCategoryMenuOpen(false);
                      }}
                    >
                      <span className="acpt-category-option-icon">{option.icon}</span>
                      <span className="acpt-category-option-label">{option.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
          <AdminSelectMenu
            id="semanticModelKey"
            value={semanticModelKey}
            onChange={(nextValue) => {
              setSemanticModelKey(nextValue);
              setError("");
              setInvalidFields([]);
            }}
            options={semanticModelOptions.map((option) => ({
              value: option.key,
              label: option.label,
            }))}
            className={hasInvalid("semanticModelKey") ? "acpt-select acpt-select-error" : "acpt-select"}
            triggerClassName="acpt-input acpt-select-trigger"
            menuClassName="acpt-select-menu"
            optionClassName="acpt-select-option"
            ariaLabel="Semantic model"
          />
          <span className="acpt-hint">
            {(semanticModelOptions.find((option) => option.key === semanticModelKey) || semanticModelOptions[0])?.description}
          </span>
        </div>
      </div>
    </div>
  );
}
