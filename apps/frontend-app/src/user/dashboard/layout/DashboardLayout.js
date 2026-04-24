import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import NotificationsPanel from "../notifications/NotificationsPanel";
import { applyTheme, getStoredTheme } from "../../../app/providers/ThemeContext";
import { useI18n } from "../../../app/providers/i18n";
import { authHeaders } from "../../../shared/api/authHeaders";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport Type";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function DashboardLayout({ user, companyId, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, setLang } = useI18n();
  const [passportTypes, setPassportTypes] = useState([]);
  const [currentTheme,  setCurrentTheme]  = useState(() => getStoredTheme(user?.id));
  const [msgUnread, setMsgUnread] = useState(0);
  const [openingAssetManagement, setOpeningAssetManagement] = useState(false);

  useEffect(() => {
    // Apply stored theme on mount
    const stored = getStoredTheme(user?.id);
    setCurrentTheme(stored);
    applyTheme(stored);
  }, [user?.id]);

  useEffect(() => {
    if (!companyId) { navigate("/login"); return; }
    fetch(`${API}/api/companies/${companyId}/passport-types`,
      { headers: authHeaders() })
      .then(r => r.json()).then(setPassportTypes).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    const fetchMsgUnread = () => {
      fetch(`${API}/api/messaging/unread`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : { count: 0 })
        .then(d => setMsgUnread(d.count || 0))
        .catch(() => {});
    };
    fetchMsgUnread();
    const iv = setInterval(fetchMsgUnread, 15000);
    return () => clearInterval(iv);
  }, []);

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
  const handleOpenAssetManagement = async () => {
    if (!companyId || openingAssetManagement) return;
    try {
      setOpeningAssetManagement(true);
      const response = await fetch(`${API}/api/companies/${companyId}/asset-management/launch`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to open Asset Management");
      const assetUrl = data.assetUrl?.startsWith("http")
        ? data.assetUrl
        : `${API}${data.assetUrl}`;
      window.open(assetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      window.alert(error.message || "Failed to open Asset Management");
    } finally {
      setOpeningAssetManagement(false);
    }
  };

  // Group passport types by product category if available
  const groupedTypes = passportTypes.reduce((acc, pt) => {
    const productCategory = pt.umbrella_category || pt.display_name || formatPassportTypeLabel(pt.type_name);
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
              {isEditor && (
                <NavLink to="/dashboard/create" className={({isActive})=>`sidebar-link sidebar-create-btn${isActive?" active":""}`}>
                  + Create Passport
                </NavLink>
              )}
              {isEditor && user?.asset_management_enabled && (
                <button
                  type="button"
                  className="sidebar-link sidebar-asset-btn"
                  onClick={handleOpenAssetManagement}
                  disabled={openingAssetManagement}
                >
                  {openingAssetManagement ? "Opening Asset Platform..." : "↗ Asset Management"}
                </button>
              )}

              <p className="sidebar-section-label sidebar-section-label-spaced">Start Here</p>
              <NavLink to="/dashboard/overview" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📊 {t("overview")}
              </NavLink>
              <NavLink to="/dashboard/my-passports" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                ✓ {t("myPassports")}
              </NavLink>

              {/* Passport Types — grouped by product category */}
              {passportTypes.length > 0 && (
                <>
                  <p className="sidebar-section-label sidebar-section-label-spaced">Passport Library</p>
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
                          {pt.display_name || formatPassportTypeLabel(pt.type_name)}
                        </NavLink>
                      ))}
                    </React.Fragment>
                  ))}
                </>
              )}

              <p className="sidebar-section-label sidebar-section-label-spaced">Reusable Content</p>
              <NavLink to="/dashboard/repository/files" end={false}
                className={() => `sidebar-link${location.pathname.startsWith("/dashboard/repository") ? " active" : ""}`}>
                🗂️ Repository
              </NavLink>
              <NavLink to="/dashboard/templates" end={false}
                className={() => `sidebar-link${location.pathname.startsWith("/dashboard/templates") ? " active" : ""}`}>
                📋 Templates
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Approvals & Updates</p>
              <NavLink to="/dashboard/workflow/inprogress" end={false}
                className={() => `sidebar-link${location.pathname.startsWith("/dashboard/workflow") ? " active" : ""}`}>
                ⚙️ {t("workflow")}
              </NavLink>
              <NavLink to="/dashboard/notifications" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🔔 Notifications
              </NavLink>
              <NavLink to="/dashboard/messages" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  💬 Messages
                  {msgUnread > 0 && (
                    <span style={{
                      background: "var(--mint)", color: "#0b1826", fontSize: 10,
                      fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 16, textAlign: "center"
                    }}>{msgUnread}</span>
                  )}
                </span>
              </NavLink>

              <NavLink to="/dashboard/archived" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📦 Archived
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Workspace Settings</p>
              <NavLink to="/dashboard/company-profile" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🏢 Company Profile
              </NavLink>
              {(isAdmin || isEditor) && (
                <NavLink to="/dashboard/team" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                  👥 {t("manageTeam")}
                </NavLink>
              )}
              <NavLink to="/dashboard/security" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🔐 Security
              </NavLink>
              <NavLink to="/dashboard/profile" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                {t("myProfile")}
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Logs & Support</p>
              <NavLink to="/dashboard/audit-logs" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📋 {t("auditLogs")}
              </NavLink>
              <NavLink to="/dashboard/manual" className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📘 Manual
              </NavLink>
              <NavLink to="/dashboard/dictionary/battery/v1"
                className={() => `sidebar-link${location.pathname.startsWith("/dashboard/dictionary") ? " active" : ""}`}>
                🔖 Battery Dictionary
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
