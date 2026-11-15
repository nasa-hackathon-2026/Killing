import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FormLab } from "./lab/FormLab";
import "./index.css";
import "./theme/controls.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <FormLab />
  </StrictMode>,
);
