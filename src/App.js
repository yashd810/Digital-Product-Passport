import React, { Suspense, lazy, useState, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import "./App.css";

import { I18nProvider } from "./i18n";

// Auth
const Login = lazy(() => import("./Login"));
const Register = lazy(() => import("./Register"));
const Landing = lazy(() => import("./Landing"));
const ForgotPassword = lazy(() => import("./ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./ForgotPassword").then((m) => ({ default: m.ResetPassword })));

const PassportForm = lazy(() => import("./PassportForm"));
const PassportViewer = lazy(() => import("./PassportViewer"));
const VersionDiff = lazy(() => import("./VersionDiff"));

const DashboardLayout = lazy(() => import("./DashboardLayout"));
const PassportList = lazy(() => import("./PassportList"));
const Overview = lazy(() => import("./Overview"));
const AuditLogs = lazy(() => import("./AuditLogs"));
const UserProfile = lazy(() => import("./UserProfile"));
const CompanyProfile = lazy(() => import("./CompanyProfile"));
const SecurityCenter = lazy(() => import("./SecurityCenter"));
const ManageTeam = lazy(() => import("./ManageTeam"));
const CompanyRepository = lazy(() => import("./CompanyRepository"));
const WorkflowDashboard = lazy(() => import("./WorkflowDashboard"));

const ConsumerPage = lazy(() => import("./ConsumerPage"));
const CSVImportGuide = lazy(() => import("./CSVImportGuide"));
const NotificationsPage = lazy(() => import("./NotificationsPage"));
const MessagingPage = lazy(() => import("./MessagingPage"));
const TemplatesPage = lazy(() => import("./TemplatesPage"));
const ManualCenter = lazy(() => import("./ManualCenter"));
const CreateHub    = lazy(() => import("./CreateHub"));

const AdminLayout = lazy(() => import("./AdminLayout"));
const AdminAnalytics = lazy(() => import("./AdminAnalytics"));
const AdminCompanies = lazy(() => import("./AdminCompanies"));
const AdminInvite = lazy(() => import("./AdminInvite.js"));
const CompanyAccess = lazy(() => import("./CompanyAccess"));
const AdminCompanyAnalytics = lazy(() => import("./AdminCompanyAnalytics"));
const AdminPassportTypes = lazy(() => import("./AdminPassportTypes"));
const AdminCreatePassportType = lazy(() => import("./AdminCreatePassportType"));
const AdminPassportTypeFields = lazy(() => import("./AdminPassportTypeFields"));
const AdminSecurity = lazy(() => import("./AdminSecurity"));

// Theme
import { applyTheme, getStoredTheme } from "./ThemeContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function RouteFallback() {
  return <div className="loading dashboard-loading-screen">Loading…</div>;
}

function ProtectedRoute({ token, authReady, children }) {
  if (!authReady) return null;
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ token, user, authReady, children }) {
  if (!authReady) return null;
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== "super_admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function CreatePassportRoute({ user, companyId }) {
  const { passportType } = useParams();
  if (user?.role === "viewer") return <Navigate to="/dashboard" replace />;
  return <PassportForm mode="create" passportType={passportType}
           user={user} companyId={companyId} />;
}

function EditPassportRoute({ user, companyId }) {
  if (user?.role === "viewer") return <Navigate to="/dashboard" replace />;
  return <PassportForm mode="edit" user={user} companyId={companyId} />;
}

function App() {
  const [token,     setToken]     = useState(false);
  const [user,      setUser]      = useState(JSON.parse(localStorage.getItem("user") || "null"));
  const [companyId, setCompanyId] = useState(localStorage.getItem("companyId"));
  const [authReady, setAuthReady] = useState(false);

  // Apply stored theme on app load
  useEffect(() => {
    const userId = JSON.parse(localStorage.getItem("user") || "null")?.id;
    const theme  = getStoredTheme(userId);
    applyTheme(theme);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/users/me`);
        if (!r.ok) throw new Error("No active session");
        const sessionUser = await r.json();
        if (cancelled) return;
        const normalizedUser = {
          ...sessionUser,
          companyId: sessionUser.company_id,
          company_name: sessionUser.company_name,
        };
        setToken(true);
        setUser(normalizedUser);
        setCompanyId(sessionUser.company_id || "");
        localStorage.setItem("user", JSON.stringify(normalizedUser));
        localStorage.setItem("companyId", sessionUser.company_id || "");
      } catch {
        if (cancelled) return;
        setToken(false);
        setUser(null);
        setCompanyId("");
        localStorage.removeItem("user");
        localStorage.removeItem("companyId");
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUserUpdate = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem("user", JSON.stringify(updatedUser));
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: "POST" });
    } catch {}
    setToken(false);
    setUser(null);
    setCompanyId("");
    localStorage.removeItem("user");
    localStorage.removeItem("companyId");
  };

  return (
    <I18nProvider>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public */}
        <Route path="/"                element={<Landing token={token} user={user} onLogout={handleLogout} />} />
        <Route path="/login"           element={<Login    setToken={setToken} setUser={setUser} setCompanyId={setCompanyId} />} />
        <Route path="/register"        element={<Register setToken={setToken} setUser={setUser} setCompanyId={setCompanyId} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />

        {/* Consumer QR landing page */}
        <Route path="/p/:guid" element={<ConsumerPage />} />

        {/* Passport viewer — public */}
        <Route path="/passport/:guid/*" element={<PassportViewer />} />

        {/* Version diff — needs token for API */}
        <Route path="/passport/:guid/diff" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <VersionDiff companyId={companyId} />
          </ProtectedRoute>
        } />

        {/* CSV Import */}
        <Route path="/csv-import/:passportType" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <CSVImportGuide user={user} companyId={companyId} />
          </ProtectedRoute>
        } />

        {/* Dashboard */}
        <Route path="/dashboard" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <DashboardLayout user={user} companyId={companyId} onLogout={handleLogout} />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview"      element={<Overview companyId={companyId} />} />
          <Route path="my-passports"  element={<PassportList user={user} companyId={companyId} filterByUser={true} />} />
          <Route path="passports/product/:productKey" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="passports/umbrella/:umbrellaKey" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="passports/:passportType" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="notifications"   element={<NotificationsPage user={user} />} />
          <Route path="messages"        element={<MessagingPage user={user} />} />
          <Route path="templates"       element={<TemplatesPage user={user} companyId={companyId} />} />
          <Route path="create"          element={<CreateHub user={user} companyId={companyId} />} />
          <Route path="audit-logs"      element={<AuditLogs companyId={companyId} />} />
          <Route path="workflow"        element={<WorkflowDashboard user={user} companyId={companyId} />} />
          <Route path="profile"         element={<UserProfile user={user} companyId={companyId} onUserUpdate={handleUserUpdate} />} />
          <Route path="security"        element={<SecurityCenter user={user} companyId={companyId} />} />
          <Route path="company-profile" element={<CompanyProfile user={user} companyId={companyId} />} />
          <Route path="team"            element={<ManageTeam user={user} companyId={companyId} />} />
          <Route path="repository"      element={<CompanyRepository user={user} companyId={companyId} />} />
          <Route path="manual"          element={<ManualCenter mode="user" user={user} companyId={companyId} />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={
          <AdminRoute token={token} user={user} authReady={authReady}>
            <AdminLayout user={user} onLogout={handleLogout} />
          </AdminRoute>
        }>
          <Route index element={<Navigate to="analytics" replace />} />
          <Route path="analytics"                    element={<AdminAnalytics />} />
          <Route path="companies"                    element={<AdminCompanies />} />
          <Route path="passport-types"               element={<AdminPassportTypes />} />
          <Route path="passport-types/new"           element={<AdminCreatePassportType />} />
          <Route path="passport-types/:typeName/fields" element={<AdminPassportTypeFields />} />
          <Route path="invite"                       element={<AdminInvite />} />
          <Route path="admin-management"             element={<AdminSecurity user={user} />} />
          <Route path="profile"                      element={<UserProfile user={user} companyId={companyId} onUserUpdate={handleUserUpdate} showWorkflowDefaults={false} showLanguageSelector={false} profileTitle="My Profile" profileSubtitle={user?.email} />} />
          <Route path="manual"                       element={<ManualCenter mode="admin" user={user} companyId={companyId} />} />
          <Route path="security"                     element={<Navigate to="/admin/admin-management" replace />} />
          <Route path="company/:companyId/access"    element={<CompanyAccess />} />
          <Route path="company/:companyId/analytics" element={<AdminCompanyAnalytics />} />
          <Route path="company/:companyId/profile"   element={<CompanyProfile user={user} />} />
        </Route>

        {/* Create / Edit */}
        <Route path="/create/:passportType" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <CreatePassportRoute user={user} companyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/edit/:guid" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <EditPassportRoute user={user} companyId={companyId} />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </I18nProvider>
  );
}

export default App;
