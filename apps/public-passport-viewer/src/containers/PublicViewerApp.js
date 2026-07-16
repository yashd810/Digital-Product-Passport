import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const PassportViewer = lazy(() => import("@frontend/passport-viewer/containers/PassportViewerPage"));

function RouteFallback() {
  return <div className="loading dashboard-loading-screen">Loading…</div>;
}

function NotFound() {
  return (
    <div className="loading dashboard-loading-screen">
      Public passport page not found.
    </div>
  );
}

export default function PublicViewerApp() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:dppId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:dppId/:versionNumber" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:dppId/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:dppId" element={<PassportViewer />} />

        <Route path="/" element={<Navigate to="/not-found" replace />} />
        <Route path="/not-found" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
