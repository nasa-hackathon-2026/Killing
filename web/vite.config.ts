import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { snapshotStatic } from "./snapshot-static.ts";

export default defineConfig({
  base: "/earth-system-trend-detective/",
  plugins: [react(), snapshotStatic()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        lab: "lab/index.html",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
