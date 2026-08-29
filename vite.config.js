import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],

  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Tuned for old hardware (Surface Pro 3 / Haswell / HD 4400):
  // WebView2 + WKWebView + WebKitGTK all support es2021, so we ship no
  // transpiler shims and no legacy polyfills. Smaller bundle = faster
  // cold start and less JIT work on a 2014 CPU.
  build: {
    target: "es2021",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    modulePreload: { polyfill: false },
  },
  esbuild: {
    legalComments: "none",
  },
});
