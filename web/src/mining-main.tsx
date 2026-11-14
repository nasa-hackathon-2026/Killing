import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MiningPage } from "./mining/MiningPage";
import "./index.css";
import "./mining/mining.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <MiningPage />
  </StrictMode>,
);
