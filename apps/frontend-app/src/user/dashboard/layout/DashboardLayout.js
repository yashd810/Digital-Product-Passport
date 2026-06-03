import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation, useParams } from "react-router-dom";
import NotificationsPanel from "../notifications/NotificationsPanel";
import { applyTheme, getStoredTheme } from "../../../app/providers/ThemeContext";
import { useI18n } from "../../../app/providers/i18n";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { buildDashboardPath, resolveDashboardCompanySlug } from "../utils/dashboardRoutes";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport Type";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildSemanticModelDictionarySubpath(model) {
  if (!model?.family || !model?.version) return null;
  return `dictionary/${encodeURIComponent(model.family)}/${encodeURIComponent(model.version)}`;
}

function DashboardLayout({ user, companyId, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { companySlug: routeCompanySlug } = useParams();
  const { t, lang, setLang } = useI18n();
  const [passportTypes, setPassportTypes] = useState([]);
  const [semanticModels, setSemanticModels] = useState([]);
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
    Promise.all([
      fetchWithAuth(`${API}/api/companies/${companyId}/passport-types`, { headers: authHeaders() })
        .then(r => r.json())
        .catch(() => []),
      fetchWithAuth(`${API}/api/companies/${companyId}/semantic-models`, { headers: authHeaders() })
        .then(r => r.json())
        .catch(() => []),
    ])
      .then(([passportTypeData, semanticModelData]) => {
        setPassportTypes(Array.isArray(passportTypeData) ? passportTypeData : []);
        setSemanticModels(Array.isArray(semanticModelData) ? semanticModelData : []);
      })
      .catch(() => {
        setPassportTypes([]);
        setSemanticModels([]);
      });
  }, [companyId]);

  useEffect(() => {
    const fetchMsgUnread = () => {
      fetchWithAuth(`${API}/api/messaging/unread`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : { count: 0 })
        .then(d => setMsgUnread(typeof d?.count === "number" ? d.count : 0))
        .catch(() => setMsgUnread(0));
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
  const companySlug = resolveDashboardCompanySlug({
    companySlug: routeCompanySlug,
    companyName: user?.companyName,
    companyId,
  });
  const dashboardPath = (subpath = "") => buildDashboardPath({ companySlug, subpath });
  const isDashboardSectionActive = (section) => location.pathname.startsWith(dashboardPath(section));
  const displayName = user?.firstName ? `${user.firstName} ${user?.lastName || ""}`.trim() : user?.email;
  const initials = `${(user?.firstName || "").trim().charAt(0)}${(user?.lastName || "").trim().charAt(0)}`.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?";
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
      const response = await fetchWithAuth(`${API}/api/companies/${companyId}/asset-management/launch`, {
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
    const productCategory = pt.productCategory || pt.displayName || formatPassportTypeLabel(pt.typeName);
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
              {user?.firstName ? `${user.firstName} ${user.lastName}` : user?.email}
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
                <p className="user-company">{user?.companyName || "No company assigned"}</p>
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
                <NavLink to={dashboardPath("create")} className={({isActive})=>`sidebar-link sidebar-create-btn${isActive?" active":""}`}>
                  + Create Passport
                </NavLink>
              )}
              {isEditor && user?.assetManagementEnabled && (
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
              <NavLink to={dashboardPath("overview")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📊 {t("overview")}
              </NavLink>
              <NavLink to={dashboardPath("my-passports")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                ✓ {t("myPassports")}
              </NavLink>

              {/* Passport Types — grouped by product category */}
              {passportTypes.length > 0 && (
                <>
                  <p className="sidebar-section-label sidebar-section-label-spaced">Passport Library</p>
                  {Object.entries(groupedTypes).map(([productCategory, types]) => (
                    <React.Fragment key={productCategory}>
                      <NavLink
                        to={dashboardPath(`passports/product/${encodeURIComponent(productCategory)}`)}
                        className={({ isActive }) => `sidebar-link sidebar-link-productCategory${isActive ? " active" : ""}`}
                      >
                        <span className="sidebar-productCategory-icon">{types[0]?.productIcon || "📋"}</span>
                        <span className="sidebar-productCategory-label">{productCategory}</span>
                      </NavLink>
                      {types.map(pt => (
                        <NavLink
                          key={pt.id}
                          to={dashboardPath(`passports/${pt.typeName}`)}
                          className={({isActive})=>`sidebar-link${isActive?" active":""}`}
                        >
                          {pt.displayName || formatPassportTypeLabel(pt.typeName)}
                        </NavLink>
                      ))}
                    </React.Fragment>
                  ))}
                </>
              )}

              <p className="sidebar-section-label sidebar-section-label-spaced">Reusable Content</p>
              <NavLink to={dashboardPath("repository/files")} end={false}
                className={() => `sidebar-link${isDashboardSectionActive("repository") ? " active" : ""}`}>
                🗂️ Repository
              </NavLink>
              <NavLink to={dashboardPath("templates")} end={false}
                className={() => `sidebar-link${isDashboardSectionActive("templates") ? " active" : ""}`}>
                📋 Templates
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Approvals & Updates</p>
              <NavLink to={dashboardPath("workflow/inprogress")} end={false}
                className={() => `sidebar-link${isDashboardSectionActive("workflow") ? " active" : ""}`}>
                ⚙️ {t("workflow")}
              </NavLink>
              <NavLink to={dashboardPath("notifications")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🔔 Notifications
              </NavLink>
              <NavLink to={dashboardPath("messages")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
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

              <NavLink to={dashboardPath("archived")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📦 Archived
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Workspace Settings</p>
              <NavLink to={dashboardPath("company-profile")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🏢 Company Profile
              </NavLink>
              {(isAdmin || isEditor) && (
                <NavLink to={dashboardPath("team")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                  👥 {t("manageTeam")}
                </NavLink>
              )}
              <NavLink to={dashboardPath("security")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                🔐 Security
              </NavLink>
              <NavLink to={dashboardPath("profile")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                👤 {t("myProfile")}
              </NavLink>

              <p className="sidebar-section-label sidebar-section-label-spaced">Logs & Support</p>
              <NavLink to={dashboardPath("audit-logs")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📋 {t("auditLogs")}
              </NavLink>
              <NavLink to={dashboardPath("manual")} className={({isActive})=>`sidebar-link${isActive?" active":""}`}>
                📘 Manual
              </NavLink>
              {semanticModels
                .map((model) => ({ model, subpath: buildSemanticModelDictionarySubpath(model) }))
                .filter(({ subpath }) => subpath)
                .map(({ model, subpath }) => (
                  <NavLink
                    key={model.semanticModelKey || subpath}
                    to={dashboardPath(subpath)}
                    className={() => `sidebar-link${isDashboardSectionActive("dictionary") ? " active" : ""}`}
                  >
                    🔖 {model.name || model.semanticModelKey || "Dictionary"}
                  </NavLink>
                ))}
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
