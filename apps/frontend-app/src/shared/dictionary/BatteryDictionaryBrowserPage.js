import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import "./BatteryDictionaryBrowserPage.css";

const API = import.meta.env.VITE_API_URL || "";

const DATA_TYPE_COLORS = {
  string: "#4a9eff",
  number: "#f59e0b",
  integer: "#f59e0b",
  array: "#8b5cf6",
  uri: "#10b981",
};

function buildDictionaryBasePath(pathname) {
  if (pathname.startsWith("/admin/")) return "/admin/dictionary/battery/v1";
  if (pathname.startsWith("/dashboard/")) return "/dashboard/dictionary/battery/v1";
  return "/dictionary/battery/v1";
}

async function fetchJson(url) {
  const response = await fetchWithAuth(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function TypeBadge({ jsonType, format }) {
  const display = format === "URI/URL" ? "URI" : jsonType || "string";
  const typeKey = format === "URI/URL" ? "uri" : (jsonType || "string");
  const color = DATA_TYPE_COLORS[typeKey] || "#6b7280";
  return (
    <span
      className={`dictionary-type-badge dictionary-type-${typeKey.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "default"}`}
      style={{
        "--dictionary-type-color": color,
        "--dictionary-type-background": `${color}22`,
        "--dictionary-type-border": `${color}44`,
      }}
    >
      {display}
    </span>
  );
}

function TermCard({ term, unitsByKey, termHref }) {
  const unitObj = unitsByKey.get(term.unit);
  const unitDisplay = term.unitDisplay || unitObj?.display || (term.unit === "none" ? null : term.unit);

  return (
    <article className="dictionary-term-card">
      <div className="dictionary-term-header">
        <div className="dictionary-term-main">
          <div className="dictionary-term-heading-row">
            <strong className="dictionary-term-title">{term.label}</strong>
            <TypeBadge jsonType={term.dataType?.jsonType} format={term.dataType?.format} />
            {unitDisplay && <span className="dictionary-term-unit">{unitDisplay}</span>}
          </div>
          <p className="dictionary-term-definition">{term.definition}</p>
          <div className="dictionary-term-meta-line">
            <span className="dictionary-term-meta-label">IRI:</span>
            <a href={term.iri} target="_blank" rel="noopener noreferrer" className="dictionary-link dictionary-link-mono">
              {term.iri}
            </a>
          </div>
          {term.appFieldKeys?.length > 0 && (
            <div className="dictionary-term-field-row">
              <span className="dictionary-term-meta-label">Field keys:</span>
              {term.appFieldKeys.map((key) => (
                <code key={key} className="dictionary-field-pill">{key}</code>
              ))}
            </div>
          )}
        </div>
        <div className="dictionary-term-side">
          <div className="dictionary-term-ref">#{term.specRef || term.number}</div>
          <Link to={termHref} className="dictionary-card-link">Open term</Link>
        </div>
      </div>
    </article>
  );
}

function DetailRow({ label, value, mono = false, empty = "Not specified" }) {
  const display = value === null || value === undefined || value === "" ? empty : value;
  return (
    <div className="dictionary-detail-item">
      <span className="dictionary-detail-label">{label}</span>
      <span className={`dictionary-detail-value${mono ? " dictionary-detail-value-mono" : ""}`}>{display}</span>
    </div>
  );
}

function DictionaryDetail({ term, categories, unitsByKey, manifest, basePath }) {
  const categoryLabel = categories.find((category) => category.key === term.category)?.label || term.categoryLabel || term.category;
  const unitDisplay = term.unitDisplay || unitsByKey.get(term.unit)?.display || (term.unit === "none" ? "n.a." : term.unit);

  return (
    <>
      <div className="dictionary-results-bar">
        <Link to={basePath} className="dictionary-inline-link">Back to dictionary</Link>
        <div className="dictionary-footer-links">
          <a href={`${API}/api/dictionary/battery/v1/terms/${term.slug}`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
            Term JSON
          </a>
          <a href={term.iri} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
            Term IRI
          </a>
        </div>
      </div>

      <div className="dictionary-detail-layout">
        <section className="dictionary-detail-panel dictionary-detail-main">
          <div className="dictionary-chip-row">
            <span className="dictionary-chip">Term #{term.specRef || term.number}</span>
            <span className="dictionary-chip dictionary-chip-muted">{categoryLabel}</span>
          </div>

          <h1 className="dictionary-detail-title">{term.label}</h1>
          <p className="dictionary-detail-subtitle">{term.definition}</p>

          <div className="dictionary-detail-tag-row">
            <TypeBadge jsonType={term.dataType?.jsonType} format={term.dataType?.format} />
            <span className="dictionary-detail-tag">{unitDisplay}</span>
            {term.subcategory && <span className="dictionary-detail-tag">{term.subcategory}</span>}
          </div>

          <div className="dictionary-detail-grid">
            <DetailRow label="Category" value={categoryLabel} />
            <DetailRow label="Subcategory" value={term.subcategory} />
            <DetailRow label="Data format" value={term.dataType?.format} />
            <DetailRow label="JSON type" value={term.dataType?.jsonType} />
            <DetailRow label="XSD datatype" value={term.dataType?.xsdType} mono />
            <DetailRow label="Domain" value={term.domain?.curie || term.semanticBinding?.domain?.curie} mono />
            <DetailRow label="Range" value={term.range?.curie || term.semanticBinding?.range?.curie} mono />
            <DetailRow label="Unit" value={unitDisplay} />
            <DetailRow label="Access rights" value={term.accessRights} />
            <DetailRow label="Static vs dynamic" value={term.staticOrDynamic} />
            <DetailRow label="Update requirement" value={term.updateRequirement} />
            <DetailRow label="Granularity" value={term.granularityLevel} />
            <DetailRow label="DIN/DKE chapter" value={term.dinDkeSpec99100Chapter} />
            <DetailRow label="Workbook row" value={term.sourceWorkbookRow} />
            <DetailRow label="Internal key" value={term.internalKey || term.internal_key} mono />
            <DetailRow label="Element ID" value={term.elementId || term.element_id} mono />
          </div>

          <div className="dictionary-detail-section">
            <h2>Battery category requirements</h2>
            {term.batteryCategoryRequirements ? (
              <div className="dictionary-detail-pill-row">
                {Object.entries(term.batteryCategoryRequirements).map(([category, requirement]) => (
                  <span key={category} className="dictionary-field-pill">{category}: {requirement || "not applicable"}</span>
                ))}
              </div>
            ) : (
              <p className="dictionary-detail-empty">No category requirements are attached to this term yet.</p>
            )}
          </div>

          <div className="dictionary-detail-section">
            <h2>Component granularity</h2>
            {term.componentGranularity ? (
              <div className="dictionary-detail-pill-row">
                {Object.entries(term.componentGranularity).map(([component, requirement]) => (
                  <span key={component} className="dictionary-field-pill">{component}: {requirement || "not applicable"}</span>
                ))}
              </div>
            ) : (
              <p className="dictionary-detail-empty">No component granularity is attached to this term yet.</p>
            )}
          </div>

          <div className="dictionary-detail-section">
            <h2>Regulation references</h2>
            {term.regulationReferences?.length ? (
              <div className="dictionary-detail-pill-row">
                {term.regulationReferences.map((reference) => (
                  <span key={reference} className="dictionary-field-pill">{reference}</span>
                ))}
              </div>
            ) : (
              <p className="dictionary-detail-empty">No regulation references are attached to this term yet.</p>
            )}
          </div>

          <div className="dictionary-detail-section">
            <h2>Application field keys</h2>
            {term.appFieldKeys?.length ? (
              <div className="dictionary-detail-pill-row">
                {term.appFieldKeys.map((key) => (
                  <code key={key} className="dictionary-field-pill">{key}</code>
                ))}
              </div>
            ) : (
              <p className="dictionary-detail-empty">No application field keys are mapped yet.</p>
            )}
          </div>
        </section>

        <aside className="dictionary-detail-panel dictionary-detail-sidebar">
          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Dictionary reference URL</h2>
            <a href={term.iri} target="_blank" rel="noopener noreferrer" className="dictionary-link dictionary-link-mono">
              {term.iri}
            </a>
            <p>This is the canonical term identifier used by JSON-LD exports and semantic mappings.</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Dictionary context</h2>
            <a href={manifest?.contextUrl} target="_blank" rel="noopener noreferrer" className="dictionary-link dictionary-link-mono">
              {manifest?.contextUrl}
            </a>
            <p>The shared context provides the canonical namespace and type declarations for battery exports.</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Governance and traceability</h2>
            <p>
              {manifest?.authority?.derivationNotice
                || "This dictionary is a Claros-maintained derived implementation vocabulary."}
            </p>
            <div className="dictionary-footer-links">
              <a href={manifest?.categoryRulesUrl || `${API}/api/dictionary/battery/v1/category-rules`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Category rules
              </a>
              <a href={manifest?.termsUrl || `${API}/api/dictionary/battery/v1/terms`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Terms JSON
              </a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function BatteryDictionaryBrowserPage() {
  const { slug } = useParams();
  const location = useLocation();
  const basePath = useMemo(() => buildDictionaryBasePath(location.pathname), [location.pathname]);
  const isDetailView = Boolean(slug);

  const [terms, setTerms] = useState([]);
  const [term, setTerm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);

    const requests = isDetailView
      ? Promise.all([
          fetchJson(`${API}/api/dictionary/battery/v1/terms/${slug}`),
          fetchJson(`${API}/api/dictionary/battery/v1/categories`),
          fetchJson(`${API}/api/dictionary/battery/v1/units`),
          fetchJson(`${API}/api/dictionary/battery/v1/manifest`),
        ])
      : Promise.all([
          fetchJson(`${API}/api/dictionary/battery/v1/terms`),
          fetchJson(`${API}/api/dictionary/battery/v1/categories`),
          fetchJson(`${API}/api/dictionary/battery/v1/units`),
          fetchJson(`${API}/api/dictionary/battery/v1/manifest`),
        ]);

    requests
      .then((payload) => {
        if (ignore) return;
        if (isDetailView) {
          const [singleTerm, nextCategories, nextUnits, nextManifest] = payload;
          setTerm(singleTerm);
          setTerms([]);
          setCategories(nextCategories);
          setUnits(nextUnits);
          setManifest(nextManifest);
        } else {
          const [nextTerms, nextCategories, nextUnits, nextManifest] = payload;
          setTerms(nextTerms);
          setTerm(null);
          setCategories(nextCategories);
          setUnits(nextUnits);
          setManifest(nextManifest);
        }
        setLoading(false);
      })
      .catch((requestError) => {
        if (ignore) return;
        setError(requestError.message || "Failed to load dictionary. Please try again.");
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [isDetailView, slug]);

  const unitsByKey = useMemo(
    () => new Map(units.map((unit) => [unit.key, unit])),
    [units]
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map();
    for (const nextTerm of terms) {
      counts.set(nextTerm.category, (counts.get(nextTerm.category) || 0) + 1);
    }
    return counts;
  }, [terms]);

  const activeCategoryLabel = useMemo(
    () => categories.find((category) => category.key === activeCategory)?.label || null,
    [categories, activeCategory]
  );

  const filteredTerms = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return terms.filter((nextTerm) => {
      const matchesCategory = !activeCategory || nextTerm.category === activeCategory;
      const matchesSearch = !query
        || nextTerm.label.toLowerCase().includes(query)
        || nextTerm.definition.toLowerCase().includes(query)
        || nextTerm.slug.includes(query)
        || (nextTerm.appFieldKeys || []).some((key) => key.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [terms, activeCategory, deferredSearch]);

  if (loading || (isDetailView && !term)) {
    return (
      <section className="dictionary-page dictionary-page-state">
        <div className="dictionary-state-card">Loading battery dictionary…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="dictionary-page dictionary-page-state">
        <div className="dictionary-state-card dictionary-state-card-error">{error}</div>
      </section>
    );
  }

  return (
    <section className="dictionary-page">
      <div className="dictionary-hero">
        <div className="dictionary-hero-main">
          <div className="dictionary-chip-row">
            <span className="dictionary-chip">Semantic Dictionary</span>
            {manifest?.version && <span className="dictionary-chip dictionary-chip-muted">v{manifest.version}</span>}
          </div>

          <h1>{isDetailView ? term?.label : "Battery DPP Dictionary"}</h1>
          <p className="dictionary-hero-subtitle">
            {isDetailView
              ? "Canonical dictionary metadata for this battery term, including its JSON-LD identifier, datatype contract, and field mappings."
              : `${manifest?.name || "Claros Battery Dictionary"} with canonical terms, JSON-LD links, and field-key mappings for the battery passport model.`}
          </p>

          <div className="dictionary-meta-grid">
            <div className="dictionary-meta-card">
              <span>{isDetailView ? "Term number" : "Total terms"}</span>
              <strong>{isDetailView ? (term?.specRef || term?.number) : terms.length}</strong>
            </div>
            <div className="dictionary-meta-card">
              <span>{isDetailView ? "Category" : "Categories"}</span>
              <strong>{isDetailView ? (term?.categoryLabel || categories.find((category) => category.key === term?.category)?.label || "n.a.") : categories.length}</strong>
            </div>
          </div>
        </div>

        <aside className="dictionary-hero-side">
          <div className="dictionary-side-card">
            <h2>Dictionary Base IRI</h2>
            <a
              href={manifest?.baseIri}
              target="_blank"
              rel="noopener noreferrer"
              className="dictionary-link dictionary-link-mono"
            >
              {manifest?.baseIri}
            </a>
            <p>Use this as the canonical namespace for exported battery passport semantics.</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Authority</h2>
            <p>{manifest?.authority?.officialStatus || "implementation-vocabulary"}</p>
            <p>
              Source: {manifest?.authority?.normativeSource?.title || "BatteryPass source material"}
              {manifest?.authority?.normativeSource?.version ? ` v${manifest.authority.normativeSource.version}` : ""}
            </p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Governance</h2>
            <p>Steward: {manifest?.governance?.steward?.name || manifest?.publisher?.name || "Claros DPP"}</p>
            <p>{manifest?.governance?.changeControl || "Versioned static artifacts with repository-based change control."}</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Regulatory traceability</h2>
            <p>{manifest?.regulatoryTraceability?.traceabilityMethod || "Term-level source and regulation metadata are published with the dictionary artifacts."}</p>
            <div className="dictionary-footer-links">
              <a href={manifest?.categoryRulesUrl || `${API}/api/dictionary/battery/v1/category-rules`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Category rules
              </a>
              <a href={`${API}/api/dictionary/battery/v1/field-map`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Field map
              </a>
            </div>
          </div>
        </aside>
      </div>

      {isDetailView ? (
        <DictionaryDetail
          term={term}
          categories={categories}
          unitsByKey={unitsByKey}
          manifest={manifest}
          basePath={basePath}
        />
      ) : (
        <>
          <div className="dictionary-toolbar-card">
            <div className="dictionary-search-row">
              <input
                type="search"
                placeholder="Search terms, field keys, definitions..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="dictionary-search-input"
              />
            </div>

            <div className="dictionary-category-row">
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className={`dictionary-category-pill${!activeCategory ? " is-active" : ""}`}
              >
                All
                <span>{terms.length}</span>
              </button>
              {categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(activeCategory === category.key ? null : category.key)}
                  className={`dictionary-category-pill${activeCategory === category.key ? " is-active" : ""}`}
                >
                  {category.label}
                  <span>{categoryCounts.get(category.key) || category.termCount || 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dictionary-results-bar">
            <p className="dictionary-results-copy">
              {filteredTerms.length} term{filteredTerms.length !== 1 ? "s" : ""}
              {activeCategoryLabel ? ` in ${activeCategoryLabel}` : ""}
              {deferredSearch.trim() ? ` matching "${deferredSearch.trim()}"` : ""}
            </p>

            <div className="dictionary-footer-links">
              <a href={`${API}/api/dictionary/battery/v1/context.jsonld`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                JSON-LD Context
              </a>
              <a href={`${API}/api/dictionary/battery/v1/manifest`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Manifest
              </a>
              <a href={`${API}/api/dictionary/battery/v1/terms`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Terms JSON
              </a>
              <a href={`${API}/api/dictionary/battery/v1/units`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Units
              </a>
            </div>
          </div>

          {filteredTerms.length === 0 ? (
            <div className="dictionary-state-card">No terms found.</div>
          ) : (
            <div className="dictionary-terms-list">
              {filteredTerms.map((nextTerm) => (
                <TermCard
                  key={nextTerm.slug}
                  term={nextTerm}
                  unitsByKey={unitsByKey}
                  termHref={`${basePath}/terms/${nextTerm.slug}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
