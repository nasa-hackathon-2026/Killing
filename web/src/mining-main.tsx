import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MiningPage } from "./mining/MiningPage";
import { initI18n } from "./i18n";
import "./index.css";
import "./theme/controls.css";
import "./theme/tailwind.css";
import "./mining/mining.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

// The language is known before the first render (web/src/i18n).
void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <MiningPage />
    </StrictMode>,
  );
});
