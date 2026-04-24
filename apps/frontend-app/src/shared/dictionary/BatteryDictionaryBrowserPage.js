import React, { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "";

const DATA_TYPE_COLORS = {
  string: "#4a9eff",
  number: "#f59e0b",
  integer: "#f59e0b",
  array: "#8b5cf6",
  uri: "#10b981",
};

function TypeBadge({ jsonType, format }) {
  const display = format === "uri" ? "URI" : jsonType || "string";
  const color = DATA_TYPE_COLORS[format === "uri" ? "uri" : jsonType] || "#6b7280";
  return (
    <span style={{
      display: "inline-block",
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 4,
      background: color + "22",
      color,
      border: `1px solid ${color}44`,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    }}>
      {display}
    </span>
  );
}

function TermCard({ term, units }) {
  const unitObj = units.find(u => u.key === term.unit);
  const unitDisplay = unitObj ? unitObj.display : term.unit === "none" ? null : term.unit;

  return (
    <div style={{
      background: "var(--card-bg, #fff)",
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: 8,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>{term.label}</strong>
            <TypeBadge jsonType={term.dataType?.jsonType} format={term.dataType?.format} />
            {unitDisplay && (
              <span style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>{unitDisplay}</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)", margin: "0 0 6px" }}>
            {term.definition}
          </p>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace", wordBreak: "break-all" }}>
            <span style={{ color: "#d1d5db" }}>IRI: </span>
            <a href={term.iri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #4a9eff)" }}>
              {term.iri}
            </a>
          </div>
          {term.appFieldKeys?.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#9ca3af" }}>
              <span style={{ color: "#d1d5db" }}>Field keys: </span>
              {term.appFieldKeys.map(k => (
                <code key={k} style={{
                  background: "var(--code-bg, #f3f4f6)", borderRadius: 3,
                  padding: "1px 4px", marginRight: 4, fontSize: 10,
                }}>{k}</code>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>
          #{term.specRef}
        </div>
      </div>
    </div>
  );
}

export default function BatteryDictionaryBrowserPage() {
  const [terms, setTerms] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/dictionary/battery/v1/terms`).then(r => r.json()),
      fetch(`${API}/api/dictionary/battery/v1/categories`).then(r => r.json()),
      fetch(`${API}/api/dictionary/battery/v1/units`).then(r => r.json()),
      fetch(`${API}/api/dictionary/battery/v1/manifest`).then(r => r.json()),
    ])
      .then(([t, c, u, m]) => {
        setTerms(t);
        setCategories(c);
        setUnits(u);
        setManifest(m);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load dictionary. Please try again.");
        setLoading(false);
      });
  }, []);

  const filteredTerms = terms.filter(t => {
    const matchesCategory = !activeCategory || t.category === activeCategory;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      t.label.toLowerCase().includes(q) ||
      t.definition.toLowerCase().includes(q) ||
      (t.appFieldKeys || []).some(k => k.includes(q));
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary, #6b7280)" }}>
        Loading battery dictionary…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#ef4444" }}>{error}</div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
          Battery DPP Dictionary
        </h1>
        {manifest && (
          <p style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)", margin: "0 0 8px" }}>
            {manifest.name} · v{manifest.version} · {terms.length} terms
          </p>
        )}
        <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>
          Base IRI:{" "}
          <a
            href={manifest?.baseIri}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent, #4a9eff)" }}
          >
            {manifest?.baseIri}
          </a>
        </div>
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Search terms, field keys, definitions…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "9px 14px",
          borderRadius: 8,
          border: "1px solid var(--border, #e5e7eb)",
          fontSize: 14,
          marginBottom: 16,
          background: "var(--input-bg, #fff)",
          color: "var(--text, #111)",
          boxSizing: "border-box",
        }}
      />

      {/* Category tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
        <button
          onClick={() => setActiveCategory(null)}
          style={{
            padding: "5px 12px",
            borderRadius: 20,
            fontSize: 12,
            border: "1px solid var(--border, #e5e7eb)",
            background: !activeCategory ? "var(--accent, #4a9eff)" : "transparent",
            color: !activeCategory ? "#fff" : "var(--text, #111)",
            cursor: "pointer",
          }}
        >
          All ({terms.length})
        </button>
        {categories.map(cat => {
          const count = terms.filter(t => t.category === cat.key).length;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 20,
                fontSize: 12,
                border: "1px solid var(--border, #e5e7eb)",
                background: activeCategory === cat.key ? "var(--accent, #4a9eff)" : "transparent",
                color: activeCategory === cat.key ? "#fff" : "var(--text, #111)",
                cursor: "pointer",
              }}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px" }}>
        {filteredTerms.length} term{filteredTerms.length !== 1 ? "s" : ""}
        {activeCategory && categories.find(c => c.key === activeCategory)
          ? ` in ${categories.find(c => c.key === activeCategory).label}` : ""}
        {search ? ` matching "${search}"` : ""}
      </p>

      {/* Terms list */}
      {filteredTerms.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
          No terms found.
        </div>
      ) : (
        filteredTerms.map(term => (
          <TermCard key={term.slug} term={term} units={units} />
        ))
      )}

      {/* Footer links */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--border, #e5e7eb)", fontSize: 12, color: "#9ca3af" }}>
        <a href={`${API}/dictionary/battery/v1/context.jsonld`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #4a9eff)", marginRight: 16 }}>
          JSON-LD Context
        </a>
        <a href={`${API}/api/dictionary/battery/v1/manifest`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #4a9eff)", marginRight: 16 }}>
          Manifest
        </a>
        <a href={`${API}/api/dictionary/battery/v1/terms`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #4a9eff)", marginRight: 16 }}>
          Terms JSON
        </a>
        <a href={`${API}/api/dictionary/battery/v1/units`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #4a9eff)" }}>
          Units
        </a>
      </div>
    </div>
  );
}
