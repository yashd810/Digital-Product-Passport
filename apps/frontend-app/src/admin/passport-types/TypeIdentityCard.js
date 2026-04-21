import React from "react";

export function TypeIdentityCard({
  displayName,
  setDisplayName,
  umbrella,
  setUmbrella,
  umbrellaIcon,
  setUmbrellaIcon,
  umbrellaOptions,
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
          <label>Umbrella Category *</label>
          {umbrellaOptions.length === 0 ? (
            <div className="acpt-hint acpt-hint-error">
              No umbrella categories yet.{" "}
              <a href="/admin/passport-types" className="acpt-hint-link">
                Go back and add one first.
              </a>
            </div>
          ) : (
            <select
              value={umbrella}
              onChange={e => {
                const selected = umbrellaOptions.find(o => o.name === e.target.value);
                setUmbrella(e.target.value);
                setError("");
                setInvalidFields([]);
                if (selected) setUmbrellaIcon(selected.icon);
              }}
              className={`acpt-input${hasInvalid("umbrella") ? " acpt-input-error" : ""}`}
              required
            >
              <option value="">— Select a category —</option>
              {umbrellaOptions.map(o => (
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
              value={umbrellaIcon}
              onChange={e => setUmbrellaIcon(e.target.value)}
              className="acpt-input acpt-icon-input"
              maxLength={4}
            />
            <div className="acpt-icon-presets">
              {iconPresets.map(ic => (
                <button key={ic} type="button" className={`acpt-icon-btn ${umbrellaIcon === ic ? "selected" : ""}`} onClick={() => setUmbrellaIcon(ic)}>
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
      </div>
    </div>
  );
}
