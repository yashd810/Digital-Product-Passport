// Application shell: providers and browser-wide UI; routes live in AppRoutes.
import React, { Suspense, useEffect } from "react";

import "../styles/App.css";
import AppSkipLink from "../components/AppSkipLink";
import RouteErrorBoundary from "../components/RouteErrorBoundary";
import { useSessionAuth } from "../hooks/useSessionAuth";
import { I18nProvider, useI18n } from "../providers/i18n";
import { applyTheme, getStoredTheme } from "../providers/ThemeContext";
import { AppRoutes } from "../routes/AppRoutes";

/**
 * Dashboard application shell.
 *
 * Owns cross-cutting browser concerns—session hydration, theme setup,
 * providers, accessibility landmarks, and route error handling. Product route
 * definitions live separately in `app/routes/AppRoutes.jsx`.
 */
function RouteFallback() {
  const { t } = useI18n();
  return <div className="loading dashboard-loading-screen">{t("appLoading")}</div>;
}

export default function App() {
  const session = useSessionAuth();

  useEffect(() => {
    const userId = JSON.parse(localStorage.getItem("user") || "null")?.id;
    applyTheme(getStoredTheme(userId));
  }, []);

  return (
    <I18nProvider>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <AppSkipLink />
          <main id="app-main-content">
            <AppRoutes {...session} />
          </main>
        </Suspense>
      </RouteErrorBoundary>
    </I18nProvider>
  );
}
