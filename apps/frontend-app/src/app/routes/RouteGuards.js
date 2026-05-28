import React from "react";
import { Navigate } from "react-router-dom";
import { buildUserDashboardHomePath } from "../../user/dashboard/utils/dashboardRoutes";

export function ProtectedRoute({ token, authReady, children }) {
  if (!authReady) return null;
  return token ? children : <Navigate to="/login" replace />;
}

export function AdminRoute({ token, user, authReady, children }) {
  if (!authReady) return null;
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== "super_admin") return <Navigate to={buildUserDashboardHomePath({ user })} replace />;
  return children;
}
