import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import packageJson from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;
const buildTime = new Date().toISOString();
const rawVersion =
  process.env.APP_VERSION ||
  process.env.VITE_APP_VERSION ||
  process.env.GITHUB_REF_NAME ||
  packageJson.version;
const appVersion = String(rawVersion).replace(/^v/, "");

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
