import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import PublicViewerApp from "../containers/PublicViewerApp";
import "@frontend/app/styles/index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <PublicViewerApp />
    </BrowserRouter>
  </React.StrictMode>
);
