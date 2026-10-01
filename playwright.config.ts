import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT, E2E_WORKER_HEALTH_PORT } from "./tests/e2e/support/env";

/**
 * E2E tests run against a production build (`npm run build` first) backed by a
 * dedicated database (E2E_DATABASE_URL) and a local SMTP sink started in global setup.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /responsive/ },
    {
      name: "tablet-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } },
      testMatch: /responsive/,
    },
  ],
  webServer: [
    {
      command: `npx next start -p ${E2E_PORT}`,
      url: `http://localhost:${E2E_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: E2E_ENV,
    },
    {
      // Background worker: processes webhooks and sends messages.
      command: "npx tsx --conditions=react-server worker/index.ts",
      url: `http://127.0.0.1:${E2E_WORKER_HEALTH_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...E2E_ENV, WORKER_HEALTH_PORT: String(E2E_WORKER_HEALTH_PORT) },
    },
  ],
});
