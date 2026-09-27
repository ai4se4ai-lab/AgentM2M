import { defineConfig, devices } from "@playwright/test";

/**
 * These e2e tests run against the REAL engine (apps/engine, port 4000) and
 * the REAL local Ollama server — no mocked network responses. Nothing here
 * stubs `/api/*`; the "launch a run" test genuinely waits on a local LLM
 * call, which is why its timeout is generous.
 *
 * Start both services before running `npx playwright test`:
 *   DATA_DIR=/tmp/agentm2m-dashboard-dev-data PORT=4000 node ../engine/dist/main.js &
 *   npx next dev -p 3011 &
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.PW_BASE_URL || "http://localhost:3011",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
