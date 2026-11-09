/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { tailwindScanFallback } from "./vite/tailwindScanFallback.ts";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  // tailwindScanFallback must come before tailwindcss(); it does nothing where Tailwind can scan files itself.
  plugins: [react(), tailwindScanFallback({ root: fileURLToPath(new URL(".", import.meta.url)), css: "src/index.css" }), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": ENGINE_URL },
    // Allow importing ../shared/schema (the engine's JSON Schema, single source of truth).
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    // Test runs write screenshots and traces here; watching them made the dev server stall
    // mid-test (slow page loads, analysis timeouts) on this machine.
    watch: { ignored: ["**/e2e/.results/**", "**/test-results/**", "**/playwright-report/**", "**/.shots/**"] },
  },
  build: {
    // react-pdf + docx (~510 kB gzip) and pdf.js are large but lazy-loaded only in the
    // editor, so they never slow down the first page load.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "vite/**/*.test.ts"],
  },
});
