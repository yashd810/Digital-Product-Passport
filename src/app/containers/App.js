import React, { Suspense, lazy, useState, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import "../styles/App.css";
import { I18nProvider } from "../providers/i18n";
import { useSessionAuth } from "../hooks/useSessionAuth";
import { AdminRoute, ProtectedRoute } from "../routes/RouteGuards";
import { applyTheme, getStoredTheme } from "../providers/ThemeContext";

// Auth
const Login = lazy(() => import("../../auth/containers/Login"));
const Register = lazy(() => import("../../auth/containers/Register"));
const Landing = lazy(() => import("../../auth/containers/Landing"));
const ForgotPassword = lazy(() => import("../../auth/containers/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("../../auth/containers/ForgotPassword").then((m) => ({ default: m.ResetPassword })));

const PassportForm = lazy(() => import("../../passports/form/PassportFormPage"));
const PassportViewer = lazy(() => import("../../passport-viewer/containers/PassportViewerPage"));
const VersionDiff = lazy(() => import("../../passports/history/VersionDiff"));

const DashboardLayout = lazy(() => import("../../user/dashboard/layout/DashboardLayout"));
const PassportList = lazy(() => import("../../user/dashboard/passports/containers/PassportListPage"));
const Overview = lazy(() => import("../../user/dashboard/overview/Overview"));
const AuditLogs = lazy(() => import("../../user/dashboard/audit/AuditLogs"));
const UserProfile = lazy(() => import("../../user/profile/UserProfile"));
const CompanyProfile = lazy(() => import("../../user/dashboard/company/CompanyProfile"));
const SecurityCenter = lazy(() => import("../../user/profile/SecurityCenter"));
const ManageTeam = lazy(() => import("../../user/dashboard/team/ManageTeam"));
const CompanyRepository = lazy(() => import("../../user/dashboard/repository/CompanyRepository"));
const WorkflowDashboard = lazy(() => import("../../user/dashboard/workflow/WorkflowDashboard"));

const ConsumerPage = lazy(() => import("../../passport-viewer/containers/ConsumerPage"));
const CSVImportGuide = lazy(() => import("../../user/dashboard/csv/CSVImportGuide"));
const NotificationsPage = lazy(() => import("../../user/dashboard/notifications/NotificationsPage"));
const MessagingPage = lazy(() => import("../../user/dashboard/notifications/MessagingPage"));
const TemplatesPage = lazy(() => import("../../user/dashboard/templates/TemplatesPage"));
const ManualCenter = lazy(() => import("../../manual/ManualCenterPage"));
const CreateHub = lazy(() => import("../../user/dashboard/create/CreateHub"));
const ArchivedPassports = lazy(() => import("../../user/dashboard/archived/ArchivedPassportsPage"));

const AdminLayout = lazy(() => import("../../admin/layout/AdminLayout"));
const AdminAnalytics = lazy(() => import("../../admin/pages/AdminAnalytics"));
const AdminCompanies = lazy(() => import("../../admin/pages/AdminCompanies"));
const AdminInvite = lazy(() => import("../../admin/pages/AdminInvite"));
const CompanyAccess = lazy(() => import("../../admin/pages/CompanyAccess"));
const AdminCompanyAnalytics = lazy(() => import("../../admin/pages/AdminCompanyAnalytics"));
const AdminPassportTypes = lazy(() => import("../../admin/passport-types/AdminPassportTypes"));
const AdminCreatePassportType = lazy(() => import("../../admin/passport-types/AdminCreatePassportTypePage"));
const AdminPassportTypeFields = lazy(() => import("../../admin/passport-types/AdminPassportTypeFields"));
const AdminSecurity = lazy(() => import("../../admin/pages/AdminSecurity"));

function RouteFallback() {
  return <div className="loading dashboard-loading-screen">Loading…</div>;
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

function TemplateEditRoute({ user, companyId }) {
  const { templateId } = useParams();
  return <TemplatesPage user={user} companyId={companyId} view="edit" editTemplateId={templateId} />;
}

function CSVImportTabRoute({ user, companyId }) {
  const { tab } = useParams();
  return <CSVImportGuide user={user} companyId={companyId} activeTab={tab || "create"} />;
}

function App() {
  const {
    authReady,
    companyId,
    handleLogout,
    handleUserUpdate,
    setCompanyId,
    setToken,
    setUser,
    token,
    user,
  } = useSessionAuth();

  // Apply stored theme on app load
  useEffect(() => {
    const userId = JSON.parse(localStorage.getItem("user") || "null")?.id;
    const theme  = getStoredTheme(userId);
    applyTheme(theme);
  }, []);

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
        <Route path="/p/:productId" element={<ConsumerPage />} />
        <Route path="/p/inactive/:productId/:versionNumber" element={<ConsumerPage />} />

        {/* Passport viewer — public */}
        <Route path="/dpp/preview/:manufacturerSlug/:modelSlug/:previewId/technical/*" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <PassportViewer previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/dpp/preview/:manufacturerSlug/:modelSlug/:previewId" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <ConsumerPage previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber" element={<ConsumerPage />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId" element={<ConsumerPage />} />

        {/* Legacy passport viewer aliases */}
        <Route path="/passport/preview/:previewId/technical/*" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <PassportViewer previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/passport/preview/:previewId" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <ConsumerPage previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/passport/inactive/:productId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/passport/inactive/:productId/:versionNumber" element={<ConsumerPage />} />
        <Route path="/passport/:productId/technical/*" element={<PassportViewer />} />
        <Route path="/passport/:productId" element={<ConsumerPage />} />

        {/* Version diff — needs token for API */}
        <Route path="/passport/:guid/diff" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <VersionDiff companyId={companyId} />
          </ProtectedRoute>
        } />

        {/* CSV Import */}
        <Route path="/csv-import/:passportType" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <Navigate to="create" replace />
          </ProtectedRoute>
        } />
        <Route path="/csv-import/:passportType/:tab" element={
          <ProtectedRoute token={token} authReady={authReady}>
            <CSVImportTabRoute user={user} companyId={companyId} />
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
          <Route path="templates"       element={<TemplatesPage user={user} companyId={companyId} view="list" />} />
          <Route path="templates/new"   element={<TemplatesPage user={user} companyId={companyId} view="create" />} />
          <Route path="templates/:templateId/edit" element={<TemplateEditRoute user={user} companyId={companyId} />} />
          <Route path="create"          element={<CreateHub user={user} companyId={companyId} />} />
          <Route path="audit-logs"      element={<AuditLogs companyId={companyId} />} />
          <Route path="workflow"          element={<Navigate to="workflow/inprogress" replace />} />
          <Route path="workflow/inprogress" element={<WorkflowDashboard user={user} companyId={companyId} activeTab="inprogress" />} />
          <Route path="workflow/backlog"    element={<WorkflowDashboard user={user} companyId={companyId} activeTab="backlog" />} />
          <Route path="workflow/history"    element={<WorkflowDashboard user={user} companyId={companyId} activeTab="history" />} />
          <Route path="profile"         element={<UserProfile user={user} companyId={companyId} onUserUpdate={handleUserUpdate} />} />
          <Route path="security"        element={<SecurityCenter user={user} companyId={companyId} />} />
          <Route path="company-profile" element={<CompanyProfile user={user} companyId={companyId} />} />
          <Route path="team"            element={<ManageTeam user={user} companyId={companyId} />} />
          <Route path="repository"          element={<Navigate to="repository/files" replace />} />
          <Route path="repository/files"   element={<CompanyRepository user={user} companyId={companyId} activeTab="files" />} />
          <Route path="repository/symbols" element={<CompanyRepository user={user} companyId={companyId} activeTab="symbols" />} />
          <Route path="archived"        element={<ArchivedPassports user={user} companyId={companyId} />} />
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
