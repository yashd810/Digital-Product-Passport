import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { applyTheme, getStoredTheme } from "../../app/providers/ThemeContext";
import "../styles/AdminDashboard.css";

function AdminLayout({ user, onLogout }) {
  const navigate = useNavigate();
  const [currentTheme, setCurrentTheme] = useState(() => getStoredTheme(user?.id));
  const displayName = user?.first_name
    ? `${user.first_name} ${user?.last_name || ""}`.trim()
    : user?.email;

  useEffect(() => {
    const stored = getStoredTheme(user?.id);
    setCurrentTheme(stored);
    applyTheme(stored);
  }, [user?.id]);

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

  return (
    <div className="admin-dashboard">

      {/* ── Header ── */}
      <header className="admin-header">
        <div className="header-content">
          <h1>Super Admin</h1>
          <div className="header-actions">
            <span className="user-info">Super Admin: {displayName}</span>
            <button
              className="theme-toggle-header-btn"
              onClick={handleThemeToggle}
              title={`Switch to ${currentTheme === "dark" ? "Light" : "Dark"} mode`}
            >
              {currentTheme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      {/* ── Tab nav ── */}
      <nav className="admin-tabs">
        <NavLink to="/admin/analytics"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          📊 Analytics
        </NavLink>
        <NavLink to="/admin/companies"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          🏢 Companies
        </NavLink>
        <NavLink to="/admin/passport-types"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          📋 Passport Types
        </NavLink>
        <NavLink to="/admin/admin-management"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          👑 Admin Management
        </NavLink>
        <NavLink to="/admin/profile"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          👤 My Profile
        </NavLink>
        <NavLink to="/admin/manual"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          📘 Manual
        </NavLink>
        <NavLink to="/admin/dictionary/battery/v1"
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          🔖 Battery Dictionary
        </NavLink>
      </nav>

      {/* ── Child page ── */}
      <main className="admin-main">
        <Outlet />
      </main>

    </div>
  );
}

export default AdminLayout;
