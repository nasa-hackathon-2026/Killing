import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { snapshotStatic } from "./snapshot-static.ts";

export default defineConfig({
  base: "/earth-system-trend-detective/",
  plugins: [react(), tailwindcss(), snapshotStatic()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        lab: "lab/index.html",
        mining: "mining/index.html",
        compare: "compare/index.html",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
