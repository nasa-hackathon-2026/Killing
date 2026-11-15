import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initI18n } from "./i18n";
import "./index.css";
import "./theme/controls.css";
import "./theme/tailwind.css";

// The globe is a separate chunk (App.tsx); start fetching it now, in parallel
// with the page's own code, instead of when the first render asks for it.
void import("./scene/EarthCanvas");

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

// The language and the role are known before the first render.
void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
