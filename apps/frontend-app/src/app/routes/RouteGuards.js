import React from "react";
import { Navigate } from "react-router-dom";
import { buildUserDashboardHomePath } from "../../user/dashboard/utils/dashboardRoutes";

export function ProtectedRoute({ isAuthenticated, authReady, children }) {
  if (!authReady) return null;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export function AdminRoute({ isAuthenticated, user, authReady, children }) {
  if (!authReady) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== "super_admin") return <Navigate to={buildUserDashboardHomePath({ user })} replace />;
  return children;
}
