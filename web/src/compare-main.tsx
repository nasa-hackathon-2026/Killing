import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComparePage } from "./compare/ComparePage";
import "./index.css";
import "./theme/controls.css";
import "./mining/mining.css";
import "./compare/compare.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
);
