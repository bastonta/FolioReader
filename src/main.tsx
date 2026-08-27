import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

// Disable default browser context menu in production / release builds
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

