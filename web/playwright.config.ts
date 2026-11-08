import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real app in the locally installed Chrome
 * (no browser download needed). The builder works without the engine.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    channel: "chrome",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // The engine (import API). AI features stay off in tests.
      command: ".venv\\Scripts\\python.exe -m uvicorn resume_engine.api.main:app --port 8001",
      cwd: "../engine",
      url: "http://127.0.0.1:8001/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { RESUME_ENGINE_LLM: "off", RESUME_ENGINE_CORS_ORIGINS: "http://localhost:5174" },
    },
    {
      // E2E_PROD=1 tests the production bundle (lazy chunks, worker and font paths) instead of the dev server.
      command: process.env.E2E_PROD
        ? "npx vite build && npx vite preview --port 5174 --strictPort"
        : "npx vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ENGINE_URL: "http://127.0.0.1:8001" },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
  ],
});
