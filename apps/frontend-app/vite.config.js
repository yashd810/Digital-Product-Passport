import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

const developmentSecurityHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default defineConfig({
  plugins: [
    {
      name: 'treat-js-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.match(/\/src\/.*\.js$/)) return null;
        return transformWithOxc(code, id, {
          lang: 'jsx',
          jsx: {
            runtime: 'automatic',
            importSource: 'react',
          },
        });
      },
    },
    react({
      include: /\.(js|jsx|mjs|cjs|ts|tsx)$/,
    }),
  ],
  server: {
    host: 'localhost',
    port: 3000,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: { origin: /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/ },
    open: false,
    headers: developmentSecurityHeaders,
    fs: {
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
        '**/.git/**', 'package-lock.json', 'Dockerfile',
      ],
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/resolve': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/contexts': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/dictionary': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: 'localhost',
    port: 3000,
    strictPort: true,
    allowedHosts: ['localhost'],
    headers: developmentSecurityHeaders,
  },
  build: {
    rolldownOptions: {
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
  test: {
    environment: "node",
    css: false,
    globals: true,
  },
});
