import path from "path";
import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";

const frontendSrc = path.resolve(__dirname, "../frontend-app/src");

export default defineConfig({
  plugins: [
    {
      name: "treat-js-as-jsx",
      enforce: "pre",
      async transform(code, id) {
        if (!id.match(/\/src\/.*\.js$/) && !id.startsWith(frontendSrc)) return null;
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
