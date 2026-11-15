import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initI18n } from "./i18n";
import "./index.css";
import "./theme/controls.css";

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
