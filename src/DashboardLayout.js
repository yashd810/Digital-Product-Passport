import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import NotificationsPanel from "./NotificationsPanel";
import { applyTheme, getStoredTheme } from "./ThemeContext";
import { useI18n } from "./i18n";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function DashboardLayout({ user, companyId, onLogout }) {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const [passportTypes, setPassportTypes] = useState([]);
  const [currentTheme,  setCurrentTheme]  = useState(() => getStoredTheme(user?.id));

  useEffect(() => {
    // Apply stored theme on mount
    const stored = getStoredTheme(user?.id);
    setCurrentTheme(stored);
    applyTheme(stored);
  }, [user?.id]);

  useEffect(() => {
    if (!companyId) { navigate("/login"); return; }
    fetch(`${API}/api/companies/${companyId}/passport-types`,
      { headers: { Authorization: "Bearer cookie-session" } })
      .then(r => r.json()).then(setPassportTypes).catch(() => {});
  }, [companyId]);

  const handleLogout = async () => {
    await onLogout?.();
    navigate("/login");
  };

  const handleThemeToggle = () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    localStorage.setItem(`dpp_theme_${user?.id}`, next);
    applyTheme(next);
  };

  const isEditor = user?.role === "editor" || user?.role === "company_admin" || user?.role === "super_admin";
  const isAdmin  = user?.role === "company_admin" || user?.role === "super_admin";
  const displayName = user?.first_name ? `${user.first_name} ${user?.last_name || ""}`.trim() : user?.email;
  const initials = `${(user?.first_name || "").trim().charAt(0)}${(user?.last_name || "").trim().charAt(0)}`.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?";
  const languageOptions = [
    { code: "en", label: "EN" },
    { code: "sv", label: "SV" },
    { code: "de", label: "DE" },
  ];
  const roleLabel = (user?.role || "editor").replace(/_/g, " ");

  // Group passport types by product category if available
  const groupedTypes = passportTypes.reduce((acc, pt) => {
    const productCategory = pt.umbrella_category || pt.display_name || pt.type_name;
    if (!acc[productCategory]) acc[productCategory] = [];
    acc[productCategory].push(pt);
    return acc;
  }, {});

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>Dashboard</h1>
          <div className="header-actions">
            <span className="user-info">
              {user?.first_name ? `${user.first_name} ${user.last_name}` : user?.email}
            </span>
            <NotificationsPanel user={user} />
            {/* Theme toggle button in header */}
            <button
              className="theme-toggle-header-btn"
              onClick={handleThemeToggle}
              title={`Switch to ${currentTheme === "dark" ? "Light" : "Dark"} mode`}
            >
              {currentTheme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="logout-btn" onClick={handleLogout}>{t("logout")}</button>
          </div>
        </div>
      </header>

      <div className="dashboard-main dashboard-main-shell">
        <div className="dashboard-container">
          <aside className="dashboard-sidebar">
            <div className="user-card">
              <div className="user-card-top">
                <div className="user-avatar user-avatar-initials">{initials}</div>
                <div className="user-details">
                  <h3>Your Account</h3>
                  <p className="user-name">{displayName}</p>
                  <p className="user-email">{user?.email}</p>
                </div>
              </div>

              <div className="user-meta-row">
                <span className={`role-chip role-${user?.role}`}>{roleLabel}</span>
                <p className="user-company">{user?.company_name || "No company assigned"}</p>
              </div>

              <div className="setting-row sidebar-setting-row">
                <label className="setting-label">{t("language")}</label>
                <div className="lang-btns sidebar-lang-btns">
                  {languageOptions.map((languageOption) => (
                    <button
                      key={languageOption.code}
                      type="button"
                      className={`lang-btn${lang === languageOption.code ? " active" : ""}`}
                      onClick={() => setLang(languageOption.code)}
                    >
                      {languageOption.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <nav className="sidebar-nav">
              <p className="sidebar-section-label">Analytics</p>
              <NavLink to="/dashboard/overview" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📊 {t("overview")}
              </NavLink>
              <NavLink to="/dashboard/my-passports" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                ✓ {t("myPassports")}
              </NavLink>
              <NavLink to="/dashboard/workflow" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                ⚙️ {t("workflow")}
              </NavLink>

              {/* Passport Types — grouped by product category */}
              {passportTypes.length > 0 && (
                <>
                  {Object.entries(groupedTypes).map(([productCategory, types]) => (
                    <React.Fragment key={productCategory}>
                      <NavLink
                        to={`/dashboard/passports/product/${encodeURIComponent(productCategory)}`}
                        className={({ isActive }) => `sidebar-link sidebar-link-umbrella${isActive ? " active" : ""}`}
                      >
                        <span className="sidebar-umbrella-icon">{types[0]?.umbrella_icon || "📋"}</span>
                        <span className="sidebar-umbrella-label">{productCategory}</span>
                      </NavLink>
                      {types.map(pt => (
                        <NavLink
                          key={pt.id}
                          to={`/dashboard/passports/${pt.type_name}`}
                          className={({isActive})=>`sidebar-link${isActive?" active":""}`}
                        >
                          {pt.display_name || pt.type_name.charAt(0).toUpperCase() + pt.type_name.slice(1)}
                        </NavLink>
                      ))}
                    </React.Fragment>
                  ))}
                </>
              )}

              <p className="sidebar-section-label sidebar-section-label-spaced">Account</p>
              <NavLink to="/dashboard/profile" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                {t("myProfile")}
              </NavLink>
              <NavLink to="/dashboard/company-profile" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🏢 Company Profile
              </NavLink>
              {(isAdmin || isEditor) && (
                <NavLink to="/dashboard/team" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                  👥 {t("manageTeam")}
                </NavLink>
              )}

              <p className="sidebar-section-label sidebar-section-label-spaced">Audit</p>
              <NavLink to="/dashboard/audit-logs" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📋 {t("auditLogs")}
              </NavLink>
            </nav>
          </aside>

          <div className="dashboard-content">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardLayout;
