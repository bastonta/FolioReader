import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

// Disable default browser context menu to ensure a native application experience
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  // Allow native menu only for text inputs/textareas
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }
  e.preventDefault();
});

if (import.meta.env.DEV) {
  const iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (iconLink) iconLink.href = "/icon-dev.png";
  const splashIcon = document.querySelector<HTMLImageElement>(".android-splash-icon");
  if (splashIcon) splashIcon.src = "/icon-dev.png";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

