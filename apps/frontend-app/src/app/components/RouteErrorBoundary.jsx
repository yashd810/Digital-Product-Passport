import React from "react";

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Route rendering failed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="route-load-error" role="alert">
        <div className="route-load-error-card">
          <span className="route-load-error-icon" aria-hidden="true">↻</span>
          <h1>This page could not be loaded</h1>
          <p>
            The application may have been updated while this page was open.
            Reload to use the latest version.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
