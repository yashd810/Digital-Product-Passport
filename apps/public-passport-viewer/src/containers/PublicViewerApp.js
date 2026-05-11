import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const PassportViewer = lazy(() => import("@frontend/passport-viewer/containers/PassportViewerPage"));
const PublicPassportRedirectPage = lazy(() => import("@frontend/passport-viewer/containers/PublicPassportRedirectPage"));

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
        <Route path="/p/:productId" element={<PublicPassportRedirectPage />} />
        <Route path="/p/inactive/:productId/:versionNumber" element={<PublicPassportRedirectPage />} />

        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId" element={<PassportViewer />} />

        <Route path="/" element={<Navigate to="/p/not-found" replace />} />
        <Route path="/p/not-found" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
