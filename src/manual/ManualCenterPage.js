import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authHeaders } from "../shared/api/authHeaders";
import { CORE_DATABASE_TABLES } from "./manualData";
import { buildAdminSections, buildUserSections, collectSearchTerms, prettifyName } from "./manualBuilders";
import { ManualSection } from "./manualComponents";
import "./styles/ManualCenter.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function ManualCenter({ mode = "user", user, companyId }) {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const deferredSearch = useDeferredValue(searchValue);
  const [activeSectionId, setActiveSectionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  });
  const [contextLoading, setContextLoading] = useState(mode === "admin" || Boolean(companyId));
  const [passportTypes, setPassportTypes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [adminPassportTypes, setAdminPassportTypes] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      setContextLoading(true);

      try {
        if (mode === "user") {
          if (!companyId) {
            if (!cancelled) {
              setPassportTypes([]);
              setContextLoading(false);
            }
            return;
          }

          const response = await fetch(`${API}/api/companies/${companyId}/passport-types`, {
            headers: authHeaders(),
          });
          const data = response.ok ? await response.json() : [];
          if (!cancelled) setPassportTypes(Array.isArray(data) ? data : []);
        } else {
          const [companiesResponse, typesResponse, categoriesResponse] = await Promise.all([
            fetch(`${API}/api/admin/companies`, {
              headers: authHeaders(),
            }).catch(() => null),
            fetch(`${API}/api/admin/passport-types`, {
              headers: authHeaders(),
            }).catch(() => null),
            fetch(`${API}/api/admin/umbrella-categories`, {
              headers: authHeaders(),
            }).catch(() => null),
          ]);

          const [companiesData, passportTypesData, categoriesData] = await Promise.all([
            companiesResponse?.ok ? companiesResponse.json() : Promise.resolve([]),
            typesResponse?.ok ? typesResponse.json() : Promise.resolve([]),
            categoriesResponse?.ok ? categoriesResponse.json() : Promise.resolve([]),
          ]);

          if (!cancelled) {
            setCompanies(Array.isArray(companiesData) ? companiesData : []);
            setAdminPassportTypes(Array.isArray(passportTypesData) ? passportTypesData : []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
          }
        }
      } catch {
        if (!cancelled) {
          setPassportTypes([]);
          setCompanies([]);
          setAdminPassportTypes([]);
          setCategories([]);
        }
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };

    loadContext();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId]);

  const sections = useMemo(() => {
    if (mode === "admin") {
      return buildAdminSections({ user, companies, adminPassportTypes, categories });
    }
    return buildUserSections({ user, companyId, passportTypes });
  }, [mode, user, companies, adminPassportTypes, categories, companyId, passportTypes]);

  const filteredSections = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    return sections.filter((section) => !normalizedSearch || collectSearchTerms(section).includes(normalizedSearch));
  }, [sections, deferredSearch]);

  useEffect(() => {
    if (!filteredSections.length) {
      if (activeSectionId) setActiveSectionId("");
      return;
    }

    const stillValid = filteredSections.some((section) => section.id === activeSectionId);
    if (!stillValid) {
      setActiveSectionId(filteredSections[0].id);
    }
  }, [filteredSections, activeSectionId]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeSectionId) return;
    const nextHash = `#${encodeURIComponent(activeSectionId)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [activeSectionId]);

  const activeSection = useMemo(
    () => filteredSections.find((section) => section.id === activeSectionId) || filteredSections[0] || null,
    [filteredSections, activeSectionId]
  );

  const heroStats = useMemo(() => {
    if (mode === "admin") {
      return [
        { label: "Manual sections", value: sections.length },
        { label: "Companies", value: companies.length || 0 },
        { label: "Passport types", value: adminPassportTypes.length || 0 },
        { label: "DB table groups", value: CORE_DATABASE_TABLES.length },
      ];
    }
    return [
      { label: "Manual sections", value: sections.length },
      { label: "Granted types", value: passportTypes.length || 0 },
      { label: "Your role", value: prettifyName(user?.role || "user") },
      { label: "Quick routes", value: 8 },
    ];
  }, [mode, sections.length, companies.length, adminPassportTypes.length, passportTypes.length, user?.role]);

  const manualTitle = mode === "admin" ? "Super Admin Manual" : "Workspace Manual";
  const manualSubtitle =
    mode === "admin"
      ? "A guided map of the super-admin UI plus deep backend, security, asset-management, and API guidance for platform operators."
      : "A detailed guide to the company workspace, Asset Management tool, security model, and practical API usage in plain language.";
  const scopeNote =
    mode === "admin"
      ? "This manual includes the requested backend operations section because super admins often need the full platform picture."
      : "This manual still focuses on normal company work, but it now also explains the API and security flows that company teams commonly ask about.";

  return (
    <div className={`manual-center manual-center-${mode}`}>
      <div className="manual-back-row">
        <button
          type="button"
          className="manual-back-btn"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
      </div>

      <section className="manual-hero">
        <div className="manual-hero-main">
          <div className="manual-chip-row">
            <span className="manual-chip">{mode === "admin" ? "Super Admin" : "User Dashboard"}</span>
            <span className="manual-chip manual-chip-muted">{scopeNote}</span>
          </div>
          <h1>{manualTitle}</h1>
          <p>{manualSubtitle}</p>

          <div className="manual-search-row">
            <input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={mode === "admin" ? "Search companies, passport types, APIs, tables, workflows..." : "Search create flows, templates, workflow, API keys, audit..."}
              className="manual-search-input"
            />
          </div>
        </div>

        <div className="manual-stats-grid">
          {heroStats.map((stat) => (
            <article key={`${manualTitle}-${stat.label}`} className="manual-stat-card">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="manual-toolbar manual-toolbar-static-note">
        <div className="manual-toolbar-note" style={{ marginTop: 0 }}>
          {contextLoading
            ? "Loading live workspace context for this manual..."
            : mode === "admin"
              ? `Built with ${companies.length || 0} companies, ${adminPassportTypes.length || 0} passport types, and ${categories.length || 0} categories currently available in the UI.`
              : `Built with ${passportTypes.length || 0} passport types currently available to your company dashboard.`}
        </div>
      </section>

      <div className="manual-layout">
        <aside className="manual-toc">
          <div className="manual-toc-card">
            <div className="manual-card-title-row">
              <h4>Section map</h4>
            </div>
            <div className="manual-toc-links">
              {filteredSections.map((section) => (
                <button
                  key={`toc-${section.id}`}
                  type="button"
                  className={`manual-toc-link${activeSection?.id === section.id ? " manual-toc-link-active" : ""}`}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>{section.icon}</span>
                  <span>{section.title}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="manual-content">
          {activeSection ? (
            <ManualSection key={activeSection.id} section={activeSection} />
          ) : (
            <section className="manual-section">
              <div className="manual-section-header">
                <div className="manual-section-icon">🔎</div>
                <div className="manual-section-heading">
                  <h3>No sections matched that search</h3>
                  <p>Try a broader keyword and then choose a section from the map on the left.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default ManualCenter;