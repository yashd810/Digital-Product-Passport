import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import PublicViewerApp from "../containers/PublicViewerApp";
import "@frontend/app/styles/index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <PublicViewerApp />
    </BrowserRouter>
  </React.StrictMode>
);
