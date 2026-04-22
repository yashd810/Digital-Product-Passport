import path from "path";
import fs from "fs";
import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";

const localFrontendSrc = path.resolve(__dirname, "./frontend-app/src");
const siblingFrontendSrc = path.resolve(__dirname, "../frontend-app/src");
const frontendSrc = fs.existsSync(localFrontendSrc) ? localFrontendSrc : siblingFrontendSrc;

export default defineConfig({
  plugins: [
    {
      name: "treat-js-as-jsx",
      enforce: "pre",
      async transform(code, id) {
        const isJsSource =
          id.match(/\/src\/.*\.[mc]?jsx?$/) ||
          (id.startsWith(frontendSrc) && id.match(/\.[mc]?jsx?$/));
        if (!isJsSource) return null;
        return transformWithEsbuild(code, id, { loader: "jsx" });
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      "@frontend": frontendSrc,
    },
  },
  server: {
    host: "localhost",
    port: 3004,
    open: false,
    fs: {
      allow: [
        path.resolve(__dirname, ".."),
      ],
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx",
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "router";
          if (id.includes("qrcode")) return "qrcode";
          if (id.includes("react")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
});
