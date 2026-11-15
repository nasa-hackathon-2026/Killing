import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { snapshotStatic } from "./snapshot-static.ts";

export default defineConfig({
  base: "/earth-system-trend-detective/",
  plugins: [react(), tailwindcss(), snapshotStatic()],
  build: {
    // Third-party code is split from the app's own, so a change to the app
    // does not make visitors download three.js again (#201).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            // The few three.js classes the page's own code uses (Vector3,
            // geometries) are in three.core; the WebGPU renderer, the node
            // material system and react-three-fiber are the globe's, and
            // load with it.
            {
              name: "three-core",
              test: /node_modules[\\/]three[\\/]build[\\/]three\.(core|module)\.js/,
              priority: 30,
            },
            {
              name: "three-renderer",
              test: /node_modules[\\/](three|@react-three|three-stdlib|troika-[^\\/]+|@monogrid|its-fine|zustand|suspend-react|react-use-measure)[\\/]/,
              priority: 20,
            },
            {
              name: "vendor-radix",
              test: /node_modules[\\/](@radix-ui|radix-ui|@floating-ui|aria-hidden|react-remove-scroll[^\\/]*|react-style-singleton|use-callback-ref|use-sidecar|get-nonce)[\\/]/,
            },
          ],
        },
      },
    },
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
