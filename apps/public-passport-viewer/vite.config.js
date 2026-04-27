import path from "path";
import fs from "fs";
import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";

const localFrontendSrc = path.resolve(__dirname, "./frontend-app/src");
const siblingFrontendSrc = path.resolve(__dirname, "../frontend-app/src");
const frontendSrc = fs.existsSync(localFrontendSrc) ? localFrontendSrc : siblingFrontendSrc;
const appNodeModules = path.resolve(__dirname, "node_modules");
const resolveAppDependency = (pkg) => {
  const localPackage = path.resolve(appNodeModules, pkg);
  return fs.existsSync(localPackage) ? localPackage : pkg;
};

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
    alias: [
      { find: "@frontend", replacement: frontendSrc },
      // Shared source files are imported from ../frontend-app/src, so pin core deps
      // to this app's install instead of relying on a repo-root node_modules.
      { find: "react-router-dom", replacement: resolveAppDependency("react-router-dom") },
      { find: "react-dom", replacement: resolveAppDependency("react-dom") },
      { find: "react", replacement: resolveAppDependency("react") },
      { find: "qrcode", replacement: resolveAppDependency("qrcode") },
    ],
    dedupe: ["react", "react-dom", "react-router-dom"],
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
