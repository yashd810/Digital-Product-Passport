import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const ConsumerPage = lazy(() => import("@frontend/passport-viewer/containers/ConsumerPage"));
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
        <Route path="/p/:productId" element={<ConsumerPage />} />
        <Route path="/p/inactive/:productId/:versionNumber" element={<ConsumerPage />} />

        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber" element={<ConsumerPage />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId/technical/*" element={<PassportViewer />} />
        <Route path="/dpp/:manufacturerSlug/:modelSlug/:productId" element={<ConsumerPage />} />

        <Route path="/passport/inactive/:productId/:versionNumber/technical/*" element={<PassportViewer />} />
        <Route path="/passport/inactive/:productId/:versionNumber" element={<ConsumerPage />} />
        <Route path="/passport/:productId/technical/*" element={<PassportViewer />} />
        <Route path="/passport/:productId" element={<ConsumerPage />} />

        <Route path="/" element={<Navigate to="/passport/not-found" replace />} />
        <Route path="/passport/not-found" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
