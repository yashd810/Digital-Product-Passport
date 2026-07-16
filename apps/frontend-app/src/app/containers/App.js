import React, { Suspense, lazy, useState, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import "../styles/App.css";
import { I18nProvider } from "../providers/i18n";
import { useSessionAuth } from "../hooks/useSessionAuth";
import { AdminRoute, ProtectedRoute } from "../routes/RouteGuards";
import { applyTheme, getStoredTheme } from "../providers/ThemeContext";
import AppSkipLink from "../components/AppSkipLink";
import { buildUserDashboardHomePath } from "../../user/dashboard/utils/dashboardRoutes";

// Auth
const Login = lazy(() => import("../../auth/containers/Login"));
const Register = lazy(() => import("../../auth/containers/Register"));
const Landing = lazy(() => import("../../auth/containers/Landing"));
const ForgotPassword = lazy(() => import("../../auth/containers/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("../../auth/containers/ForgotPassword").then((m) => ({ default: m.ResetPassword })));
const OAuthCallback = lazy(() => import("../../auth/containers/OAuthCallback"));

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

const CSVImportGuide = lazy(() => import("../../user/dashboard/csv/CSVImportGuide"));
const NotificationsPage = lazy(() => import("../../user/dashboard/notifications/NotificationsPage"));
const TemplatesPage = lazy(() => import("../../user/dashboard/templates/TemplatesPage"));
const ManualCenter = lazy(() => import("../../manual/ManualCenterPage"));
const CreateHub = lazy(() => import("../../user/dashboard/create/CreateHub"));
const PassportDataManagement = lazy(() => import("../../user/dashboard/passport-data/PassportDataManagementPage"));
const ArchivedPassports = lazy(() => import("../../user/dashboard/archived/ArchivedPassportsPage"));

const AdminLayout = lazy(() => import("../../admin/layout/AdminLayout"));
const DictionaryBrowserPage = lazy(() => import("../../shared/dictionary/DictionaryBrowserPage"));
const AdminAnalytics = lazy(() => import("../../admin/pages/AdminAnalytics"));
const AdminCompanies = lazy(() => import("../../admin/pages/AdminCompanies"));
const AdminInvite = lazy(() => import("../../admin/pages/AdminInvite"));
const CompanyAccess = lazy(() => import("../../admin/pages/CompanyAccess"));
const AdminEditCompanyPage = lazy(() => import("../../admin/pages/AdminEditCompanyPage"));
const AdminCompanyAnalytics = lazy(() => import("../../admin/pages/AdminCompanyAnalytics"));
const AdminPassportTypes = lazy(() => import("../../admin/passport-types/AdminPassportTypes"));
const AdminPassportModules = lazy(() => import("../../admin/passport-modules/AdminPassportModules"));
const AdminCreatePassportType = lazy(() => import("../../admin/passport-types/AdminCreatePassportTypePage"));
const AdminPassportTypeFields = lazy(() => import("../../admin/passport-types/AdminPassportTypeFields"));
const AdminSecurity = lazy(() => import("../../admin/pages/AdminSecurity"));

function RouteFallback() {
  return <div className="loading dashboard-loading-screen">Loading…</div>;
}

function CreatePassportRoute({ user, companyId }) {
  const { passportType } = useParams();
  if (user?.role === "viewer") return <Navigate to={buildUserDashboardHomePath({ user, companyId })} replace />;
  return <PassportForm mode="create" passportType={passportType}
           user={user} companyId={companyId} />;
}

function EditPassportRoute({ user, companyId }) {
  if (user?.role === "viewer") return <Navigate to={buildUserDashboardHomePath({ user, companyId })} replace />;
  return <PassportForm mode="edit" user={user} companyId={companyId} />;
}

function TemplateEditRoute({ user, companyId }) {
  const { templateId } = useParams();
  return <TemplatesPage user={user} companyId={companyId} view="edit" editTemplateId={templateId} />;
}

function App() {
  const {
    authReady,
    companyId,
    handleLogout,
    handleUserUpdate,
    setCompanyId,
    setIsAuthenticated,
    setUser,
    isAuthenticated,
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
      <AppSkipLink />
      <main id="app-main-content">
      <Routes>
        {/* Public */}
        <Route path="/"                element={<Landing isAuthenticated={isAuthenticated} user={user} onLogout={handleLogout} />} />
        <Route path="/login"           element={<Login    setIsAuthenticated={setIsAuthenticated} setUser={setUser} setCompanyId={setCompanyId} />} />
        <Route path="/register"        element={<Register setIsAuthenticated={setIsAuthenticated} setUser={setUser} setCompanyId={setCompanyId} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/oauth/callback"  element={<OAuthCallback setIsAuthenticated={setIsAuthenticated} setUser={setUser} setCompanyId={setCompanyId} />} />

        {/* Passport viewer — protected previews */}
        <Route path="/dpp/preview/:manufacturerSlug/:modelSlug/:previewId/technical/*" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <PassportViewer previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/dpp/preview/:manufacturerSlug/:modelSlug/:previewId" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <PassportViewer previewMode={true} previewCompanyId={companyId} />
          </ProtectedRoute>
        } />
        {/* CSV Import */}
        <Route path="/csv-import/:passportType" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <Navigate to="create-csv" replace />
          </ProtectedRoute>
        } />
        <Route path="/csv-import/:passportType/create-csv" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <CSVImportGuide user={user} companyId={companyId} activeTab="create-csv" />
          </ProtectedRoute>
        } />
        <Route path="/csv-import/:passportType/create-json" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <CSVImportGuide user={user} companyId={companyId} activeTab="create-json" />
          </ProtectedRoute>
        } />

        {/* Dashboard */}
        <Route path="/dashboard/:companySlug" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <DashboardLayout user={user} companyId={companyId} onLogout={handleLogout} />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview"      element={<Overview companyId={companyId} />} />
          <Route path="my-passports"  element={<PassportList user={user} companyId={companyId} filterByUser={true} />} />
          <Route path="passports/product/:productKey" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="passports/productCategory/:productCategoryKey" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="passports/:dppId/diff" element={<VersionDiff companyId={companyId} />} />
          <Route path="passports/:dppId/history" element={<VersionDiff companyId={companyId} />} />
          <Route path="passports/:passportType" element={<PassportList user={user} companyId={companyId} filterByUser={false} />} />
          <Route path="notifications"   element={<NotificationsPage user={user} />} />
          <Route path="templates"       element={<TemplatesPage user={user} companyId={companyId} view="list" />} />
          <Route path="templates/new"   element={<TemplatesPage user={user} companyId={companyId} view="create" />} />
          <Route path="templates/:templateId/edit" element={<TemplateEditRoute user={user} companyId={companyId} />} />
          <Route path="create"          element={<CreateHub user={user} companyId={companyId} />} />
          <Route path="passport-data"   element={<PassportDataManagement user={user} companyId={companyId} />} />
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
          <Route path="dictionary" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version/terms/:slug" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version/*" element={<DictionaryBrowserPage />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={
          <AdminRoute isAuthenticated={isAuthenticated} user={user} authReady={authReady}>
            <AdminLayout user={user} onLogout={handleLogout} />
          </AdminRoute>
        }>
          <Route index element={<Navigate to="analytics" replace />} />
          <Route path="analytics"                    element={<AdminAnalytics />} />
          <Route path="companies"                    element={<AdminCompanies />} />
          <Route path="passport-types"               element={<AdminPassportTypes />} />
          <Route path="passport-modules"             element={<AdminPassportModules />} />
          <Route path="passport-types/new"           element={<AdminCreatePassportType />} />
          <Route path="passport-types/:typeName/edit"   element={<AdminCreatePassportType />} />
          <Route path="passport-types/:typeName/fields" element={<AdminPassportTypeFields />} />
          <Route path="invite"                       element={<AdminInvite />} />
          <Route path="admin-management"             element={<AdminSecurity user={user} />} />
          <Route path="manual"                       element={<ManualCenter mode="admin" user={user} companyId={companyId} />} />
          <Route path="company/:companyId/access"    element={<CompanyAccess />} />
          <Route path="company/:companyId/edit"      element={<AdminEditCompanyPage />} />
          <Route path="analytics/:companySlug"        element={<AdminCompanyAnalytics />} />
          <Route path="dictionary" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version/terms/:slug" element={<DictionaryBrowserPage />} />
          <Route path="dictionary/:family/:version/*" element={<DictionaryBrowserPage />} />
        </Route>

        {/* Create / Edit */}
        <Route path="/create/:passportType" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <CreatePassportRoute user={user} companyId={companyId} />
          </ProtectedRoute>
        } />
        <Route path="/edit/:dppId" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} authReady={authReady}>
            <EditPassportRoute user={user} companyId={companyId} />
          </ProtectedRoute>
        } />

        <Route path="/dictionary" element={<DictionaryBrowserPage />} />
        <Route path="/dictionary/:family/:version" element={<DictionaryBrowserPage />} />
        <Route path="/dictionary/:family/:version/terms/:slug" element={<DictionaryBrowserPage />} />
        <Route path="/dictionary/:family/:version/*" element={<DictionaryBrowserPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>
      </Suspense>
    </I18nProvider>
  );
}

export default App;
