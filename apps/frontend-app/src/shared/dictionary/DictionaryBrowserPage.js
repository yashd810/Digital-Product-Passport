import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { buildDashboardPath } from "../../user/dashboard/utils/dashboardRoutes";
import "./DictionaryBrowserPage.css";

const API = import.meta.env.VITE_API_URL || "";

function buildDictionaryBasePath(pathname, companySlug = "", dictionaryPath) {
  if (pathname.startsWith("/admin/")) return `/admin/dictionary/${dictionaryPath}`;
  if (pathname.startsWith("/dashboard/")) {
    return buildDashboardPath({ companySlug, subpath: `dictionary/${dictionaryPath}` });
  }
  return `/dictionary/${dictionaryPath}`;
}

function buildDictionaryModelPath(pathname, companySlug = "", model) {
  if (!model?.family || !model?.version) return "";
  return buildDictionaryBasePath(
    pathname,
    companySlug,
    `${encodeURIComponent(model.family)}/${encodeURIComponent(model.version)}`
  );
}

async function fetchJson(url) {
  const response = await fetchWithAuth(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function formatDataType(term) {
  if (term.dataType?.format === "URI/URL") return "URI";
  return term.dataType?.jsonType || term.dataType?.format || "string";
}

function TermCard({ term, unitsByKey, termHref }) {
  const unitObj = unitsByKey.get(term.unit);
  const unitDisplay = term.unitDisplay || unitObj?.display || (term.unit === "none" ? "n.a." : term.unit || "n.a.");
  const domainDisplay = term.domain?.curie || term.domain?.label || "";
  const rangeDisplay = term.range?.curie || term.range?.label || "";
  const dataTypeDisplay = formatDataType(term);

  return (
    <article className="dictionary-term-card">
      <div className="dictionary-term-header">
        <div className="dictionary-term-main">
          <div className="dictionary-term-heading-row">
            <strong className="dictionary-term-title">{term.label}</strong>
          </div>
          <p className="dictionary-term-definition">{term.definition}</p>
          <div className="dictionary-term-meta-grid">
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Data type</span>
              <strong>{dataTypeDisplay}</strong>
            </div>
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Unit</span>
              <strong>{unitDisplay}</strong>
            </div>
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Domain</span>
              <strong className="dictionary-term-meta-mono">{domainDisplay || "Not specified"}</strong>
            </div>
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Range</span>
              <strong className="dictionary-term-meta-mono">{rangeDisplay || "Not specified"}</strong>
            </div>
          </div>
          <div className="dictionary-term-meta-line">
            <span className="dictionary-term-meta-label">IRI:</span>
            <a href={term.iri} target="_blank" rel="noopener noreferrer" className="dictionary-link dictionary-link-mono">
              {term.iri}
            </a>
          </div>
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

function getDictionaryApiPath(family, version) {
  return `${API}/api/dictionary/${encodeURIComponent(family)}/${encodeURIComponent(version)}`;
}

function DictionaryModelCard({ model, href }) {
  return (
    <article className="dictionary-term-card dictionary-model-card">
      <div className="dictionary-term-header">
        <div className="dictionary-term-main">
          <div className="dictionary-chip-row">
            <span className="dictionary-chip">{model.family || "dictionary"}</span>
            {model.version && <span className="dictionary-chip dictionary-chip-muted">{model.version}</span>}
          </div>
          <strong className="dictionary-term-title">{model.name || model.semanticModelKey}</strong>
          <p className="dictionary-term-definition">
            {model.description || "Semantic model registered in the backend dictionary resources."}
          </p>
          <div className="dictionary-term-meta-grid">
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Model key</span>
              <strong className="dictionary-term-meta-mono">{model.semanticModelKey || model.key}</strong>
            </div>
            <div className="dictionary-term-meta-block">
              <span className="dictionary-term-meta-label">Version</span>
              <strong>{model.dictionaryVersion || model.version || "n.a."}</strong>
            </div>
          </div>
        </div>
        {href && (
          <div className="dictionary-term-side">
            <Link to={href} className="dictionary-card-link">Open dictionary</Link>
          </div>
        )}
      </div>
    </article>
  );
}

function DictionaryDetail({ term, categories, unitsByKey, manifest, basePath, apiPath }) {
  const categoryLabel = categories.find((category) => category.key === term.category)?.label || term.categoryLabel || term.category;
  const unitDisplay = term.unitDisplay || unitsByKey.get(term.unit)?.display || (term.unit === "none" ? "n.a." : term.unit || "n.a.");
  const dataTypeDisplay = formatDataType(term);
  const domainDisplay = term.domain?.curie || term.domain?.label || "";
  const rangeDisplay = term.range?.curie || term.range?.label || "";

  return (
    <>
      <div className="dictionary-results-bar">
        <Link to={basePath} className="dictionary-inline-link">Back to dictionary</Link>
        <div className="dictionary-footer-links">
          <a href={`${apiPath}/terms/${term.slug}`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
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

          <div className="dictionary-detail-grid">
            <DetailRow label="Category" value={categoryLabel} />
            <DetailRow label="Data type" value={dataTypeDisplay} />
            <DetailRow label="Data format" value={term.dataType?.format} />
            <DetailRow label="JSON type" value={term.dataType?.jsonType} />
            <DetailRow label="XSD datatype" value={term.dataType?.xsdType} mono />
            <DetailRow label="Domain" value={domainDisplay} mono />
            <DetailRow label="Range" value={rangeDisplay} mono />
            <DetailRow label="Unit" value={unitDisplay} />
            <DetailRow label="Internal key" value={term.internalKey} mono />
          </div>

          <div className="dictionary-detail-section">
            <h2>Applicability requirements</h2>
            {term.categoryRequirements ? (
              <div className="dictionary-detail-pill-row">
                {Object.entries(term.categoryRequirements).map(([category, requirement]) => (
                  <span key={category} className="dictionary-field-pill">{category}: {requirement || "not applicable"}</span>
                ))}
              </div>
            ) : (
              <p className="dictionary-detail-empty">No applicability requirements are attached to this term yet.</p>
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
            <p>The shared context provides the canonical namespace and type declarations for this semantic model.</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Dictionary artifacts</h2>
            <p>Use these JSON artifacts for field mappings and semantic exports.</p>
            <div className="dictionary-footer-links">
              <a href={manifest?.termsUrl || `${apiPath}/terms`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Terms JSON
              </a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function DictionaryBrowserPage() {
  const { companySlug, family, version, slug } = useParams();
  const location = useLocation();
  const isModelListView = !family || !version;
  const dictionaryPath = isModelListView ? "" : `${family}/${version}`;
  const apiPath = useMemo(
    () => (isModelListView ? "" : getDictionaryApiPath(family, version)),
    [family, isModelListView, version]
  );
  const basePath = useMemo(
    () => (isModelListView ? "" : buildDictionaryBasePath(location.pathname, companySlug, dictionaryPath)),
    [companySlug, dictionaryPath, isModelListView, location.pathname]
  );
  const isDetailView = Boolean(slug) && !isModelListView;

  const [models, setModels] = useState([]);
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

    if (isModelListView) {
      fetchJson(`${API}/api/semantic-models`)
        .then((payload) => {
          if (ignore) return;
          setModels(Array.isArray(payload) ? payload : []);
          setTerms([]);
          setTerm(null);
          setCategories([]);
          setUnits([]);
          setManifest(null);
          setLoading(false);
        })
        .catch((requestError) => {
          if (ignore) return;
          setError(requestError.message || "Failed to load semantic dictionaries. Please try again.");
          setLoading(false);
        });

      return () => {
        ignore = true;
      };
    }

    const requests = isDetailView
      ? Promise.all([
          fetchJson(`${apiPath}/terms/${slug}`),
          fetchJson(`${apiPath}/categories`),
          fetchJson(`${apiPath}/units`),
          fetchJson(`${apiPath}/manifest`),
        ])
      : Promise.all([
          fetchJson(`${apiPath}/terms`),
          fetchJson(`${apiPath}/categories`),
          fetchJson(`${apiPath}/units`),
          fetchJson(`${apiPath}/manifest`),
        ]);

    requests
      .then((payload) => {
        if (ignore) return;
        setModels([]);
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
  }, [apiPath, isDetailView, isModelListView, slug]);

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
        || String(nextTerm.iri || "").toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [terms, activeCategory, deferredSearch]);

  if (loading || (isDetailView && !term)) {
    return (
      <section className="dictionary-page dictionary-page-state">
        <div className="dictionary-state-card">Loading semantic dictionary…</div>
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

  if (isModelListView) {
    return (
      <section className="dictionary-page">
        <div className="dictionary-hero">
          <div className="dictionary-hero-main">
            <div className="dictionary-chip-row">
              <span className="dictionary-chip">Semantic Dictionaries</span>
            </div>
            <h1>Registered Dictionaries</h1>
            <p className="dictionary-hero-subtitle">
              Dictionaries appear here after module semantic resources are added under the backend semantics folder.
            </p>
            <div className="dictionary-meta-grid">
              <div className="dictionary-meta-card">
                <span>Total dictionaries</span>
                <strong>{models.length}</strong>
              </div>
              <div className="dictionary-meta-card">
                <span>Status</span>
                <strong>{models.length ? "Ready" : "Empty"}</strong>
              </div>
            </div>
          </div>
          <aside className="dictionary-hero-side">
            <div className="dictionary-side-card">
              <h2>How dictionaries are added</h2>
              <p>Generate or add module semantic JSON files, then seed the matching passport module when you are ready.</p>
            </div>
          </aside>
        </div>

        {models.length === 0 ? (
          <div className="dictionary-state-card">No semantic dictionaries are registered yet.</div>
        ) : (
          <div className="dictionary-terms-list">
            {models.map((model) => (
              <DictionaryModelCard
                key={model.semanticModelKey || model.key}
                model={model}
                href={buildDictionaryModelPath(location.pathname, companySlug, model)}
              />
            ))}
          </div>
        )}
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

          <h1>{isDetailView ? term?.label : (manifest?.name || "Semantic Dictionary")}</h1>
          <p className="dictionary-hero-subtitle">
            {isDetailView
              ? "Canonical dictionary metadata for this term, including its JSON-LD identifier and datatype contract."
              : `${manifest?.description || "Browse canonical terms, JSON-LD links, and module-ready metadata for this semantic model."}`}
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
            <p>Use this as the canonical namespace for exported passport semantics.</p>
          </div>

          <div className="dictionary-side-card dictionary-side-card-plain">
            <h2>Dictionary artifacts</h2>
            <p>Open the generated artifacts behind this semantic model.</p>
            <div className="dictionary-footer-links">
              <a href={manifest?.termsUrl || `${apiPath}/terms`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Terms JSON
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
          apiPath={apiPath}
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
              <a href={`${apiPath}/context.jsonld`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                JSON-LD Context
              </a>
              <a href={`${apiPath}/manifest`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Manifest
              </a>
              <a href={`${apiPath}/terms`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
                Terms JSON
              </a>
              <a href={`${apiPath}/units`} target="_blank" rel="noopener noreferrer" className="dictionary-inline-link">
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
