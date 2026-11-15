import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComparePage } from "./compare/ComparePage";
import { initI18n } from "./i18n";
import "./index.css";
import "./theme/controls.css";
import "./mining/mining.css";
import "./compare/compare.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

// The language is known before the first render (web/src/i18n).
void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <ComparePage />
    </StrictMode>,
  );
});
